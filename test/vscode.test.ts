// The VS Code extension (surfaces/vscode): what it decides without VS Code. The rest is checked
// by hand in VS Code.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO } from "./helpers.ts";

// Plain CommonJS, loaded as VS Code loads it; the tests see it untyped.
const lib = (await import(pathToFileURL(path.join(REPO, "surfaces", "vscode", "lib.js")).href)).default;

const data = {
  current: { profile: "personal", state: "warn" },
  slots: { WSL: "personal", Windows: "work" },
  profiles: [
    { name: "personal", state: "ok", avatar: "warn", windows: [{ kind: "session", pct: 79, resetsAt: "2026-11-12T15:17:00Z" }, { kind: "week", pct: 38 }, { kind: "model-week", model: "Opus", pct: 13 }] },
    { name: "work", state: "ok", avatar: "ok", windows: [{ kind: "session", pct: 0 }, { kind: "week", pct: 11 }] },
  ],
};

test("the extension finds the server's address where dotagents start leaves it, and nothing when it can't read one", () => {
  assert.equal(lib.stateDir({ DOTAGENTS_STATE_DIR: "/state" }, "/home/me"), "/state");
  assert.equal(lib.stateDir({}, "/home/me"), path.join("/home/me", ".config", "dotagents"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-vscode-"));
  try {
    assert.equal(lib.readServer(dir), null);
    fs.writeFileSync(path.join(dir, "start.json"), JSON.stringify({ port: 7337, token: "t", pid: 1 }));
    assert.deepEqual(lib.readServer(dir), { port: 7337, token: "t", pid: 1 });
    fs.writeFileSync(path.join(dir, "start.json"), "{not json");
    assert.equal(lib.readServer(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the status bar shows the current account and its windows as in the statusLine, in parts with a tone each", () => {
  const status = lib.statusFor(data, Date.parse("2026-11-12T12:00:00Z"));
  assert.deepEqual(status.parts, [
    { text: "$(dotagents-accounts) personal", tone: "name" },
    { text: "$(circle-filled)", tone: "amber" },
    { text: "5h", tone: "label" },
    { text: "━━━━━━", tone: "warn" },
    { text: "──", tone: "track" },
    { text: "79% ↻ 3h17m", tone: "warn" },
    { text: "7d", tone: "label" },
    { text: "━━━", tone: "ok" },
    { text: "─────", tone: "track" },
    { text: "38%", tone: "ok" },
  ]);
  assert.match(status.tooltip, /\*\*work\*\* \(Windows\)  5h 0%  7d 11%/);
  assert.doesNotMatch(status.text, /·/, "no middle dot");
});

test("the status bar shows the state as the avatars' dot: its color, and a ring for limit and waiting", () => {
  const dot = (state: string) => lib.statusFor({ ...data, current: { profile: "personal", state } }).parts[1];
  assert.deepEqual(dot("error"), { text: "$(circle-filled)", tone: "red" });
  assert.deepEqual(dot("limit"), { text: "$(target)", tone: "red" });
  assert.deepEqual(dot("waiting"), { text: "$(target)", tone: "amber" });
  assert.deepEqual(dot("ok"), { text: "$(circle-filled)", tone: "green" });
  assert.deepEqual(dot("asleep"), { text: "$(circle-filled)", tone: "blue" });
});

test("the status bar's colors are the identity's terminal roles, the account's lighter on a dark theme", () => {
  assert.equal(lib.toneColor("high", "#D77655", false), "#d50322");
  assert.equal(lib.toneColor("track", "#D77655", true), "#454545");
  assert.equal(lib.toneColor("name", "#376B80", false), "#376B80");
  assert.equal(lib.toneColor("name", "#376B80", true), "#7a9caa");
});

test("the switch lists every account with its usage and where it is, the current one marked", () => {
  const items = lib.pickItems(data);
  assert.deepEqual(items.map((i: { label: string }) => i.label), ["$(check) personal", "work"]);
  assert.equal(items[1].detail, "in the slot on Windows");
  assert.equal(items[1].profile, "work");
});

test("a release is newer by its numbers, not as text", () => {
  assert.equal(lib.newer("3.10.0", "3.9.1"), true);
  assert.equal(lib.newer("3.0.0", "3.0.0"), false);
  assert.equal(lib.newer("2.9.9", "3.0.0"), false);
});
