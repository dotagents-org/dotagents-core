// The Codex accounts (ADR 0017), switched in place like Claude's (ADR 0009). Each side has one slot,
// <CODEX_HOME>/auth.json (~/.codex by default), which the Codex command line, its VS Code extension
// and its desktop app all read. Every account's login waits in the vault, <state>/vault/<profile>/
// auth.json, one per account and side. The file is copied byte for byte and read only to tell
// whose login it is: never printed, never renewed here (the refresh token is single-use).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Profile, loadProfiles, providerOf } from "./machine-state.ts";
import { report, section } from "./output.ts";
import { state } from "./state.ts";
import { vaultDir, writePrivate } from "./switch.ts";

export const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export const slotFile = () => path.join(codexHome(), "auth.json");
export const vaultFile = (name: string) => path.join(vaultDir(name), "auth.json");

// A login: the file as Codex wrote it, and who it is. user: the person (chatgpt_user_id); the
// workspace's account_id is the same for every seat in it, so it can't tell two seats apart.
// grant: one completed sign-in (login_owner_id), which renewals keep. plan: the ChatGPT plan type
// ("team"). Read from the id_token, nothing else of it.
export type CodexLogin = { text: string; user: string; grant: string | null; refreshed: number | null; email: string; plan: string | null };

export function readLogin(file: string): CodexLogin | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const tokens = JSON.parse(text)?.tokens;
    const payload = JSON.parse(Buffer.from(String(tokens?.id_token).split(".")[1] ?? "", "base64url").toString("utf8"));
    const auth = payload?.["https://api.openai.com/auth"];
    const user = auth?.chatgpt_user_id;
    if (typeof user !== "string" || !user) return null;
    const refreshed = Date.parse(JSON.parse(text)?.last_refresh);
    return {
      text,
      user,
      grant: typeof tokens.login_owner_id === "string" ? tokens.login_owner_id : null,
      refreshed: Number.isNaN(refreshed) ? null : refreshed,
      email: typeof payload.email === "string" ? payload.email : "",
      plan: typeof auth.chatgpt_plan_type === "string" && auth.chatgpt_plan_type ? auth.chatgpt_plan_type : null,
    };
  } catch {
    return null;
  }
}

// The mark of a login's refresh token, as loginMark in core/switch.ts does for Claude's: tells a
// login apart without keeping any of it.
export function codexLoginMark(text: string): string | null {
  try {
    const token = JSON.parse(text)?.tokens?.refresh_token;
    return typeof token === "string" && token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : null;
  } catch {
    return null;
  }
}

export const codexProfiles = () => loadProfiles().filter((p) => providerOf(p) === "codex");
export const slotLogin = () => readLogin(slotFile());
export const vaultLogin = (name: string) => readLogin(vaultFile(name));
const ownerOf = (user: string) => codexProfiles().find((p) => vaultLogin(p.name)?.user === user) ?? null;

// The Codex profile whose account is in this side's slot, or null.
export function codexSlotProfile(): Profile | null {
  const slot = slotLogin();
  return slot ? ownerOf(slot.user) : null;
}

// The account of a profile's saved login, or null.
export function codexAccount(p: Profile) {
  const saved = vaultLogin(p.name);
  return saved ? { user: saved.user, email: saved.email, plan: saved.plan } : null;
}

function saveToVault(name: string, login: CodexLogin) {
  const known = vaultLogin(name);
  if (known?.text === login.text) return report("ok", vaultDir(name), `${name}'s login`);
  if (state.dryRun) return report("would update", vaultDir(name), `${name}'s login`);
  writePrivate(vaultFile(name), login.text);
  report(known ? "updated" : "created", vaultDir(name), `${name}'s login`);
}

// Puts a file in place under Codex's own commit lock, auth.json.lock, an exclusive flock it waits
// 5 s for (LockFileEx on Windows), so Codex never saves over a half-done switch. Never auth.lock,
// its long sign-in lock. Where neither tool is there (macOS has no flock command), a plain rename:
// the check after writing still catches a Codex that saved over it.
export type CommitUnderLock = (tmp: string, dest: string) => void;

export const commitUnderLock: CommitUnderLock = (tmp, dest) => {
  const lock = path.join(path.dirname(dest), "auth.json.lock");
  if (process.platform === "win32") {
    const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const script = [
      `$f = [IO.File]::Open(${quote(lock)}, 'OpenOrCreate', 'ReadWrite', 'ReadWrite')`,
      "$until = (Get-Date).AddSeconds(5)",
      "while ($true) { try { $f.Lock(0, [long]::MaxValue); break } catch { if ((Get-Date) -gt $until) { throw 'Codex holds its login lock' }; Start-Sleep -Milliseconds 100 } }",
      `try { Move-Item -LiteralPath ${quote(tmp)} -Destination ${quote(dest)} -Force } finally { $f.Unlock(0, [long]::MaxValue); $f.Close() }`,
    ].join("\n");
    const run = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    if (run.status !== 0) throw new Error(`Couldn't write ${dest}: ${(run.stderr || run.error?.message || `exit ${run.status}`).trim()}`);
    return;
  }
  const run = spawnSync("flock", ["-x", "-w", "5", lock, "mv", "-f", tmp, dest], { encoding: "utf8" });
  if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") return fs.renameSync(tmp, dest);
  if (run.status !== 0) throw new Error(`Couldn't write ${dest}: ${run.status === 1 && !run.stderr ? "Codex holds its login lock; try again" : (run.stderr || `exit ${run.status}`).trim()}`);
};

// Runs the codex command. On Windows it may be a .cmd shim, which only a shell runs, and Node
// warns about arguments passed apart to a shell: the command goes as one line (fixed arguments).
const runCodex = (args: string[], options: Parameters<typeof spawnSync>[2]) =>
  process.platform === "win32" ? spawnSync(`codex ${args.join(" ")}`, { ...options, shell: true }) : spawnSync("codex", args, options);

// A running Codex app-server keeps the old login in memory and doesn't see the file change (it
// compares the workspace's account_id, the same for every seat), and Codex 0.169 has no reload-auth:
// the daemon is restarted when it runs. Null when there is none, or no codex command.
export type RestartDaemon = () => string | null;

export const restartDaemon: RestartDaemon = () => {
  const codex = (args: string[]) => runCodex(args, { encoding: "utf8", timeout: 30_000, windowsHide: true });
  const version = codex(["app-server", "daemon", "version"]);
  let running = false;
  try {
    running = version.status === 0 && JSON.parse(String(version.stdout)).status === "running";
  } catch {
    // An older Codex without the daemon, or its output changed: nothing to restart.
  }
  if (!running) return null;
  const restart = codex(["app-server", "daemon", "restart"]);
  return restart.status === 0 ? "restarted" : `couldn't restart it (exit ${restart.status}); run: codex app-server daemon restart`;
};

// The switch on this side, under dotagents' login lock: the profile switched to, or null after a
// --save.
export function switchCodexHere(name: string | undefined, save: string | undefined, options: { commit?: CommitUnderLock; daemon?: RestartDaemon } = {}): string | null {
  const { commit = commitUnderLock, daemon = restartDaemon } = options;
  const profiles = codexProfiles();
  const find = (n: string) => {
    const p = profiles.find((x) => x.name === n);
    if (!p) throw new Error(`There is no Codex profile named ${n}`);
    return p;
  };

  if (save) {
    find(save);
    const slot = slotLogin();
    if (!slot) throw new Error(`There is no Codex login in ${slotFile()} to save; sign in with: codex login`);
    const other = ownerOf(slot.user);
    if (other && other.name !== save) throw new Error(`That login is ${other.name}'s; sign in with ${save}'s account first`);
    section("Vault");
    saveToVault(save, slot);
    return null;
  }
  if (!name) throw new Error("Usage: dotagents switch <profile> [--here], or dotagents switch --save <profile>");

  find(name);
  const wanted = vaultLogin(name);
  if (!wanted) throw new Error(`There is no login saved for ${name}: sign it in with dotagents login ${name}`);
  const slot = slotLogin();

  if (slot) {
    const owner = ownerOf(slot.user);
    if (!owner) throw new Error(`${slotFile()} holds an account no profile knows; save it first with: dotagents switch --save <profile>`);
    const saved = vaultLogin(owner.name);
    // The slot's copy goes back to its vault only when it is provably the newer one: the same
    // sign-in, renewed at least as late. Another sign-in of the account is a choice for the person.
    if (slot.text !== saved?.text) {
      if (!saved || slot.grant === null || slot.grant !== saved.grant || (slot.refreshed ?? 0) < (saved.refreshed ?? 0)) {
        throw new Error(`${slotFile()} holds another sign-in of ${owner.name} than its vault; keep it with dotagents switch --save ${owner.name}, then switch again`);
      }
      section("Vault");
      saveToVault(owner.name, slot);
    }
    if (owner.name === name) {
      section("Slot");
      report("ok", slotFile(), `${name} is already in the slot`);
      return name;
    }
  }

  writeSlot(name, wanted, commit, daemon);
  return name;
}

// Puts a login in the slot, under Codex's lock, checks it, and restarts the daemon.
function writeSlot(name: string, login: CodexLogin, commit: CommitUnderLock, daemon: RestartDaemon) {
  section("Slot");
  if (state.dryRun) return report("would update", slotFile(), name);
  if (fs.lstatSync(slotFile(), { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${slotFile()} is a link; dotagents writes only a plain file there`);
  fs.mkdirSync(codexHome(), { recursive: true, mode: 0o700 });
  const tmp = `${slotFile()}.dotagents-${process.pid}`;
  fs.writeFileSync(tmp, login.text, { mode: 0o600 });
  try {
    commit(tmp, slotFile());
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  if (slotLogin()?.user !== login.user) throw new Error(`${slotFile()} doesn't hold ${name} after writing it; run it again`);
  report("updated", slotFile(), `now ${name}`);
  const restarted = daemon();
  if (restarted) report(restarted === "restarted" ? "updated" : "failed", "codex app-server daemon", restarted);
}

// ── Signing a Codex profile in ───────────────────────────────────────────────────────────────
// codex login in the live folder revokes the login before it, which may be another profile's
// saved one. So the sign-in runs in a temporary CODEX_HOME, only the user's, and its auth.json is
// taken into the vault; when the profile's account is in the slot, the new login goes there too.
// dotagents' lock is held only around the vault and slot writes, never while the browser waits.

export type CodexSignIn = (home: string) => { ok: boolean; detail: string };

export const codexSignIn: CodexSignIn = (home) => {
  const run = runCodex(["login"], { stdio: "inherit", env: { ...process.env, CODEX_HOME: home } });
  return { ok: run.status === 0, detail: run.error?.message ?? `exit ${run.status}` };
};

export type CodexLoginOptions = { run?: CodexSignIn; commit?: CommitUnderLock; daemon?: RestartDaemon; lock?: <T>(fn: () => T) => Promise<T> };

export async function loginCodex(name: string, { run = codexSignIn, commit = commitUnderLock, daemon = restartDaemon, lock = async (fn) => fn() }: CodexLoginOptions = {}) {
  if (!codexProfiles().some((p) => p.name === name)) throw new Error(`There is no Codex profile named ${name}`);
  section(name);
  if (state.dryRun) return report("would update", vaultDir(name), `sign ${name} in with codex login, in a folder of its own`);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-codex-login-"));
  try {
    fs.chmodSync(home, 0o700);
    // A file, never the system keyring, so there is an auth.json to take.
    fs.writeFileSync(path.join(home, "config.toml"), 'cli_auth_credentials_store = "file"\n', { mode: 0o600 });
    const signed = run(home);
    if (!signed.ok) throw new Error(`codex login didn't finish (${signed.detail})`);
    const fresh = readLogin(path.join(home, "auth.json"));
    if (!fresh) throw new Error("codex login left no ChatGPT login to keep; sign in with a ChatGPT account, not an API key");
    await lock(() => {
      const known = vaultLogin(name);
      const owner = ownerOf(fresh.user);
      if ((known && known.user !== fresh.user) || (owner && owner.name !== name)) {
        throw new Error(`Signed in as ${fresh.email || "another account"}, not ${name}'s account; run it again and choose that account in the browser`);
      }
      section("Vault");
      saveToVault(name, fresh);
      if (slotLogin()?.user === fresh.user) writeSlot(name, fresh, commit, daemon);
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
