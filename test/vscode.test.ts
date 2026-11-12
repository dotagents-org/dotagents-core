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
    { name: "personal", state: "ok", avatar: "warn", windows: [{ kind: "session", pct: 79 }, { kind: "week", pct: 38 }, { kind: "model-week", model: "Opus", pct: 13 }] },
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

test("the status bar shows the current account, its session and week, and warns in its state's tone", () => {
  const status = lib.statusFor(data);
  assert.equal(status.text, "$(account) personal 5h 79%  7d 38%");
  assert.equal(status.severity, "warning");
  assert.match(status.tooltip, /\*\*work\*\* \(Windows\)  5h 0%  7d 11%/);
  assert.doesNotMatch(status.text, /·/, "no middle dot");
  assert.equal(lib.statusFor({ ...data, current: { profile: "work", state: "limit" } }).severity, "error");
  assert.equal(lib.statusFor({ ...data, current: { profile: "work", state: "ok" } }).severity, "none");
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
