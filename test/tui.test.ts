// The TUI, rendered without a terminal (ink-testing-library), against a temporary home with two
// accounts: the frame, each screen, and the keys.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { render } from "ink-testing-library";
import { createElement as h } from "react";
import { saveAccount } from "../lib/machine-state.ts";
import { App } from "../tui/app.ts";
import { REPO, quiet } from "./helpers.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

function twoAccounts(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-tui-"));
  const keys = ["HOME", "USERPROFILE", "DOTAGENTS_STATE_DIR"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, DOTAGENTS_STATE_DIR: path.join(home, "state") });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(home, { recursive: true, force: true });
  });
  quiet();
  const now = Date.now();
  const signed = (uuid: string, pct: number) => ({
    oauthAccount: { accountUuid: uuid, emailAddress: `${uuid}@example.com` },
    cachedUsageUtilization: {
      fetchedAtMs: now,
      accountUuid: uuid,
      utilization: { limits: [{ kind: "session", percent: pct, resets_at: new Date(now + 3_600_000).toISOString() }] },
    },
  });
  fs.mkdirSync(path.join(home, ".claude"));
  fs.mkdirSync(path.join(home, ".claude-personal"));
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify(signed("uuid-a", 93)));
  fs.writeFileSync(path.join(home, ".claude-personal", ".claude.json"), JSON.stringify(signed("uuid-b", 12)));
  saveAccount({ name: "work", configDir: path.join(home, ".claude"), color: "#D77655", default: true });
  saveAccount({ name: "personal", configDir: path.join(home, ".claude-personal"), color: "#376B80" });
}

test("the usage screen shows every account, and the number keys switch screens", async (t) => {
  twoAccounts(t);
  const app = render(h(App, { repo: REPO }));
  t.after(() => app.unmount());
  let frame = app.lastFrame() ?? "";
  for (const tab of ["1 Usage", "2 Accounts", "3 Workspaces", "4 Skills"]) assert.ok(frame.includes(tab), tab);
  assert.match(frame, /work[\s\S]*Session \(5h\)[\s\S]*93%/);
  assert.match(frame, /personal[\s\S]*12%/);

  app.stdin.write("2");
  await settle();
  frame = app.lastFrame() ?? "";
  assert.match(frame, /uuid-a@example\.com/);
  // The accounts' checklist, from verifyAccounts through capture: these accounts have no launcher.
  assert.match(frame, /✗ 4 passed · 2 failed[\s\S]*launcher claude-work exists/);

  app.stdin.write("4");
  await settle();
  assert.match(app.lastFrame() ?? "", /session-archive/);
});

test("the arrows and tab go round the screens, and the usage --watch view opens on usage", async (t) => {
  twoAccounts(t);
  const app = render(h(App, { repo: REPO, initial: "skills" }));
  t.after(() => app.unmount());
  assert.match(app.lastFrame() ?? "", /session-archive/);
  app.stdin.write("\u001B[C"); // →, from the last screen back to the first
  await settle();
  assert.match(app.lastFrame() ?? "", /Session \(5h\)/);
  app.stdin.write("\t");
  await settle();
  assert.match(app.lastFrame() ?? "", /uuid-b@example\.com/);
});
