// The switch in place (ADR 0009): each side has one slot (~/.claude and ~/.claude.json); every
// account's login is kept in a vault, and a switch saves the slot's login back to its account's
// vault and writes the chosen one in. Fake credentials only.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { saveMachine, saveProfile } from "../core/machine-state.ts";
import { type ClaudeLogin, loginMark, loginProfile, peerFailure, slotProfile, switchProfile, verifyLogins, type PeerSwitch } from "../core/switch.ts";
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

test("a token Claude Code renews in the middle of a switch is saved, not lost with the slot", async (t) => {
  const home = machine(t);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1");
  login(path.join(home, ".claude-personal"), path.join(home, ".claude-personal", ".claude.json"), "uuid-personal", "personal1");
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  quiet();
  // A session renews work's token after the switch saved it, before the slot is replaced.
  const renew = () => fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), creds("work2"));
  await switchProfile({ name: "personal", peer: noPeer, afterSave: renew });
  assert.equal(vault(home, "work", "credentials.json").claudeAiOauth.refreshToken, "rt-work2", "the renewed token is the one kept");
  assert.equal(slotToken(home), "rt-personal1");
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

test("the checklist says when each profile's saved login expires, warning a week ahead and failing once it has", async (t) => {
  const home = machine(t);
  const day = 86_400_000;
  const now = new Date("2026-10-30T12:00:00Z");
  const withExpiry = (token: string, ms: number) => JSON.stringify({ claudeAiOauth: { accessToken: `at-${token}`, refreshToken: `rt-${token}`, expiresAt: 1, refreshTokenExpiresAt: ms } });
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1");
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), withExpiry("work1", now.getTime() + 20 * day));
  login(path.join(home, ".claude-personal"), path.join(home, ".claude-personal", ".claude.json"), "uuid-personal", "p1");
  fs.writeFileSync(path.join(home, ".claude-personal", ".credentials.json"), withExpiry("p1", now.getTime() + 3 * day));
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  let events = quiet();
  verifyLogins(now);
  const text = (k: string) => events.filter((e) => e.kind === k).map((e) => ("text" in e ? e.text : "")).join("\n");
  assert.match(text("check"), /work.*Nov 19/);
  assert.match(text("warning"), /personal.*expires in 3 days/);
  assert.equal(state.problems, 0);
  fs.writeFileSync(path.join(home, ".claude-personal", ".credentials.json"), withExpiry("p1", now.getTime() - day));
  events = quiet();
  verifyLogins(now);
  assert.equal(state.problems, 1);
  assert.match(text("check"), /personal.*expired/);
});

// The live usage marks the login Anthropic refused (core/live.ts); the mark holds for that login,
// wherever it is copied, until a new sign-in or a renewal brings another.
const refuse = (home: string, name: string, token: string) => {
  fs.mkdirSync(path.join(home, "state", "usage"), { recursive: true });
  fs.writeFileSync(path.join(home, "state", "usage", `${name}.json`), JSON.stringify({ version: 1, refused: loginMark(creds(token)), error: "Anthropic refused the login (401); sign in again" }));
};

test("a login Anthropic refused fails the checklist and warns on a switch, until it is signed in again", async (t) => {
  const home = machine(t);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1");
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  refuse(home, "work", "work1");
  let events = quiet();
  verifyLogins();
  const text = (k: string) => events.filter((e) => e.kind === k).map((e) => ("text" in e ? e.text : "")).join("\n");
  assert.equal(state.problems, 1);
  assert.match(text("check"), /work on .*: Anthropic refused the login/);
  events = quiet();
  await switchProfile({ name: "work", peer: noPeer, here: true });
  assert.match(text("warning"), /work.*refused/, "already in the slot, but not a good login");
  // Signed in again: a new refresh token.
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), creds("work2"));
  events = quiet();
  verifyLogins();
  assert.equal(state.problems, 0);
});

test("a refused login stays refused when a switch copies it into the slot", async (t) => {
  const home = machine(t);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1");
  login(path.join(home, ".claude-personal"), path.join(home, ".claude-personal", ".claude.json"), "uuid-personal", "personal1");
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  refuse(home, "personal", "personal1");
  quiet();
  await switchProfile({ name: "personal", peer: noPeer, here: true });
  assert.equal(slotToken(home), "rt-personal1");
  const events = quiet();
  verifyLogins();
  assert.ok(events.some((e) => e.kind === "check" && !e.passed && /personal on .*: Anthropic refused/.test(e.text)));
});

test("a slot that names an account but has no credentials fails the checklist, on either side", async (t) => {
  const home = machine(t);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1");
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  const peerHome = path.join(home, "peer");
  login(path.join(peerHome, ".claude"), path.join(peerHome, ".claude.json"), "uuid-work", "work1");
  saveMachine({ peer: { name: "Windows", home: peerHome, nativeHome: "C:\\Users\\me" } });
  let events = quiet();
  verifyLogins();
  assert.equal(state.problems, 0);
  fs.rmSync(path.join(peerHome, ".claude", ".credentials.json"));
  events = quiet();
  verifyLogins();
  const checks = events.filter((e) => e.kind === "check" && !e.passed).map((e) => ("text" in e ? e.text : ""));
  assert.deepEqual(checks, ["the slot on Windows has no login (it names work)"]);
  fs.rmSync(path.join(home, ".claude", ".credentials.json"));
  events = quiet();
  verifyLogins();
  assert.equal(state.problems, 2);
});

// Stands in for `claude auth login`: signs the slot in to an account with a new token.
const signsIn = (home: string, uuid: string, token: string, calls: string[] = []): ClaudeLogin => () => {
  calls.push(uuid);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), uuid, token);
  return { ok: true, detail: "" };
};

test("login signs a profile in through the slot, keeps the new login in its vault and puts the previous account back", async (t) => {
  const home = machine(t);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1");
  login(path.join(home, ".claude-personal"), path.join(home, ".claude-personal", ".claude.json"), "uuid-personal", "personal1");
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  quiet();
  await switchProfile({ name: "personal", peer: noPeer, here: true });
  await switchProfile({ name: "work", peer: noPeer, here: true });
  quiet();
  await loginProfile({ name: "personal", run: signsIn(home, "uuid-personal", "personal2") });
  assert.equal(vault(home, "personal", "credentials.json").claudeAiOauth.refreshToken, "rt-personal2", "the new login is in the vault");
  assert.equal(slotToken(home), "rt-work1", "the account that was in the slot is back");
  assert.equal(slotProfile()?.name, "work");
  // The profile already in the slot: nothing to put back, and the new login is still kept.
  quiet();
  await loginProfile({ name: "work", run: signsIn(home, "uuid-work", "work2") });
  assert.equal(vault(home, "work", "credentials.json").claudeAiOauth.refreshToken, "rt-work2");
});

test("login refuses an account other than the profile's, and saves nothing for it", async (t) => {
  const home = machine(t);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1");
  login(path.join(home, ".claude-personal"), path.join(home, ".claude-personal", ".claude.json"), "uuid-personal", "personal1");
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  await switchProfile({ name: "personal", peer: noPeer, here: true });
  await switchProfile({ name: "work", peer: noPeer, here: true });
  quiet();
  await assert.rejects(loginProfile({ name: "personal", run: signsIn(home, "uuid-other", "x1") }), /uuid-other@example.com, not personal's account/);
  assert.equal(vault(home, "personal", "credentials.json").claudeAiOauth.refreshToken, "rt-personal1");
  assert.equal(slotToken(home), "rt-work1", "the unknown account is dropped and work is back in the slot");
});

test("login keeps the slot's newer token when the sign-in fails for the profile already there", async (t) => {
  const home = machine(t);
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1");
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  // Claude Code renews the token in the slot after the last save.
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), creds("work1b"));
  quiet();
  await assert.rejects(loginProfile({ name: "work", run: () => ({ ok: false, detail: "exit 1" }) }), /didn't finish/);
  assert.equal(vault(home, "work", "credentials.json").claudeAiOauth.refreshToken, "rt-work1b");
});

test("login --all signs in only the profiles whose login runs out within a week; a dry run signs in none", async (t) => {
  const home = machine(t);
  const day = 86_400_000;
  const now = new Date();
  const withExpiry = (token: string, ms: number) => JSON.stringify({ claudeAiOauth: { accessToken: `at-${token}`, refreshToken: `rt-${token}`, expiresAt: 1, refreshTokenExpiresAt: ms } });
  login(path.join(home, ".claude"), path.join(home, ".claude.json"), "uuid-work", "work1");
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), withExpiry("work1", now.getTime() + 20 * day));
  login(path.join(home, ".claude-personal"), path.join(home, ".claude-personal", ".claude.json"), "uuid-personal", "p1");
  fs.writeFileSync(path.join(home, ".claude-personal", ".credentials.json"), withExpiry("p1", now.getTime() + 3 * day));
  quiet();
  await switchProfile({ save: "work", peer: noPeer });
  await switchProfile({ name: "personal", peer: noPeer, here: true });
  await switchProfile({ name: "work", peer: noPeer, here: true });
  const calls: string[] = [];
  quiet({ dryRun: true });
  await loginProfile({ all: true, now, run: signsIn(home, "uuid-personal", "p2", calls) });
  assert.deepEqual(calls, [], "a dry run runs no sign-in");
  quiet();
  await loginProfile({ all: true, now, run: signsIn(home, "uuid-personal", "p2", calls) });
  assert.deepEqual(calls, ["uuid-personal"], "only personal, which runs out in 3 days");
  assert.equal(slotProfile()?.name, "work");
});
