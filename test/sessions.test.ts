// The sessions module on temporary Claude Code config folders: listing on both sides, archiving
// into a project's .artifacts/session-archives/, and deleting everything a session leaves.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { Peer } from "../core/machine-state.ts";
import { type ConfigDir, archiveRoot, archiveSession, deleteSession, fromPeer, listSessions, sessionFiles } from "../core/sessions.ts";
import { state } from "../core/state.ts";
import { REPO, quiet } from "./helpers.ts";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const HOUR = 3_600_000;

function setup(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-sessions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const here: ConfigDir = { side: "Here", dir: path.join(root, "claude") };
  const ws = path.join(root, "ws");
  fs.mkdirSync(path.join(ws, ".artifacts", "session-archives"), { recursive: true });
  fs.mkdirSync(path.join(ws, "repo", "src"), { recursive: true });
  return { root, here, ws };
}

type Line = Record<string, unknown>;
const lines = (cwd: string, id: string, extra: Line[] = []): Line[] => [
  { type: "user", sessionId: id, cwd, timestamp: "2026-01-02T10:00:00.000Z", message: { role: "user", content: "<system-reminder>x</system-reminder>Plan the release" } },
  { type: "assistant", sessionId: id, cwd, timestamp: "2026-01-02T10:05:00.000Z", message: { id: "m1", content: [{ type: "text", text: "Sure." }] } },
  ...extra,
];

// Writes a transcript and what Claude Code keeps beside it; an hour old unless told otherwise.
function session(dir: ConfigDir, id: string, body: Line[], { age = HOUR } = {}) {
  const project = path.join(dir.dir, "projects", "slug");
  fs.mkdirSync(path.join(project, id, "tool-results"), { recursive: true });
  fs.mkdirSync(path.join(dir.dir, "file-history", id), { recursive: true });
  fs.mkdirSync(path.join(dir.dir, "session-env", id), { recursive: true });
  const file = path.join(project, `${id}.jsonl`);
  fs.writeFileSync(file, `${body.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const at = new Date(Date.now() - age);
  fs.utimesSync(file, at, at);
  return file;
}

test("a path from the other side is reached through /mnt from WSL and through the share from Windows", () => {
  const windows: Peer = { name: "Windows", home: "/mnt/c/Users/me", nativeHome: "C:\\Users\\me" };
  assert.equal(fromPeer("C:\\Users\\me\\app", windows, "posix"), "/mnt/c/Users/me/app");
  assert.equal(fromPeer("D:\\", windows, "posix"), "/mnt/d");
  assert.equal(fromPeer("\\\\wsl.localhost\\Ubuntu\\home\\me\\app", windows, "posix"), "/home/me/app");
  assert.equal(fromPeer("relative", windows, "posix"), null);
  const wsl: Peer = { name: "WSL", home: "\\\\wsl.localhost\\Ubuntu\\home\\me", nativeHome: "/home/me" };
  assert.equal(fromPeer("/home/me/app", wsl, "win32"), "\\\\wsl.localhost\\Ubuntu\\home\\me\\app");
  assert.equal(fromPeer("/mnt/c/work", wsl, "win32"), "C:\\work");
  assert.equal(fromPeer("C:\\x", wsl, "win32"), null);
});

test("the archive root is the nearest folder with .artifacts/session-archives/, from any folder inside it", (t) => {
  const s = setup(t);
  assert.equal(archiveRoot(path.join(s.ws, "repo", "src")), s.ws);
  assert.equal(archiveRoot(s.ws), s.ws);
  assert.equal(archiveRoot(s.root), null);
  assert.equal(archiveRoot(null), null);
});

test("sessions are listed from every config folder, newest first, with title, accounts and archive root", (t) => {
  const s = setup(t);
  const peer: ConfigDir = { side: "There", dir: path.join(s.root, "peer-claude"), peer: { name: "There", home: path.join(s.root, "peer"), nativeHome: "C:\\Users\\me" } };
  session(s.here, "one", [...lines(path.join(s.ws, "repo"), "one"), { type: "ai-title", aiTitle: "First title" }, { type: "ai-title", aiTitle: "Release plan" }, { type: "session-owner", accountUuid: A }, { type: "session-owner", accountUuid: B }, { type: "session-owner", accountUuid: A }]);
  session(s.here, "two", lines(path.join(s.root, "elsewhere"), "two").map((l) => ({ ...l, timestamp: "2026-01-01T09:00:00.000Z" })));
  session(peer, "three", lines("C:\\Users\\me\\app", "three").map((l) => ({ ...l, timestamp: "2025-12-31T09:00:00.000Z" })));

  const all = listSessions({ dirs: [s.here, peer] });
  assert.deepEqual(all.map((x) => x.id), ["one", "two", "three"]);
  const [one, two, three] = all;
  assert.equal(one.title, "Release plan", "the last title Claude Code gave it");
  assert.equal(two.title, "Plan the release", "else the first prompt, without injected context");
  assert.deepEqual(one.accounts, [A, B]);
  assert.deepEqual(two.accounts, []);
  assert.equal(one.root, s.ws);
  assert.equal(two.root, null);
  assert.equal(one.ended, "2026-01-02T10:05:00.000Z");
  assert.equal(three.side, "There");
  assert.equal(three.cwd, "C:\\Users\\me\\app");
  assert.equal(three.localCwd, fromPeer("C:\\Users\\me\\app", peer.peer!));
  assert.ok(all.every((x) => !x.running));
  assert.deepEqual(all.map((x) => x.checked), [true, true, false], "the other side, not asked, is unchecked");

  assert.deepEqual(listSessions({ dirs: [s.here, peer], under: s.ws }).map((x) => x.id), ["one"], "only the ones started inside the folder");
});

test("a session counts as running while its process lives on this side, or when written in the last minutes", (t) => {
  const s = setup(t);
  session(s.here, "live", lines(s.ws, "live"));
  session(s.here, "dead", lines(s.ws, "dead"));
  session(s.here, "fresh", lines(s.ws, "fresh"), { age: 60_000 });
  fs.mkdirSync(path.join(s.here.dir, "sessions"));
  fs.writeFileSync(path.join(s.here.dir, "sessions", "100.json"), JSON.stringify({ pid: 100, sessionId: "live", procStart: "7" }));
  fs.writeFileSync(path.join(s.here.dir, "sessions", "200.json"), JSON.stringify({ pid: 200, sessionId: "dead" }));
  const probe = (pid: number, start?: string) => pid === 100 && start === "7";
  const running = Object.fromEntries(listSessions({ dirs: [s.here], running: probe }).map((x) => [x.id, x.running]));
  assert.deepEqual(running, { live: true, dead: false, fresh: true });
});

test("a session is archived into its project, then deleted with everything Claude Code kept for it", (t) => {
  quiet();
  const s = setup(t);
  const file = session(s.here, "one", [...lines(path.join(s.ws, "repo"), "one"), { type: "session-owner", accountUuid: A }]);
  const [one] = listSessions({ dirs: [s.here] });

  const archived = archiveSession(one, new Map([[A, "turing (a@example.com)"]]));
  assert.ok(archived.ok);
  assert.equal(archived.file, path.join(s.ws, ".artifacts", "session-archives", "2026-01-02-one.md"));
  const md = fs.readFileSync(archived.file, "utf8");
  assert.match(md, /\| \*\*Account\*\* \| turing \(a@example\.com\) \|/);
  assert.match(md, /Plan the release/);

  assert.ok(deleteSession(one));
  for (const target of [file, path.join(path.dirname(file), "one"), path.join(s.here.dir, "file-history", "one"), path.join(s.here.dir, "session-env", "one")]) {
    assert.ok(!fs.existsSync(target), `${target} is gone`);
  }
  assert.ok(!fs.existsSync(path.dirname(file)), "the project folder, now empty, is gone too");
  assert.ok(fs.existsSync(archived.file), "the archive stays");

  const events = quiet();
  assert.ok(deleteSession(one), "deleting it again changes nothing");
  assert.deepEqual(events, []);
});

test("a session outside a standard workspace, or whose archive can't be written, is not archived", (t) => {
  quiet();
  const s = setup(t);
  session(s.here, "out", lines(s.root, "out"));
  session(s.here, "bad", lines(s.ws, "bad"));
  const byId = Object.fromEntries(listSessions({ dirs: [s.here] }).map((x) => [x.id, x]));

  const out = archiveSession(byId.out);
  assert.equal(out.ok, false);

  fs.mkdirSync(path.join(s.ws, ".artifacts", "session-archives", "2026-01-02-bad.md")); // a folder where the file goes
  const bad = archiveSession(byId.bad);
  assert.equal(bad.ok, false);
  assert.ok(fs.existsSync(byId.bad.file), "archiving never deletes");
});

test("a running session is never deleted, and a dry run touches nothing", (t) => {
  const s = setup(t);
  session(s.here, "fresh", lines(s.ws, "fresh"), { age: 1_000 });
  session(s.here, "old", lines(s.ws, "old"));
  const byId = Object.fromEntries(listSessions({ dirs: [s.here] }).map((x) => [x.id, x]));

  const events = quiet();
  assert.equal(deleteSession(byId.fresh), false);
  assert.ok(events.some((e) => e.kind === "result" && e.status === "skipped"));
  assert.ok(fs.existsSync(byId.fresh.file));

  quiet({ dryRun: true });
  assert.ok(archiveSession(byId.old).ok);
  assert.ok(deleteSession(byId.old));
  state.dryRun = false;
  for (const target of sessionFiles(byId.old)) assert.ok(fs.existsSync(target), `${target} is kept`);
  assert.deepEqual(fs.readdirSync(path.join(s.ws, ".artifacts", "session-archives")), []);
});

test("a running session, once confirmed, has its Claude Code ended and then its files deleted; a dry run ends nothing", (t) => {
  const s = setup(t);
  session(s.here, "live", lines(s.ws, "live"));
  fs.mkdirSync(path.join(s.here.dir, "sessions"));
  fs.writeFileSync(path.join(s.here.dir, "sessions", "100.json"), JSON.stringify({ pid: 100, sessionId: "live" }));
  const [live] = listSessions({ dirs: [s.here], running: (pid) => pid === 100 });
  assert.equal(live.running, true);
  assert.equal(live.pid, 100);

  const stopped: number[] = [];
  const stop = (pid: number) => (stopped.push(pid), true);
  quiet({ dryRun: true });
  assert.ok(deleteSession(live, { evenRunning: true, stop }));
  state.dryRun = false;
  assert.deepEqual(stopped, [], "a dry run ends nothing");
  assert.ok(fs.existsSync(live.file));

  quiet();
  assert.equal(deleteSession(live, { stop }), false, "not without being asked");
  assert.deepEqual(stopped, []);
  assert.ok(deleteSession(live, { evenRunning: true, stop }));
  assert.deepEqual(stopped, [100]);
  for (const target of sessionFiles(live)) assert.ok(!fs.existsSync(target), `${target} is gone`);
});

test("the other side is asked once which sessions it runs, and a side that can't say is marked unchecked", (t) => {
  const s = setup(t);
  const peer: ConfigDir = { side: "There", dir: path.join(s.root, "peer-claude"), peer: { name: "There", home: path.join(s.root, "peer"), nativeHome: "/home/me" } };
  session(peer, "idle", lines("/home/me/app", "idle"));
  session(peer, "gone", lines("/home/me/app", "gone"));
  session(s.here, "local", lines(s.ws, "local"));

  let asked = 0;
  const answer = (ids: string[] | null) => () => {
    asked++;
    return ids && new Set(ids);
  };
  const byId = (peerRunning: (p: unknown) => Set<string> | null) => Object.fromEntries(listSessions({ dirs: [s.here, peer], peerRunning }).map((x) => [x.id, x]));

  const told = byId(answer(["idle"]));
  assert.equal(asked, 1, "one question for the whole side");
  assert.equal(told.idle.running, true, "idle for an hour, but its process runs there");
  assert.equal(told.gone.running, false);
  assert.ok(told.idle.checked && told.local.checked);

  const silent = byId(answer(null));
  assert.equal(silent.idle.running, false);
  assert.equal(silent.idle.checked, false);

  asked = 0;
  listSessions({ dirs: [s.here, peer], under: s.ws, peerRunning: answer([]) });
  assert.equal(asked, 0, "not asked when none of its sessions is listed");
});

test("sessions --running prints the ids this side's Claude Code runs, for the other side to ask", (t) => {
  const s = setup(t);
  const home = path.join(s.root, "home");
  const sessionsDir = path.join(home, ".claude", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: "11111111-2222-3333-4444-555555555555" }));
  fs.writeFileSync(path.join(sessionsDir, "999999999.json"), JSON.stringify({ pid: 999_999_999, sessionId: "99999999-2222-3333-4444-555555555555" }));
  const res = spawnSync(process.execPath, [path.join(REPO, "cli.ts"), "sessions", "--running"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, DOTAGENTS_STATE_DIR: path.join(s.root, "state") },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.stdout.trim().split(/\r?\n/), ["11111111-2222-3333-4444-555555555555"]);
});

test("sessions rm archives before deleting, and --no-archive deletes without archiving", (t) => {
  const s = setup(t);
  const home = path.join(s.root, "home");
  const dir: ConfigDir = { side: "Here", dir: path.join(home, ".claude") };
  const kept = session(dir, "11111111-0000-0000-0000-000000000001", lines(s.ws, "11111111-0000-0000-0000-000000000001"));
  const bare = session(dir, "22222222-0000-0000-0000-000000000002", lines(s.ws, "22222222-0000-0000-0000-000000000002"));
  const rm = (...args: string[]) =>
    spawnSync(process.execPath, [path.join(REPO, "cli.ts"), "sessions", "rm", ...args], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, DOTAGENTS_STATE_DIR: path.join(s.root, "state") },
    });
  const archives = path.join(s.ws, ".artifacts", "session-archives");

  let res = rm("11111111", "--yes");
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.ok(!fs.existsSync(kept));
  assert.deepEqual(fs.readdirSync(archives), ["2026-01-02-11111111-0000-0000-0000-000000000001.md"]);

  res = rm("22222222", "--yes", "--no-archive");
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.match(res.stdout, /without an archive \(--no-archive\)/);
  assert.ok(!fs.existsSync(bare));
  assert.equal(fs.readdirSync(archives).length, 1, "no archive written");

  res = rm("33333333", "--yes");
  assert.notEqual(res.status, 0, "an unknown id fails");
});

test("the sessions list draws no glyphs between its parts, only spaces", (t) => {
  const s = setup(t);
  const home = path.join(s.root, "home");
  session({ side: "Here", dir: path.join(home, ".claude") }, "11111111-0000-0000-0000-000000000001", lines(s.ws, "11111111-0000-0000-0000-000000000001"));
  const res = spawnSync(process.execPath, [path.join(REPO, "cli.ts"), "sessions", "--all"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, DOTAGENTS_STATE_DIR: path.join(s.root, "state"), FORCE_COLOR: "1" },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Plan the release/, "the terminal view, not the piped one");
  assert.doesNotMatch(res.stdout, /[◇·⚠└●]/);
});

test("in the terminal, a session's account is painted in its profile's color, and a missing archive folder in the warning one", (t) => {
  const s = setup(t);
  const home = path.join(s.root, "home");
  const stateDir = path.join(s.root, "state");
  const dir: ConfigDir = { side: "Here", dir: path.join(home, ".claude") };
  session(dir, "11111111-0000-0000-0000-000000000001", [...lines(s.ws, "11111111-0000-0000-0000-000000000001"), { type: "session-owner", accountUuid: A }]);
  session(dir, "22222222-0000-0000-0000-000000000002", lines(s.root, "22222222-0000-0000-0000-000000000002"));
  fs.mkdirSync(path.join(stateDir, "vault", "work"), { recursive: true });
  fs.writeFileSync(path.join(stateDir, "profiles.json"), JSON.stringify({ version: 1, profiles: [{ name: "work", configDir: dir.dir, color: "#D77655" }] }));
  fs.writeFileSync(path.join(stateDir, "vault", "work", "account.json"), JSON.stringify({ accountUuid: A, emailAddress: "w@example.com" }));
  fs.writeFileSync(path.join(stateDir, "vault", "work", "credentials.json"), "{}");
  const res = spawnSync(process.execPath, [path.join(REPO, "cli.ts"), "sessions", "--all"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, DOTAGENTS_STATE_DIR: stateDir, FORCE_COLOR: "3", DOTAGENTS_THEME: "dark" },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes("\x1b[38;2;215;118;85mwork\x1b[39m"), "the profile's color on its name");
  assert.ok(res.stdout.includes("\x1b[38;2;254;153;17mno .artifacts, not archived\x1b[39m"), "the warning color");
});
