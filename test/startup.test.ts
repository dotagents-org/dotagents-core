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
    env: { ...process.env, BLOCKED: blocked.join(","), DOTAGENTS_STATE_DIR: tempDir(t), XDG_CACHE_HOME: tempDir(t), LOCALAPPDATA: tempDir(t) },
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

// Runs cli.ts with a home, a temporary folder and a shared folder of the test's own; the cache, when
// on, is <home>/.cache/dotagents/compile-cache (LOCALAPPDATA's on Windows, here the shared folder).
function withFolders(t: TestContext, args: string[], { env: extra = {} }: { env?: NodeJS.ProcessEnv } = {}) {
  const tmp = tempDir(t);
  const home = tempDir(t);
  const shared = tempDir(t);
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, HOME: home, USERPROFILE: home, XDG_CACHE_HOME: shared, LOCALAPPDATA: shared, ...extra };
  delete env.NODE_COMPILE_CACHE;
  if (!("NODE_DISABLE_COMPILE_CACHE" in extra)) delete env.NODE_DISABLE_COMPILE_CACHE;
  const res = spawnSync(process.execPath, [path.join(REPO, "cli.ts"), ...args], { encoding: "utf8", env, cwd: tmp });
  assert.equal(res.status, 0, res.stderr);
  const cache = process.platform === "win32" ? path.join(shared, "dotagents", "compile-cache") : path.join(home, ".cache", "dotagents", "compile-cache");
  return { tmp, home, shared, cache };
}

test("every other test runs the commands without the compile cache", () => {
  assert.equal(process.env.NODE_DISABLE_COMPILE_CACHE, "1");
});

// The shared temporary folder (Node's default) would let another account plant code in the cache.
test("the compile cache lives in this user's cache folder, never the temporary one", (t) => {
  const { tmp, cache } = withFolders(t, ["--help"]);
  assert.deepEqual(fs.readdirSync(tmp), []);
  assert.ok(fs.readdirSync(cache).length);
});

// A folder named by the environment could be shared, so XDG_CACHE_HOME is not followed.
test("XDG_CACHE_HOME is not followed", { skip: process.platform === "win32" }, (t) => {
  const { shared, cache } = withFolders(t, ["--help"]);
  assert.deepEqual(fs.readdirSync(shared), []);
  assert.ok(fs.readdirSync(cache).length);
});

test("a relative LOCALAPPDATA is ignored", { skip: process.platform !== "win32" }, (t) => {
  const { tmp, home } = withFolders(t, ["--help"], { env: { LOCALAPPDATA: "relative-cache" } });
  assert.deepEqual(fs.readdirSync(tmp), []);
  assert.ok(fs.readdirSync(path.join(home, "AppData", "Local", "dotagents", "compile-cache")).length);
});

test("a new compile cache folder is the user's alone", { skip: process.platform === "win32" }, (t) => {
  const { home, cache } = withFolders(t, ["--help"]);
  for (const dir of [path.join(home, ".cache"), path.dirname(cache), cache]) assert.equal(fs.statSync(dir).mode & 0o077, 0, dir);
});

// A folder on the way that others can write to could hand dotagents their code: then it runs without the cache.
for (const loose of [".cache", ".cache/dotagents", ".cache/dotagents/compile-cache"]) {
  test(`the compile cache stays off when others can write to ~/${loose}`, { skip: process.platform === "win32" }, (t) => {
    const home = tempDir(t);
    const cache = path.join(home, ".cache", "dotagents", "compile-cache");
    fs.mkdirSync(cache, { recursive: true });
    fs.chmodSync(path.join(home, loose), 0o777);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env.NODE_COMPILE_CACHE;
    delete env.NODE_DISABLE_COMPILE_CACHE;
    const res = spawnSync(process.execPath, [path.join(REPO, "cli.ts"), "--help"], { encoding: "utf8", env });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(fs.readdirSync(cache), []);
  });
}

test("NODE_DISABLE_COMPILE_CACHE creates no cache folder", (t) => {
  const { home, shared } = withFolders(t, ["--help"], { env: { NODE_DISABLE_COMPILE_CACHE: "1" } });
  assert.deepEqual([...fs.readdirSync(home), ...fs.readdirSync(shared)], []);
});

test("--dry-run leaves the compile cache off, in either form the parser takes", (t) => {
  for (const flag of ["--dry-run", "--dry-run=true"]) {
    const { tmp, home, shared } = withFolders(t, ["--help", flag]);
    assert.deepEqual([...fs.readdirSync(tmp), ...fs.readdirSync(home), ...fs.readdirSync(shared)], [], flag);
  }
});
