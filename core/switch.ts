// The switch in place (ADR 0009). Each side of the machine has one slot: ~/.claude (its
// .credentials.json) and ~/.claude.json (its oauthAccount block), which the command line, the VS
// Code extension and the Desktop's Code tab in WSL mode all read, so they change together. Every
// account's login is kept in a vault, one per account and side (<state>/vault/<profile>/), readable
// only by the user. A switch saves the slot's login back to its account's vault (Claude Code may
// have renewed the token since), writes the chosen account's in, and checks the account after.
// Always manual (ADR 0001). Credentials are copied whole and never printed.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defaultConfigDir, stateFile } from "./claude-code.ts";
import { type Profile, loadMachine, loadProfiles, stateDir } from "./machine-state.ts";
import { report, section } from "./output.ts";
import { state } from "./state.ts";

// A login: the .credentials.json as Claude Code wrote it, and the account it belongs to.
type Login = { credentials: string; account: Record<string, unknown>; accountUuid: string };

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
  return { credentials, account: a, accountUuid: a.accountUuid };
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

// The profile an account belongs to, by the account's id.
const ownerOf = (uuid: string) => loadProfiles().find((p) => knownLogin(p)?.accountUuid === uuid) ?? null;

// The profile whose account is in this side's slot, or null.
export function slotProfile(): Profile | null {
  const slot = slotLogin();
  return slot ? ownerOf(slot.accountUuid) : null;
}

// Writes a file whole and in one step (a temporary file renamed over it), readable only by the user.
function writePrivate(file: string, text: string) {
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
  const last = `${run.stdout ?? ""}${run.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "").trim().split(/\r?\n/).pop() ?? "";
  return run.status === 0 ? { ok: true, detail: `${peer.name}: ${name}` } : { ok: false, detail: `${peer.name}: ${last || run.error?.message || `exit ${run.status}`}` };
};

export type SwitchOptions = { name?: string; save?: string; here?: boolean; peer?: PeerSwitch };

export async function switchProfile({ name, save, here = false, peer = peerSwitch }: SwitchOptions) {
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
    return saveToVault(save, slot);
  }
  if (!name) throw new Error("Usage: dotagents switch <profile> [--here], or dotagents switch --save <profile>");

  const target = find(name);
  const wanted = knownLogin(target);
  if (!wanted) throw new Error(`There is no login saved for ${name}: put it in the slot with claude auth login, then run dotagents switch --save ${name}`);
  const slot = slotLogin();

  section("Slot");
  if (slot && slot.accountUuid === wanted.accountUuid) report("ok", slotDir(), `${name} is already in the slot`);
  else {
    if (slot) {
      const owner = ownerOf(slot.accountUuid);
      if (!owner) throw new Error(`The slot holds ${slot.account.emailAddress ?? slot.accountUuid}, which no profile knows; save it first with: dotagents switch --save <profile>`);
      section("Vault");
      saveToVault(owner.name, slot);
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

  if (here || state.dryRun) return;
  const other = peer(name);
  if (!other) return;
  section("Other side");
  report(other.ok ? "updated" : "failed", "switch", other.detail);
}
