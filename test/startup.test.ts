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

// Runs cli.ts with the temporary folder and this user's cache folder each in a folder of the test's own.
function withFolders(t: TestContext, args: string[], { xdg, localAppData }: { xdg?: string; localAppData?: string } = {}) {
  const tmp = tempDir(t);
  const cache = tempDir(t);
  const home = tempDir(t);
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, XDG_CACHE_HOME: xdg ?? cache, LOCALAPPDATA: localAppData ?? cache, HOME: home, USERPROFILE: home };
  delete env.NODE_COMPILE_CACHE;
  delete env.NODE_DISABLE_COMPILE_CACHE;
  const res = spawnSync(process.execPath, [path.join(REPO, "cli.ts"), ...args], { encoding: "utf8", env, cwd: tmp });
  assert.equal(res.status, 0, res.stderr);
  return { tmp, cache, home: env.HOME! };
}

// The shared temporary folder (Node's default) would let another account plant code in the cache.
test("the compile cache lives in this user's cache folder, never the temporary one", (t) => {
  const { tmp, cache } = withFolders(t, ["--help"]);
  assert.deepEqual(fs.readdirSync(tmp), []);
  assert.ok(fs.readdirSync(path.join(cache, "dotagents", "compile-cache")).length);
});

test("every other test runs the commands without the compile cache", () => {
  assert.equal(process.env.NODE_DISABLE_COMPILE_CACHE, "1");
});

test("a relative LOCALAPPDATA is ignored", { skip: process.platform !== "win32" }, (t) => {
  const { tmp, home } = withFolders(t, ["--help"], { localAppData: "relative-cache" });
  assert.deepEqual(fs.readdirSync(tmp), []);
  assert.ok(fs.readdirSync(path.join(home, "AppData", "Local", "dotagents", "compile-cache")).length);
});

// The XDG spec ignores a relative XDG_CACHE_HOME: it would put the cache in whatever folder the command runs in.
test("a relative XDG_CACHE_HOME is ignored", { skip: process.platform === "win32" }, (t) => {
  const { tmp, home } = withFolders(t, ["--help"], { xdg: "relative-cache" });
  assert.deepEqual(fs.readdirSync(tmp), []);
  assert.ok(fs.readdirSync(path.join(home, ".cache", "dotagents", "compile-cache")).length);
});

test("--dry-run leaves the compile cache off, in either form the parser takes", (t) => {
  for (const flag of ["--dry-run", "--dry-run=true"]) {
    const { tmp, cache } = withFolders(t, ["--help", flag]);
    assert.deepEqual([...fs.readdirSync(tmp), ...fs.readdirSync(cache)], [], flag);
  }
});
