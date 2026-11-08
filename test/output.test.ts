// The output module: every result is counted and handed to the renderer as one event.

import assert from "node:assert/strict";
import { test } from "node:test";
import { capture, captureAsync, checkItem, checkWarn, finish, flushSection, line, plainRenderer, report, section, setRenderer, terminalRenderer } from "../core/output.ts";
import { state } from "../core/state.ts";
import { quiet } from "./helpers.ts";

test("results, checks and warnings become events and counters", () => {
  const events = quiet();
  section("Files");
  report("created", "/tmp/a");
  report("skipped", "/tmp/b", "already exists");
  checkItem(false, "b is a link", "a copy");
  checkWarn("c looks odd");
  assert.deepEqual(
    events.map((e) => e.kind),
    ["section", "result", "result", "check", "warning"]
  );
  assert.deepEqual(events[2], { kind: "result", status: "skipped", target: "/tmp/b", detail: "already exists" });
  assert.equal(state.counts.created, 1);
  assert.equal(state.counts.warnings, 1);
  assert.equal(state.problems, 2);
});

test("finish sets the exit code from the problems counted", (t) => {
  t.after(() => (process.exitCode = 0));
  quiet();
  report("ok", "/tmp/a");
  finish();
  assert.equal(process.exitCode, 0);
  report("failed", "/tmp/b", "no access");
  finish();
  assert.equal(process.exitCode, 1);
});

test("capture keeps a run's events and leaves the counters as they were", () => {
  const outer = quiet();
  report("created", "/tmp/a");
  const inner = capture(() => {
    report("failed", "/tmp/b");
    checkItem(true, "ok");
  });
  assert.deepEqual(inner.map((e) => e.kind), ["result", "check"]);
  assert.equal(outer.length, 1);
  assert.equal(state.problems, 0);
  assert.equal(state.counts.created, 1);
  assert.equal(state.counts.failed, undefined);
});

test("capture can run a preview or the real thing, whatever --dry-run said, and restores it", async () => {
  quiet({ dryRun: false });
  const seen: boolean[] = [];
  capture(() => void seen.push(state.dryRun), { dryRun: true });
  await captureAsync(async () => void seen.push(state.dryRun), { dryRun: false });
  assert.deepEqual(seen, [true, false]);
  assert.equal(state.dryRun, false);
});

// What a renderer prints, with console.log caught; colors stripped.
function printed(t: import("node:test").TestContext, fn: () => void) {
  const out: string[] = [];
  const log = console.log;
  console.log = (text = "") => void out.push(String(text).replace(/\x1b\[[0-9;]*m/g, ""));
  t.after(() => {
    console.log = log;
    process.exitCode = 0;
  });
  try {
    fn();
  } finally {
    console.log = log;
  }
  return out.join("\n");
}

for (const [name, renderer] of [["terminal", terminalRenderer], ["plain", plainRenderer]] as const) {
  test(`${name} output: a section's title waits for its first line, and an empty section prints nothing`, (t) => {
    quiet();
    const out = printed(t, () => {
      setRenderer(renderer);
      section("Empty");
      section("Files");
      report("created", "/tmp/a");
      section("Drawn by the command");
      line("a list line");
      section("Before a spinner");
      flushSection();
      section("Left empty at the end");
      finish();
    });
    assert.doesNotMatch(out, /Empty|Left empty/);
    assert.match(out, /Files\n.*\/tmp\/a/);
    assert.match(out, /Drawn by the command\na list line/);
    assert.match(out, /Before a spinner/);
  });
}
