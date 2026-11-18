// What a command loads at start: heavy modules wait until the command that needs them calls them.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { REPO } from "./helpers.ts";

// Fails the import of any module named in BLOCKED (comma-separated package names).
const BLOCK = `data:text/javascript,${encodeURIComponent(`
import { registerHooks } from "node:module";
const blocked = process.env.BLOCKED.split(",");
registerHooks({
  resolve(spec, context, next) {
    if (blocked.some((name) => spec === name || spec.startsWith(name + "/"))) throw new Error("loaded at start: " + spec);
    return next(spec, context);
  },
});
`)}`;

// An empty folder of the test's own, removed when it ends.
function tempDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-startup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(t: TestContext, args: string[], blocked: string[], input = "") {
  const res = spawnSync(process.execPath, ["--import", BLOCK, path.join(REPO, "cli.ts"), ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, BLOCKED: blocked.join(","), DOTAGENTS_STATE_DIR: tempDir(t) },
  });
  assert.equal(res.status, 0, `${t.name}: ${res.stderr}`);
  return res;
}

test("--help loads neither the Anthropic SDK nor the prompts", (t) => {
  run(t, ["--help"], ["@anthropic-ai/sdk", "@clack/prompts"]);
});

test("a command that asks nothing doesn't load the prompts", (t) => {
  run(t, ["usage", "--json"], ["@clack/prompts"]);
});

test("the revision hook loads the Anthropic SDK only to call the API", (t) => {
  const res = run(t, ["revision", "hook"], ["@anthropic-ai/sdk"], JSON.stringify({ prompt: "/clear" }));
  assert.equal(res.stdout, "");
});

// npm link points the dotagents command at cli.ts itself, so on Linux and macOS it must stay executable.
test("cli.ts is executable", { skip: process.platform === "win32" }, () => {
  assert.ok(fs.statSync(path.join(REPO, "cli.ts")).mode & 0o111);
});

// The compile cache lives in the temporary folder; a dry run writes nothing, not even there.
test("--dry-run leaves the compile cache off, in either form the parser takes", (t) => {
  for (const flag of ["--dry-run", "--dry-run=true"]) {
    const tmp = tempDir(t);
    const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp };
    delete env.NODE_COMPILE_CACHE;
    const res = spawnSync(process.execPath, [path.join(REPO, "cli.ts"), "--help", flag], { encoding: "utf8", env });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(fs.readdirSync(tmp), [], flag);
  }
});
