// The usage of every profile, this side's and the other side's (WSL and Windows on one machine),
// read from Claude Code's caches into one list.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { loadMachine, saveMachine, saveProfile } from "../core/machine-state.ts";
import { applyPeer } from "../core/peer.ts";
import { readUsage, usageJson } from "../core/snapshot.ts";
import { quiet } from "./helpers.ts";

const NOW = new Date("2026-10-28T12:00:00Z");

const cache = (uuid: string, fetchedAt: string, pct: number) => ({
  accountUuid: uuid,
  fetchedAtMs: Date.parse(fetchedAt),
  utilization: { limits: [{ kind: "session", percent: pct, resets_at: "2026-10-28T14:00:00Z" }] },
});

const state = (uuid: string, usage?: unknown) => JSON.stringify({ oauthAccount: { accountUuid: uuid, emailAddress: `${uuid}@example.com` }, ...(usage ? { cachedUsageUtilization: usage } : {}) });

// This side's home with two profiles, and the other side's home in another folder.
function machine(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-snapshot-"));
  const home = path.join(root, "home");
  const peer = path.join(root, "peer");
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DOTAGENTS_STATE_DIR: process.env.DOTAGENTS_STATE_DIR };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, DOTAGENTS_STATE_DIR: path.join(home, "state") });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const dir of [path.join(home, ".claude"), path.join(home, ".claude-personal"), path.join(peer, ".claude"), path.join(peer, ".claude-personal"), path.join(peer, ".config", "dotagents")])
    fs.mkdirSync(dir, { recursive: true });
  quiet();
  saveProfile({ name: "work", configDir: path.join(home, ".claude"), color: "#D77655", default: true });
  saveProfile({ name: "personal", configDir: path.join(home, ".claude-personal"), color: "#376B80" });
  return { home, peer };
}

test("this side alone: each profile's cache, and the JSON wraps the list with a version", (t) => {
  const { home } = machine(t);
  fs.writeFileSync(path.join(home, ".claude.json"), state("uuid-a", cache("uuid-a", "2026-10-28T11:50:00Z", 40)));
  fs.writeFileSync(path.join(home, ".claude-personal", ".claude.json"), state("uuid-b"));
  const list = readUsage(NOW);
  assert.deepEqual(list.map((p) => [p.name, p.state]), [["work", "ok"], ["personal", "no-data"]]);
  const json = usageJson(list, NOW);
  assert.equal(json.version, 1);
  assert.equal(json.generatedAt, NOW.toISOString());
  assert.equal(json.profiles[0].windows[0].pct, 40);
  assert.ok(!JSON.stringify(json).includes("uuid-a"), "the account id stays out of the JSON");
});

test("with the other side known, its newer cache of the same account wins, and says where it came from", (t) => {
  const { home, peer } = machine(t);
  fs.writeFileSync(path.join(home, ".claude.json"), state("uuid-a", cache("uuid-a", "2026-10-28T09:00:00Z", 10)));
  fs.writeFileSync(path.join(home, ".claude-personal", ".claude.json"), state("uuid-b", cache("uuid-b", "2026-10-28T11:00:00Z", 20)));
  // The other side names its folders in its own form (C:\Users\me\...).
  const native = "C:\\Users\\me";
  fs.writeFileSync(
    path.join(peer, ".config", "dotagents", "profiles.json"),
    JSON.stringify({ version: 1, profiles: [
      { name: "work", configDir: `${native}\\.claude`, color: "#D77655", default: true },
      { name: "personal", configDir: `${native}\\.claude-personal`, color: "#376B80" },
    ] })
  );
  fs.writeFileSync(path.join(peer, ".claude.json"), state("uuid-a", cache("uuid-a", "2026-10-28T11:55:00Z", 70)));
  fs.writeFileSync(path.join(peer, ".claude-personal", ".claude.json"), state("uuid-b", cache("uuid-b", "2026-10-28T10:00:00Z", 5)));
  saveMachine({ peer: { name: "Windows", home: peer, nativeHome: native } });
  const [work, personal] = readUsage(NOW);
  assert.equal(work.windows[0].pct, 70);
  assert.equal(work.from, "Windows");
  assert.equal(personal.windows[0].pct, 20, "this side's data is newer for personal");
  assert.equal(personal.from, undefined);
});

test("another side that can't be read changes nothing", (t) => {
  const { home } = machine(t);
  fs.writeFileSync(path.join(home, ".claude.json"), state("uuid-a", cache("uuid-a", "2026-10-28T11:50:00Z", 40)));
  saveMachine({ peer: { name: "Windows", home: path.join(home, "nowhere"), nativeHome: "C:\\Users\\me" } });
  assert.equal(readUsage(NOW)[0].windows[0].pct, 40);
});

test("install records the other side it finds, changes nothing the second time, and forgets a side that's gone", (t) => {
  machine(t);
  const windows = { name: "Windows", home: "/mnt/c/Users/me", nativeHome: "C:\\Users\\me" };
  let events = quiet({ dryRun: true });
  applyPeer(() => windows);
  assert.deepEqual(loadMachine(), {}, "a dry run records nothing");
  assert.ok(events.some((e) => e.kind === "result" && e.status === "would update"));
  quiet();
  applyPeer(() => windows);
  assert.deepEqual(loadMachine().peer, windows);
  events = quiet();
  applyPeer(() => windows);
  assert.ok(events.every((e) => e.kind !== "result" || e.status === "ok"));
  quiet();
  applyPeer(() => null);
  assert.deepEqual(loadMachine(), {});
});
