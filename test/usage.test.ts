// The usage module: Claude Code's usage cache, read and normalized, with a fixed "now".

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { accountUsage, bar, normalize, pace } from "../lib/usage.ts";

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

test("the bar has a fixed width and eighth-of-a-cell steps", () => {
  assert.equal(bar(0, 10), "··········");
  assert.equal(bar(100, 10), "██████████");
  assert.equal(bar(50, 10), "█████·····");
  assert.equal(bar(55, 10), "█████▌····");
  assert.equal([...bar(93, 30)].length, 30);
});

function tempAccount(t: TestContext, stateFile: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-usage-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (stateFile !== undefined) fs.writeFileSync(path.join(dir, ".claude.json"), JSON.stringify(stateFile));
  return { name: "personal", color: "#376B80", configDir: dir };
}

test("an account's usage tells apart no sign-in, no data, someone else's cache and old data", (t) => {
  const signed = { oauthAccount: { accountUuid: "uuid-a" } };
  assert.equal(accountUsage(tempAccount(t, undefined), NOW).state, "not-signed-in");
  assert.equal(accountUsage(tempAccount(t, signed), NOW).state, "no-data");
  assert.equal(accountUsage(tempAccount(t, { ...signed, cachedUsageUtilization: cache("uuid-b") }), NOW).state, "other-account");
  assert.equal(accountUsage(tempAccount(t, { ...signed, cachedUsageUtilization: cache("uuid-a", "2026-10-28T02:00:00Z") }), NOW).state, "stale");
  const ok = accountUsage(tempAccount(t, { ...signed, cachedUsageUtilization: cache() }), NOW);
  assert.equal(ok.state, "ok");
  assert.equal(ok.windows.length, 3);
});
