// The TUI, rendered without a terminal (ink-testing-library), against a temporary home with two
// accounts: the frame, each screen, and the keys.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { render } from "ink-testing-library";
import { createElement as h } from "react";
import { launcherFile } from "../lib/accounts.ts";
import { registerWorkspace, saveAccount } from "../lib/machine-state.ts";
import { App } from "../tui/app.ts";
import { REPO, quiet } from "./helpers.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
// The frame without colors: a terminal with colors on (Windows Terminal) puts codes in the text.
const plain = (app: { lastFrame(): string | undefined }): string => (app.lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "");

function twoAccounts(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-tui-"));
  const keys = ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "DOTAGENTS_STATE_DIR"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    DOTAGENTS_STATE_DIR: path.join(home, "state"),
  });
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
  let frame = plain(app);
  for (const tab of ["1 Usage", "2 Accounts", "3 Workspaces", "4 Skills"]) assert.ok(frame.includes(tab), tab);
  assert.match(frame, /work[\s\S]*Session \(5h\)[\s\S]*93%/);
  assert.match(frame, /personal[\s\S]*12%/);

  app.stdin.write("2");
  await settle();
  frame = plain(app);
  assert.match(frame, /uuid-a@example\.com/);
  // The accounts' checklist, from verifyAccounts through capture: these accounts have no launcher.
  assert.match(frame, /✗ 4 passed · 2 failed[\s\S]*launcher claude-work(\.cmd)? exists/);

  app.stdin.write("4");
  await settle();
  assert.match(plain(app), /session-archive/);
  // More skills than lines: the list scrolls instead of growing past the terminal.
  assert.match(plain(app), /↓ \d+ more · ↑↓ scroll/);
  app.stdin.write("\u001B[B"); // ↓
  await settle();
  assert.match(plain(app), /↑ 1 more/);
});

test("the arrows and tab go round the screens, and the usage --watch view opens on usage", async (t) => {
  twoAccounts(t);
  const app = render(h(App, { repo: REPO, initial: "skills" }));
  t.after(() => app.unmount());
  assert.match(plain(app), /session-archive/);
  app.stdin.write("\u001B[C"); // →, from the last screen back to the first
  await settle();
  assert.match(plain(app), /Session \(5h\)/);
  app.stdin.write("\t");
  await settle();
  assert.match(plain(app), /uuid-b@example\.com/);
});

// Waits until the frame matches, for actions that finish on their own time.
async function until(app: ReturnType<typeof render>, pattern: RegExp) {
  for (let i = 0; i < 50 && !pattern.test(plain(app)); i++) await settle();
  assert.match(plain(app), pattern);
}

test("i on the accounts screen previews the install, n cancels it and y applies it", async (t) => {
  twoAccounts(t);
  const launcher = launcherFile("work");
  const app = render(h(App, { repo: REPO, initial: "accounts" }));
  t.after(() => app.unmount());
  app.stdin.write("i");
  await until(app, /Install, preview:[\s\S]*would create[\s\S]*y apply · n cancel/);
  assert.ok(!fs.existsSync(launcher));
  app.stdin.write("n");
  await settle();
  assert.doesNotMatch(plain(app), /preview/);
  app.stdin.write("i");
  await until(app, /y apply/);
  app.stdin.write("y");
  await until(app, /Install:[\s\S]*created/);
  assert.ok(fs.existsSync(launcher));
  // The checklist is read again: the launchers are there now.
  assert.match(plain(app), /✓ 6 passed/);
});

test("a on the workspaces screen applies the standards to the picked workspace, after a preview", async (t) => {
  twoAccounts(t);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-tui-ws-"));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  registerWorkspace(ws, ["to-cards"]);
  const app = render(h(App, { repo: REPO, initial: "workspaces" }));
  t.after(() => app.unmount());
  app.stdin.write("a");
  await until(app, /Apply the standards, preview:[\s\S]*AGENTS\.md/);
  assert.ok(!fs.existsSync(path.join(ws, "AGENTS.md")));
  app.stdin.write("y");
  await until(app, /Apply the standards:[\s\S]*created/);
  assert.ok(fs.existsSync(path.join(ws, "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(ws, ".agents", "skills", "to-cards", "SKILL.md")));
});
