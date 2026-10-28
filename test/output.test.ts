// The output module: every result is counted and handed to the renderer as one event.

import assert from "node:assert/strict";
import { test } from "node:test";
import { capture, checkItem, checkWarn, finish, report, section } from "../lib/output.ts";
import { state } from "../lib/state.ts";
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
