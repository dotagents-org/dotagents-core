import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ensureExcluded, removeExcluded } from "../../core/workspace/git.ts";
import { quiet, tempWorkspace } from "../helpers.ts";

test("root and nested workspaces keep separate exclude blocks", (t) => {
  const root = tempWorkspace(t);
  assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
  const sub = path.join(root, "sub");
  fs.mkdirSync(sub);
  quiet();
  ensureExcluded(sub);
  ensureExcluded(root);
  const file = path.join(root, ".git", "info", "exclude");
  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.split("\n").includes("/sub/AGENTS.md"));
  assert.ok(text.split("\n").includes("/AGENTS.md"));
  ensureExcluded(root);
  assert.equal(fs.readFileSync(file, "utf8"), text);
  removeExcluded(root);
  const remaining = fs.readFileSync(file, "utf8");
  assert.ok(remaining.split("\n").includes("/sub/AGENTS.md"));
  assert.ok(!remaining.split("\n").includes("/AGENTS.md"));
});
