// The providers dotagents holds accounts for: Claude (Claude Code) and ChatGPT (Codex). One shape
// for what differs between them, so the rest of the core asks providerFor(profile) and calls it,
// and never branches on which provider a profile has. Each provider is a file in core/accounts/providers/.
//
// The list at the bottom is the switch: a provider left out of it is off everywhere (its profiles
// refused, nothing of it in install, the checks, the usage or the API), with no other file touched.
//
// The arrows of the core point one way, and nothing runs in a circle: surfaces, then the common
// coordination (switch, login, usage-refresh, snapshot, profiles), then this list,
// then each provider's files, then the storage and utilities they share (vault, usage-record,
// machine-state, output). This file's types, and provider-labels, import no provider.

import type { DesktopApp } from "../desktop.ts";
import { type Profile, type ProviderId, loadProfiles } from "../machine-state.ts";
import type { Labels } from "./provider-labels.ts";
import type { Fetcher } from "./providers/claude-usage.ts";
import claude from "./providers/claude.ts";
import type { SpawnAppServer } from "./providers/codex-usage.ts";
import codex from "./providers/codex.ts";
import type { PeerView } from "./snapshot.ts";
import type { ProfileUsage } from "./usage.ts";

// What the rest of the core reads of Claude alone: the account behind a login (sessions, usage --spend)
// and the live usage's pace (start).
export { profileAccount } from "./providers/claude-store.ts";
export { ASK_EVERY_MS } from "./usage-record.ts";

// A login as a provider keeps it: text is the file as the agent wrote it, never printed. id is the
// account's own (Claude's accountUuid, the ChatGPT user); the other fields are what only one
// provider reads: account is Claude's oauthAccount block (its second file), grant and refreshed
// are Codex's sign-in and its last renewal.
export type Login = {
  id: string;
  email: string;
  plan: string | null;
  text: string;
  file: string;
  account?: Record<string, unknown>;
  grant?: string | null;
  refreshed?: number | null;
};

// Who a saved login is, for lists and for telling two profiles' accounts apart. shown: the email,
// or what stands in for it. plan and seat: the ids the provider gives ("team", "team_standard"),
// named for people by the labels' plan.
export type Account = { id: string; email: string; plan: string | null; seat?: string | null; shown: string };

// What the tests reach into the switch and the sign-in with: Claude's moment between saving the
// slot and replacing it, and Codex's lock, daemon and sign-in command.
export type SwitchOptions = { afterSave?: () => void; codex?: { commit?: (tmp: string, dest: string, expectedDigest?: string | null) => void; expectedDigest?: string | null; daemon?: () => string | null } };
export type SignInOptions = { now?: Date; run?: () => { ok: boolean; detail: string }; codex?: { run?: (home: string) => { ok: boolean; detail: string }; commit?: (tmp: string, dest: string, expectedDigest?: string | null) => void; expectedDigest?: string | null; daemon?: () => string | null; lock?: <T>(fn: () => T) => Promise<T> } };

// What the common coordination hands a provider's switch steps: the vault save with its reports,
// and the options.
export type SwitchContext = { save: (name: string, login: Login) => void; options: SwitchOptions };

// What the common sign-in hands a provider: the check that a fresh login is the profile's account,
// the vault save and the slot write (under the lock the caller already holds), and the switch on
// this side.
export type SignInContext = { accept: (profile: Profile, fresh: Login, who: string, onMismatch?: (owner: Profile | null) => void) => void; save: (name: string, login: Login) => void; put: (name: string, login: Login) => void; switchHere: (name: string) => string | null };

// What the usage refresh may be given: Claude's network, Codex's app-server, the clock, a forced ask.
export type UsageOptions = { fetcher?: Fetcher; spawnIt?: SpawnAppServer; now?: () => number; force?: boolean; timeoutMs?: number };

// One ask of a provider's usage: the record to keep (afterWrite: what to do once it is written), or why it failed (refusedMark: the mark of the
// login the company turned down; retryAfter: ms the company asked to wait).
export type Asked = { ok: true; record: Record<string, unknown>; afterWrite?: () => void } | { ok: false; error: string; refusedMark?: string | null; retryAfter?: number; discard?: boolean };

export type Provider = {
  id: ProviderId;
  labels: Labels;
  // The agent's command, the shape of the line its --version prints, and how to install it when a
  // side lacks it (doctor).
  cli: { command: string; version: RegExp; install: string };
  // The agent's config folder: the slot is in it.
  configDir: () => string;
  // Each profile's Desktop app on Windows (core/desktop.ts): Claude Desktop, or the ChatGPT app.
  desktop: DesktopApp;
  // What adding one of its profiles applies besides that app: Claude's global configuration.
  configure?: (repo: string) => void;
  // The profiles of this provider on this machine.
  profiles: () => Profile[];
  // The record of a new profile; throws for an option the provider has no use for.
  profileRecord: (args: { name: string; color: string; isDefault: boolean; prior: Profile | undefined; all: Profile[] }) => Profile;

  // ── The slot and the vault ──
  // The account of a profile's saved login, or null.
  account: (p: Profile) => Account | null;
  // The login in this side's slot, the profile whose account it is, and where it is.
  slot: () => Login | null;
  slotProfile: () => Profile | null;
  slotPath: () => string;
  // A profile's saved login (the vault's, or the one of the model before the vault), and the vault's alone.
  saved: (p: Profile) => Login | null;
  vaultLogin: (name: string) => Login | null;
  ownerOf: (id: string) => Profile | null;
  writeVault: (name: string, login: Login) => void;

  // ── The switch, step by step; the common coordination orders them ──
  switchOptions?: (options: SwitchOptions) => SwitchOptions;
  noSlotLogin: () => string;
  noSavedLogin: (name: string) => string;
  // --save: whether this login may be kept as that profile's.
  checkSave?: (slot: Login, save: string) => void;
  // The slot holds a login: look after it before it is replaced (Claude saves it back, Codex only
  // when it provably is the newer one) and say whether the profile wanted is already there.
  beforeLeave: (slot: Login, wanted: Login, name: string, ctx: SwitchContext) => boolean;
  // Before the slot is written, with or without a login in it.
  beforePut?: (name: string, wanted: Login, ctx: SwitchContext) => void;
  slotDetail: (name: string, login: Login) => string;
  // Puts the login in the slot, under the agent's own lock if it has one, and checks it.
  writeSlot: (name: string, login: Login, options: SwitchOptions) => void;
  // After a write (Codex: remembers what it put there and restarts the daemon), and after finding
  // the profile already in the slot (the first only).
  afterSlotWrite?: (name: string, login: Login, options: SwitchOptions) => void;
  afterAlready?: (name: string, slot: Login) => void;
  // Whether the company refused this profile's login.
  refused: (p: Profile) => boolean;
  // What the switch command says when it is done, and the line for a profile just added.
  switched: string;
  addHint: (name: string) => string;
  // What to do for a profile with no saved login, in the checklist.
  signInHint: (name: string) => string;
  // A line for the switch listing when the slot holds an account no profile knows.
  unknownSlotHint?: string;

  // ── Signing in again ──
  // The profiles whose login needs it soon (login --all); only a provider that can do that has it.
  dueLogins?: (now: Date) => Profile[];
  // Signs the profiles in, one after the other.
  signIn: (profiles: Profile[], options: SignInOptions, ctx: SignInContext) => Promise<void>;

  // ── Usage ──
  // How a provider's usage is asked of its company, and kept in <state>/usage/<profile>.json; the
  // pacing, the backoff and the writing are common (core/accounts/usage-refresh.ts).
  usage: {
    // The profiles to refresh.
    profiles: () => Profile[];
    // The least time between two asks of a profile, and whether a forced refresh skips it.
    every: (p: Profile) => number;
    forceable: boolean;
    // Whether the profiles are asked together, or one at a time (each takes the login lock).
    together: boolean;
    locked?: boolean;
    hasLogin: (p: Profile) => boolean;
    dryRun: string;
    done: string;
    ask: (p: Profile, options: UsageOptions) => Promise<Asked>;
  };
  // What was read of the usage of its profiles, for the lists (the one in this side's slot first),
  // and the profile in each side's slot; the other side only while view says it is up.
  readUsage: (now: Date, view?: PeerView) => ProfileUsage[];
  readSlots: (list: ProfileUsage[], view?: PeerView) => Record<string, string>;

  // ── Checks ──
  // The provider's part of the profiles checklist, after every account has been compared.
  verifyProfiles?: () => void;
  verifyEnvironment?: () => void;
  // The Logins section: the expiry of each saved login, on each side.
  verifyLogins?: (now: Date) => void;
  // What install writes for it, and the checklist of that.
  install?: (repo: string) => void;
  verifyConfig?: (repo: string) => void;
  // The profile record to check about its folder.
  verifyProfile?: (p: Profile) => void;
};

// Every provider, in the order the lists show them.
const PROVIDERS: Provider[] = [claude, codex];

export const providers = () => PROVIDERS;

// The provider of an id, or an error that says which are on.
export function providerById(id: string): Provider {
  const found = PROVIDERS.find((p) => p.id === id);
  if (!found) throw new Error(`'${id}' is not a provider: use ${PROVIDERS.map((p) => p.id).join(" or ")}`);
  return found;
}

// The provider that holds a profile's account; a profile of a provider that is off is refused.
export function providerFor(p: Profile): Provider {
  const id = p.provider ?? "claude";
  const found = PROVIDERS.find((x) => x.id === id);
  if (!found) throw new Error(`${p.name} is a ${id} profile, and ${id} accounts are turned off in this dotagents`);
  return found;
}

// Every profile whose provider is on: what the lists and the loops over profiles use.
export const activeProfiles = (): Profile[] => loadProfiles().filter((p) => PROVIDERS.some((x) => x.id === (p.provider ?? "claude")));

// The profiles as the listings show them, like usage: by provider, in the providers' order, and
// within each the one in this side's slot first, the rest in the order of profiles.json.
export function listedProfiles(): Profile[] {
  const inSlot = PROVIDERS.map((p) => p.slotProfile()?.name);
  const rank = (p: Profile) => PROVIDERS.indexOf(providerFor(p)) * 2 + (inSlot.includes(p.name) ? 0 : 1);
  return activeProfiles().map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(({ p }) => p);
}

// What install writes for each provider that has something to write, and the checklist of it.
export const installProviders = (repo: string) => PROVIDERS.forEach((p) => p.install?.(repo));
export const verifyProviderConfigs = (repo: string) => PROVIDERS.forEach((p) => p.verifyConfig?.(repo));
