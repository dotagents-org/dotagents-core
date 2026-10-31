// The usage module: Claude Code's usage cache, read and normalized, with a fixed "now".

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { type ProfileUsage, type UsageWindow, bar, elapsedPct, faceOf, levelOf, normalize, pace, profileUsage, shortLines, span, thresholdAlerts, usageLines } from "../core/usage.ts";
import { sessionActivity } from "../core/claude-code.ts";

const NOW = new Date("2026-10-28T12:00:00Z");
const at = (iso: string) => new Date(iso);

// The cache as Claude Code writes it after /usage: the limits list and the older fields.
const cache = (accountUuid = "uuid-a", fetchedAt = "2026-10-28T11:50:00Z") => ({
  fetchedAtMs: at(fetchedAt).getTime(),
  accountUuid,
  utilization: {
    five_hour: { utilization: 40, resets_at: "2026-10-28T14:00:00+00:00" },
    seven_day: { utilization: 20, resets_at: "2026-11-03T21:59:59+00:00" },
    seven_day_opus: null,
    limits: [
      { kind: "session", group: "session", percent: 40, resets_at: "2026-10-28T14:00:00+00:00", scope: null },
      { kind: "weekly_all", group: "weekly", percent: 20, resets_at: "2026-11-03T21:59:59+00:00", scope: null },
      { kind: "weekly_scoped", group: "weekly", percent: 55, resets_at: "2026-11-03T21:59:59+00:00", scope: { model: { display_name: "Opus" } } },
    ],
  },
});

test("the limits list becomes session, week and per-model windows", () => {
  const usage = normalize(cache(), NOW);
  assert.ok(usage);
  assert.deepEqual(
    usage.windows.map((w) => [w.kind, w.model, w.pct, w.reset]),
    [
      ["session", undefined, 40, false],
      ["week", undefined, 20, false],
      ["model-week", "Opus", 55, false],
    ]
  );
  assert.equal(usage.fetchedAt.toISOString(), "2026-10-28T11:50:00.000Z");
});

test("without the limits list, the older fields are read; null windows are skipped", () => {
  const raw = cache();
  delete (raw.utilization as { limits?: unknown }).limits;
  const usage = normalize(raw, NOW);
  assert.deepEqual(
    usage?.windows.map((w) => [w.kind, w.pct]),
    [
      ["session", 40],
      ["week", 20],
    ]
  );
});

test("a window whose reset time has passed shows as reset, never with the old number", () => {
  const usage = normalize(cache(), at("2026-10-28T15:00:00Z"));
  assert.deepEqual(usage?.windows[0], { kind: "session", pct: 0, resetsAt: at("2026-10-28T14:00:00Z"), reset: true });
});

test("anything that isn't a usage cache gives no data", () => {
  for (const raw of [undefined, null, 3, {}, { utilization: { limits: "x" } }]) assert.equal(normalize(raw, NOW), null);
});

test("the pace says when a window runs out, or how much is left at reset", () => {
  // 40% used after 3 of 5 hours: at that rate, 66.7% at reset.
  assert.deepEqual(pace({ kind: "session", pct: 40, resetsAt: at("2026-10-28T14:00:00Z"), reset: false }, NOW), { leftAtReset: 33 });
  // 90% used after 3 hours: 100% after 3h20, at 12:20.
  assert.deepEqual(pace({ kind: "session", pct: 90, resetsAt: at("2026-10-28T14:00:00Z"), reset: false }, NOW), { runsOutAt: at("2026-10-28T12:20:00Z") });
  // Too early in the window, nothing used, or reset: no note.
  assert.equal(pace({ kind: "session", pct: 40, resetsAt: at("2026-10-28T16:50:00Z"), reset: false }, NOW), null);
  assert.equal(pace({ kind: "week", pct: 0, resetsAt: at("2026-11-03T21:59:59Z"), reset: false }, NOW), null);
});

test("the bar has the same width at every percentage: used, a gap, the rest", () => {
  for (const width of [8, 32])
    for (let pct = 0; pct <= 100; pct++) {
      const { used, rest } = bar(pct, width);
      assert.equal(used + rest + (used && rest ? 1 : 0), width, `${pct}% at ${width}`);
      if (pct > 0) assert.ok(used >= 1, `${pct}% shows`);
    }
  assert.deepEqual(bar(0, 8), { used: 0, rest: 8 });
  assert.deepEqual(bar(100, 8), { used: 8, rest: 0 });
  assert.deepEqual(bar(72, 8), { used: 6, rest: 1 });
  assert.deepEqual(bar(91, 8), { used: 6, rest: 1 }, "near the top the gap and one cell of track stay");
  assert.deepEqual(bar(72, 32), { used: 23, rest: 8 });
});

test("the level turns at 70% and 90%", () => {
  assert.equal(levelOf(69), "ok");
  assert.equal(levelOf(70), "warn");
  assert.equal(levelOf(89), "warn");
  assert.equal(levelOf(90), "high");
});

test("durations are short: <1m, 58m, 3h 17m, 4d 18h", () => {
  assert.equal(span(20_000), "<1m");
  assert.equal(span(58 * 60_000), "58m");
  assert.equal(span((3 * 60 + 17) * 60_000), "3h 17m");
  assert.equal(span(((4 * 24 + 18) * 60 + 5) * 60_000), "4d 18h");
});

const text = (lines: { text: string }[][]) => lines.map((l) => l.map((s) => s.text).join("")).join("\n");

const sample: ProfileUsage[] = [
  {
    name: "work",
    color: "#D77655",
    default: true,
    state: "ok",
    fetchedAt: at("2026-10-28T11:56:00Z"),
    windows: [
      { kind: "session", pct: 72, resetsAt: at("2026-10-28T15:17:00Z"), reset: false },
      { kind: "week", pct: 48, resetsAt: at("2026-11-02T05:00:00Z"), reset: false },
      { kind: "model-week", model: "Fable", pct: 59, resetsAt: at("2026-11-02T05:00:00Z"), reset: false },
    ],
  },
  { name: "personal", color: "#376B80", state: "not-signed-in", fetchedAt: null, windows: [] },
];

test("the usage view: the profile, then one aligned line per window, with no rail, dots or icons", () => {
  const out = text(usageLines(sample, NOW));
  assert.match(out, /^work {2}\[default\] {2}4m ago$/m);
  assert.match(out, /^ {2}5h {6}━{23} ─{8} {3}72% {2}resets 3h 17m$/m);
  assert.match(out, /^ {2}Fable {3}━+ ─+ {3}59%/m);
  assert.match(out, /^personal {2}not signed in, sign in with: claude-personal auth login$/m);
  assert.doesNotMatch(out, /[◇·⚠└●!]/);
  // The labels of every profile share one column.
  const starts = out.split("\n").filter((l) => l.includes("━")).map((l) => l.indexOf("━"));
  assert.equal(new Set(starts).size, 1);
});

test("from 70% the reset takes the level's color; below, it's muted, and so is a stale profile", () => {
  const segs = usageLines(sample, NOW).flat();
  assert.equal(segs.find((s) => s.text === "resets 3h 17m")?.role, "warn");
  assert.equal(segs.find((s) => s.text.startsWith("resets 4d"))?.role, "muted");
  assert.equal(segs.find((s) => s.text.trim() === "72%")?.bold, true);
  const stale = usageLines([{ ...sample[0], state: "stale", fetchedAt: at("2026-10-28T02:00:00Z") }], NOW).flat();
  assert.ok(stale.some((s) => s.text.includes("stale") && s.role === "warn"));
  assert.ok(stale.filter((s) => s.text.includes("━")).every((s) => s.role === "muted"));
});

test("the short view: one line per profile, 5h and 7d with 8-cell bars, the reset only from 70%", () => {
  const out = text(shortLines(sample, NOW));
  assert.equal(out.split("\n")[0], "work      5h ━━━━━━ ─  72% ↻ 3h17m   7d ━━━━ ───  48%");
  assert.equal(out.split("\n")[1], "personal  not signed in");
});

function tempProfile(t: TestContext, stateFile: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-usage-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (stateFile !== undefined) fs.writeFileSync(path.join(dir, ".claude.json"), JSON.stringify(stateFile));
  return { name: "personal", color: "#376B80", configDir: dir };
}

test("a profile's usage tells apart no sign-in, no data, someone else's cache and old data", (t) => {
  const signed = { oauthAccount: { accountUuid: "uuid-a" } };
  assert.equal(profileUsage(tempProfile(t, undefined), NOW).state, "not-signed-in");
  assert.equal(profileUsage(tempProfile(t, signed), NOW).state, "no-data");
  assert.equal(profileUsage(tempProfile(t, { ...signed, cachedUsageUtilization: cache("uuid-b") }), NOW).state, "other-account");
  assert.equal(profileUsage(tempProfile(t, { ...signed, cachedUsageUtilization: cache("uuid-a", "2026-10-28T02:00:00Z") }), NOW).state, "stale");
  const ok = profileUsage(tempProfile(t, { ...signed, cachedUsageUtilization: cache() }), NOW);
  assert.equal(ok.state, "ok");
  assert.equal(ok.windows.length, 3);
});

test("the face follows the most serious window: limit from 90%, warn from 70%, asleep without fresh data", () => {
  const profile = (pct: number, state: ProfileUsage["state"] = "ok"): ProfileUsage => ({
    name: "work",
    color: "#D77655",
    state,
    fetchedAt: NOW,
    windows: [{ kind: "week", pct, resetsAt: at("2026-11-04T12:00:00Z"), reset: false }],
  });
  assert.equal(faceOf([profile(20)], NOW), "ok");
  assert.equal(faceOf([profile(20), profile(75)], NOW), "warn");
  assert.equal(faceOf([profile(75), profile(95)], NOW), "limit");
  assert.equal(faceOf([profile(95, "stale")], NOW), "asleep");
});

test("the uniform pace mark is how much of the window has gone by", () => {
  const session: UsageWindow = { kind: "session", pct: 40, resetsAt: at("2026-10-28T14:00:00Z"), reset: false };
  assert.equal(elapsedPct(session, NOW), 60, "3 of the 5 hours");
  assert.equal(elapsedPct({ ...session, reset: true }, NOW), null);
  assert.equal(elapsedPct({ ...session, resetsAt: at("2026-10-28T20:00:00Z") }, NOW), 0, "never below the start");
});

test("a threshold notifies once per crossing, and again only after falling 5 points below it", () => {
  const at5h = (pct: number, state: ProfileUsage["state"] = "ok"): ProfileUsage[] => [
    { name: "work", color: "#D77655", state, fetchedAt: NOW, windows: [{ kind: "session", pct, resetsAt: at("2026-10-28T14:00:00Z"), reset: false }] },
  ];
  let levels: Record<string, number> = {};
  const step = (pct: number, state: ProfileUsage["state"] = "ok") => {
    const r = thresholdAlerts(at5h(pct, state), levels);
    levels = r.levels;
    return r.alerts.map((a) => `${a.window} ${a.level} ${a.pct}`);
  };
  assert.deepEqual(step(50), []);
  assert.deepEqual(step(71), ["5h warn 71"]);
  assert.deepEqual(step(69), [], "around 70%: no second notice");
  assert.deepEqual(step(72), []);
  assert.deepEqual(step(93), ["5h high 93"]);
  assert.deepEqual(step(20, "stale"), [], "a profile without fresh data keeps its levels");
  assert.deepEqual(step(91), []);
  assert.deepEqual(step(0), [], "reset");
  assert.deepEqual(step(75), ["5h warn 75"]);
  assert.deepEqual(step(95), ["5h high 95"]);
});

test("a config folder's running sessions count as working or waiting; idle ones and dead processes don't", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-sessions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "sessions"));
  const session = (pid: number, status: string) => fs.writeFileSync(path.join(dir, "sessions", `${pid}.json`), JSON.stringify({ pid, status, procStart: "1" }));
  session(10, "busy");
  session(11, "busy");
  session(12, "waiting");
  session(13, "idle");
  session(14, "busy");
  fs.writeFileSync(path.join(dir, "sessions", "15.json"), "{ half");
  const alive = (pid: number) => pid !== 14;
  assert.deepEqual(sessionActivity(dir, alive), { working: 2, waiting: 1 });
  assert.deepEqual(sessionActivity(path.join(dir, "missing"), alive), { working: 0, waiting: 0 });
});
