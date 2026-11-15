// The Codex accounts (ADR 0017): one slot per side, <CODEX_HOME>/auth.json, and a vault per
// account; a switch puts a saved login in the slot under Codex's lock and restarts its daemon.
// Fake logins only.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { codexSlotProfile } from "../core/codex.ts";
import { loadProfiles, saveProfile } from "../core/machine-state.ts";
import { setUpProfile, verifyProfiles } from "../core/profiles.ts";
import { state } from "../core/state.ts";
import { type PeerSwitch, switchProfile } from "../core/switch.ts";
import { REPO, quiet } from "./helpers.ts";

function machine(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-codex-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DOTAGENTS_STATE_DIR: process.env.DOTAGENTS_STATE_DIR, CODEX_HOME: process.env.CODEX_HOME };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, DOTAGENTS_STATE_DIR: path.join(home, "state") });
  delete process.env.CODEX_HOME;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    state.dryRun = false;
    fs.rmSync(home, { recursive: true, force: true });
  });
  quiet();
  saveProfile({ name: "work", configDir: path.join(home, ".claude"), color: "#D77655", default: true });
  saveProfile({ name: "hopper", configDir: path.join(home, ".codex"), color: "#7B61A8", provider: "codex" });
  saveProfile({ name: "dijkstra", configDir: path.join(home, ".codex"), color: "#B8862B", provider: "codex" });
  return home;
}

// An auth.json as Codex writes it: both seats in one workspace (the same account_id), told apart
// by chatgpt_user_id; grant is the sign-in (login_owner_id).
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function auth(user: string, token: string, { grant = `grant-${user}`, refreshed = "2026-11-15T10:00:00Z" } = {}) {
  const idToken = `${b64({ alg: "none" })}.${b64({ email: `${user}@example.com`, "https://api.openai.com/auth": { chatgpt_user_id: user, chatgpt_account_id: "workspace-1", chatgpt_plan_type: "team" } })}.sig`;
  return `${JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null, last_refresh: refreshed, tokens: { id_token: idToken, access_token: `at-${token}`, refresh_token: `rt-${token}`, account_id: "workspace-1", login_owner_id: grant } }, null, 2)}\n`;
}

const slot = (home: string) => path.join(home, ".codex", "auth.json");
const slotToken = (home: string) => JSON.parse(fs.readFileSync(slot(home), "utf8")).tokens.refresh_token;
const vaultToken = (home: string, name: string) => JSON.parse(fs.readFileSync(path.join(home, "state", "vault", name, "auth.json"), "utf8")).tokens.refresh_token;
const signIn = (home: string, text: string) => {
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(slot(home), text);
};
const noPeer: PeerSwitch = () => ({ ok: true, detail: "" });

// Both profiles saved, dijkstra's login left in the slot; the daemon calls are counted.
async function twoSaved(home: string) {
  const restarts: string[] = [];
  const codex = { daemon: () => (restarts.push("restart"), "restarted") };
  signIn(home, auth("user-hopper", "hopper1"));
  await switchProfile({ save: "hopper", peer: noPeer, codex });
  signIn(home, auth("user-dijkstra", "dijkstra1"));
  await switchProfile({ save: "dijkstra", peer: noPeer, codex });
  restarts.length = 0;
  return { codex, restarts };
}

test("profile add --provider codex records the profile on ~/.codex, without touching Claude's files", (t) => {
  const home = machine(t);
  quiet();
  setUpProfile(REPO, { name: "lovelace", provider: "codex", desktop: null });
  const profile = loadProfiles().find((p) => p.name === "lovelace");
  assert.deepEqual(profile && { provider: profile.provider, configDir: profile.configDir }, { provider: "codex", configDir: path.join(home, ".codex") });
  assert.equal(fs.existsSync(path.join(home, ".claude", "CLAUDE.md")), false, "no Claude configuration was written");
  assert.throws(() => setUpProfile(REPO, { name: "lovelace", desktop: null }), /already a codex profile/);
  assert.throws(() => setUpProfile(REPO, { name: "x", provider: "gemini", desktop: null }), /not a provider/);
  assert.throws(() => setUpProfile(REPO, { name: "x", provider: "codex", isDefault: true, desktop: null }), /Desktop/);
});

test("a switch saves the slot's login to its vault, puts the chosen one in, restarts the daemon and leaves ~/.claude alone", async (t) => {
  const home = machine(t);
  const { codex, restarts } = await twoSaved(home);
  // Codex renewed dijkstra's token in the slot since it was saved.
  signIn(home, auth("user-dijkstra", "dijkstra2", { refreshed: "2026-11-15T11:00:00Z" }));
  const events = quiet();
  await switchProfile({ name: "hopper", peer: noPeer, codex });
  assert.equal(slotToken(home), "rt-hopper1");
  assert.equal(vaultToken(home, "dijkstra"), "rt-dijkstra2", "the renewed login went back to its vault");
  assert.equal(codexSlotProfile()?.name, "hopper");
  assert.deepEqual(restarts, ["restart"]);
  assert.equal(fs.existsSync(path.join(home, ".claude")), false);
  if (process.platform !== "win32") assert.equal(fs.statSync(slot(home)).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(events), /rt-|at-|example\.com/, "no token or e-mail in the output");
  // A second run changes nothing and doesn't restart the daemon again.
  quiet();
  await switchProfile({ name: "hopper", here: true, codex });
  assert.equal(state.counts.updated ?? 0, 0);
  assert.deepEqual(restarts, ["restart"]);
});

test("another sign-in of the slot's account, or one no profile knows, stops the switch and leaves the slot", async (t) => {
  const home = machine(t);
  const { codex } = await twoSaved(home);
  signIn(home, auth("user-dijkstra", "dijkstra9", { grant: "grant-new" }));
  quiet();
  await assert.rejects(switchProfile({ name: "hopper", peer: noPeer, codex }), /another sign-in of dijkstra/);
  assert.equal(slotToken(home), "rt-dijkstra9");
  assert.equal(vaultToken(home, "dijkstra"), "rt-dijkstra1");
  signIn(home, auth("user-stranger", "stranger1"));
  quiet();
  await assert.rejects(switchProfile({ name: "hopper", peer: noPeer, codex }), /no profile knows/);
  assert.equal(slotToken(home), "rt-stranger1");
  // --save refuses a login that is another profile's.
  signIn(home, auth("user-hopper", "hopper1"));
  quiet();
  await assert.rejects(switchProfile({ save: "dijkstra", peer: noPeer, codex }), /hopper's/);
});

test("a dry run changes no file", async (t) => {
  const home = machine(t);
  const { codex, restarts } = await twoSaved(home);
  quiet({ dryRun: true });
  await switchProfile({ name: "hopper", peer: noPeer, codex });
  assert.equal(slotToken(home), "rt-dijkstra1");
  assert.deepEqual(restarts, []);
});

test("the checklist names a Codex profile without a login and two holding the same account", async (t) => {
  const home = machine(t);
  const events = quiet();
  verifyProfiles({ desktop: null });
  assert.match(JSON.stringify(events), /hopper has no saved login/);
  signIn(home, auth("user-hopper", "hopper1"));
  await switchProfile({ save: "hopper", peer: noPeer, codex: { daemon: () => null } });
  fs.mkdirSync(path.join(home, "state", "vault", "dijkstra"), { recursive: true });
  fs.writeFileSync(path.join(home, "state", "vault", "dijkstra", "auth.json"), auth("user-hopper", "copy"));
  const again = quiet();
  verifyProfiles({ desktop: null });
  assert.match(JSON.stringify(again), /dijkstra and hopper hold the same account|hopper and dijkstra hold the same account/);
});

const hasFlock = process.platform !== "win32" && spawnSync("flock", ["--version"]).status === 0;

test("the switch waits for Codex's commit lock and gives up after 5 s", { skip: !hasFlock && "no flock command here" }, async (t) => {
  const home = machine(t);
  const { codex } = await twoSaved(home);
  const holder = spawn("flock", ["-x", path.join(home, ".codex", "auth.json.lock"), "sleep", "10"]);
  t.after(() => holder.kill());
  await new Promise((resolve) => setTimeout(resolve, 300));
  quiet();
  const started = Date.now();
  await assert.rejects(switchProfile({ name: "hopper", peer: noPeer, codex }), /holds its login lock/);
  assert.ok(Date.now() - started >= 4500, "it waited for the lock");
  assert.equal(slotToken(home), "rt-dijkstra1", "the slot is untouched");
});
