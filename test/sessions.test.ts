// The sessions module on temporary Claude Code config folders: listing on both sides, archiving
// into a project's .artifacts/session-archives/, and deleting everything a session leaves.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { Peer } from "../core/machine-state.ts";
import { type ConfigDir, archiveRoot, archiveSession, deleteSession, fromPeer, listSessions, sessionFiles } from "../core/sessions.ts";
import { state } from "../core/state.ts";
import { quiet } from "./helpers.ts";

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
