// Prompt revision: the switch in the configuration's settings, the hook with a fake API client
// (never the real API), and the model choice.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { type Client, FALLBACK_MODEL, keepsHardTokens, HOOK_COMMAND, currentModel, logFile, readLog, pendingMessages, reviseSession, windowSpan, type LogEntry, disable, enable, isEnabled, keyFile, readBackend, readKey, runHook, saveBackend, saveKey } from "../core/revision.ts";
import type { Session } from "../core/sessions.ts";
import { state } from "../core/state.ts";
import { parseTranscript, readRevisions, renderArchive, revise as applyRevisions, revisionsFile } from "../skills/session-archive/scripts/archive-session.ts";
import { quiet, withConfig } from "./helpers.ts";

function setup(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-revision-"));
  const saved = process.env.DOTAGENTS_STATE_DIR;
  process.env.DOTAGENTS_STATE_DIR = path.join(root, "state");
  t.after(() => {
    saved === undefined ? delete process.env.DOTAGENTS_STATE_DIR : (process.env.DOTAGENTS_STATE_DIR = saved);
    state.dryRun = false;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const config = path.join(root, "config");
  fs.mkdirSync(path.join(config, "claude"), { recursive: true });
  withConfig(t, config);
  const settings = path.join(config, "claude", "settings.json");
  quiet();
  return { root, settings };
}

// A fake API: answers every request with `reply` (or throws it), and lists `models`.
function fakeClient(reply: string | Error, models = [{ id: "claude-sonnet-5-5", created_at: "2026-10-01T00:00:00Z" }]) {
  const calls: unknown[] = [];
  const client: Client = {
    messages: {
      async create(params) {
        calls.push(params);
        if (reply instanceof Error) throw reply;
        return { stop_reason: "end_turn", content: [{ type: "text", text: reply }], usage: { input_tokens: 300, output_tokens: 30 } } as never;
      },
    },
    models: {
      async *list() {
        yield* models;
      },
    },
  };
  return { client, calls };
}

// What a revision through the Claude account returns, as `claude -p --output-format json` reports it.
const said = (text: string) => ({ text, model: "claude-sonnet-5-5", costUsd: 0.0005, tokens: { input: 2, cacheRead: 1708, cacheWrite: 0, output: 29 } });

const input = (prompt: string) => JSON.stringify({ session_id: "s", hook_event_name: "UserPromptSubmit", prompt });

test("revision is off until turned on; on and off keep the other settings and hooks, and a second run changes nothing", (t) => {
  const { settings } = setup(t);
  const other = { type: "command", command: "echo hi" };
  fs.writeFileSync(settings, JSON.stringify({ model: "opus", hooks: { UserPromptSubmit: [{ hooks: [other] }], Stop: [{ hooks: [other] }] } }));
  const repo = "/unused";
  assert.equal(isEnabled(repo), false);

  state.dryRun = true;
  enable(repo);
  assert.equal(isEnabled(repo), false, "dry run writes nothing");
  state.dryRun = false;

  enable(repo);
  const before = fs.readFileSync(settings, "utf8");
  enable(repo);
  assert.equal(fs.readFileSync(settings, "utf8"), before, "idempotent");
  const on = JSON.parse(before);
  assert.equal(on.model, "opus");
  assert.deepEqual(on.hooks.UserPromptSubmit.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command)), ["echo hi", HOOK_COMMAND]);
  assert.equal(isEnabled(repo), true);

  disable(repo);
  disable(repo);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, "utf8")), { model: "opus", hooks: { UserPromptSubmit: [{ hooks: [other] }], Stop: [{ hooks: [other] }] } });

  // Turned on and off in a settings file with no hooks, it leaves no empty hooks key.
  fs.writeFileSync(settings, "{}");
  enable(repo);
  disable(repo);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, "utf8")), {});
});

test("by default the hook revises through the Claude account, shows and hands over the result, and stays silent when there is nothing to change or it fails", async (t) => {
  setup(t);
  assert.equal(readBackend(), "claude");
  const asked: string[] = [];
  const claude = async (text: string) => (asked.push(text), said("Você pode escrever a regra?"));
  const out = await runHook(input("vc pode escrever a rule?"), { claude, client: fakeClient(new Error("not used")).client });
  assert.equal(out?.systemMessage, "Você pode escrever a regra?");
  assert.match(out!.hookSpecificOutput.additionalContext, /Você pode escrever a regra\?[\s\S]*the original wins[\s\S]*ask before acting/);
  assert.deepEqual(asked, ["vc pode escrever a rule?"]);
  assert.equal(await runHook(input("Sim."), { claude: async () => said("Sim.") }), null, "unchanged: nothing shown");
  assert.equal(await runHook(input("sim"), { claude: async () => null }), null, "claude failed or timed out: the prompt goes through");
  assert.equal(await runHook(input("/model opus"), { claude }), null, "slash commands are left alone");
  assert.equal(await runHook("not json", { claude }), null);
  assert.equal(asked.length, 1, "none of those reached the model");
  const long = "x ".repeat(5_000);
  assert.notEqual(await runHook(input(long), { claude: async () => said(long.trim() + ".") }), null, "a long message is revised too");
});

test("with --api, the hook revises through the API key with the newest Sonnet, capped", async (t) => {
  setup(t);
  saveBackend("api");
  assert.equal(readBackend(), "api");
  const { client, calls } = fakeClient("Você pode escrever a regra?");
  const out = await runHook(input("vc pode escrever a rule?"), { client, claude: async () => said("not used") });
  assert.equal(out?.systemMessage, "Você pode escrever a regra?");
  const params = calls[0] as { model: string; thinking: unknown; output_config: unknown; messages: { content: string }[] };
  assert.equal(params.model, "claude-sonnet-5-5");
  assert.deepEqual(params.thinking, { type: "between_tools" });
  assert.deepEqual(params.output_config, { effort: "low" });
  assert.equal(params.messages[0].content, "vc pode escrever a rule?");

  assert.equal(await runHook(input("sim"), { client: fakeClient(new Error("network")).client }), null, "a failure lets the prompt through");
  assert.equal(await runHook(input("vc")), null, "no API key: nothing to do");
  saveBackend("claude");
  assert.equal(readBackend(), "claude");
});

test("the API key is kept readable only by the user, and the model is the newest Sonnet, checked once a day", async (t) => {
  setup(t);
  assert.equal(readKey(), null);
  saveKey("  sk-ant-test  ");
  assert.equal(readKey(), "sk-ant-test");
  if (process.platform !== "win32") assert.equal(fs.statSync(keyFile()).mode & 0o777, 0o600);

  const models = [
    { id: "claude-opus-5-5", created_at: "2026-11-01T00:00:00Z" },
    { id: "claude-sonnet-5-5", created_at: "2026-10-01T00:00:00Z" },
    { id: "claude-sonnet-5", created_at: "2025-10-01T00:00:00Z" },
    { id: "claude-haiku-5-5", created_at: "2026-10-02T00:00:00Z" },
  ];
  const now = Date.parse("2026-11-13T12:00:00Z");
  assert.equal(await currentModel(fakeClient("", models).client, now), "claude-sonnet-5-5");
  const newer = [...models, { id: "claude-sonnet-6", created_at: "2026-11-10T00:00:00Z" }];
  assert.equal(await currentModel(fakeClient("", newer).client, now + 1000), "claude-sonnet-5-5", "cached for a day");
  assert.equal(await currentModel(fakeClient("", newer).client, now + 2 * 86_400_000), "claude-sonnet-6");

  const broken: Client = { ...fakeClient("").client, models: { async *list() { throw new Error("down"); } } };
  assert.equal(await currentModel(broken, now + 10 * 86_400_000), FALLBACK_MODEL);
});

test("a revision that loses code, a URL, a path or a number is dropped", async (t) => {
  setup(t);
  const original = "vc pode ver `npm test` em src/a.ts:41 e https://x.dev/p? sao 3 erros";
  assert.equal(keepsHardTokens(original, "Você pode ver `npm test` em src/a.ts:41 e https://x.dev/p? São 3 erros."), true);
  for (const lost of ["Você pode ver npm test em src/a.ts:41 e https://x.dev/p? São 3 erros.", "Você pode ver `npm test` em src/a.ts e https://x.dev/p? São 3 erros.", "Você pode ver `npm test` em src/a.ts:41 e o link? São 3 erros.", "Você pode ver `npm test` em src/a.ts:41 e https://x.dev/p? São três erros."]) {
    assert.equal(keepsHardTokens(original, lost), false, lost);
    assert.equal(await runHook(input(original), { claude: async () => said(lost) }), null);
  }
});

test("each revision is logged with its cost, tokens and the signed-in account's quota at that moment", async (t) => {
  const { root } = setup(t);
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  Object.assign(process.env, { HOME: root, USERPROFILE: root });
  t.after(() => Object.assign(process.env, saved));
  fs.writeFileSync(path.join(root, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "uuid-work", emailAddress: "me@example.com" } }));
  const usage = path.join(process.env.DOTAGENTS_STATE_DIR!, "usage");
  fs.mkdirSync(usage, { recursive: true });
  fs.writeFileSync(path.join(usage, "work.json"), JSON.stringify({ version: 1, fetchedAtMs: Date.parse("2026-11-13T12:00:00Z"), accountUuid: "uuid-work", utilization: { five_hour: { utilization: 42 }, seven_day: { utilization: 7 } } }));
  fs.writeFileSync(path.join(usage, "other.json"), JSON.stringify({ version: 1, fetchedAtMs: 1, accountUuid: "uuid-other", utilization: { five_hour: { utilization: 99 } } }));

  await runHook(input("sim"), { claude: async () => said("Sim.") });
  await runHook(input("Pode."), { claude: async () => said("Pode.") });
  await runHook(input("falhou"), { claude: async () => null });
  const log = readLog();
  assert.equal(log.length, 2, "an unchanged revision is logged too, a failed one isn't");
  assert.equal(log[0].costUsd, 0.0005);
  assert.equal(log[0].tokens.output, 29);
  assert.deepEqual(log[0].quota, { profile: "work", fiveHourPct: 42, sevenDayPct: 7, fiveHourResetsAt: null, sevenDayResetsAt: null, readAt: "2026-11-13T12:00:00.000Z" });

  // Through the API the cost comes from the price list.
  saveBackend("api");
  await runHook(input("vc"), { client: fakeClient("Você.").client });
  const api = readLog().at(-1)!;
  assert.equal(api.backend, "api");
  assert.equal(api.costUsd, (300 * 2 + 30 * 10) / 1e6);
  fs.writeFileSync(logFile(), "not json\n");
  assert.deepEqual(readLog(), []);
});

test("a window's span never crosses its restart: by its end when logged, else by the percentage dropping", () => {
  const e = (fiveHourPct: number, fiveHourResetsAt: string | null = null, profile = "work") =>
    ({ at: "", backend: "claude", model: "m", costUsd: 0, tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, quota: { profile, fiveHourPct, sevenDayPct: 1, fiveHourResetsAt, sevenDayResetsAt: null, readAt: "" } }) as LogEntry;
  assert.deepEqual(windowSpan([e(80), e(92), e(3), e(9)], "fiveHour"), { from: 3, to: 9, revisions: 2 }, "the drop from 92 to 3 is a restart");
  const a = "2026-11-13T15:00:00.1+00:00", b = "2026-11-13T20:00:00.2+00:00";
  assert.deepEqual(windowSpan([e(5, a), e(5, b), e(7, "2026-11-13T20:00:00.9+00:00")], "fiveHour"), { from: 5, to: 7, revisions: 2 }, "another end is a restart, even at the same percentage");
  assert.deepEqual(windowSpan([e(1, null, "other"), e(2), e(4)], "fiveHour"), { from: 2, to: 4, revisions: 2 }, "and so is another account");
  assert.equal(windowSpan([], "fiveHour"), null);
});

test("a past session's messages are revised with the hook's rules, kept next to its archive, and a second run asks only for what was left", async (t) => {
  const { root } = setup(t);
  const project = path.join(root, "proj");
  fs.mkdirSync(path.join(project, ".artifacts", "session-archives"), { recursive: true });
  const file = path.join(root, "s.jsonl");
  const user = (text: string, uuid: string) => JSON.stringify({ type: "user", uuid, sessionId: "sid", timestamp: "2026-01-02T10:00:00.000Z", cwd: project, message: { role: "user", content: text } });
  fs.writeFileSync(file, [user("vc ve isso", "m1"), user("sim", "m2"), user("roda `npm test` ja", "m3"), user('<pasted_content id="x">log</pasted_content>', "m4"), user("falha esta", "m5"), user("ok", "m6")].join("\n") + "\n");
  const session = { file, root: project } as Pick<Session, "file" | "root">;

  const pending = pendingMessages(session)!;
  assert.deepEqual(pending.messages.map((m) => m.id), ["m1", "m2", "m3", "m5", "m6"], "pasted text is never revised");
  assert.equal(pendingMessages({ file, root: null }), null, "outside a project there is nowhere to keep revisions");

  const answers: Record<string, string | null> = { "vc ve isso": "Você vê isso?", sim: "Sim.", "roda `npm test` ja": "Roda npm test já.", "falha esta": null, ok: "ok" };
  const asked: string[] = [];
  const claude = async (text: string) => (asked.push(text), answers[text] == null ? null : said(answers[text]!));

  state.dryRun = true;
  assert.deepEqual(await reviseSession(pending, { claude }), { revised: 0, unchanged: 0, failed: 0 });
  assert.equal(asked.length, 0, "a dry run calls nothing");
  assert.equal(fs.existsSync(revisionsFile(pending.archive)), false);
  state.dryRun = false;

  // m3 lost its backticks and m5 failed: both are left for later; m6 came back as it was.
  assert.deepEqual(await reviseSession(pending, { claude }), { revised: 2, unchanged: 1, failed: 2 });
  assert.deepEqual(readRevisions(pending.archive), { m1: "Você vê isso?", m2: "Sim.", m6: "ok" });
  assert.deepEqual(pendingMessages(session)!.messages.map((m) => m.id), ["m3", "m5"]);
  assert.equal(readLog().length, 4, "each call that answered was logged, with its cost");
  const md = renderArchive(applyRevisions(parseTranscript(file), readRevisions(pending.archive)));
  assert.ok(md.includes("Você vê isso?") && md.includes("Sim.") && md.includes("roda `npm test` ja"));
});
