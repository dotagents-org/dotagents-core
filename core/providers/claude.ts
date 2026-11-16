// Claude, the accounts of Claude Code, switched in place (ADR 0009): each side's slot is ~/.claude
// and ~/.claude.json (core/providers/claude-store.ts), every account's login waits in a vault, and
// a switch saves the slot's login back (Claude Code may have renewed the token since), writes the
// chosen one in and checks it. Always manual. Credentials are copied whole and never printed. The
// steps here are the ones the common coordination (core/account-switch.ts, account-login.ts) calls.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CREDENTIAL_VARIABLES, defaultConfigDir, stateFile } from "../claude-code.ts";
import { samePath } from "../common.ts";
import { LABELS } from "../provider-labels.ts";
import { type Peer, claudeProfiles, loadMachine, sideName } from "../machine-state.ts";
import { checkItem, checkWarn, displayPath, report, section } from "../output.ts";
import type { Provider } from "../providers.ts";
import { readClaudeSlots, readClaudeUsage } from "./claude-snapshot.ts";
import { LIVE_EVERY_MS, askClaude, sideProfiles } from "./claude-usage.ts";
import { state } from "../state.ts";
import { readRecord } from "../usage-record.ts";
import { vaultDir, withLoginLock, writePrivate } from "../vault.ts";
import { type StoredLogin, credentialsIn, knownLogin, liveLogin, loginMark, loginOf, ownerOf, profileAccount, readJson, realOrSame, slotDir, slotLogin, slotProfile, vaultLogin } from "./claude-store.ts";

// ── When the saved logins expire ─────────────────────────────────────────────────────────────
// A login lasts a few weeks; Claude Code renews the access token but not past the refresh token's
// own expiry (refreshTokenExpiresAt). The checklist names that date for each profile on each side,
// so a login is renewed calmly instead of failing in the middle of work.

const WARN_DAYS = 7;
const DAY = 86_400_000;

const expiryOf = (login: StoredLogin | null) => {
  try {
    const value = JSON.parse(login?.text ?? "")?.claudeAiOauth?.refreshTokenExpiresAt;
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
};

// The freshest login of each profile on the other side: its slot's when the account is there, else
// its vault's. Read only.
function peerLogins(peer: Peer, uuids: Map<string, string>) {
  const peerSlot = loginOf(path.join(peer.home, ".claude", ".credentials.json"), readJson(path.join(peer.home, ".claude.json"))?.oauthAccount);
  return (name: string) => {
    const dir = path.join(peer.home, ".config", "dotagents", "vault", name);
    const saved = loginOf(path.join(dir, "credentials.json"), readJson(path.join(dir, "account.json")));
    const uuid = saved?.id ?? uuids.get(name);
    return peerSlot && uuid && peerSlot.id === uuid ? peerSlot : saved;
  };
}

// Each side signs in on its own, so the hint names the side to run it on.
const renewHint = (name: string, side: string) => `renew it, on ${side}: dotagents login ${name}`;

// Whether Anthropic refused this login: the live usage marks the profile with the login it was
// refused (refused in <state>/usage/<profile>.json, core/providers/claude-usage.ts). A token revoked
// on the server still has a good date, so the date alone can't tell.
function refusedLogin(name: string, login: StoredLogin | null, dir?: string) {
  const mark = login && loginMark(login.text);
  return mark !== null && readRecord(name, dir).refused === mark;
}

// A slot whose .claude.json names an account but that has no .credentials.json: signed out (a
// logout elsewhere deletes the file), though every date still looks good.
function checkSlot(home: string, side: string, uuids: Map<string, string>) {
  const account = readJson(path.join(home, ".claude.json"))?.oauthAccount as Record<string, unknown> | undefined;
  if (typeof account?.accountUuid !== "string" || fs.existsSync(path.join(home, ".claude", ".credentials.json"))) return;
  const owner = [...uuids].find(([, uuid]) => uuid === account.accountUuid)?.[0];
  checkItem(false, `the slot on ${side} has no login${owner ? ` (it names ${owner})` : ""}`, `sign in there with claude auth login, then dotagents switch --save ${owner ?? "<profile>"}`);
}

function checkExpiry(name: string, side: string, login: StoredLogin | null, now: Date, stateHome?: string) {
  if (refusedLogin(name, login, stateHome)) return checkItem(false, `${name} on ${side}: Anthropic refused the login`, renewHint(name, side));
  const expires = expiryOf(login);
  if (expires === null) return;
  const date = new Date(expires).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const days = Math.floor((expires - now.getTime()) / DAY);
  const renew = renewHint(name, side);
  if (expires <= now.getTime()) return checkItem(false, `${name} on ${side}: login expired on ${date}`, renew);
  if (days < WARN_DAYS) return checkWarn(`${name} on ${side}: login expires in ${days} day${days === 1 ? "" : "s"} (${date})`, renew);
  checkItem(true, `${name} on ${side}: login good until ${date}`);
}

function verifyLogins(now: Date) {
  section("Logins");
  // In WSL the slot must be a folder: Windows reaches it through \\wsl.localhost, which doesn't
  // follow a Linux link, so the Desktop's Code tab in WSL mode couldn't install its server there.
  if (sideName() === "WSL" && fs.lstatSync(slotDir(), { throwIfNoEntry: false })?.isSymbolicLink()) {
    const real = realOrSame(slotDir());
    checkItem(false, `${slotDir()} is a folder, not a link (to ${real})`, `with every Claude Code closed: rm ${slotDir()} && mv ${real} ${slotDir()} && ln -s ${path.basename(slotDir())} ${real}`);
  }
  const slot = slotLogin();
  const uuids = new Map<string, string>();
  for (const p of claudeProfiles()) {
    const known = knownLogin(p);
    if (known) uuids.set(p.name, known.id);
    checkExpiry(p.name, sideName(), slot && known && slot.id === known.id ? slot : known, now);
  }
  checkSlot(path.dirname(slotDir()), sideName(), uuids);
  const peer = loadMachine().peer;
  if (!peer) return;
  const other = peerLogins(peer, uuids);
  for (const p of claudeProfiles()) checkExpiry(p.name, peer.name, other(p.name), now, path.join(peer.home, ".config", "dotagents"));
  checkSlot(peer.home, peer.name, uuids);
}

// ── Signing a profile in again ───────────────────────────────────────────────────────────────
// A login lasts a few weeks and no renewal extends it, so each profile signs in again in the
// browser, on each side. login does it through this side's slot: it puts the profile's account in
// (saving the one there), runs `claude auth login`, checks that the account signed in is the
// profile's, keeps the new login in its vault, and puts the previous account back. The lock is held
// only around the slot changes, never while the browser waits for the person.

export type ClaudeLogin = () => { ok: boolean; detail: string };

export const claudeLogin: ClaudeLogin = () => {
  const run = spawnSync("claude", ["auth", "login"], { stdio: "inherit", shell: process.platform === "win32" });
  return { ok: run.status === 0, detail: run.error?.message ?? `exit ${run.status}` };
};

// The profiles of this side whose login needs a new sign-in: none saved, refused by Anthropic, or
// running out within WARN_DAYS.
function dueLogins(now: Date) {
  const slot = slotLogin();
  return claudeProfiles().filter((p) => {
    const known = knownLogin(p);
    const login = slot && known && slot.id === known.id ? slot : known;
    if (!login || refusedLogin(p.name, login)) return true;
    const expires = expiryOf(login);
    return expires !== null && expires - now.getTime() < WARN_DAYS * DAY;
  });
}

const emailOf = (login: StoredLogin) => login.account.emailAddress ?? login.id;
const unknownSlot = (slot: StoredLogin) => new Error(`The slot holds ${emailOf(slot)}, which no profile knows; save it first with: dotagents switch --save <profile>`);

const claude: Provider = {
  id: "claude",
  labels: LABELS.claude,
  configDir: defaultConfigDir,
  desktop: true,
  profiles: claudeProfiles,
  profileRecord({ name, color, isDefault, prior, all }) {
    const otherDefault = all.find((a) => a.default && a.name !== name);
    // The default profile is the one the normal Desktop app opens: only one.
    if (isDefault && otherDefault) throw new Error(`${otherDefault.name} is already the default profile`);
    return { name, configDir: defaultConfigDir(), color, ...(isDefault || prior?.default ? { default: true } : {}) };
  },

  account(p) {
    const account = profileAccount(p);
    return account ? { id: account.accountUuid, email: account.email, plan: null, shown: account.email || account.accountUuid } : null;
  },
  slot: slotLogin,
  slotProfile,
  slotPath: slotDir,
  saved: knownLogin,
  vaultLogin,
  ownerOf,
  writeVault(name, login) {
    const dir = vaultDir(name);
    writePrivate(path.join(dir, "credentials.json"), login.text);
    writePrivate(path.join(dir, "account.json"), `${JSON.stringify(login.account, null, 2)}\n`);
  },

  noSlotLogin: () => "There is no login in the slot to save; sign in with: claude auth login",
  noSavedLogin: (name) => `There is no login saved for ${name}: put it in the slot with claude auth login, then run dotagents switch --save ${name}`,
  beforeLeave(slot, wanted, _name, ctx) {
    if (slot.id === wanted.id) return true;
    const owner = ownerOf(slot.id);
    if (!owner) throw unknownSlot(slot as StoredLogin);
    section("Vault");
    ctx.save(owner.name, slot);
    ctx.options.afterSave?.();
    // Claude Code may have renewed the token since it was read, spending the one just saved: the
    // renewed one is saved too, or replacing the slot would lose it and sign the account out.
    const again = slotLogin();
    if (again && again.id === slot.id && again.text !== slot.text) ctx.save(owner.name, again);
    return false;
  },
  beforePut: (name, wanted, ctx) => ctx.save(name, wanted),
  slotDetail: (name, login) => `${name} (${emailOf(login as StoredLogin)})`,
  writeSlot(name, login) {
    const wanted = login as StoredLogin;
    writePrivate(credentialsIn(slotDir()), wanted.text);
    const file = stateFile(slotDir());
    writePrivate(file, `${JSON.stringify({ ...(readJson(file) ?? {}), oauthAccount: wanted.account }, null, 2)}\n`);
    if (slotLogin()?.id !== wanted.id) throw new Error(`The slot doesn't hold ${name} after the switch; run it again`);
  },
  refused(p) {
    const slot = slotLogin();
    const known = knownLogin(p);
    return refusedLogin(p.name, slot && known && slot.id === known.id ? slot : known);
  },
  switched: "Conversations open in VS Code and the terminal go on in the new account; type continue in them.",
  signInHint: (name) => `sign in with claude auth login, then: dotagents switch --save ${name}`,
  addHint: (name) => `Save its login: sign in with claude auth login, then run dotagents switch --save ${name}`,
  unknownSlotHint: "The slot holds an account no profile knows: dotagents switch --save <profile>",

  usage: {
    profiles: sideProfiles,
    every: () => LIVE_EVERY_MS,
    forceable: false,
    together: true,
    hasLogin: (p) => liveLogin(p) !== null,
    dryRun: "would ask Anthropic for the usage",
    done: "asked Anthropic for the usage",
    ask: askClaude,
  },

  dueLogins,
  async signIn(due, { run = claudeLogin }, ctx) {
    const before = slotProfile()?.name ?? null;
    try {
      for (const p of due) {
        section(p.name);
        // Into the slot: the profile's own login when it has one, or else the slot's saved first,
        // since the sign-in replaces it.
        await withLoginLock(() => {
          const slot = slotLogin();
          const known = knownLogin(p);
          // Already in the slot: its copy there may be newer than the vault's (Claude Code renews
          // it), so it is saved first, or a sign-in that fails would leave only a spent token.
          if (slot && known && slot.id === known.id) return ctx.save(p.name, slot);
          if (known) return void ctx.switchHere(p.name);
          if (!slot) return;
          const owner = ownerOf(slot.id);
          if (!owner) throw unknownSlot(slot);
          ctx.save(owner.name, slot);
        });
        if (state.dryRun) {
          report("would update", vaultDir(p.name), `sign ${p.name} in with claude auth login`);
          continue;
        }
        const signed = run();
        if (!signed.ok) throw new Error(`claude auth login didn't finish (${signed.detail})`);
        await withLoginLock(() => {
          const slot = slotLogin();
          if (!slot) throw new Error("claude auth login left no login in the slot");
          ctx.accept(p, slot, String(emailOf(slot)), (owner) => {
            // An account no profile knows was signed in just now, by this command: dropping it from
            // the slot loses nothing, and lets the previous account go back.
            if (!owner && !state.dryRun) fs.rmSync(credentialsIn(slotDir()), { force: true });
          });
          ctx.save(p.name, slot);
        });
      }
    } finally {
      // The account that was in the slot goes back, also after a failure; a failure here is said,
      // never put in place of the one that stopped the sign-in.
      if (before && slotProfile()?.name !== before) {
        try {
          section("Slot");
          await withLoginLock(() => ctx.switchHere(before));
        } catch (err) {
          report("failed", slotDir(), `couldn't put ${before} back: ${(err as Error).message}`);
        }
      }
    }
  },

  readUsage: readClaudeUsage,
  readSlots: readClaudeSlots,
  verifyProfile(profile) {
    checkItem(samePath(profile.configDir, defaultConfigDir()), `${profile.name} uses ${displayPath(defaultConfigDir())}`, "move it there with: dotagents install");
  },
  verifyEnvironment() {
    const exported = CREDENTIAL_VARIABLES.filter((v) => process.env[v]);
    if (exported.length) checkWarn(`${exported.join(", ")} set in this shell`, "they sign Claude Code in over the slot's login; unset them");
  },
  verifyLogins,
};

export default claude;
