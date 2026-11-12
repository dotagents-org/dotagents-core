// Live usage (ADR 0008): each profile's usage asked of Anthropic with the login Claude Code keeps,
// renewed only when it is about to expire and written back to the copy it came from. The network
// is a fake here, and the credentials too.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { type Fetcher, LIVE_EVERY_MS, fetchLive, readRecord, refreshUsage } from "../core/live.ts";
import { loadProfiles, saveProfile } from "../core/machine-state.ts";
import { readUsage } from "../core/snapshot.ts";
import { state } from "../core/state.ts";
import { loginMark, withLoginLock } from "../core/switch.ts";
import { quiet } from "./helpers.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const HOUR = 3_600_000;

const creds = (token: string, expiresAt: number) =>
  JSON.stringify({ claudeAiOauth: { accessToken: `at-${token}`, refreshToken: `rt-${token}`, expiresAt, scopes: ["user:inference"], subscriptionType: "team" } });
const account = (uuid: string) => ({ accountUuid: uuid, emailAddress: `${uuid}@example.com` });

// work is in the slot (~/.claude); personal's login is in its vault.
function machine(t: TestContext, { work = HOUR, personal = HOUR } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-live-"));
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
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), creds("work1", NOW + work));
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ numStartups: 3, oauthAccount: account("uuid-work") }));
  const vault = path.join(home, "state", "vault", "personal");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "credentials.json"), creds("personal1", NOW + personal));
  fs.writeFileSync(path.join(vault, "account.json"), JSON.stringify(account("uuid-personal")));
  return home;
}

const profile = (name: string) => loadProfiles().find((p) => p.name === name)!;
const slotCreds = (home: string) => JSON.parse(fs.readFileSync(path.join(home, ".claude", ".credentials.json"), "utf8")).claudeAiOauth;
const vaultCreds = (home: string) => JSON.parse(fs.readFileSync(path.join(home, "state", "vault", "personal", "credentials.json"), "utf8")).claudeAiOauth;

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

// Anthropic, faked: the usage answers each access token with its own percentage; the token
// endpoint rotates the refresh token. A status given for a URL answers that instead.
function anthropic(answers: { usage?: number; token?: number; retryAfter?: string } = {}) {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, ...init });
    const headers = { get: (name: string) => (name === "retry-after" ? (answers.retryAfter ?? null) : null) };
    if (url.endsWith("/v1/oauth/token")) {
      if (answers.token) return { status: answers.token, headers, text: JSON.stringify({ error: "invalid_grant", error_description: "Refresh token expired" }) };
      const old = JSON.parse(init.body!).refresh_token as string;
      return { status: 200, headers, text: JSON.stringify({ access_token: `${old.replace("rt-", "at-")}-new`, refresh_token: `${old}-new`, expires_in: 28_800 }) };
    }
    if (answers.usage) return { status: answers.usage, headers, text: JSON.stringify({ error: { message: "Rate limited" } }) };
    const token = init.headers.authorization.replace("Bearer ", "");
    const pct = token.startsWith("at-work") ? 40 : 65;
    return { status: 200, headers, text: JSON.stringify({ five_hour: { utilization: pct, resets_at: "2026-10-30T14:00:00Z" }, seven_day: { utilization: 12, resets_at: "2026-11-03T00:00:00Z" } }) };
  };
  return { calls, fetcher };
}

const clock = (at: number) => () => at;

test("each profile is asked with the login it lives in: the slot's, or its vault's; the token never reaches the record", async (t) => {
  const home = machine(t);
  const { calls, fetcher } = anthropic();
  quiet();
  await refreshUsage({ fetcher, now: clock(NOW) });
  const usage = calls.filter((c) => c.url.includes("/api/oauth/usage"));
  assert.deepEqual(usage.map((c) => c.headers.authorization).sort(), ["Bearer at-personal1", "Bearer at-work1"]);
  assert.ok(usage.every((c) => c.headers["anthropic-beta"] === "oauth-2025-04-20" && /^claude-cli\/\S+ \(external, cli\)$/.test(c.headers["user-agent"])));
  assert.ok(!calls.some((c) => c.url.includes("/oauth/token")), "tokens an hour from expiry aren't renewed");

  const list = readUsage(new Date(NOW + 60_000));
  assert.deepEqual(list.map((p) => [p.name, p.state, p.source, p.windows[0]?.pct]), [["work", "ok", "live", 40], ["personal", "ok", "live", 65]]);
  const records = fs.readdirSync(path.join(home, "state", "usage")).map((f) => fs.readFileSync(path.join(home, "state", "usage", f), "utf8")).join("");
  assert.ok(!/at-|rt-/.test(records), "no token in the records");
});

test("a profile is asked at most once a minute, by any number of runs", async (t) => {
  machine(t);
  const { calls, fetcher } = anthropic();
  await fetchLive(profile("personal"), { fetcher, now: clock(NOW) });
  const again = await fetchLive(profile("personal"), { fetcher, now: clock(NOW + 30_000) });
  assert.equal(again.status, "ok");
  assert.equal(calls.length, 1);
  await fetchLive(profile("personal"), { fetcher, now: clock(NOW + LIVE_EVERY_MS) });
  assert.equal(calls.length, 2);
});

test("the vault's copy is renewed a few minutes early, and the rotated token replaces it in place", async (t) => {
  const home = machine(t, { personal: 2 * 60_000 });
  const { calls, fetcher } = anthropic();
  const res = await fetchLive(profile("personal"), { fetcher, now: clock(NOW) });
  assert.equal(res.status, "updated");
  const renewal = calls.find((c) => c.url.includes("/oauth/token"))!;
  assert.deepEqual(JSON.parse(renewal.body!), { grant_type: "refresh_token", client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e", refresh_token: "rt-personal1" });
  const saved = vaultCreds(home);
  assert.equal(saved.refreshToken, "rt-personal1-new");
  assert.equal(saved.accessToken, "at-personal1-new");
  assert.equal(saved.expiresAt, NOW + 28_800_000);
  assert.equal(saved.subscriptionType, "team", "the rest of the credentials stays");
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(home, "state", "vault", "personal", "credentials.json")).mode & 0o777, 0o600);
  assert.equal(calls.at(-1)!.headers.authorization, "Bearer at-personal1-new");
  assert.equal(slotCreds(home).refreshToken, "rt-work1", "the slot is untouched");
});

test("the slot's copy, which Claude Code renews itself, is renewed only once it has expired, and only in the slot", async (t) => {
  const home = machine(t, { work: 2 * 60_000 });
  // The vault holds the same token as the slot, as after a switch: a renewal must not spend it there.
  fs.mkdirSync(path.join(home, "state", "vault", "work"), { recursive: true });
  fs.copyFileSync(path.join(home, ".claude", ".credentials.json"), path.join(home, "state", "vault", "work", "credentials.json"));
  fs.writeFileSync(path.join(home, "state", "vault", "work", "account.json"), JSON.stringify(account("uuid-work")));
  const { calls, fetcher } = anthropic();
  await fetchLive(profile("work"), { fetcher, now: clock(NOW) });
  assert.ok(!calls.some((c) => c.url.includes("/oauth/token")), "two minutes left: Claude Code's turn");
  await fetchLive(profile("work"), { fetcher, now: clock(NOW + 3 * 60_000) });
  assert.ok(calls.some((c) => c.url.includes("/oauth/token")), "expired: renewed");
  assert.equal(slotCreds(home).refreshToken, "rt-work1-new");
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "state", "vault", "work", "credentials.json"), "utf8")).claudeAiOauth.refreshToken, "rt-work1", "the vault isn't the live copy");
});

test("a 429 backs off, as long as it asks, and keeps the numbers already there with the error next to them", async (t) => {
  machine(t);
  await fetchLive(profile("personal"), { fetcher: anthropic().fetcher, now: clock(NOW) });
  const limited = anthropic({ usage: 429, retryAfter: "300" });
  const res = await fetchLive(profile("personal"), { fetcher: limited.fetcher, now: clock(NOW + LIVE_EVERY_MS) });
  assert.equal(res.status, "failed");
  assert.match(res.detail, /429/);
  await fetchLive(profile("personal"), { fetcher: limited.fetcher, now: clock(NOW + LIVE_EVERY_MS + 120_000) });
  assert.equal(limited.calls.length, 1, "not again before the five minutes it asked for");
  const personal = readUsage(new Date(NOW + LIVE_EVERY_MS + 1000)).find((p) => p.name === "personal")!;
  assert.equal(personal.windows[0].pct, 65);
  assert.match(personal.error ?? "", /429/);
});

test("a renewal Anthropic refuses changes no credentials and says to sign in again", async (t) => {
  const home = machine(t, { personal: -HOUR });
  const before = fs.readFileSync(path.join(home, "state", "vault", "personal", "credentials.json"), "utf8");
  const { calls, fetcher } = anthropic({ token: 400 });
  const res = await fetchLive(profile("personal"), { fetcher, now: clock(NOW) });
  assert.equal(res.status, "failed");
  assert.match(res.detail, /Refresh token expired/);
  assert.ok(!calls.some((c) => c.url.includes("/api/oauth/usage")));
  assert.equal(fs.readFileSync(path.join(home, "state", "vault", "personal", "credentials.json"), "utf8"), before);
});

test("a dry run asks nothing and writes nothing", async (t) => {
  const home = machine(t, { personal: -HOUR });
  const { calls, fetcher } = anthropic();
  const events = quiet({ dryRun: true });
  await refreshUsage({ fetcher, now: clock(NOW) });
  assert.equal(calls.length, 0);
  assert.ok(!fs.existsSync(path.join(home, "state", "usage")));
  assert.ok(events.some((e) => e.kind === "result" && e.status === "would update" && e.target === "personal"));
});

test("the login lock waits for the run that holds it, and takes over one left by a process that died", async (t) => {
  const home = machine(t);
  const order: string[] = [];
  const first = withLoginLock(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    order.push("first");
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await withLoginLock(() => order.push("second"));
  await first;
  assert.deepEqual(order, ["first", "second"]);

  const lock = path.join(home, "state", "logins.lock");
  fs.writeFileSync(lock, "999999\n");
  const old = new Date(Date.now() - 5 * 60_000);
  fs.utimesSync(lock, old, old);
  assert.equal(await withLoginLock(() => "taken"), "taken");
  assert.ok(!fs.existsSync(lock));
});

test("a login Anthropic refuses is marked refused, and a good answer clears the mark; a network error doesn't mark it", async (t) => {
  machine(t, { personal: -HOUR });
  const offline: Fetcher = async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  };
  await fetchLive(profile("personal"), { fetcher: anthropic({ token: 400 }).fetcher, now: clock(NOW) });
  assert.equal(readRecord("personal").refused, loginMark(creds("personal1", NOW - HOUR)), "a refused renewal");
  await fetchLive(profile("work"), { fetcher: offline, now: clock(NOW) });
  assert.equal(readRecord("work").refused, undefined, "a network error marks nothing");
  await fetchLive(profile("work"), { fetcher: anthropic({ usage: 401 }).fetcher, now: clock(NOW + 10 * 60_000) });
  assert.equal(readRecord("work").refused, loginMark(creds("work1", NOW)), "a refused usage request");
  assert.ok(!JSON.stringify(readRecord("work")).includes("rt-"), "the mark isn't the token");
  await fetchLive(profile("work"), { fetcher: offline, now: clock(NOW + 30 * 60_000) });
  assert.ok(readRecord("work").refused, "a network error keeps the mark");
  await fetchLive(profile("work"), { fetcher: anthropic().fetcher, now: clock(NOW + 2 * HOUR) });
  assert.equal(readRecord("work").refused, undefined, "a good answer clears it");
});
