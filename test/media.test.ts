// The README's captures are drawn from the views: they must match what the views draw today.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { captures } from "../scripts/media.ts";
import { REPO } from "./helpers.ts";

test("the captures in docs/media are up to date with the views (npm run media)", () => {
  for (const [name, content] of Object.entries(captures())) {
    assert.equal(fs.readFileSync(path.join(REPO, "docs", "media", name), "utf8").replace(/\r\n/g, "\n"), content, `${name} is stale: run npm run media`);
  }
});
