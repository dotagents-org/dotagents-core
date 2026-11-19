import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { costOf } from "../../core/accounts/prices.ts";
import { type Point, readHistory, readSpend, ratios, recordHistory, spendReport } from "../../core/accounts/spend.ts";
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
