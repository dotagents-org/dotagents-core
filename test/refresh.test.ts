// usage --refresh: Claude Code itself is asked for each profile's usage (claude -p "/usage"), at
// most once every few minutes per profile; the asking goes through a fake here.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { type Profile, saveProfile } from "../core/machine-state.ts";
import { REFRESH_EVERY_MS, refreshUsage } from "../core/refresh.ts";
import { quiet } from "./helpers.ts";

function twoProfiles(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-refresh-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DOTAGENTS_STATE_DIR: process.env.DOTAGENTS_STATE_DIR };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, DOTAGENTS_STATE_DIR: path.join(home, "state") });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(home, { recursive: true, force: true });
  });
  quiet();
  saveProfile({ name: "work", configDir: path.join(home, ".claude"), color: "#D77655", default: true });
  saveProfile({ name: "personal", configDir: path.join(home, ".claude-personal"), color: "#376B80" });
}

test("each profile is asked once, then not again until a few minutes pass", async (t) => {
  twoProfiles(t);
  const asked: string[] = [];
  const ask = async (p: Profile) => (asked.push(p.name), { ok: true, detail: "" });
  const now = new Date("2026-10-28T12:00:00Z");
  quiet();
  await refreshUsage(now, { ask });
  assert.deepEqual(asked.sort(), ["personal", "work"]);
  quiet();
  await refreshUsage(new Date(now.getTime() + 60_000), { ask });
  assert.equal(asked.length, 2, "too soon: nobody asked again");
  quiet();
  await refreshUsage(new Date(now.getTime() + REFRESH_EVERY_MS), { ask });
  assert.equal(asked.length, 4);
});

test("a dry run asks nobody, and a profile that fails is reported and can be asked again later", async (t) => {
  twoProfiles(t);
  const asked: string[] = [];
  const ask = async (p: Profile) => (asked.push(p.name), p.name === "personal" ? { ok: false, detail: "not signed in" } : { ok: true, detail: "" });
  const now = new Date("2026-10-28T12:00:00Z");
  quiet({ dryRun: true });
  await refreshUsage(now, { ask });
  assert.equal(asked.length, 0);
  const events = quiet();
  await refreshUsage(now, { ask });
  assert.ok(events.some((e) => e.kind === "result" && e.status === "failed" && e.target === "personal"));
  assert.ok(events.some((e) => e.kind === "result" && e.status === "updated" && e.target === "work"));
});
