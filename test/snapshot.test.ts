// The usage of every profile, this side's and the other side's (WSL and Windows on one machine),
// read from Claude Code's caches into one list.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { loadMachine, saveMachine, saveProfile } from "../core/machine-state.ts";
import { applyPeer } from "../core/peer.ts";
import { readUsage, usageJson, watchPeer } from "../core/snapshot.ts";
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

test("a slot that holds another account's login doesn't lend its cache to the profile whose folder it is", (t) => {
  const { home } = machine(t);
  // The switch in place put personal in the slot, work's folder: work's login waits in its vault.
  fs.writeFileSync(path.join(home, ".claude.json"), state("uuid-b", cache("uuid-b", "2026-10-28T11:50:00Z", 70)));
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), "{}");
  const vault = path.join(home, "state", "vault", "work");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "credentials.json"), "{}");
  fs.writeFileSync(path.join(vault, "account.json"), JSON.stringify({ accountUuid: "uuid-a" }));
  const work = readUsage(NOW).find((p) => p.name === "work")!;
  assert.equal(work.state, "other-account");
  assert.deepEqual(work.windows, []);
});

// The other side as a long-running reader sees it: asked whether it is up, and which sessions run.
const known = (home: string, peer: string) => {
  fs.writeFileSync(path.join(home, ".claude.json"), state("uuid-a", cache("uuid-a", "2026-10-28T09:00:00Z", 10)));
  fs.writeFileSync(path.join(peer, ".claude.json"), state("uuid-a", cache("uuid-a", "2026-10-28T11:55:00Z", 70)));
  fs.writeFileSync(path.join(peer, ".config", "dotagents", "profiles.json"), JSON.stringify({ version: 1, profiles: [{ name: "work", configDir: "C:\\Users\\me\\.claude", color: "#D77655", default: true }] }));
  saveMachine({ peer: { name: "Windows", home: peer, nativeHome: "C:\\Users\\me" } });
};

test("a side that isn't up isn't read, so reading never wakes it", (t) => {
  const { home, peer } = machine(t);
  known(home, peer);
  const [work] = readUsage(NOW, { up: () => false });
  assert.equal(work.windows[0].pct, 10, "this side's own, though the other side's is newer");
  assert.equal(work.from, undefined);
});

test("the other side's running sessions count for the account in its slot", (t) => {
  const { home, peer } = machine(t);
  known(home, peer);
  fs.mkdirSync(path.join(peer, ".claude", "sessions"), { recursive: true });
  const session = (pid: number, sessionId: string, status: string) => fs.writeFileSync(path.join(peer, ".claude", "sessions", `${pid}.json`), JSON.stringify({ pid, sessionId, status }));
  session(1, "s-busy", "busy");
  session(2, "s-waiting", "waiting");
  session(3, "s-gone", "busy");
  const [work, personal] = readUsage(NOW, { up: () => true, running: () => new Set(["s-busy", "s-waiting"]) });
  assert.deepEqual(work.activity, { working: 1, waiting: 1 });
  assert.equal(personal.activity, undefined);
});

test("watchPeer asks whether the side is up at most every 5 s, and for its sessions at most every 15 s", () => {
  let clock = 0;
  const asked = { up: 0, running: 0 };
  const view = watchPeer({ up: () => (asked.up++, true), running: () => (asked.running++, new Set<string>()), now: () => clock });
  const peer = { name: "WSL", home: "\\\\wsl.localhost\\Ubuntu\\home\\me", nativeHome: "/home/me" };
  view.up(peer);
  view.running!(peer);
  clock = 4_000;
  view.up(peer);
  view.running!(peer);
  assert.deepEqual(asked, { up: 1, running: 1 });
  clock = 15_000;
  view.up(peer);
  view.running!(peer);
  assert.deepEqual(asked, { up: 2, running: 2 });
});

test("the other side is asked about its sessions only when one looks alive there, and a failed answer keeps the last", (t) => {
  const { home, peer } = machine(t);
  known(home, peer);
  let asked = 0;
  let answer: Set<string> | null = new Set(["s-busy"]);
  let clock = 0;
  const view = watchPeer({ up: () => true, running: () => (asked++, answer), now: () => clock });
  fs.mkdirSync(path.join(peer, ".claude", "sessions"), { recursive: true });
  fs.writeFileSync(path.join(peer, ".claude", "sessions", "1.json"), JSON.stringify({ pid: 1, sessionId: "s-idle", status: "idle" }));
  readUsage(NOW, view);
  assert.equal(asked, 0, "nothing busy or waiting there: not asked, so an idle WSL can shut down");
  fs.writeFileSync(path.join(peer, ".claude", "sessions", "2.json"), JSON.stringify({ pid: 2, sessionId: "s-busy", status: "busy" }));
  assert.deepEqual(readUsage(NOW, view)[0].activity, { working: 1, waiting: 0 });
  answer = null;
  clock = 20_000;
  assert.deepEqual(readUsage(NOW, view)[0].activity, { working: 1, waiting: 0 }, "the side couldn't answer: the last answer stands");
  assert.equal(asked, 2);
});

test("watchPeer never waits for the other side: the last answer stands until the new one comes", async () => {
  let resolve: (v: Set<string>) => void = () => {};
  const view = watchPeer({ up: () => true, running: () => new Promise((r) => (resolve = r)), now: () => 0 });
  const peer = { name: "WSL", home: "\\\\wsl.localhost\\Ubuntu\\home\\me", nativeHome: "/home/me" };
  assert.equal(view.running!(peer), null, "nothing known yet, and no wait");
  resolve(new Set(["s1"]));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...view.running!(peer)!], ["s1"]);
});
