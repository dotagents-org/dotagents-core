import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import type * as prompts from "@clack/prompts";
import { askInit } from "../surfaces/cli/init.ts";
import { REPO, quiet, tempWorkspace } from "./helpers.ts";

function fake(answer: string | null, wrap: boolean) {
  const asked: string[] = [];
  const api = {
    isCancel: () => false,
    intro: () => {},
    cancel: () => {},
    log: { message: () => {} },
    text: async () => answer,
    confirm: async ({ message }: { message: string }) => { asked.push(message); return wrap; },
    multiselect: async () => [],
  } as unknown as typeof prompts;
  return { api, asked };
}

test("init --wrap uses the final repository without a wrap question", async (t) => {
  const first = tempWorkspace(t, "first");
  const chosen = tempWorkspace(t, "chosen");
  for (const folder of [first, chosen]) assert.equal(spawnSync("git", ["-C", folder, "init", "-q"]).status, 0);
  quiet({ dryRun: true });
  const { api, asked } = fake(chosen, false);
  const result = await askInit({ repo: REPO, args: { _: [], wrap: true }, positional: [] }, first, {}, api);
  assert.equal(result.wrapFrom, chosen);
  assert.equal(result.ws, `${chosen}-workspace`);
  assert.equal(asked.length, 0);
});

test("init without --wrap still asks before moving a repository", async (t) => {
  const folder = tempWorkspace(t, "repo");
  assert.equal(spawnSync("git", ["-C", folder, "init", "-q"]).status, 0);
  quiet({ dryRun: true });
  const { api, asked } = fake(null, false);
  const result = await askInit({ repo: REPO, args: { _: [] }, positional: [folder] }, folder, {}, api);
  assert.equal(result.wrapFrom, null);
  assert.equal(result.ws, path.resolve(folder));
  assert.equal(asked.length, 1);
});

test("init --wrap skips non-repositories and an already opened clone", async (t) => {
  const folder = tempWorkspace(t, "plain");
  quiet({ dryRun: true });
  const { api, asked } = fake(null, false);
  const context = { repo: REPO, args: { _: [], wrap: true }, positional: [folder] };
  assert.equal((await askInit(context, folder, {}, api)).wrapFrom, null);
  assert.equal(spawnSync("git", ["-C", folder, "init", "-q"]).status, 0);
  assert.equal((await askInit(context, folder, { opened: true }, api)).wrapFrom, null);
  assert.equal(asked.length, 0);
});
