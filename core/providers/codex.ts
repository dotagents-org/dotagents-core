// Codex, the ChatGPT accounts (ADR 0007), switched in place like Claude's (ADR 0009). Each side has
// one slot, <CODEX_HOME>/auth.json (~/.codex by default), which the Codex command line, its VS Code
// extension and its desktop app all read. Every account's login waits in the vault, <state>/vault/
// <profile>/auth.json, one per account and side. The file is copied byte for byte and read only to
// tell whose login it is: never printed, never renewed here (the refresh token is single-use). The
// steps here are the ones the common coordination (core/account-switch.ts, account-login.ts) calls.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Profile, sideName, stateDir } from "../machine-state.ts";
import { checkItem, checkWarn, report, section } from "../output.ts";
import { LABELS } from "../provider-labels.ts";
import type { Login, Provider, SwitchOptions } from "../providers.ts";
import { state } from "../state.ts";
import { vaultDir, withLoginLock, writePrivate } from "../vault.ts";
import { CODEX_OTHER_EVERY_MS, CODEX_SLOT_EVERY_MS, askCodex, readCodexSlots, readCodexUsage } from "./codex-usage.ts";
import { codexHome, installCodex, verifyCodexConfig } from "./codex-config.ts";
import { codexAccount, codexLoginMark, codexProfiles, codexSlotProfile, ownerOf, readLogin, slotFile, slotLogin, vaultFile, vaultLogin } from "./codex-store.ts";

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
  // The restarted daemon outlives this command and keeps every handle it inherited. On Windows a
  // child inherits all of them, the pipes of whoever runs dotagents too (the other side's switch,
  // through PowerShell), which would then wait on the daemon until its timeout: Start-Process starts
  // the restart without passing any handle on, and only that process is waited for.
  const restart =
    process.platform === "win32"
      ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$p = Start-Process -FilePath codex -ArgumentList 'app-server','daemon','restart' -WindowStyle Hidden -PassThru; $p.WaitForExit(); exit $p.ExitCode"], { stdio: "ignore", timeout: 60_000, windowsHide: true })
      : runCodex(["app-server", "daemon", "restart"], { stdio: "ignore", timeout: 30_000 });
  return restart.status === 0 ? "restarted" : `couldn't restart it (exit ${restart.status}); run: codex app-server daemon restart`;
};

// Puts a login in the slot, under Codex's lock, and checks it.
function writeSlot(name: string, login: Login, { codex = {} }: SwitchOptions) {
  const { commit = commitUnderLock } = codex;
  if (fs.lstatSync(slotFile(), { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${slotFile()} is a link; dotagents writes only a plain file there`);
  fs.mkdirSync(codexHome(), { recursive: true, mode: 0o700 });
  const tmp = `${slotFile()}.dotagents-${process.pid}`;
  fs.writeFileSync(tmp, login.text, { mode: 0o600 });
  try {
    commit(tmp, slotFile());
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  if (slotLogin()?.id !== login.id) throw new Error(`${slotFile()} doesn't hold ${name} after writing it; run it again`);
}

// Remembers what was put there, and restarts the daemon.
function afterSlotWrite(name: string, login: Login, { codex = {} }: SwitchOptions) {
  const { daemon = restartDaemon } = codex;
  recordSlot(name, login.id);
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


const codex: Provider = {
  id: "codex",
  labels: LABELS.codex,
  configDir: codexHome,
  desktop: false,
  profiles: codexProfiles,
  profileRecord({ name, color, isDefault }) {
    if (isDefault) throw new Error("--default names the profile the Claude Desktop app opens; a ChatGPT profile has none");
    return { name, configDir: codexHome(), color, provider: "codex" };
  },

  account(p) {
    const account = codexAccount(p);
    return account ? { id: account.user, email: account.email, plan: account.plan, shown: account.email || "saved" } : null;
  },
  slot: slotLogin,
  slotProfile: codexSlotProfile,
  slotPath: slotFile,
  saved: (p) => vaultLogin(p.name),
  vaultLogin,
  ownerOf,
  writeVault: (name, login) => writePrivate(vaultFile(name), login.text),

  noSlotLogin: () => `There is no Codex login in ${slotFile()} to save; sign in with: codex login`,
  noSavedLogin: (name) => `There is no login saved for ${name}: sign it in with dotagents login ${name}`,
  checkSave(slot, save) {
    const other = ownerOf(slot.id);
    if (other && other.name !== save) throw new Error(`That login is ${other.name}'s; sign in with ${save}'s account first`);
  },
  beforeLeave(slot, _wanted, name, ctx) {
    const owner = ownerOf(slot.id);
    if (!owner) throw new Error(`${slotFile()} holds an account no profile knows; save it first with: dotagents switch --save <profile>`);
    const saved = vaultLogin(owner.name);
    // The slot's copy goes back to its vault only when it is provably the newer one: the same
    // sign-in, renewed at least as late. Another sign-in of the account is a choice for the person.
    if (slot.text !== saved?.text) {
      if (!saved || slot.grant === null || slot.grant !== saved.grant || (slot.refreshed ?? 0) < (saved.refreshed ?? 0)) {
        throw new Error(`${slotFile()} holds another sign-in of ${owner.name} than its vault; keep it with dotagents switch --save ${owner.name}, then switch again`);
      }
      section("Vault");
      ctx.save(owner.name, slot);
    }
    return owner.name === name;
  },
  slotDetail: (name) => name,
  writeSlot,
  afterSlotWrite,
  afterAlready: (name, slot) => recordSlot(name, slot.id),
  refused: (p) => refusedCodex(p.name),
  switched: "Codex sessions already open stay on the old account until you restart them.",
  signInHint: (name) => `sign it in with: dotagents login ${name}`,
  addHint: (name) => `Sign it in with: dotagents login ${name}`,

  usage: {
    profiles: codexProfiles,
    every: (p) => (codexSlotProfile()?.name === p.name ? CODEX_SLOT_EVERY_MS : CODEX_OTHER_EVERY_MS),
    forceable: true,
    together: false,
    hasLogin: (p) => (codexSlotProfile()?.name === p.name ? readLogin(slotFile()) : vaultLogin(p.name)) !== null,
    dryRun: "would ask Codex for the usage",
    done: "asked Codex for the usage",
    ask: askCodex,
  },

  async signIn(profiles, { codex = {} }, ctx) {
    const { run = codexSignIn, lock = withLoginLock } = codex;
    for (const p of profiles) {
      const { name } = p;
      section(name);
      if (state.dryRun) {
        report("would update", vaultDir(name), `sign ${name} in with codex login, in a folder of its own`);
        continue;
      }
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
          ctx.accept(p, fresh, fresh.email || "another account");
          section("Vault");
          ctx.save(name, fresh);
          if (slotLogin()?.id === fresh.id) ctx.put(name, fresh);
        });
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    }
  },

  readUsage: readCodexUsage,
  readSlots: (_list, view) => readCodexSlots(view),
  verifyProfiles: verifyCodexLogins,
  install: installCodex,
  verifyConfig: verifyCodexConfig,
};

export default codex;

// ── Checks ───────────────────────────────────────────────────────────────────────────────────
// The checklist of `profile list` for the Codex logins of this side, and the switch's warning.

// Whether OpenAI refused this profile's login: the live usage marks the profile's record with the
// login it was refused (refused in <state>/usage/<profile>.json, core/providers/codex-usage.ts), the slot's
// when the profile's account is there, else the vault's. A new sign-in or renewal changes the mark.
function refusedCodex(name: string) {
  const saved = vaultLogin(name);
  const slot = slotLogin();
  const login = slot && saved && slot.id === saved.id ? slot : saved;
  const mark = login && codexLoginMark(login.text);
  if (!mark) return false;
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir(), "usage", `${name}.json`), "utf8"))?.refused === mark;
  } catch {
    return false;
  }
}

const renewHint = (name: string) => `renew it, on ${sideName()}: dotagents login ${name}`;

// Which profile and ChatGPT user the last switch or login put in this side's slot: no token.
const slotRecord = () => path.join(stateDir(), "codex-slot.json");

function recordSlot(profile: string, user: string) {
  if (!state.dryRun) writePrivate(slotRecord(), `${JSON.stringify({ profile, user })}\n`);
}

// A top-level key of config.toml (one inside a [section] is another setting), or null.
function configValue(key: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(codexHome(), "config.toml"), "utf8");
  } catch {
    return null;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) return null;
    const match = line.match(new RegExp(`^${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s#]+))`));
    if (match) return match[1] ?? match[2] ?? match[3];
  }
  return null;
}

const CODEX_KEY_VARIABLES = ["OPENAI_API_KEY", "CODEX_API_KEY"];

export function verifyCodexLogins() {
  if (!codexProfiles().length) return;
  const side = sideName();
  for (const p of codexProfiles()) if (refusedCodex(p.name)) checkItem(false, `${p.name} on ${side}: OpenAI refused the login`, renewHint(p.name));

  const link = fs.lstatSync(slotFile(), { throwIfNoEntry: false });
  if (link && (link.isSymbolicLink() || link.nlink > 1)) {
    checkItem(false, `${slotFile()} is ${link.isSymbolicLink() ? "a link" : "a file with more than one name"}`, "dotagents writes only a plain file there; with Codex closed, replace it with a plain copy, or sign in again with codex login");
  }

  const store = configValue("cli_auth_credentials_store");
  if (store !== null && store !== "file") {
    checkWarn(`cli_auth_credentials_store is "${store}" in ${path.join(codexHome(), "config.toml")}`, 'the switch swaps auth.json and Codex would not read it; set it to "file" there');
  }
  const exported = CODEX_KEY_VARIABLES.filter((v) => process.env[v]);
  if (exported.length) checkWarn(`${exported.join(", ")} set in this shell`, "Codex signs in with that key over the slot's login; unset it");

  let put: { profile?: unknown; user?: unknown } | null = null;
  try {
    put = JSON.parse(fs.readFileSync(slotRecord(), "utf8"));
  } catch {
    // Nothing recorded yet.
  }
  const now = slotLogin();
  if (put && typeof put.profile === "string" && typeof put.user === "string" && now && now.id !== put.user) {
    const holds = ownerOf(now.id)?.name;
    checkWarn(`the slot on ${side} holds ${holds ?? "an account no profile knows"}, but the last switch put ${put.profile} there`, `a Codex left open may have written its old login back; run dotagents switch ${put.profile} again, or dotagents switch --save ${holds ?? "<profile>"} if the new login is wanted`);
  }
}
