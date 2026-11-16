import assert from "node:assert/strict";
import { test } from "node:test";
import { loginProfile } from "../core/accounts/login.ts";
import "./helpers.ts";

test("login rejects a missing profile before starting either agent", async () => {
  let started = false;
  await assert.rejects(loginProfile({ name: "missing", run: () => { started = true; return { ok: true, detail: "" }; }, codex: { run: () => { started = true; return { ok: true, detail: "" }; } } }), /There is no profile named missing/);
  assert.equal(started, false);
});

test("login requires a profile name or all", async () => {
  await assert.rejects(loginProfile({}), /Usage: dotagents login/);
});
