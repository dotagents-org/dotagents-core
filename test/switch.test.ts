// The switch in place (ADR 0009): each side has one slot (~/.claude and ~/.claude.json); every
// account's login is kept in a vault, and a switch saves the slot's login back to its account's
// vault and writes the chosen one in. Fake credentials only.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { saveProfile } from "../core/machine-state.ts";
import { peerFailure, slotProfile, switchProfile, type PeerSwitch } from "../core/switch.ts";
import { state } from "../core/state.ts";
import { quiet } from "./helpers.ts";

function machine(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-switch-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DOTAGENTS_STATE_DIR: process.env.DOTAGENTS_STATE_DIR };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, DOTAGENTS_STATE_DIR: path.join(home, "state") });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    state.dryRun = false;
    fs.rmSync(home, { recursive: true, force: true });
  });
  quiet();
  saveProfile({ name: "work", configDir: path.join(home, ".claude"), color: "#D77655", default: true });
  saveProfile({ name: "personal", configDir: path.join(home, ".claude-personal"), color: "#376B80" });
  return home;
}

const creds = (token: string) => JSON.stringify({ claudeAiOauth: { accessToken: `at-${token}`, refreshToken: `rt-${token}`, expiresAt: 1 } });
const account = (uuid: string) => ({ accountUuid: uuid, emailAddress: `${uuid}@example.com` });

// A login in a folder: its .credentials.json and the oauthAccount of its state file.
function login(dir: string, stateFile: string, uuid: string, token: string, extra: Record<string, unknown> = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".credentials.json"), creds(token));
  const current = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
  fs.writeFileSync(stateFile, JSON.stringify({ ...current, ...extra, oauthAccount: account(uuid) }));
}

const slotToken = (home: string) => JSON.parse(fs.readFileSync(path.join(home, ".claude", ".credentials.json"), "utf8")).claudeAiOauth.refreshToken;
const slotAccount = (home: string) => JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
const vault = (home: string, name: string, file: string) => JSON.parse(fs.readFileSync(path.join(home, "state", "vault", name, file), "utf8"));
const noPeer: PeerSwitch = () => ({ ok: true, detail: "" });

test("a switch saves the slot's login to its account's vault and writes the chosen one in, keeping the rest of .claude.json", async (t) => {
  const home = machine(t);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1", { numStartups: 7 });
  login(path.join(home, ".claude-personal"), path.join(home, ".claude-personal", ".claude.json"), "uuid-personal", "personal1");
  // The slot's login is new to the vault: --save tells which profile it is.
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  quiet();
  await switchProfile({ name: "personal", peer: noPeer });
  assert.equal(slotToken(home), "rt-personal1", "the personal login is in the slot");
  assert.equal(slotAccount(home).oauthAccount.accountUuid, "uuid-personal");
  assert.equal(slotAccount(home).numStartups, 7, "the rest of .claude.json stays");
  assert.equal(vault(home, "work", "credentials.json").claudeAiOauth.refreshToken, "rt-work1");
  assert.equal(slotProfile()?.name, "personal");

  // Claude Code renewed the token in the slot meanwhile: switching back saves the renewed one.
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), creds("personal2"));
  quiet();
  await switchProfile({ name: "work", peer: noPeer });
  assert.equal(slotToken(home), "rt-work1");
  assert.equal(vault(home, "personal", "credentials.json").claudeAiOauth.refreshToken, "rt-personal2");
  assert.equal(slotProfile()?.name, "work");
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(home, "state", "vault", "work", "credentials.json")).mode & 0o777, 0o600);
});

test("switching to the account already in the slot changes nothing, and a dry run writes nothing", async (t) => {
  const home = machine(t);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1");
  login(path.join(home, ".claude-personal"), path.join(home, ".claude-personal", ".claude.json"), "uuid-personal", "personal1");
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  let events = quiet();
  await switchProfile({ name: "work", peer: noPeer, here: true });
  assert.ok(events.every((e) => e.kind !== "result" || e.status === "ok"));
  events = quiet({ dryRun: true });
  await switchProfile({ name: "personal", peer: noPeer });
  assert.equal(slotToken(home), "rt-work1");
  assert.ok(events.some((e) => e.kind === "result" && e.status === "would update"));
});

test("an account in the slot that no profile knows is never overwritten, and a profile without a login can't be chosen", async (t) => {
  const home = machine(t);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-stranger", "s1");
  login(path.join(home, ".claude-personal"), path.join(home, ".claude-personal", ".claude.json"), "uuid-personal", "personal1");
  quiet();
  await assert.rejects(switchProfile({ name: "personal", peer: noPeer }), /no profile knows.*--save/);
  assert.equal(slotToken(home), "rt-s1");
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  fs.rmSync(path.join(home, "state", "vault", "work"), { recursive: true });
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  quiet();
  await switchProfile({ name: "personal", peer: noPeer });
  quiet();
  await switchProfile({ name: "work", peer: noPeer });
  fs.rmSync(path.join(home, ".claude-personal"), { recursive: true });
  fs.rmSync(path.join(home, "state", "vault", "personal"), { recursive: true });
  await assert.rejects(switchProfile({ name: "personal", peer: noPeer }), /no login saved for personal/);
});

test("the switch reaches the other side too, unless --here", async (t) => {
  const home = machine(t);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1");
  login(path.join(home, ".claude-personal"), path.join(home, ".claude-personal", ".claude.json"), "uuid-personal", "personal1");
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  const calls: string[] = [];
  const peer: PeerSwitch = (name) => (calls.push(name), { ok: true, detail: "" });
  quiet();
  await switchProfile({ name: "personal", peer });
  assert.deepEqual(calls, ["personal"]);
  quiet();
  await switchProfile({ name: "work", peer, here: true });
  assert.deepEqual(calls, ["personal"]);
});

test("a failure on the other side reads as one line: an older dotagents says how to update it", () => {
  const nodeTrace = "file:///D:/x/core/common.ts:268\n    throw new Error(`x`);\n\nError: Missing value for --here\n    at parseArgs (file:///D:/x)\n\nNode.js v24.20.0";
  assert.match(peerFailure(nodeTrace), /doesn't know switch yet.*dotagents update/);
  assert.match(peerFailure("dotagents: Unknown command 'switch'. Run: dotagents --help"), /doesn't know switch yet/);
  assert.equal(peerFailure("✗ dotagents: There is no login saved for work: put it in the slot"), "There is no login saved for work: put it in the slot");
});
