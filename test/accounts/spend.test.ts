import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import zlib from "node:zlib";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { costOf } from "../../core/accounts/prices.ts";
import { type Point, readCodexSpend, readHistory, readSpend, ratios, recordHistory, spendReport } from "../../core/accounts/spend.ts";
import "../helpers.ts";

const A = "acct-work";
const B = "acct-personal";

function tmp(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-spend-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const owner = (account: string) => JSON.stringify({ type: "session-owner", accountUuid: account, sessionId: "s" });
const message = (id: string, at: string, usage: Record<string, unknown>, model = "claude-opus-5-5", cwd = "/work/app") =>
  JSON.stringify({ type: "assistant", timestamp: at, cwd, message: { id, model, usage } });

// A config folder with transcripts: { "<project>/<file>.jsonl": [lines] }
function configDir(t: TestContext, files: Record<string, string[]>) {
  const dir = tmp(t);
  for (const [rel, list] of Object.entries(files)) {
    const file = path.join(dir, "projects", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${list.join("\n")}\n`);
  }
  return [{ side: "Linux", dir }];
}

test("the history gets a line only when a window's % or reset changes", (t) => {
  const dir = tmp(t);
  const resets = new Date("2026-11-15T15:00:20Z");
  const windows = (session: number, week: number, r = resets) => [
    { kind: "session" as const, pct: session, resetsAt: r, reset: false },
    { kind: "week" as const, pct: week, resetsAt: new Date("2026-11-20T00:00:00Z"), reset: false },
  ];
  recordHistory("work", windows(10, 30), new Date("2026-11-15T10:00:00Z"), dir);
  recordHistory("work", windows(10, 30, new Date("2026-11-15T15:00:40Z")), new Date("2026-11-15T10:01:00Z"), dir); // the reset moved by seconds
  recordHistory("work", windows(12, 30), new Date("2026-11-15T10:02:00Z"), dir);
  const history = readHistory("work", dir);
  assert.deepEqual(history.map((p) => p.session), [10, 12]);
  assert.equal(history[0].sessionResetsAt, "2026-11-15T15:00:00.000Z");
});

test("the spend counts each message once, under the account its session ran as, subagents under their session's", (t) => {
  const usage = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 300, cache_creation: { ephemeral_1h_input_tokens: 100 }, output_tokens: 50 };
  const dirs = configDir(t, {
    "-work-app/s1.jsonl": [
      owner(A),
      message("m1", "2026-11-15T10:00:00Z", usage),
      message("m1", "2026-11-15T10:00:00Z", usage), // the same message, one line per content block
      owner(B), // the account switched mid-session
      message("m2", "2026-11-15T10:05:00Z", usage, "claude-sonnet-5-5"),
      message("old", "2026-11-14T10:00:00Z", usage), // before the interval
    ],
    "-work-app/s1/subagents/agent-1.jsonl": [message("m3", "2026-11-15T10:06:00Z", usage, "claude-haiku-5-5")],
  });
  const spend = readSpend(Date.parse("2026-11-15T00:00:00Z"), dirs);
  assert.deepEqual(spend.map((s) => [s.model, s.account]), [["claude-opus-5-5", A], ["claude-sonnet-5-5", B], ["claude-haiku-5-5", B]]);
  assert.deepEqual(spend[0].tokens, { input: 10, cacheRead: 1000, cacheWrite: 200, cacheWrite1h: 100, output: 50 });
  // by hand: 10×4 + 1000×0.2 + 200×4×1.25 + 100×4×2 + 50×20, per million
  assert.ok(Math.abs((spend[0].costUsd ?? 0) - (40 + 200 + 1000 + 800 + 1000) / 1e6) < 1e-12);
  assert.equal(costOf("an-unknown-model", spend[0].tokens), null);
});

test("1% is the spend between two readings of a window over the % it rose; a rise with no spend is unexplained", () => {
  const p = (at: string, session: number, resets = "2026-11-15T15:00:00.000Z"): Point => ({ at, session, week: 20, sessionResetsAt: resets, weekResetsAt: "2026-11-20T00:00:00.000Z" });
  const points = [p("2026-11-15T10:00:00Z", 10), p("2026-11-15T10:10:00Z", 12), p("2026-11-15T10:20:00Z", 15), p("2026-11-15T15:10:00Z", 1, "2026-11-15T20:00:00.000Z"), p("2026-11-15T15:20:00Z", 3, "2026-11-15T20:00:00.000Z")];
  const spend = (at: string, costUsd: number) => ({ at: Date.parse(at), account: A, model: "m", cwd: "", tokens: { input: 0, cacheRead: 1000, cacheWrite: 0, output: 0 }, costUsd });
  const [session, week] = ratios(points, [spend("2026-11-15T10:05:00Z", 0.4), spend("2026-11-15T10:06:00Z", 0.2), spend("2026-11-15T15:15:00Z", 0.6)]);
  // 10→12 cost 0.6 (2%), 12→15 nothing (3% unexplained), 15→1 is a new window, 1→3 cost 0.6 (2%)
  assert.equal(session.pairs, 2);
  assert.equal(session.explainedPct, 4);
  assert.equal(session.unexplainedPct, 3);
  assert.ok(Math.abs((session.usdPerPct ?? 0) - 0.3) < 1e-12);
  assert.equal(session.tokensPerPct, 750);
  assert.equal(week.usdPerPct, null); // the week never rose
});

test("the report puts the current window's spend by model and folder, and counts what no profile ran", (t) => {
  const dir = tmp(t);
  const saved = process.env.DOTAGENTS_STATE_DIR;
  process.env.DOTAGENTS_STATE_DIR = dir;
  t.after(() => (process.env.DOTAGENTS_STATE_DIR = saved));
  recordHistory("work", [{ kind: "session", pct: 5, resetsAt: new Date("2026-11-15T12:00:00Z") }], new Date("2026-11-15T09:00:00Z"));
  const usage = { input_tokens: 0, output_tokens: 1000 };
  const dirs = configDir(t, {
    "-work-app/s1.jsonl": [owner(A), message("m1", "2026-11-15T08:00:00Z", usage), message("m2", "2026-11-15T09:30:00Z", usage, "claude-sonnet-5-5", "/work/api")],
    "-work-x/s2.jsonl": [owner("someone-else"), message("m3", "2026-11-15T09:40:00Z", usage)],
  });
  const { profiles, unattributedUsd } = spendReport([{ name: "work", accountUuid: A }], { now: Date.parse("2026-11-15T10:00:00Z"), dirs });
  const w = profiles[0].session;
  assert.equal(w?.from, "2026-11-15T07:00:00.000Z");
  assert.deepEqual(w?.models.map(([m]) => m), ["claude-opus-5-5", "claude-sonnet-5-5"]);
  assert.deepEqual(w?.workspaces.map(([f]) => f), ["/work/app", "/work/api"]);
  assert.ok(Math.abs((w?.totalUsd ?? 0) - (1000 * 20 + 1000 * 10) / 1e6) < 1e-12);
  assert.ok(Math.abs(unattributedUsd - (1000 * 20) / 1e6) < 1e-12);
});

test("ChatGPT's spend comes from Codex's rollouts, on the user that started each, in tokens with no price", (t) => {
  const dir = tmp(t);
  const saved = process.env.DOTAGENTS_STATE_DIR;
  process.env.DOTAGENTS_STATE_DIR = dir;
  t.after(() => (process.env.DOTAGENTS_STATE_DIR = saved));
  const resets = new Date("2026-11-15T12:00:00Z");
  recordHistory("hopper", [{ kind: "session", pct: 10, resetsAt: resets }], new Date("2026-11-15T09:00:00Z"));
  recordHistory("hopper", [{ kind: "session", pct: 12, resetsAt: resets }], new Date("2026-11-15T09:20:00Z"));
  const home = path.join(dir, "codex");
  const day = path.join(home, "sessions", "2026", "11", "15");
  fs.mkdirSync(day, { recursive: true });
  const usage = { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 1000 };
  const record = (at: string, id: string) => JSON.stringify({ timestamp: at, type: "token_usage_record", response_id: id, usage });
  fs.writeFileSync(path.join(day, "rollout-a.jsonl"), [
    JSON.stringify({ timestamp: "2026-11-15T09:00:00Z", type: "session_meta", payload: { id: "c1", cwd: "/work/shop", creator_user_id: "user-hopper" } }),
    JSON.stringify({ timestamp: "2026-11-15T09:00:01Z", type: "turn_context", payload: { model: "gpt-test-1" } }),
    record("2026-11-15T09:05:00Z", "r1"),
    record("2026-11-15T09:10:00Z", "r2"),
    record("2026-11-15T09:10:00Z", "r2"), // the same response twice: counted once
    record("2026-11-15T08:00:00Z", "r0"), // before the first reading: not in this rise
  ].join("\n"));
  const { profiles } = spendReport([{ name: "hopper", accountUuid: "user-hopper" }], { now: Date.parse("2026-11-15T09:30:00Z"), dirs: [], codex: [home] });
  const [session] = profiles[0].ratios;
  assert.deepEqual([session.usdPerPct, session.tokensPerPct, session.explainedPct], [null, 6000, 2]);
  assert.equal(profiles[0].session!.totalUsd, null);
  assert.equal(profiles[0].session!.totalTokens, 18000);
  assert.deepEqual(profiles[0].session!.models, [["gpt-test-1", 0, 18000]]);
  assert.deepEqual(profiles[0].session!.workspaces, [["/work/shop", 0, 18000]]);
});

test("a Codex rollout with only token_count events gives its spend from the running total's steps", (t) => {
  const dir = tmp(t);
  const home = path.join(dir, "codex");
  const day = path.join(home, "sessions", "2026", "11", "15");
  fs.mkdirSync(day, { recursive: true });
  const count = (at: string, input: number, cached: number, output: number) => JSON.stringify({ timestamp: at, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } } });
  fs.writeFileSync(path.join(day, "rollout-old.jsonl"), [
    JSON.stringify({ timestamp: "2026-11-15T09:00:00Z", type: "session_meta", payload: { id: "c1", cwd: "/work/shop", creator_user_id: "user-hopper" } }),
    JSON.stringify({ timestamp: "2026-11-15T09:00:00Z", type: "session_meta", payload: { id: "c2", cwd: "/elsewhere", creator_user_id: "user-other" } }), // a later one: not the conversation's
    count("2026-11-15T09:05:00Z", 5000, 4000, 1000),
    count("2026-11-15T09:05:00Z", 5000, 4000, 1000), // the same total again: no step
    count("2026-11-15T09:10:00Z", 8000, 6500, 1500),
  ].join("\n"));
  const spend = readCodexSpend(0, [home]);
  assert.deepEqual(spend.map((x) => [x.account, x.cwd, x.tokens.input, x.tokens.cacheRead, x.tokens.output]), [["user-hopper", "/work/shop", 1000, 4000, 1000], ["user-hopper", "/work/shop", 500, 2500, 500]]);
});

test("a rollout Codex archived (compressed, in archived_sessions) still counts toward the window's spend", (t) => {
  const dir = tmp(t);
  const home = path.join(dir, "codex");
  fs.mkdirSync(path.join(home, "archived_sessions"), { recursive: true });
  const text = [
    JSON.stringify({ timestamp: "2026-11-15T09:00:00Z", type: "session_meta", payload: { id: "c1", cwd: "/work/shop", creator_user_id: "user-hopper" } }),
    JSON.stringify({ timestamp: "2026-11-15T09:05:00Z", type: "token_usage_record", response_id: "r1", usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 1000 } }),
  ].join("\n");
  fs.writeFileSync(path.join(home, "archived_sessions", "rollout-2026-11-15T09-00-00-c1.jsonl.zst"), zlib.zstdCompressSync(text));
  // The compressed file the only source: if it can't be read, nothing is counted
  assert.deepEqual(readCodexSpend(0, [home]).map((x) => [x.account, x.tokens.output]), [["user-hopper", 1000]]);
  fs.writeFileSync(path.join(home, "archived_sessions", "rollout-2026-11-15T09-00-00-c2.jsonl"), text); // the same response, as plain text: counted once
  assert.deepEqual(readCodexSpend(0, [home]).map((x) => [x.account, x.tokens.output]), [["user-hopper", 1000]]);
});

test("a rollout that goes from token_count to token_usage_record counts both parts once, and a copy of it adds nothing", (t) => {
  const dir = tmp(t);
  const home = path.join(dir, "codex");
  fs.mkdirSync(path.join(home, "sessions", "2026", "11", "15"), { recursive: true });
  fs.mkdirSync(path.join(home, "archived_sessions"), { recursive: true });
  const count = (at: string, input: number, output: number) => JSON.stringify({ timestamp: at, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output } } } });
  const text = [
    JSON.stringify({ timestamp: "2026-11-15T09:00:00Z", type: "session_meta", payload: { id: "c1", cwd: "/w", creator_user_id: "user-hopper" } }),
    count("2026-11-15T09:05:00Z", 2000, 500), // before the update: from the total's step
    JSON.stringify({ timestamp: "2026-11-15T10:00:00Z", type: "token_usage_record", response_id: "r1", usage: { input_tokens: 3000, cached_input_tokens: 0, output_tokens: 700 } }),
    count("2026-11-15T10:00:00Z", 5000, 1200), // the same response's count: not twice
  ].join("\n");
  fs.writeFileSync(path.join(home, "sessions", "2026", "11", "15", "rollout-2026-11-15T09-00-00-c1.jsonl"), text);
  fs.writeFileSync(path.join(home, "archived_sessions", "rollout-2026-11-15T09-00-00-c1.jsonl"), text); // a copy
  assert.deepEqual(readCodexSpend(0, [home]).map((x) => x.tokens.output), [500, 700]);
});

test("a response's cache writes are counted once: input holds the reads and the writes, each on its own line", (t) => {
  const dir = tmp(t);
  const home = path.join(dir, "codex");
  fs.mkdirSync(path.join(home, "sessions", "2026", "11", "15"), { recursive: true });
  fs.writeFileSync(path.join(home, "sessions", "2026", "11", "15", "rollout-2026-11-15T09-00-00-c1.jsonl"), [
    JSON.stringify({ timestamp: "2026-11-15T09:00:00Z", type: "session_meta", payload: { id: "c1", cwd: "/w", creator_user_id: "u" } }),
    JSON.stringify({ timestamp: "2026-11-15T09:05:00Z", type: "token_usage_record", response_id: "r1", usage: { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 60, output_tokens: 10 } }),
  ].join("\n"));
  const [x] = readCodexSpend(0, [home]);
  assert.deepEqual([x.tokens.input, x.tokens.cacheRead, x.tokens.cacheWrite, x.tokens.output], [0, 40, 60, 10]);
});

test("after a switch --save to another account, a profile's history of the old one is not the new one's, and an empty ChatGPT window is tokens, not dollars", (t) => {
  const dir = tmp(t);
  const saved = process.env.DOTAGENTS_STATE_DIR;
  process.env.DOTAGENTS_STATE_DIR = dir;
  t.after(() => (process.env.DOTAGENTS_STATE_DIR = saved));
  const resets = new Date("2026-11-15T12:00:00Z");
  recordHistory("hopper", [{ kind: "session", pct: 10, resetsAt: resets }], new Date("2026-11-15T09:00:00Z"), undefined, "user-old");
  recordHistory("hopper", [{ kind: "session", pct: 40, resetsAt: resets }], new Date("2026-11-15T09:20:00Z"), undefined, "user-old");
  recordHistory("hopper", [{ kind: "session", pct: 5, resetsAt: resets }], new Date("2026-11-15T09:30:00Z"), undefined, "user-new");
  const now = Date.parse("2026-11-15T09:40:00Z");
  const { profiles } = spendReport([{ name: "hopper", accountUuid: "user-new", tokensOnly: true }], { now, dirs: [], codex: [] });
  const [session] = profiles[0].ratios;
  assert.equal(session.explainedPct + session.unexplainedPct, 0, "the old account's rise isn't counted");
  assert.deepEqual([profiles[0].session!.totalUsd, profiles[0].session!.totalTokens], [null, 0]);
});
