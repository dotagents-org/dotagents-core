// The live usage of the Codex profiles (ADR 0007, phase 4): asked of `codex app-server` over
// JSON-RPC, never of chatgpt.com. The app-server is a fake script (test/fixtures), the logins fake.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { codexLoginMark } from "../core/accounts/providers/codex-store.ts";
import { CODEX_OTHER_EVERY_MS, CODEX_SLOT_EVERY_MS, type SpawnAppServer } from "../core/accounts/providers/codex-usage.ts";
import { fetchUsage, refreshUsage } from "../core/accounts/usage-refresh.ts";
import { loadProfiles, saveProfile } from "../core/machine-state.ts";
import { readCodexUsage as codexUsage } from "../core/accounts/providers/codex-usage.ts";
import { state } from "../core/state.ts";
import { type PeerSwitch, switchProfile } from "../core/accounts/switch.ts";
import { type ProfileUsage, usageLines } from "../core/accounts/usage.ts";
import { pathToFileURL } from "node:url";
import { withLoginLock } from "../core/accounts/vault.ts";
import { stopAppServer } from "../core/accounts/providers/codex-usage.ts";
import { REPO, quiet } from "./helpers.ts";

const FAKE = path.join(REPO, "test", "fixtures", "fake-app-server.mjs");
const NOW = Date.parse("2026-11-16T12:00:00Z");

// hopper is in the slot (~/.codex); dijkstra's login is only in its vault.
async function machine(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-codex-usage-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DOTAGENTS_STATE_DIR: process.env.DOTAGENTS_STATE_DIR, CODEX_HOME: process.env.CODEX_HOME, PATH: process.env.PATH };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, DOTAGENTS_STATE_DIR: path.join(home, "state") });
  delete process.env.CODEX_HOME;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    state.dryRun = false;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const events = quiet();
  saveProfile({ name: "hopper", configDir: path.join(home, ".codex"), color: "#7B61A8", provider: "codex" });
  saveProfile({ name: "dijkstra", configDir: path.join(home, ".codex"), color: "#B8862B", provider: "codex" });
  const noPeer: PeerSwitch = () => ({ ok: true, detail: "" });
  const codex = { daemon: () => null };
  const slot = path.join(home, ".codex", "auth.json");
  fs.mkdirSync(path.dirname(slot), { recursive: true });
  fs.writeFileSync(slot, auth("user-dijkstra", "dijkstra1"));
  await switchProfile({ save: "dijkstra", peer: noPeer, codex });
  fs.writeFileSync(slot, auth("user-hopper", "hopper1"));
  await switchProfile({ save: "hopper", peer: noPeer, codex });
  return { home, events, log: path.join(home, "fake.log"), slot, vault: (name: string) => path.join(home, "state", "vault", name, "auth.json") };
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (user: string) => `${b64({ alg: "none" })}.${b64({ email: `${user}@example.com`, "https://api.openai.com/auth": { chatgpt_user_id: user, chatgpt_account_id: "workspace-1", chatgpt_plan_type: "team" } })}.sig`;
// Long tokens, so a leak is told from the text around it.
const token = (name: string) => `${name}-${"a1b2c3d4".repeat(6)}`;
function auth(user: string, name: string) {
  return `${JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null, last_refresh: "2026-11-15T10:00:00Z", tokens: { id_token: idToken(user), access_token: `at-${token(name)}`, refresh_token: `rt-${token(name)}`, account_id: "workspace-1", login_owner_id: `grant-${user}` } }, null, 2)}\n`;
}

// The fake app-server in a given mode; every start and request goes to the log.
const fake =
  (log: string, mode: string): SpawnAppServer =>
  (home) =>
    spawn(process.execPath, [FAKE], { env: { ...process.env, CODEX_HOME: home, FAKE_MODE: mode, FAKE_LOG: log, FAKE_NOW_S: String(NOW / 1000), FAKE_OTHER_ID_TOKEN: idToken("user-someone-else") }, stdio: ["pipe", "pipe", "pipe"] });

const entries = (log: string): Record<string, any>[] => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const profile = (name: string) => loadProfiles().find((p) => p.name === name)!;
const record = (home: string, name: string) => JSON.parse(fs.readFileSync(path.join(home, "state", "usage", `${name}.json`), "utf8"));
const read = (name: string, now = NOW) => codexUsage(new Date(now)).find((p) => p.name === name)!;

test("a good answer from a profile outside the slot: asked in a temporary folder, windows by length", async (t) => {
  const m = await machine(t);
  const before = fs.readFileSync(m.vault("dijkstra"), "utf8");
  const slotBefore = fs.readFileSync(m.slot, "utf8");
  const res = await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, "good"), now: () => NOW });
  assert.equal(res.status, "updated");
  const log = entries(m.log);
  const start = log.find((e) => e.start)!;
  assert.notEqual(start.home, path.join(m.home, ".codex"), "never the real slot's folder");
  assert.ok(start.config, "the copy has a config.toml");
  assert.equal(fs.existsSync(start.home), false, "the temporary folder is gone");
  assert.deepEqual(log.filter((e) => e.method).map((e) => e.method), ["initialize", "initialized", "account/rateLimits/read"]);
  assert.equal(log.find((e) => e.method === "initialize")!.params.clientInfo.name, "dotagents");
  assert.equal(fs.readFileSync(m.vault("dijkstra"), "utf8"), before, "an unchanged copy is not written back");
  assert.equal(fs.readFileSync(m.slot, "utf8"), slotBefore, "the slot is not touched");
  const p = read("dijkstra");
  assert.deepEqual([p.state, p.source, p.plan, p.provider], ["ok", "live", "team", "codex"]);
  assert.deepEqual(p.windows.map((w) => [w.kind, w.pct, w.reset]), [["session", 42, false], ["week", 17, false]]);
  assert.equal(p.windows[0].resetsAt?.getTime(), NOW + 3_600_000);
});

test("the profile in the slot is asked in the real CODEX_HOME", async (t) => {
  const m = await machine(t);
  const res = await fetchUsage(profile("hopper"), { spawnIt: fake(m.log, "good"), now: () => NOW });
  assert.equal(res.status, "updated");
  assert.equal(entries(m.log).find((e) => e.start)!.home, path.join(m.home, ".codex"));
  assert.equal(read("hopper").windows.length, 2);
});

test("the older rateLimits field and windows in any order are read the same", async (t) => {
  const m = await machine(t);
  await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, "swapped"), now: () => NOW });
  assert.deepEqual(read("dijkstra").windows.map((w) => [w.kind, w.pct]), [["session", 42], ["week", 17]]);
  await fetchUsage(profile("hopper"), { spawnIt: fake(m.log, "legacy"), now: () => NOW });
  assert.deepEqual(read("hopper").windows.map((w) => [w.kind, w.pct]), [["session", 42], ["week", 17]]);
});

test("a window that passed its reset reads as 0%, and old numbers are stale", async (t) => {
  const m = await machine(t);
  await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, "good"), now: () => NOW });
  const later = NOW + 2 * 3_600_000;
  assert.deepEqual(read("dijkstra", later).windows.map((w) => [w.kind, w.pct, w.reset]), [["session", 0, true], ["week", 17, false]]);
  assert.equal(read("dijkstra", NOW + 7 * 3_600_000).state, "stale");
});

test("an unknown shape is refused with a reason, and no number is made up", async (t) => {
  const m = await machine(t);
  for (const mode of ["unknown", "empty"]) {
    const res = await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, mode), now: () => NOW, force: true });
    assert.equal(res.status, "failed");
    assert.match(res.detail, /not a usage this dotagents reads/);
    fs.rmSync(path.join(m.home, "state", "usage"), { recursive: true });
  }
  await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, "unknown"), now: () => NOW });
  const p = read("dijkstra");
  assert.deepEqual([p.state, p.windows.length], ["no-data", 0]);
  assert.match(p.error ?? "", /60 minutes long/);
});

test("a Codex without account/rateLimits/read says to update it", async (t) => {
  const m = await machine(t);
  const res = await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, "missing"), now: () => NOW });
  assert.equal(res.status, "failed");
  assert.match(res.detail, /update Codex/);
  assert.equal("refused" in record(m.home, "dijkstra"), false);
});

test("a failure after Codex renewed the copy still writes the renewed login to the vault", async (t) => {
  const m = await machine(t);
  const old = fs.readFileSync(m.vault("dijkstra"), "utf8");
  const res = await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, "renewed"), now: () => NOW });
  assert.equal(res.status, "failed");
  const kept = fs.readFileSync(m.vault("dijkstra"), "utf8");
  assert.notEqual(kept, old);
  assert.equal(JSON.parse(kept).tokens.refresh_token, `${JSON.parse(old).tokens.refresh_token}-renewed`);
  assert.equal(record(m.home, "dijkstra").refused, codexLoginMark(kept), "the refused login is the one the vault keeps now");
  assert.equal(fs.existsSync(entries(m.log).find((e) => e.start)!.home), false);
});

test("a copy that turned into another person's login is not written back", async (t) => {
  const m = await machine(t);
  const old = fs.readFileSync(m.vault("dijkstra"), "utf8");
  await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, "swapuser"), now: () => NOW });
  assert.equal(fs.readFileSync(m.vault("dijkstra"), "utf8"), old);
});

test("a login OpenAI refuses is recorded with its mark, and the profile says to sign in again", async (t) => {
  const m = await machine(t);
  const vault = fs.readFileSync(m.vault("dijkstra"), "utf8");
  const res = await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, "refused"), now: () => NOW });
  assert.equal(res.status, "failed");
  assert.match(res.detail, /OpenAI refused the login/);
  assert.equal(record(m.home, "dijkstra").refused, codexLoginMark(vault));
  const slot = await fetchUsage(profile("hopper"), { spawnIt: fake(m.log, "refused"), now: () => NOW });
  assert.equal(slot.status, "failed");
  assert.equal(record(m.home, "hopper").refused, codexLoginMark(fs.readFileSync(m.slot, "utf8")), "for the slot's profile, the slot's login");
  assert.match(read("dijkstra").error ?? "", /sign in again with: dotagents login dijkstra/);
  // A good answer clears it.
  await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, "good"), now: () => NOW + 3_600_000, force: true });
  const r = record(m.home, "dijkstra");
  assert.deepEqual([r.refused, r.error, r.failures], [undefined, undefined, undefined]);
});

test("no token reaches the output, the record or the logs", async (t) => {
  const m = await machine(t);
  const secrets = ["hopper", "dijkstra"].flatMap((n) => [token(n)]);
  await refreshUsage({ spawnIt: fake(m.log, "leak"), now: () => NOW, fetcher: async () => ({ status: 500, headers: { get: () => null }, text: "" }) });
  const everything = [JSON.stringify(m.events), ...["hopper", "dijkstra"].map((n) => fs.readFileSync(path.join(m.home, "state", "usage", `${n}.json`), "utf8")), JSON.stringify(codexUsage(new Date(NOW)))];
  for (const text of everything) for (const secret of secrets) assert.ok(!text.includes(secret), "a token leaked");
  assert.match(everything[1], /\[redacted\]/);
  const logs = path.join(m.home, "state", "logs");
  for (const f of fs.existsSync(logs) ? fs.readdirSync(logs) : []) for (const secret of secrets) assert.ok(!fs.readFileSync(path.join(logs, f), "utf8").includes(secret));
});

test("the slot's profile is asked every 5 minutes, the others every 30, usage --refresh at once, and an error backs off", async (t) => {
  const m = await machine(t);
  let now = NOW;
  const ask = (name: string, mode: string, force = false) => fetchUsage(profile(name), { spawnIt: fake(m.log, mode), now: () => now, force });
  const asked = () => entries(m.log).filter((e) => e.start).length;
  await ask("hopper", "good");
  await ask("dijkstra", "good");
  assert.equal(asked(), 2);
  now += CODEX_SLOT_EVERY_MS - 1000;
  assert.equal((await ask("hopper", "good")).status, "ok");
  assert.equal((await ask("dijkstra", "good")).status, "ok");
  assert.equal(asked(), 2);
  now += 2000;
  assert.equal((await ask("hopper", "good")).status, "updated", "the slot's, after 5 minutes");
  assert.equal((await ask("dijkstra", "good")).status, "ok", "the other one waits for its 30");
  assert.equal(asked(), 3);
  assert.equal((await ask("dijkstra", "good", true)).status, "updated", "--refresh asks now");
  now += CODEX_OTHER_EVERY_MS;
  assert.equal((await ask("dijkstra", "unknown")).status, "failed");
  assert.equal((await ask("dijkstra", "good", true)).status, "ok", "force skips the wait, not the backoff");
  now += 61_000;
  assert.equal((await ask("dijkstra", "good", true)).status, "updated");
  assert.equal(record(m.home, "dijkstra").failures, undefined);
});

test("a call that hangs is killed after the timeout", async (t) => {
  const m = await machine(t);
  const res = await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, "hang"), now: () => NOW, timeoutMs: 300 });
  assert.equal(res.status, "failed");
  assert.match(res.detail, /timed out/);
  const { pid } = entries(m.log).find((e) => e.start)!;
  assert.throws(() => process.kill(pid, 0), "the process is gone");
});

test("a missing codex command is a clear failure", async (t) => {
  const m = await machine(t);
  const res = await fetchUsage(profile("dijkstra"), { spawnIt: () => spawn("dotagents-no-such-codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] }), now: () => NOW });
  assert.equal(res.status, "failed");
  assert.match(res.detail, /couldn't run codex/);
});

test("a profile with no saved login is not asked, and a dry run asks nothing", async (t) => {
  const m = await machine(t);
  saveProfile({ name: "knuth", configDir: path.join(m.home, ".codex"), color: "#2E7D6B", provider: "codex" });
  assert.deepEqual(await fetchUsage(profile("knuth"), { spawnIt: fake(m.log, "good"), now: () => NOW }), { status: "failed", detail: "no login saved for it" });
  state.dryRun = true;
  assert.equal((await fetchUsage(profile("dijkstra"), { spawnIt: fake(m.log, "good"), now: () => NOW })).status, "ok");
  assert.equal(entries(m.log).length, 0);
});

test("the usage view groups the profiles by provider", () => {
  const w = { kind: "session" as const, pct: 10, resetsAt: new Date(NOW + 3_600_000), reset: false };
  const base = { color: "#000000", state: "ok" as const, fetchedAt: new Date(NOW), windows: [w], source: "live" as const };
  const list: ProfileUsage[] = [{ ...base, name: "work", provider: "claude" }, { ...base, name: "hopper", provider: "codex" }];
  const text = usageLines(list, new Date(NOW)).map((l) => l.map((s) => s.text).join(""));
  assert.deepEqual(text.filter((l) => l === "Claude" || l === "ChatGPT"), ["Claude", "ChatGPT"]);
  assert.equal(usageLines([list[0]], new Date(NOW)).some((l) => l.map((s) => s.text).join("") === "Claude"), false, "one provider: no header");
});

test("usage --refresh --json in a temporary home carries the Codex windows from the fake server", async (t) => {
  if (process.platform === "win32") return t.skip("a shell script stands in for codex");
  const m = await machine(t);
  const bin = path.join(m.home, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "codex"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_MODE: "good", FAKE_LOG: m.log, FAKE_NOW_S: String(Math.floor(Date.now() / 1000)) };
  const run = spawnSync(process.execPath, [path.join(REPO, "cli.ts"), "usage", "--refresh", "--json"], { env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const json = JSON.parse(run.stdout);
  const codex = json.profiles.filter((p: { provider?: string }) => p.provider === "codex");
  assert.deepEqual(codex.map((p: { name: string }) => p.name), ["hopper", "dijkstra"]);
  for (const p of codex) {
    assert.equal(p.plan, "team");
    assert.deepEqual(p.windows.map((w: { kind: string; pct: number }) => [w.kind, w.pct]), [["session", 42], ["week", 17]]);
  }
  assert.ok(!run.stdout.includes(token("hopper")) && !run.stderr.includes(token("dijkstra")));
});

test("a usage query waiting for the lock uses the renewed vault login", async (t) => {
  const m = await machine(t);
  const fresh = auth("user-dijkstra", "dijkstra-renewed");
  let seen = "";
  let pending: ReturnType<typeof fetchUsage>;
  await withLoginLock(async () => {
    pending = fetchUsage(profile("dijkstra"), {
      now: () => NOW,
      spawnIt: (home) => {
        seen = fs.readFileSync(path.join(home, "auth.json"), "utf8");
        return fake(m.log, "good")(home);
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    fs.writeFileSync(m.vault("dijkstra"), fresh);
  });
  assert.equal((await pending!).status, "updated");
  assert.equal(seen, fresh, "a refresh token read before waiting may already be spent");
});

test("a usage query rechecks the slot after a switch while waiting for the lock", async (t) => {
  const m = await machine(t);
  let pending: ReturnType<typeof fetchUsage>;
  await withLoginLock(async () => {
    pending = fetchUsage(profile("hopper"), { spawnIt: fake(m.log, "good"), now: () => NOW });
    await new Promise((resolve) => setTimeout(resolve, 25));
    fs.writeFileSync(m.slot, fs.readFileSync(m.vault("dijkstra")));
  });
  assert.equal((await pending!).status, "updated");
  assert.notEqual(entries(m.log).find((e) => e.start)!.home, path.dirname(m.slot));
  assert.equal(record(m.home, "hopper").user, "user-hopper");
});

test("concurrent usage queries recheck the interval under the lock", async (t) => {
  const m = await machine(t);
  const options = { spawnIt: fake(m.log, "good"), now: () => NOW };
  const results = await Promise.all([fetchUsage(profile("dijkstra"), options), fetchUsage(profile("dijkstra"), options)]);
  assert.deepEqual(results.map((r) => r.status), ["updated", "ok"]);
  assert.equal(entries(m.log).filter((e) => e.start).length, 1);
});

test("a login lock timeout is a failed refresh without changing the holder's record or rejecting the refresh tick", async (t) => {
  const m = await machine(t);
  const recordFile = path.join(m.home, "state", "usage", "dijkstra.json");
  fs.mkdirSync(path.dirname(recordFile), { recursive: true });
  const kept = JSON.stringify({ version: 1, user: "user-dijkstra", fetchedAtMs: NOW, askedAtMs: NOW });
  fs.writeFileSync(recordFile, kept);
  const lock = path.join(m.home, "state", "logins.lock");
  fs.writeFileSync(lock, "another-process\n");
  const lockTime = fs.statSync(lock).mtimeMs;
  let clockReads = 0;
  // Each lock attempt reads its deadline, lock age, then deadline again: advance past its
  // 30-second wait while keeping the holder younger than the 60-second stale threshold.
  t.mock.method(Date, "now", () => lockTime + (clockReads++ % 3 === 0 ? 0 : 31_000));
  const options = { spawnIt: fake(m.log, "good"), now: () => NOW, force: true };
  const result = await fetchUsage(profile("dijkstra"), options);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /Another dotagents is changing a login/);
  assert.equal(fs.readFileSync(recordFile, "utf8"), kept);
  const events = quiet();
  // start's tick awaits this refresh: a busy login must produce failed results, not a rejection.
  await assert.doesNotReject(refreshUsage(options));
  const failures = events.filter((e) => e.kind === "result" && e.status === "failed" && /Another dotagents/.test(e.detail));
  assert.equal(failures.length, 2, "both ChatGPT profiles report the busy lock");
  assert.equal(fs.readFileSync(recordFile, "utf8"), kept);
  assert.equal(fs.readFileSync(lock, "utf8"), "another-process\n");
  assert.equal(entries(m.log).length, 0, "no app-server starts without the lock");
});

test("a server that ignores SIGTERM is gone before its renewed login is kept and home removed", async (t) => {
  if (process.platform === "win32") return t.skip("SIGTERM handlers are a POSIX process behavior");
  const m = await machine(t);
  let child: ReturnType<SpawnAppServer>;
  const spawnIt: SpawnAppServer = (home) => {
    const script = `
      const fs = await import("node:fs");
      process.on("SIGTERM", () => {
        const file = process.env.CODEX_HOME + "/auth.json";
        const login = JSON.parse(fs.readFileSync(file, "utf8"));
        login.tokens.refresh_token += "-renewed";
        fs.writeFileSync(file, JSON.stringify(login));
      });
      await import(${JSON.stringify(pathToFileURL(FAKE).href)});
    `;
    child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, CODEX_HOME: home, FAKE_MODE: "good", FAKE_LOG: m.log, FAKE_NOW_S: String(NOW / 1000) }, stdio: ["pipe", "pipe", "pipe"] });
    t.after(() => child.kill("SIGKILL"));
    return child;
  };
  const old = JSON.parse(fs.readFileSync(m.vault("dijkstra"), "utf8"));
  assert.equal((await fetchUsage(profile("dijkstra"), { spawnIt, now: () => NOW })).status, "updated");
  assert.throws(() => process.kill(child!.pid!, 0), "the process must exit before cleanup");
  assert.equal(JSON.parse(fs.readFileSync(m.vault("dijkstra"), "utf8")).tokens.refresh_token, old.tokens.refresh_token + "-renewed");
  assert.equal(fs.existsSync(entries(m.log).find((e) => e.start)!.home), false);
});

test("a server can fill stderr without blocking its JSON-RPC answer", async (t) => {
  const m = await machine(t);
  const spawnIt: SpawnAppServer = (home) => {
    const script = `process.stderr.write("x".repeat(1024 * 1024), async () => { await import(${JSON.stringify(pathToFileURL(FAKE).href)}); });`;
    return spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, CODEX_HOME: home, FAKE_MODE: "good", FAKE_LOG: m.log, FAKE_NOW_S: String(NOW / 1000) }, stdio: ["pipe", "pipe", "pipe"] });
  };
  const result = await fetchUsage(profile("dijkstra"), { spawnIt, now: () => NOW, timeoutMs: 2000 });
  assert.equal(result.status, "updated", result.detail);
});

test("external errors and malformed windows cannot put an email address or a token in the public usage record", async (t) => {
  const m = await machine(t);
  const email = "private.person@example.com";
  const secret = token("private");
  const responses = [
    { error: { code: -32600, message: `401 Unauthorized for ${email} token ${secret}` } },
    { result: { rateLimits: { primary: { usedPercent: 10, windowDurationMins: `${email} ${secret}` } } } },
  ];
  for (const response of responses) {
    const spawnIt: SpawnAppServer = (home) => {
      const script = `
        const readline = await import("node:readline");
        readline.createInterface({ input: process.stdin }).on("line", (line) => {
          const m = JSON.parse(line);
          if (m.id) process.stdout.write(JSON.stringify({ id: m.id, ...(m.id === 1 ? { result: {} } : ${JSON.stringify(response)}) }) + "\\n");
        });
      `;
      return spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, CODEX_HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
    };
    const result = await fetchUsage(profile("dijkstra"), { spawnIt, now: () => NOW });
    assert.equal(result.status, "failed");
    assert.match(result.detail, "error" in response ? /OpenAI refused/ : /not a usage/);
    const publicText = JSON.stringify([result, read("dijkstra"), record(m.home, "dijkstra")]);
    assert.ok(!publicText.includes(email));
    assert.ok(!publicText.includes(secret));
    assert.match(publicText, /\[redacted\]/);
    fs.rmSync(path.join(m.home, "state", "usage"), { recursive: true });
  }
});


test("Windows usage termination stops the shell and its child tree with a validated PID", () => {
  const calls: unknown[][] = [];
  const child = { pid: 12345, kill: () => { assert.fail("killing only the Windows shell would leave the app-server alive"); } };
  const run = ((...args: unknown[]) => { calls.push(args); return { status: 0 }; }) as typeof spawnSync;
  assert.equal(stopAppServer(child, "SIGTERM", "win32", run), true);
  assert.deepEqual(calls, [["taskkill", ["/PID", "12345", "/T", "/F"], { shell: false, stdio: "ignore", windowsHide: true, timeout: 5_000 }]]);
  for (const pid of [undefined, 0, -1, NaN, 12.5]) assert.equal(stopAppServer({ ...child, pid }, "SIGKILL", "win32", run), false);
  assert.equal(calls.length, 1, "invalid PIDs never reach taskkill");
});

test("a slot changed externally during usage cannot assign another account's numbers or refusal to the old profile", async (t) => {
  const m = await machine(t);
  const previous = { version: 1, provider: "codex", user: "user-hopper", fetchedAtMs: NOW - CODEX_SLOT_EVERY_MS, askedAtMs: NOW - CODEX_SLOT_EVERY_MS, windows: [{ kind: "session", pct: 9, resetsAt: NOW + 3_600_000 }] };
  const file = path.join(m.home, "state", "usage", "hopper.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const mode of ["good", "refused"]) {
    fs.writeFileSync(file, JSON.stringify(previous));
    fs.writeFileSync(m.slot, fs.readFileSync(m.vault("hopper")));
    const spawnIt: SpawnAppServer = (home) => {
      fs.writeFileSync(m.slot, fs.readFileSync(m.vault("dijkstra")));
      return fake(m.log, mode)(home);
    };
    const result = await fetchUsage(profile("hopper"), { spawnIt, now: () => NOW });
    assert.equal(result.status, "failed");
    assert.match(result.detail, /slot changed accounts/);
    const kept = record(m.home, "hopper");
    assert.equal(kept.user, "user-hopper");
    assert.equal(kept.fetchedAtMs, previous.fetchedAtMs);
    assert.deepEqual(kept.windows, previous.windows);
    assert.equal(kept.refused, undefined, "the other account's refresh-token mark does not belong here");
    assert.equal(kept.error, undefined, "the other account's error does not belong here");
  }
});

test("Windows closes an app-server tree before removing its temporary login", async (t) => {
  if (process.platform !== "win32") return t.skip("requires Windows taskkill and inherited pipe behavior");
  const m = await machine(t);
  let wrapper: ReturnType<SpawnAppServer>;
  const spawnIt: SpawnAppServer = (home) => {
    const script = `const { spawn } = await import("node:child_process"); spawn(process.execPath, [${JSON.stringify(FAKE)}], { stdio: "inherit" });`;
    wrapper = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, CODEX_HOME: home, FAKE_MODE: "good", FAKE_LOG: m.log, FAKE_NOW_S: String(NOW / 1000) }, stdio: ["pipe", "pipe", "pipe"] });
    t.after(() => stopAppServer(wrapper));
    return wrapper;
  };
  assert.equal((await fetchUsage(profile("dijkstra"), { spawnIt, now: () => NOW })).status, "updated");
  const start = entries(m.log).find((e) => e.start)!;
  assert.throws(() => process.kill(wrapper!.pid!, 0), "the shell's equivalent process is gone");
  assert.throws(() => process.kill(start.pid, 0), "the nested app-server is gone too");
  assert.equal(fs.existsSync(start.home), false);
});
