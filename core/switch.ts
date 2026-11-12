// The switch in place (ADR 0009). Each side of the machine has one slot: ~/.claude (its
// .credentials.json) and ~/.claude.json (its oauthAccount block), which the command line, the VS
// Code extension and the Desktop's Code tab in WSL mode all read, so they change together. Every
// account's login is kept in a vault, one per account and side (<state>/vault/<profile>/), readable
// only by the user. A switch saves the slot's login back to its account's vault (Claude Code may
// have renewed the token since), writes the chosen account's in, and checks the account after.
// Always manual (ADR 0001). Credentials are copied whole and never printed.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defaultConfigDir, stateFile } from "./claude-code.ts";
import { type Peer, type Profile, loadMachine, loadProfiles, stateDir } from "./machine-state.ts";
import { checkItem, checkWarn, report, section } from "./output.ts";
import { state } from "./state.ts";

// A login: the .credentials.json as Claude Code wrote it, the file it came from, and the account
// it belongs to.
type Login = { credentials: string; file: string; account: Record<string, unknown>; accountUuid: string };

const slotDir = () => defaultConfigDir();
const credentialsIn = (dir: string) => path.join(dir, ".credentials.json");
export const vaultDir = (name: string) => path.join(stateDir(), "vault", name);

const readJson = (file: string): Record<string, unknown> | null => {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof data === "object" && data !== null && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
};

const loginOf = (credentialsFile: string, account: unknown): Login | null => {
  const a = account as Record<string, unknown> | null;
  if (!a || typeof a.accountUuid !== "string") return null;
  let credentials: string;
  try {
    credentials = fs.readFileSync(credentialsFile, "utf8");
  } catch {
    return null;
  }
  return { credentials, file: credentialsFile, account: a, accountUuid: a.accountUuid };
};

const slotLogin = () => loginOf(credentialsIn(slotDir()), readJson(stateFile(slotDir()))?.oauthAccount);
const vaultLogin = (name: string) => loginOf(path.join(vaultDir(name), "credentials.json"), readJson(path.join(vaultDir(name), "account.json")));

const realOrSame = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

// The login a profile still has in a folder of its own (the model before the vault); none for the
// profile whose folder is the slot.
const folderLogin = (p: Profile) =>
  realOrSame(p.configDir) === realOrSame(slotDir()) ? null : loginOf(credentialsIn(p.configDir), readJson(stateFile(p.configDir))?.oauthAccount);

const knownLogin = (p: Profile) => vaultLogin(p.name) ?? folderLogin(p);

// The account of a profile's saved login, or null.
export function profileAccount(p: Profile): { accountUuid: string; email: string } | null {
  const known = knownLogin(p);
  return known ? { accountUuid: known.accountUuid, email: typeof known.account.emailAddress === "string" ? known.account.emailAddress : "" } : null;
}

// The profile an account belongs to, by the account's id.
const ownerOf = (uuid: string) => loadProfiles().find((p) => knownLogin(p)?.accountUuid === uuid) ?? null;

// The profile whose account is in this side's slot, or null.
export function slotProfile(): Profile | null {
  const slot = slotLogin();
  return slot ? ownerOf(slot.accountUuid) : null;
}

// Where a profile's login lives now: the copy to read, and to renew when it is about to expire.
// The slot's when its account is there (the vault may hold the same token, which a renewal of the
// slot spends), else its vault's, else its own folder's. shared: Claude Code reads and renews that
// copy too; the vault's is dotagents' alone.
export type LiveLogin = { file: string; accountUuid: string; shared: boolean; configDir: string | null };

export function liveLogin(p: Profile): LiveLogin | null {
  const known = knownLogin(p);
  const slot = slotLogin();
  if (slot) {
    const mine = known ? slot.accountUuid === known.accountUuid : realOrSame(p.configDir) === realOrSame(slotDir()) && (ownerOf(slot.accountUuid)?.name ?? p.name) === p.name;
    if (mine) return { file: credentialsIn(slotDir()), accountUuid: slot.accountUuid, shared: true, configDir: slotDir() };
  }
  if (!known) return null;
  if (vaultLogin(p.name)) return { file: path.join(vaultDir(p.name), "credentials.json"), accountUuid: known.accountUuid, shared: false, configDir: null };
  return { file: credentialsIn(p.configDir), accountUuid: known.accountUuid, shared: true, configDir: p.configDir };
}

// One lock across dotagents' processes around every change to a login (a switch, a renewal), so a
// switch never copies a token that a renewal is spending. A lock older than LOCK_STALE_MS was left
// by a process that died, and is taken over.
const lockFile = () => path.join(stateDir(), "logins.lock");
const LOCK_STALE_MS = 60_000;

export async function withLoginLock<T>(fn: () => T | Promise<T>, waitMs = 30_000): Promise<T> {
  if (state.dryRun) return fn();
  fs.mkdirSync(stateDir(), { recursive: true });
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(lockFile(), `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const since = fs.statSync(lockFile(), { throwIfNoEntry: false })?.mtimeMs;
      if (since !== undefined && Date.now() - since > LOCK_STALE_MS) fs.rmSync(lockFile(), { force: true });
      else if (Date.now() > until) throw new Error(`Another dotagents is changing a login (${lockFile()}); try again`);
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lockFile(), { force: true });
  }
}

// Writes a file whole and in one step (a temporary file renamed over it), readable only by the user.
export function writePrivate(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.dotagents-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function saveToVault(name: string, login: Login) {
  const dir = vaultDir(name);
  const known = vaultLogin(name);
  const same = known && known.credentials === login.credentials && known.accountUuid === login.accountUuid;
  if (same) return report("ok", dir, `${name}'s login`);
  if (state.dryRun) return report("would update", dir, `${name}'s login`);
  writePrivate(path.join(dir, "credentials.json"), login.credentials);
  writePrivate(path.join(dir, "account.json"), `${JSON.stringify(login.account, null, 2)}\n`);
  report(known ? "updated" : "created", dir, `${name}'s login`);
}

// Runs the switch on the other side of the machine, with --here so it doesn't come back.
export type PeerSwitch = (name: string) => { ok: boolean; detail: string } | null;

export const peerSwitch: PeerSwitch = (name) => {
  const peer = loadMachine().peer;
  if (!peer) return null;
  const run =
    process.platform === "win32"
      ? spawnSync("wsl.exe", ["-e", "bash", "-lc", `dotagents switch ${name} --here`], { encoding: "utf8", timeout: 60_000, windowsHide: true })
      : spawnSync("powershell.exe", ["-NoProfile", "-Command", `dotagents switch ${name} --here`], { encoding: "utf8", timeout: 60_000, cwd: "/mnt/c" });
  if (run.status === 0) return { ok: true, detail: `${peer.name}: ${name}` };
  return { ok: false, detail: `${peer.name}: ${peerFailure(`${run.stdout ?? ""}${run.stderr ?? ""}`) || run.error?.message || `exit ${run.status}`}` };
};

// Why the other side's switch failed, in one line: a dotagents older than switch (it doesn't know
// the command or --here) says how to update it; else the error's own line, not Node's trailer.
export function peerFailure(output: string) {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => /Unknown command 'switch'|--here/.test(l))) return "its dotagents doesn't know switch yet; update it there with: dotagents update";
  const error = lines.find((l) => /^(✗ )?(\S*Error|dotagents):/.test(l));
  return (error ?? lines.at(-1) ?? "").replace(/^(✗ )?(\S*Error|dotagents): /, "");
}

// afterSave: the moment between saving the slot's login and replacing it, where a running Claude
// Code may renew its token; the tests renew it there.
export type SwitchOptions = { name?: string; save?: string; here?: boolean; peer?: PeerSwitch; afterSave?: () => void };

export async function switchProfile({ name, save, here = false, peer = peerSwitch, afterSave }: SwitchOptions) {
  const switched = await withLoginLock(() => switchHere(name, save, afterSave));
  if (!switched || here || state.dryRun) return;
  const other = peer(switched);
  if (!other) return;
  section("Other side");
  report(other.ok ? "updated" : "failed", "switch", other.detail);
}

// The switch on this side, under the lock: the profile switched to, or null after a --save.
function switchHere(name: string | undefined, save: string | undefined, afterSave?: () => void): string | null {
  const profiles = loadProfiles();
  const find = (n: string) => {
    const p = profiles.find((x) => x.name === n);
    if (!p) throw new Error(`There is no profile named ${n}`);
    return p;
  };

  // --save: the login now in the slot (after a /login) belongs to this profile.
  if (save) {
    find(save);
    const slot = slotLogin();
    if (!slot) throw new Error("There is no login in the slot to save; sign in with: claude auth login");
    section("Vault");
    saveToVault(save, slot);
    return null;
  }
  if (!name) throw new Error("Usage: dotagents switch <profile> [--here], or dotagents switch --save <profile>");

  const target = find(name);
  const wanted = knownLogin(target);
  if (!wanted) throw new Error(`There is no login saved for ${name}: put it in the slot with claude auth login, then run dotagents switch --save ${name}`);
  const slot = slotLogin();
  const refused = refusedLogin(name, slot && slot.accountUuid === wanted.accountUuid ? slot : wanted);

  if (slot && slot.accountUuid === wanted.accountUuid) {
    section("Slot");
    report("ok", slotDir(), `${name} is already in the slot`);
  } else {
    if (slot) {
      const owner = ownerOf(slot.accountUuid);
      if (!owner) throw new Error(`The slot holds ${slot.account.emailAddress ?? slot.accountUuid}, which no profile knows; save it first with: dotagents switch --save <profile>`);
      section("Vault");
      saveToVault(owner.name, slot);
      afterSave?.();
      // Claude Code may have renewed the token since it was read, spending the one just saved: the
      // renewed one is saved too, or replacing the slot would lose it and sign the account out.
      const again = slotLogin();
      if (again && again.accountUuid === slot.accountUuid && again.credentials !== slot.credentials) saveToVault(owner.name, again);
    }
    saveToVault(name, wanted);
    section("Slot");
    if (state.dryRun) report("would update", slotDir(), `${name} (${wanted.account.emailAddress ?? wanted.accountUuid})`);
    else {
      writePrivate(credentialsIn(slotDir()), wanted.credentials);
      const file = stateFile(slotDir());
      writePrivate(file, `${JSON.stringify({ ...(readJson(file) ?? {}), oauthAccount: wanted.account }, null, 2)}\n`);
      const now = slotLogin();
      if (now?.accountUuid !== wanted.accountUuid) throw new Error(`The slot doesn't hold ${name} after the switch; run it again`);
      report("updated", slotDir(), `now ${name} (${wanted.account.emailAddress ?? wanted.accountUuid})`);
    }
  }
  if (refused) checkWarn(`${name}'s login was refused by Anthropic`, renewHint(name));
  return name;
}

// ── When the saved logins expire ─────────────────────────────────────────────────────────────
// A login lasts a few weeks; Claude Code renews the access token but not past the refresh token's
// own expiry (refreshTokenExpiresAt). The checklist names that date for each profile on each side,
// so a login is renewed calmly instead of failing in the middle of work.

const WARN_DAYS = 7;
const DAY = 86_400_000;

const expiryOf = (login: Login | null) => {
  try {
    const value = JSON.parse(login?.credentials ?? "")?.claudeAiOauth?.refreshTokenExpiresAt;
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
};

const sideName = () => (process.platform === "win32" ? "Windows" : loadMachine().peer?.name === "Windows" ? "WSL" : "this machine");

// The freshest login of each profile on the other side: its slot's when the account is there, else
// its vault's. Read only.
function peerLogins(peer: Peer, uuids: Map<string, string>) {
  const peerSlot = loginOf(path.join(peer.home, ".claude", ".credentials.json"), readJson(path.join(peer.home, ".claude.json"))?.oauthAccount);
  return (name: string) => {
    const dir = path.join(peer.home, ".config", "dotagents", "vault", name);
    const saved = loginOf(path.join(dir, "credentials.json"), readJson(path.join(dir, "account.json")));
    const uuid = saved?.accountUuid ?? uuids.get(name);
    return peerSlot && uuid && peerSlot.accountUuid === uuid ? peerSlot : saved;
  };
}

const renewHint = (name: string) => `renew it: put ${name} in the slot (dotagents switch ${name} --here), run claude auth login, then dotagents switch --save ${name}`;

// Names one login's refresh token without keeping it: a short hash, which tells the login a
// refusal was about from a new one (a sign-in or a renewal brings a new refresh token), while a
// copy (a switch, the vault) keeps the same. Null for credentials without one.
export function loginMark(credentials: string): string | null {
  try {
    const token = JSON.parse(credentials)?.claudeAiOauth?.refreshToken;
    return typeof token === "string" && token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : null;
  } catch {
    return null;
  }
}

// Whether Anthropic refused this login: the live usage marks the profile with the login it was
// refused (refused in <state>/usage/<profile>.json, core/live.ts). A token revoked on the server
// still has a good date, so the date alone can't tell.
function refusedLogin(name: string, login: Login | null, dir = stateDir()) {
  const mark = login && loginMark(login.credentials);
  return mark !== null && readJson(path.join(dir, "usage", `${name}.json`))?.refused === mark;
}

// A slot whose .claude.json names an account but that has no .credentials.json: signed out (a
// logout elsewhere deletes the file), though every date still looks good.
function checkSlot(home: string, side: string, uuids: Map<string, string>) {
  const account = readJson(path.join(home, ".claude.json"))?.oauthAccount as Record<string, unknown> | undefined;
  if (typeof account?.accountUuid !== "string" || fs.existsSync(path.join(home, ".claude", ".credentials.json"))) return;
  const owner = [...uuids].find(([, uuid]) => uuid === account.accountUuid)?.[0];
  checkItem(false, `the slot on ${side} has no login${owner ? ` (it names ${owner})` : ""}`, `sign in there with claude auth login, then dotagents switch --save ${owner ?? "<profile>"}`);
}

function checkExpiry(name: string, side: string, login: Login | null, now: Date, stateHome?: string) {
  if (refusedLogin(name, login, stateHome)) return checkItem(false, `${name} on ${side}: Anthropic refused the login`, renewHint(name));
  const expires = expiryOf(login);
  if (expires === null) return;
  const date = new Date(expires).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const days = Math.floor((expires - now.getTime()) / DAY);
  const renew = renewHint(name);
  if (expires <= now.getTime()) return checkItem(false, `${name} on ${side}: login expired on ${date}`, renew);
  if (days < WARN_DAYS) return checkWarn(`${name} on ${side}: login expires in ${days} day${days === 1 ? "" : "s"} (${date})`, renew);
  checkItem(true, `${name} on ${side}: login good until ${date}`);
}

export function verifyLogins(now = new Date()) {
  section("Logins");
  // In WSL the slot must be a folder: Windows reaches it through \\wsl.localhost, which doesn't
  // follow a Linux link, so the Desktop's Code tab in WSL mode couldn't install its server there.
  if (sideName() === "WSL" && fs.lstatSync(slotDir(), { throwIfNoEntry: false })?.isSymbolicLink()) {
    const real = realOrSame(slotDir());
    checkItem(false, `${slotDir()} is a folder, not a link (to ${real})`, `with every Claude Code closed: rm ${slotDir()} && mv ${real} ${slotDir()} && ln -s ${path.basename(slotDir())} ${real}`);
  }
  const slot = slotLogin();
  const uuids = new Map<string, string>();
  for (const p of loadProfiles()) {
    const known = knownLogin(p);
    if (known) uuids.set(p.name, known.accountUuid);
    checkExpiry(p.name, sideName(), slot && known && slot.accountUuid === known.accountUuid ? slot : known, now);
  }
  checkSlot(path.dirname(slotDir()), sideName(), uuids);
  const peer = loadMachine().peer;
  if (!peer) return;
  const other = peerLogins(peer, uuids);
  for (const p of loadProfiles()) checkExpiry(p.name, peer.name, other(p.name), now, path.join(peer.home, ".config", "dotagents"));
  checkSlot(peer.home, peer.name, uuids);
}
