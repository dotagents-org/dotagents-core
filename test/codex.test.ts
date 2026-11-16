// The Codex accounts (ADR 0007): one slot per side, <CODEX_HOME>/auth.json, and a vault per
// account; a switch puts a saved login in the slot under Codex's lock and restarts its daemon.
// Fake logins only.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { codexLoginMark, codexSlotProfile } from "../core/providers/codex-store.ts";
import { codexUsage, readCodexSlots } from "../core/snapshot.ts";
import { loadProfiles, saveProfile, sideName } from "../core/machine-state.ts";
import { setUpProfile, verifyProfiles } from "../core/profiles.ts";
import { state } from "../core/state.ts";
import { loginProfile } from "../core/account-login.ts";
import { type PeerSwitch, switchProfile } from "../core/account-switch.ts";
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

// Stands in for codex login: writes the account's auth.json into the folder it is given, and
// keeps the folder to check it is never the live one.
function fakeSignIn(text: string, seen: string[] = []) {
  return (home: string) => {
    seen.push(home);
    assert.match(fs.readFileSync(path.join(home, "config.toml"), "utf8"), /cli_auth_credentials_store = "file"/);
    fs.writeFileSync(path.join(home, "auth.json"), text);
    return { ok: true, detail: "" };
  };
}

test("login signs in in a folder of its own, keeps the login in the vault and, for the slot's account, puts it there", async (t) => {
  const home = machine(t);
  const { codex, restarts } = await twoSaved(home);
  const seen: string[] = [];
  quiet();
  await loginProfile({ name: "hopper", codex: { ...codex, run: fakeSignIn(auth("user-hopper", "hopper2", { grant: "grant-2" }), seen) } });
  assert.equal(vaultToken(home, "hopper"), "rt-hopper2");
  assert.equal(slotToken(home), "rt-dijkstra1", "dijkstra stays in the slot");
  assert.notEqual(path.resolve(seen[0]), path.join(home, ".codex"));
  assert.equal(fs.existsSync(seen[0]), false, "the folder is gone");
  assert.deepEqual(restarts, []);
  quiet();
  await loginProfile({ name: "dijkstra", codex: { ...codex, run: fakeSignIn(auth("user-dijkstra", "dijkstra2", { grant: "grant-2" })) } });
  assert.equal(vaultToken(home, "dijkstra"), "rt-dijkstra2");
  assert.equal(slotToken(home), "rt-dijkstra2", "the slot's account got the new login");
  assert.deepEqual(restarts, ["restart"]);
  // The new login is the slot's now, so a switch goes on without asking.
  quiet();
  await switchProfile({ name: "hopper", peer: noPeer, codex });
  assert.equal(slotToken(home), "rt-hopper2");
});

test("login refuses another account than the profile's, and keeps nothing", async (t) => {
  const home = machine(t);
  const { codex } = await twoSaved(home);
  quiet();
  await assert.rejects(loginProfile({ name: "hopper", codex: { ...codex, run: fakeSignIn(auth("user-dijkstra", "dijkstra2")) } }), /not hopper's account/);
  assert.equal(vaultToken(home, "hopper"), "rt-hopper1");
  assert.equal(vaultToken(home, "dijkstra"), "rt-dijkstra1");
  quiet();
  await assert.rejects(loginProfile({ name: "hopper", codex: { ...codex, run: () => ({ ok: false, detail: "exit 1" }) } }), /didn't finish/);
});

test("login of a profile with no saved login yet keeps its first one", async (t) => {
  const home = machine(t);
  quiet();
  await loginProfile({ name: "hopper", codex: { run: fakeSignIn(auth("user-hopper", "hopper1")), daemon: () => null } });
  assert.equal(vaultToken(home, "hopper"), "rt-hopper1");
  assert.equal(fs.existsSync(slot(home)), false, "an empty slot stays empty");
});

test("the start API lists the Codex profiles, without numbers, and which one is in the slot", async (t) => {
  const home = machine(t);
  quiet();
  assert.deepEqual(codexUsage().map((p) => [p.name, p.provider, p.state]), [["hopper", "codex", "not-signed-in"], ["dijkstra", "codex", "not-signed-in"]]);
  await twoSaved(home);
  assert.deepEqual(codexUsage().map((p) => [p.name, p.state, p.windows.length]), [["hopper", "no-data", 0], ["dijkstra", "no-data", 0]]);
  assert.deepEqual(readCodexSlots(), { [sideName()]: "dijkstra" });
});

// ── The checks of the logins ─────────────────────────────────────────────────────────────────
const refuse = (home: string, name: string, text: string) => {
  fs.mkdirSync(path.join(home, "state", "usage"), { recursive: true });
  fs.writeFileSync(path.join(home, "state", "usage", `${name}.json`), JSON.stringify({ version: 1, provider: "codex", refused: codexLoginMark(text) }));
};
const checked = () => {
  const events = quiet();
  verifyProfiles({ desktop: null });
  return JSON.stringify(events);
};

test("the checklist fails a login OpenAI refused until a new sign-in or a renewal changes it, and the switch warns", async (t) => {
  const home = machine(t);
  const { codex } = await twoSaved(home); // dijkstra in the slot
  assert.doesNotMatch(checked(), /refused/);
  // The slot's profile: the mark is of the slot's file.
  refuse(home, "dijkstra", fs.readFileSync(slot(home), "utf8"));
  assert.match(checked(), /dijkstra on [^"]*: OpenAI refused the login[^]*dotagents login dijkstra/);
  // Codex renewed the token in the slot: another mark, no refusal.
  signIn(home, auth("user-dijkstra", "dijkstra2"));
  assert.doesNotMatch(checked(), /refused/);
  // Another profile: the mark is of its vault's login, and the switch to it warns.
  refuse(home, "hopper", fs.readFileSync(path.join(home, "state", "vault", "hopper", "auth.json"), "utf8"));
  assert.match(checked(), /hopper on [^"]*: OpenAI refused the login/);
  const events = quiet();
  await switchProfile({ name: "hopper", peer: noPeer, codex });
  assert.equal(slotToken(home), "rt-hopper1", "it still switches");
  assert.match(JSON.stringify(events), /hopper's login was refused by OpenAI/);
  // A new sign-in brings another refresh token to the vault.
  fs.writeFileSync(path.join(home, "state", "vault", "hopper", "auth.json"), auth("user-hopper", "hopper2"));
  signIn(home, auth("user-hopper", "hopper2"));
  assert.doesNotMatch(checked(), /refused/);
});

test("the checklist warns about a credentials store other than file, only at the top level, and about key variables", async (t) => {
  const home = machine(t);
  await twoSaved(home);
  const config = path.join(home, ".codex", "config.toml");
  assert.doesNotMatch(checked(), /cli_auth_credentials_store/);
  fs.writeFileSync(config, 'model = "x"\ncli_auth_credentials_store = "keyring"\n');
  assert.match(checked(), /cli_auth_credentials_store is \\"keyring\\"/);
  fs.writeFileSync(config, 'cli_auth_credentials_store = "file"\n');
  assert.doesNotMatch(checked(), /cli_auth_credentials_store/);
  fs.writeFileSync(config, '[other]\ncli_auth_credentials_store = "auto"\n');
  assert.doesNotMatch(checked(), /cli_auth_credentials_store/);
  assert.equal(fs.readFileSync(config, "utf8"), '[other]\ncli_auth_credentials_store = "auto"\n', "config.toml is never edited");
  t.after(() => { delete process.env.CODEX_API_KEY; delete process.env.OPENAI_API_KEY; });
  process.env.CODEX_API_KEY = "sk-fake-secret";
  const out = checked();
  assert.match(out, /CODEX_API_KEY set in this shell/);
  assert.doesNotMatch(out, /sk-fake-secret/);
});

test("the checklist warns when the slot holds another user than the one the last switch put there", async (t) => {
  const home = machine(t);
  const { codex } = await twoSaved(home);
  await switchProfile({ name: "hopper", peer: noPeer, codex });
  assert.doesNotMatch(checked(), /last switch put/);
  // An open Codex wrote dijkstra's login back over the switch.
  signIn(home, auth("user-dijkstra", "dijkstra1"));
  const out = checked();
  assert.match(out, /holds dijkstra, but the last switch put hopper there/);
  assert.match(out, /written its old login back[^]*dotagents switch hopper again[^]*switch --save dijkstra/);
  assert.doesNotMatch(out, /example\.com|rt-|at-/);
  signIn(home, auth("user-stranger", "x"));
  assert.match(checked(), /an account no profile knows, but the last switch put hopper/);
  // A login puts its profile in the slot too.
  signIn(home, auth("user-hopper", "hopper1"));
  await switchProfile({ name: "dijkstra", peer: noPeer, codex });
  signIn(home, auth("user-hopper", "hopper1"));
  assert.match(checked(), /last switch put dijkstra/);
});

test("the checklist fails an auth.json that is a link or has more than one name", async (t) => {
  const home = machine(t);
  await twoSaved(home);
  assert.doesNotMatch(checked(), /a link|more than one name/);
  const real = path.join(home, "elsewhere.json");
  fs.copyFileSync(slot(home), real);
  fs.rmSync(slot(home));
  fs.symlinkSync(real, slot(home));
  assert.match(checked(), /auth\.json is a link/);
  fs.rmSync(slot(home));
  fs.copyFileSync(real, slot(home));
  fs.rmSync(real);
  fs.linkSync(slot(home), real);
  assert.match(checked(), /more than one name/);
});
