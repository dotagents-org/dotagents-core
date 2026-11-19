// Where a Claude profile's login is, and whose it is. Each side of the machine has one slot:
// ~/.claude (its .credentials.json) and ~/.claude.json (its oauthAccount block), which Claude Code,
// its VS Code extension and the Desktop's Code tab in WSL mode all read. The vault keeps every
// account's login (<state>/vault/<profile>/credentials.json and account.json). Credentials are
// copied whole and never printed.

import { hashMark } from "../usage-record.ts";

import fs from "node:fs";
import path from "node:path";
import type { Login } from "../providers.ts";
import { defaultConfigDir, stateFile } from "../../claude-code.ts";
import { type Profile, claudeProfiles } from "../../machine-state.ts";
import { vaultDir } from "../vault.ts";

// A Claude login: the .credentials.json as Claude Code wrote it, and the oauthAccount block.
export type StoredLogin = Login & { account: Record<string, unknown> };

export const slotDir = () => defaultConfigDir();
export const credentialsIn = (dir: string) => path.join(dir, ".credentials.json");

export const readJson = (file: string): Record<string, unknown> | null => {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof data === "object" && data !== null && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
};

export const loginOf = (credentialsFile: string, account: unknown): StoredLogin | null => {
  const a = account as Record<string, unknown> | null;
  if (!a || typeof a.accountUuid !== "string") return null;
  let text: string;
  try {
    text = fs.readFileSync(credentialsFile, "utf8");
  } catch {
    return null;
  }
  return { text, file: credentialsFile, account: a, id: a.accountUuid, email: typeof a.emailAddress === "string" ? a.emailAddress : "", plan: null };
};

export const slotLogin = () => loginOf(credentialsIn(slotDir()), readJson(stateFile(slotDir()))?.oauthAccount);
export const vaultLogin = (name: string) => loginOf(path.join(vaultDir(name), "credentials.json"), readJson(path.join(vaultDir(name), "account.json")));

export const realOrSame = (p: string) => {
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

export const knownLogin = (p: Profile) => vaultLogin(p.name) ?? folderLogin(p);

// The account of a profile's saved login, or null.
export function profileAccount(p: Profile): { accountUuid: string; email: string } | null {
  const known = knownLogin(p);
  return known ? { accountUuid: known.id, email: known.email } : null;
}

// The profile an account belongs to, by the account's id.
export const ownerOf = (uuid: string) => claudeProfiles().find((p) => knownLogin(p)?.id === uuid) ?? null;

// The profile whose account is in this side's slot, or null.
export function slotProfile(): Profile | null {
  const slot = slotLogin();
  return slot ? ownerOf(slot.id) : null;
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
    const mine = known ? slot.id === known.id : realOrSame(p.configDir) === realOrSame(slotDir()) && (ownerOf(slot.id)?.name ?? p.name) === p.name;
    if (mine) return { file: credentialsIn(slotDir()), accountUuid: slot.id, shared: true, configDir: slotDir() };
  }
  if (!known) return null;
  if (vaultLogin(p.name)) return { file: path.join(vaultDir(p.name), "credentials.json"), accountUuid: known.id, shared: false, configDir: null };
  return { file: credentialsIn(p.configDir), accountUuid: known.id, shared: true, configDir: p.configDir };
}

// The plan in a .credentials.json ("max", "pro", "team"): the subscriptionType Claude Code keeps
// next to the tokens; only that field is read. Null when it isn't there (the macOS keychain, an
// older Claude Code).
export function subscriptionOf(text: string): string | null {
  try {
    const plan = JSON.parse(text)?.claudeAiOauth?.subscriptionType;
    return typeof plan === "string" && plan ? plan : null;
  } catch {
    return null;
  }
}

// The plan of a profile's login, and its seat (team_standard), both from the copy it uses now: the
// slot's credentials and .claude.json, or the vault's.
export function profilePlan(p: Profile): { plan: string | null; seat: string | null } {
  const login = liveLogin(p);
  if (!login) return { plan: null, seat: null };
  let plan: string | null = null;
  try {
    plan = subscriptionOf(fs.readFileSync(login.file, "utf8"));
  } catch {
    // no plan to show
  }
  const account = login.file === credentialsIn(slotDir()) ? slotLogin()?.account : knownLogin(p)?.account;
  const seat = account?.seatTier;
  return { plan, seat: typeof seat === "string" && seat ? seat : null };
}

// Names one login's refresh token without keeping it: a short hash, which tells the login a
// refusal was about from a new one (a sign-in or a renewal brings a new refresh token), while a
// copy (a switch, the vault) keeps the same. Null for credentials without one.
export function loginMark(credentials: string): string | null {
  try {
    const token = JSON.parse(credentials)?.claudeAiOauth?.refreshToken;
    return typeof token === "string" && token ? hashMark(token) : null;
  } catch {
    return null;
  }
}
