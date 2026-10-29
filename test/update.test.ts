// What `update` says about the version a pull brought.

import assert from "node:assert/strict";
import { test } from "node:test";
import { versionNote } from "../commands/update.ts";

test("a pull that changes the version names both versions and the changelog", () => {
  assert.equal(versionNote("1.0.0", "2.0.0"), "version 1.0.0 → 2.0.0: see CHANGELOG.md");
});

test("a pull that keeps the version, or a package.json that can't be read, says nothing", () => {
  assert.equal(versionNote("2.0.0", "2.0.0"), null);
  assert.equal(versionNote("", "2.0.0"), null);
  assert.equal(versionNote("2.0.0", ""), null);
});
