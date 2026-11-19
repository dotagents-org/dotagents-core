// What the start API answers (docs/start-api.md), whole: Claude only, Claude and Codex, a Codex
// profile in a slot on each side, the plan known and unknown. Fake logins on temporary folders.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { saveMachine, saveProfile, sideName } from "../../core/machine/machine-state.ts";
import { readAll, startAnswer } from "../../core/accounts/snapshot.ts";
import { listedProfiles } from "../../core/accounts/providers.ts";
import { quiet } from "../helpers.ts";

const NOW = new Date("2026-11-16T12:00:00Z");
const peerName = process.platform === "win32" ? "WSL" : "Windows";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
// Long tokens, so a leak is told from the text around it.
const secret = (name: string) => `${name}-${"a1b2c3d4".repeat(6)}`;
function codexAuth(user: string, plan?: string) {
  const claims = { email: `${user}@example.com`, "https://api.openai.com/auth": { chatgpt_user_id: user, ...(plan ? { chatgpt_plan_type: plan } : {}) } };
  const tokens = { id_token: `${b64({ alg: "none" })}.${b64(claims)}.sig`, access_token: `at-${secret(user)}`, refresh_token: `rt-${secret(user)}`, login_owner_id: `grant-${user}` };
  return JSON.stringify({ auth_mode: "chatgpt", last_refresh: "2026-11-15T10:00:00Z", tokens });
}
const claudeCredentials = (name: string, plan?: string) => JSON.stringify({ claudeAiOauth: { accessToken: `at-${secret(name)}`, refreshToken: `rt-${secret(name)}`, expiresAt: Date.parse("2026-11-17T00:00:00Z"), ...(plan ? { subscriptionType: plan } : {}) } });
const put = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

function machine(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-start-answer-"));
  const home = path.join(root, "home");
  const peer = path.join(root, "peer");
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DOTAGENTS_STATE_DIR: process.env.DOTAGENTS_STATE_DIR, CODEX_HOME: process.env.CODEX_HOME };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, DOTAGENTS_STATE_DIR: path.join(home, "state") });
  delete process.env.CODEX_HOME;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(root, { recursive: true, force: true });
  });
  quiet();
  const vault = (name: string, file: string) => path.join(home, "state", "vault", name, file);
  const claude = (name: string, color: string, uuid: string, plan?: string, slot = false) => {
    saveProfile({ name, configDir: path.join(home, `.claude-${name}`), color, ...(name === "turing" ? { default: true } : {}) });
    put(vault(name, "credentials.json"), claudeCredentials(name, plan));
    put(vault(name, "account.json"), JSON.stringify({ accountUuid: uuid, emailAddress: `${name}@example.com` }));
    if (slot) {
      put(path.join(home, ".claude", ".credentials.json"), claudeCredentials(name, plan));
      put(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: uuid, emailAddress: `${name}@example.com` } }));
    }
  };
  const codex = (name: string, color: string, user: string, plan?: string, isDefault = false) => {
    saveProfile({ name, configDir: path.join(home, ".codex"), color, provider: "chatgpt", ...(isDefault ? { default: true } : {}) });
    put(vault(name, "auth.json"), codexAuth(user, plan));
  };
  return { home, peer, claude, codex };
}

test("Claude only: no codex entry in current, the plan from the saved credentials, null when absent", (t) => {
  const m = machine(t);
  m.claude("turing", "#D77655", "uuid-t", "team", true);
  m.claude("lovelace", "#376B80", "uuid-l");
  const a = startAnswer(NOW);
  assert.deepEqual(a.profiles.map((p) => [p.name, p.provider, p.plan]), [["turing", "claude", "team"], ["lovelace", "claude", null]]);
  assert.deepEqual(a.slots, { claude: { [sideName()]: "turing" }, chatgpt: {} });
  assert.deepEqual(Object.keys(a.current), ["claude"]);
  assert.equal(a.current.claude.profile, "turing");
  assert.deepEqual(a.sides, [sideName()]);
  assert.equal("peer" in a, false);
  assert.equal(a.version, 1);
  assert.equal(a.generatedAt, NOW.toISOString());
});

test("Claude and Codex: Claude first, Codex plan from the login, a current per provider", (t) => {
  const m = machine(t);
  m.claude("turing", "#D77655", "uuid-t", "max", true);
  m.codex("hopper", "#7B61A8", "user-hopper", "team", true);
  m.codex("dijkstra", "#B8862B", "user-dijkstra");
  fs.mkdirSync(path.join(m.home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(m.home, ".codex", "auth.json"), codexAuth("user-hopper", "team"));
  const a = startAnswer(NOW);
  assert.deepEqual(a.profiles.map((p) => [p.name, p.provider, p.plan, p.state]), [["turing", "claude", "max", "no-data"], ["hopper", "chatgpt", "team", "no-data"], ["dijkstra", "chatgpt", null, "no-data"]]);
  assert.deepEqual(a.slots, { claude: { [sideName()]: "turing" }, chatgpt: { [sideName()]: "hopper" } });
  assert.deepEqual(a.current.chatgpt, { profile: "hopper", state: "asleep" });
  assert.equal(a.current.claude.profile, "turing");
  const hopper = a.profiles.find((p) => p.name === "hopper")!;
  assert.deepEqual(Object.keys(hopper).sort(), ["avatar", "color", "default", "fetchedAt", "name", "plan", "provider", "state", "windows", "working"]);
  assert.deepEqual(a.profiles.filter((p) => p.default).map((p) => p.name), ["turing", "hopper"]);
});

test("the profile in the slot comes first for each provider, in the API and in usage", (t) => {
  const m = machine(t);
  m.claude("turing", "#D77655", "uuid-t", "team");
  m.claude("lovelace", "#376B80", "uuid-l", "team", true);
  m.codex("hopper", "#7B61A8", "user-hopper", "team");
  m.codex("dijkstra", "#B8862B", "user-dijkstra", "team");
  put(path.join(m.home, ".codex", "auth.json"), codexAuth("user-dijkstra", "team"));
  const a = startAnswer(NOW);
  assert.deepEqual(a.profiles.map((p) => p.name), ["lovelace", "turing", "dijkstra", "hopper"]);
  assert.deepEqual([a.current.claude.profile, a.current.chatgpt!.profile], ["lovelace", "dijkstra"]);
  assert.deepEqual(readAll(NOW).map((p) => p.name), ["lovelace", "turing", "dijkstra", "hopper"]);
});

test("profile list orders like usage: by provider, the one in the slot first", (t) => {
  const m = machine(t);
  m.codex("hopper", "#7B61A8", "user-hopper", "team");
  m.claude("turing", "#D77655", "uuid-t", "team");
  m.codex("dijkstra", "#B8862B", "user-dijkstra", "team");
  m.claude("lovelace", "#376B80", "uuid-l", "team", true);
  put(path.join(m.home, ".codex", "auth.json"), codexAuth("user-dijkstra", "team"));
  assert.deepEqual(listedProfiles().map((p) => p.name), ["lovelace", "turing", "dijkstra", "hopper"]);
});

test("this side's slot comes first and wins ties for the current account", (t) => {
  const m = machine(t);
  m.codex("knuth", "#6B7F4A", "user-knuth", "team");
  m.codex("dijkstra", "#B8862B", "user-dijkstra", "team");
  m.codex("hopper", "#7B61A8", "user-hopper", "team");
  put(path.join(m.home, ".codex", "auth.json"), codexAuth("user-hopper", "team"));
  put(path.join(m.peer, ".codex", "auth.json"), codexAuth("user-dijkstra", "team"));
  saveMachine({ peer: { name: peerName, home: m.peer, nativeHome: m.peer } });
  const tied = startAnswer(NOW, { up: () => true });
  assert.deepEqual(tied.profiles.filter((p) => p.provider === "chatgpt").map((p) => p.name), ["hopper", "dijkstra", "knuth"]);
  assert.deepEqual(tied.current.chatgpt, { profile: "hopper", state: "asleep" });

  put(path.join(m.home, "state", "usage", "dijkstra.json"), JSON.stringify({ version: 1, provider: "chatgpt", fetchedAtMs: NOW.getTime() - 60_000, user: "user-dijkstra", plan: "team", windows: [{ kind: "session", pct: 100, resetsAt: Date.parse("2026-11-16T14:00:00Z") }] }));
  assert.deepEqual(startAnswer(NOW, { up: () => true }).current.chatgpt, { profile: "dijkstra", state: "limit" });
});

test("the live usage's plan wins over the login's", (t) => {
  const m = machine(t);
  m.codex("hopper", "#7B61A8", "user-hopper", "team");
  put(path.join(m.home, "state", "usage", "hopper.json"), JSON.stringify({ version: 1, provider: "chatgpt", fetchedAtMs: NOW.getTime() - 60_000, user: "user-hopper", plan: "pro", windows: [{ kind: "session", pct: 30, resetsAt: "2026-11-16T14:00:00Z" }], askedAtMs: NOW.getTime() - 60_000 }));
  const hopper = startAnswer(NOW).profiles.find((p) => p.name === "hopper")!;
  assert.equal(hopper.plan, "pro");
  assert.equal(hopper.state, "ok");
});

test("a Codex profile in a slot on each side, and the peer's state", (t) => {
  const m = machine(t);
  m.claude("turing", "#D77655", "uuid-t", "team", true);
  m.codex("hopper", "#7B61A8", "user-hopper", "team");
  m.codex("dijkstra", "#B8862B", "user-dijkstra", "team");
  put(path.join(m.home, ".codex", "auth.json"), codexAuth("user-hopper", "team"));
  put(path.join(m.peer, ".codex", "auth.json"), codexAuth("user-dijkstra", "team"));
  saveMachine({ peer: { name: peerName, home: m.peer, nativeHome: m.peer } });
  const up = startAnswer(NOW, { up: () => true });
  assert.deepEqual(up.slots.chatgpt, { [sideName()]: "hopper", [peerName]: "dijkstra" });
  assert.deepEqual(up.sides, [sideName(), peerName]);
  assert.deepEqual(up.peer, { name: peerName, up: true });
  assert.equal(up.current.chatgpt!.profile, "hopper");
  const down = startAnswer(NOW, { up: () => false });
  assert.deepEqual(down.slots.chatgpt, { [sideName()]: "hopper" });
  assert.deepEqual(down.peer, { name: peerName, up: false });
});

test("nothing in the answer carries a token or the ChatGPT user id", (t) => {
  const m = machine(t);
  m.claude("turing", "#D77655", "uuid-t", "team", true);
  m.codex("hopper", "#7B61A8", "user-hopper", "team");
  put(path.join(m.home, ".codex", "auth.json"), codexAuth("user-hopper", "team"));
  put(path.join(m.home, "state", "usage", "hopper.json"), JSON.stringify({ version: 1, provider: "chatgpt", fetchedAtMs: NOW.getTime() - 60_000, user: "user-hopper", plan: "team", windows: [{ kind: "session", pct: 30, resetsAt: "2026-11-16T14:00:00Z" }], askedAtMs: NOW.getTime() - 60_000 }));
  const text = JSON.stringify(startAnswer(NOW));
  for (const leak of [secret("turing"), secret("user-hopper"), "user-hopper", "uuid-t", "@example.com", "grant-"]) assert.equal(text.includes(leak), false, leak);
});
