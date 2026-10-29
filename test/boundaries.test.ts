// The layers: core/ holds the data and the actions and draws nothing; each folder under surfaces/
// uses core/ and never another surface. cli.ts, at the root, is the only place that picks one.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers.ts";

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? sources(full) : e.name.endsWith(".ts") ? [full] : [];
  });
}

// Every module a file imports, statically or with import(), resolved to a path in the repository.
function imports(file: string) {
  const text = fs.readFileSync(file, "utf8");
  const specs = [...text.matchAll(/(?:from\s+|import\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
  return specs.map((s) => path.relative(REPO, path.resolve(path.dirname(file), s)).split(path.sep).join("/"));
}

// "surfaces/cli/usage.ts" → "cli"; null outside surfaces/.
const surfaceOf = (rel: string) => (rel.startsWith("surfaces/") ? rel.split("/")[1] : null);

test("core never imports a surface", () => {
  const wrong = sources(path.join(REPO, "core")).flatMap((f) => imports(f).filter((i) => i.startsWith("surfaces/")).map((i) => `${path.relative(REPO, f)} → ${i}`));
  assert.deepEqual(wrong, []);
});

test("a surface never imports another surface", () => {
  const wrong = sources(path.join(REPO, "surfaces")).flatMap((f) => {
    const own = surfaceOf(path.relative(REPO, f).split(path.sep).join("/"));
    return imports(f).filter((i) => surfaceOf(i) && surfaceOf(i) !== own).map((i) => `${path.relative(REPO, f)} → ${i}`);
  });
  assert.deepEqual(wrong, []);
});
