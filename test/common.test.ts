// The shared helpers, through their interface.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../core/common.ts";

test("a list option takes commas, and the spaces PowerShell turns them into", () => {
  const lists = ["skills"];
  assert.deepEqual(parseArgs(["--skills", "a,b"], { lists }).skills, ["a", "b"]);
  // PowerShell reads a,b,c as an array and npm's .ps1 shim passes it on as one "a b c" argument.
  assert.deepEqual(parseArgs(["--skills", "a b c"], { lists }).skills, ["a", "b", "c"]);
  assert.deepEqual(parseArgs(["--skills=a, b", "--skills", "c"], { lists }).skills, ["a", "b", "c"]);
});

test("an option no command knows is refused by name, and -- ends the options", () => {
  const known = { booleans: ["dry-run"], lists: ["skills"], values: ["color"] };
  assert.throws(() => parseArgs(["check", "--bogus"], known), /Unknown option --bogus/);
  assert.throws(() => parseArgs(["usage", "--bogus=1"], known), /Unknown option --bogus/);
  assert.throws(() => parseArgs(["profile", "add", "x", "--color"], known), /--color needs a value/);
  assert.deepEqual(parseArgs(["check", "--", "--odd-folder"], known)._, ["check", "--odd-folder"]);
  assert.equal(parseArgs(["profile", "add", "x", "--color", "#D77655"], known).color, "#D77655");
});
