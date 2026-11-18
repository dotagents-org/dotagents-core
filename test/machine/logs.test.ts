import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { UsageError } from "../../core/common.ts";
import { logFile, peerLogsDir } from "../../core/machine/log.ts";
import { saveMachine } from "../../core/machine/machine-state.ts";
import { logs } from "../../surfaces/cli/machine/logs.ts";
import type { CliArgs } from "../../surfaces/cli/shared.ts";
import { REPO } from "../helpers.ts";

// This side's state and a Windows home as WSL sees it, each in a folder of its own
function machine(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-logs-cmd-"));
  const saved = process.env.DOTAGENTS_STATE_DIR;
  process.env.DOTAGENTS_STATE_DIR = path.join(root, "state");
  const home = path.join(root, "windows-home");
  t.after(() => {
    process.env.DOTAGENTS_STATE_DIR = saved;
    fs.rmSync(root, { recursive: true, force: true });
  });
  saveMachine({ peer: { name: "Windows", home, nativeHome: "C:\\Users\\me" } });
  return home;
}

function run(args: Partial<CliArgs> = {}) {
  const out: string[] = [];
  const log = console.log;
  console.log = (s = "") => out.push(String(s));
  try {
    logs.run({ repo: REPO, args: { _: ["logs"], ...args }, positional: [] });
  } finally {
    console.log = log;
  }
  return out.join("\n");
}

test("logs shows both sides, the last 50 lines of each file, and says which files there are none of yet", { skip: process.platform !== "linux" }, (t) => {
  const home = machine(t);
  fs.mkdirSync(path.dirname(logFile("core")), { recursive: true });
  fs.writeFileSync(logFile("core"), Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
  fs.mkdirSync(peerLogsDir(home), { recursive: true });
  fs.writeFileSync(path.join(peerLogsDir(home), "host.log"), "2026-11-15T00:00:00.000Z error spawn: claude not found\n");
  const text = run();
  assert.match(text, /WSL {2}.*state.*logs/);
  assert.match(text, /Windows {2}.*windows-home.*logs/);
  assert.match(text, /core\.log {2}last 50 lines/);
  assert.ok(text.includes("line 60") && text.includes("line 11") && !text.includes("line 10\n"));
  assert.match(text, /sidebar\.log {2}none yet/);
  assert.match(text, /error spawn: claude not found/);
});

test("logs --side shows only that side, and a side that isn't there is refused", { skip: process.platform !== "linux" }, (t) => {
  machine(t);
  const text = run({ side: "windows" });
  assert.match(text, /Windows/);
  assert.doesNotMatch(text, /\nWSL /);
  assert.throws(() => run({ side: "mac" }), (err) => err instanceof UsageError && /wsl or windows/.test(err.message));
});
