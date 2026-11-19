// The switch in place (ADR 0004), the same for every provider: the common order of the steps,
// under one lock across dotagents' processes, with what differs between Claude and Codex left to
// the provider's own steps (core/accounts/providers.ts): the side's slot, a vault per profile and side,
// saving the slot's login back before writing the chosen one, the check after, and the same switch
// on the other side through an adapter. Always manual (ADR 0004). Credentials are copied whole and
// never printed.

import { spawnSync } from "node:child_process";
import { log } from "../machine/log.ts";
import { type Profile, loadMachine, loadProfiles, sideName } from "../machine/machine-state.ts";
import { wslDistroArgs } from "../machine/peer.ts";
import { checkWarn, report, section } from "../output/output.ts";
import { type Login, type Provider, type SwitchContext, type SwitchOptions, providerFor, providers } from "./providers.ts";
import { state } from "../state.ts";
import { recordAccountChange } from "./usage-history.ts";
import { vaultDir, withLoginLock } from "./vault.ts";

// Runs the switch on the other side of the machine, with --here so it doesn't come back.
// changed: whether the other side's slot took the profile, told by its own output (the line that
// says the slot was updated), apart from ok: a switch there can fail after its slot changed (the
// Codex daemon's restart, say), and one that went through may have found it there already.
// expect: the account the profile holds here, which the other side checks its profile of that name
// holds too before it switches.
export type PeerSwitch = (name: string, expect?: string) => { ok: boolean; detail: string; changed?: boolean } | null;

// The report line the other side's switch prints when it wrote its slot: "updated  <slot>  (now x)"
// plain, or with an icon, colors and no parentheses when that side draws for a terminal.
export const slotChanged = (output: string) => /^\s*(?:\S\s+)?updated\s+\S.*\s\(?now /m.test(output.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, ""));

export const peerSwitch: PeerSwitch = (name, expect) => {
  const peer = loadMachine().peer;
  if (!peer) return null;
  // The account the profile holds here goes on the command line, so the other side can refuse its profile
  // of that name when it holds another one. An id it can't be checked by (absent, not plain) is no
  // switch by name alone: refused here, nothing run there.
  if (!expect || !/^[A-Za-z0-9_-]+$/.test(expect)) return { ok: false, detail: `${peer.name}: can't tell which account ${name} holds here, so its profile there isn't switched`, changed: false };
  const check = ` --expect ${expect}`;
  // -i too: a login shell alone skips ~/.bashrc, where nvm puts its Node on the PATH, and the
  // distro's own Node may be too old to run dotagents
  const run =
    process.platform === "win32"
      ? spawnSync("wsl.exe", [...wslDistroArgs(), "-e", "bash", "-lic", `dotagents switch ${name} --here${check}`], { encoding: "utf8", timeout: 60_000, windowsHide: true })
      : spawnSync("powershell.exe", ["-NoProfile", "-Command", `dotagents switch ${name} --here${check}`], { encoding: "utf8", timeout: 60_000, cwd: "/mnt/c" });
  const changed = slotChanged(`${run.stdout ?? ""}`);
  if (run.status === 0) return { ok: true, detail: `${peer.name}: ${name}`, changed };
  log("core", "error", "peer switch", `dotagents switch ${name} --here on ${peer.name}: exit ${run.status}${run.error ? `, ${run.error.message}` : ""}\n${run.stdout ?? ""}${run.stderr ?? ""}`);
  return { ok: false, detail: `${peer.name}: ${peerFailure(`${run.stdout ?? ""}${run.stderr ?? ""}`) || run.error?.message || `exit ${run.status}`}`, changed };
};

// Why the other side's switch failed, in one line: a dotagents older than switch (it doesn't know
// the command or --here) says how to update it; else the error's own line, not Node's trailer.
export function peerFailure(output: string) {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => /Unknown command 'switch'|--here/.test(l))) return "its dotagents doesn't know switch yet; update it there with: dotagents update";
  const error = /^(✗ )?(\S*Error( \[\w+\])?|dotagents): /;
  return (lines.find((l) => error.test(l)) ?? lines.at(-1) ?? "").replace(error, "");
}

// What the switch says when a provider refused a profile's login: the same words for both.
const renewHint = (name: string) => `renew it, on ${sideName()}: dotagents login ${name}`;

// Keeps a login in the profile's vault, or says it is already there.
export function saveToVault(provider: Provider, name: string, login: Login) {
  const dir = vaultDir(name);
  const known = provider.vaultLogin(name);
  // The account too: Claude keeps the seat (seatTier) there, which may change with the same tokens
  const same = known && known.text === login.text && known.id === login.id && JSON.stringify(known.account ?? null) === JSON.stringify(login.account ?? null);
  if (same) return report("ok", dir, `${name}'s login`);
  if (state.dryRun) return report("would update", dir, `${name}'s login`);
  provider.writeVault(name, login);
  report(known ? "updated" : "created", dir, `${name}'s login`);
}

// Puts a profile's login in the slot and says so: the provider writes and checks it, under the
// agent's own lock if it has one.
export function putInSlot(provider: Provider, name: string, login: Login, options: SwitchOptions) {
  section("Slot");
  if (state.dryRun) return report("would update", provider.slotPath(), provider.slotDetail(name, login));
  provider.writeSlot(name, login, options);
  report("updated", provider.slotPath(), `now ${provider.slotDetail(name, login)}`);
  provider.afterSlotWrite?.(name, login, options);
}

// expect: the account the profile must hold here (the other side's switch passes it), refused otherwise.
export type SwitchArgs = SwitchOptions & { name?: string; save?: string; here?: boolean; expect?: string; peer?: PeerSwitch };

// The profile's provider picks the slot: a switch touches only that provider's. A name no profile
// has goes to the first provider, which says there is no such profile.
export async function switchProfile({ name, save, here = false, expect, peer = peerSwitch, ...options }: SwitchArgs) {
  const profile = loadProfiles().find((p) => p.name === (name ?? save));
  const provider = profile ? providerFor(profile) : providers()[0];
  const switched = await withLoginLock(() => switchHere(provider, name, save, options, expect));
  if (!switched || here || state.dryRun) return;
  // The same name may be another account's profile there: it checks the account
  const other = peer(switched.name, switched.account);
  if (!other) return;
  section("Other side");
  report(other.ok ? (other.changed === false ? "ok" : "updated") : "failed", "switch", other.detail);
  // Its slot changed before it failed: the sessions there keep the old account all the same
  if (!other.ok && other.changed) report("updated", "switch", `the other side's slot holds ${switched.name}`);
}

// The switch on this side, under the lock: the profile and login selected, or null after a --save.
export function switchHere(provider: Provider, name: string | undefined, save: string | undefined, options: SwitchOptions = {}, expect?: string): { name: string; account: string } | null {
  options = provider.switchOptions?.(options) ?? options;
  const find = (n: string): Profile => {
    const p = provider.profiles().find((x) => x.name === n);
    if (!p) throw new Error(`There is no ${provider.labels.profile} named ${n}`);
    return p;
  };
  const ctx: SwitchContext = { save: (n, login) => saveToVault(provider, n, login), options };

  // --save: the login now in the slot (after a sign-in) belongs to this profile.
  if (save) {
    const profile = find(save);
    const slot = provider.slot();
    if (!slot) throw new Error(provider.noSlotLogin());
    provider.checkSave?.(slot, save);
    const previous = provider.saved(profile);
    if (!state.dryRun && previous && previous.id !== slot.id) recordAccountChange(save);
    section("Vault");
    saveToVault(provider, save, slot);
    return null;
  }
  if (!name) throw new Error("Usage: dotagents switch <profile> [--here], or dotagents switch --save <profile>");

  const target = find(name);
  const wanted = provider.saved(target);
  if (!wanted) throw new Error(provider.noSavedLogin(name));
  if (expect && wanted.id !== expect) throw new Error(`${name} on ${sideName()} holds another ${provider.labels.account} account than ${name} on the other side; give the profiles of one account the same name on both sides`);
  const slot = provider.slot();
  // Already there: nothing to write.
  if (slot && provider.beforeLeave(slot, wanted, name, ctx)) {
    section("Slot");
    report("ok", provider.slotPath(), `${name} is already in the slot`);
    provider.afterAlready?.(name, slot);
  } else {
    provider.beforePut?.(name, wanted, ctx);
    putInSlot(provider, name, wanted, options);
  }
  if (provider.refused(target)) checkWarn(`${name}'s login was refused by ${provider.labels.company}`, renewHint(name));
  return { name, account: wanted.id };
}
