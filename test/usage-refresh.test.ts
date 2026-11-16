import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fetchUsage } from "../core/accounts/usage-refresh.ts";
import { quiet } from "./helpers.ts";

test("a profile without a saved login is not sent to its provider", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-usage-refresh-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  quiet();
  let asked = false;
  const profile = { name: "no-login", configDir: path.join(home, ".claude"), color: "#123456", provider: "claude" as const };
  const result = await fetchUsage(profile, { now: () => Date.parse("2026-10-30T12:00:00Z"), fetcher: async () => { asked = true; throw new Error("unexpected network request"); } });
  assert.deepEqual(result, { status: "failed", detail: "no login saved for it" });
  assert.equal(asked, false);
});
