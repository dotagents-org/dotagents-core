// The usage of every profile in one list, for every surface (the usage command, its JSON, the
// start API): each provider reads its own (core/accounts/providers/), in the providers' order, and this
// module puts them together, with the current account of each and the sides.

import { type Peer, sideName, sidePeer } from "../machine-state.ts";
import { peerUp } from "../peer.ts";
import { providers } from "./providers.ts";
import { peerRunningLater } from "../sessions.ts";
import { AVATAR_STATES, type AvatarState, type ProfileUsage, avatarState, avatarWorking, elapsedPct, pace } from "./usage.ts";

// How a reader that runs for a long time (the start server, every 2 s) looks at the other side:
// whether it is up, and which of its sessions run. Both run a command there and may answer later
// (a promise): the last answer stands until the new one comes, so a read never waits. The tests
// pass fakes.
export type PeerView = { up: (peer: Peer) => boolean; running?: (peer: Peer) => Set<string> | null };

// Short, since a side that stopped meanwhile would be read, and started, until the next answer.
const UP_EVERY_MS = 5_000;
const RUNNING_EVERY_MS = 15_000;

type Later<T> = (peer: Peer) => T | Promise<T>;

// Asks at most every everyMs, one question at a time; keep decides whether an answer replaces the last.
function lastAnswer<T>(ask: Later<T>, everyMs: number, first: T, now: () => number, keep: (value: T) => boolean = () => true) {
  let at = -Infinity;
  let value = first;
  let asking = false;
  return (peer: Peer): T => {
    if (now() - at < everyMs || asking) return value;
    at = now();
    const answer = ask(peer);
    if (!(answer instanceof Promise)) {
      if (keep(answer)) value = answer;
      return value;
    }
    asking = true;
    answer.then((v) => keep(v) && (value = v)).catch(() => {}).finally(() => (asking = false));
    return value;
  };
}

// Running sessions are asked of the other side only after checking, right then, that it is still
// up: wsl.exe -e would start a stopped distro.
const runningIfUp: Later<Set<string> | null> = async (peer) => ((await peerUp(peer)) ? peerRunningLater() : null);

export function watchPeer({ up = peerUp, running = runningIfUp, now = Date.now }: { up?: Later<boolean>; running?: Later<Set<string> | null>; now?: () => number } = {}): PeerView {
  return {
    up: lastAnswer(up, UP_EVERY_MS, false, now),
    // A side that couldn't answer keeps its last known sessions.
    running: lastAnswer(running, RUNNING_EVERY_MS, null, now, (v) => v !== null),
  };
}

// The current account: the one in a slot, in the worst state (the same one on both sides
// after a switch, else the worse of the two); with no account in a slot, the brand in the worst
// state of all.
export function currentFor(list: ProfileUsage[], slots: Record<string, string>, now: Date): { profile: string; state: AvatarState } {
  const rank = (p: ProfileUsage) => AVATAR_STATES.indexOf(avatarState(p, now));
  const current = list.filter((p) => Object.values(slots).includes(p.name));
  const worst = (from: ProfileUsage[]) => from.reduce<ProfileUsage | null>((w, p) => (!w || rank(p) < rank(w) ? p : w), null);
  const pick = worst(current);
  if (pick) return { profile: pick.name, state: avatarState(pick, now) };
  const any = worst(list);
  return { profile: "dotagents", state: any ? avatarState(any, now) : "asleep" };
}

// A window's projection as JSON: { atResetPct, runsOutAt? }, { from } or null.
const projection = (p: ReturnType<typeof pace>) =>
  p === null ? null : "from" in p ? { from: p.from.toISOString() } : { atResetPct: p.atResetPct, ...(p.runsOutAt ? { runsOutAt: p.runsOutAt.toISOString() } : {}) };

// What `usage --json` prints: a format version, when it was read, and each profile without its
// account id. Fields are only added, so scripts that read it keep working.
export function usageJson(list: ProfileUsage[], now: Date) {
  return {
    version: 1 as const,
    generatedAt: now.toISOString(),
    profiles: list.map(({ accountUuid, ...p }) => ({
      ...p,
      plan: p.plan ?? null,
      fetchedAt: p.fetchedAt?.toISOString() ?? null,
      avatar: avatarState(p, now),
      working: avatarWorking(p),
      windows: p.windows.map((w) => ({ ...w, resetsAt: w.resetsAt?.toISOString() ?? null, elapsedPct: elapsedPct(w, now), projection: projection(p.state === "ok" ? pace(w, now) : null) })),
    })),
  };
}

// Each provider's profiles, as it read them, each one marked with its provider.
const readEach = (now: Date, view?: PeerView) => providers().map((p) => ({ provider: p, list: p.readUsage(now, view).map((u) => ({ ...u, provider: p.id })) }));

// The usage command's list: every provider's profiles, in the providers' order. A profile names its
// provider once a provider after the first (Claude) has profiles.
export function readAll(now: Date, view?: PeerView): ProfileUsage[] {
  const each = readEach(now, view);
  const list = each.flatMap((e) => e.list);
  return each.slice(1).some((e) => e.list.length) ? list : list.map(({ provider, ...u }) => u);
}

// What the start API answers (docs/start-api.md, apiVersion 2), all in one place so a test reads it
// whole: the usage JSON of every profile, in the providers' order, the profile in each side's slot
// per provider, and the current one of each provider that has profiles.
export function startAnswer(now: Date, view?: PeerView) {
  const each = readEach(now, view);
  const slots = Object.fromEntries(each.map((e) => [e.provider.id, e.provider.readSlots(e.list, view)]));
  const current = Object.fromEntries(each.filter((e) => e.list.length).map((e) => [e.provider.id, currentFor(e.list, slots[e.provider.id], now)]));
  const json = { ...usageJson(each.flatMap((e) => e.list), now), slots, current };
  const peer = sidePeer();
  // The sides, in the accounts tab's order: this one, then the other.
  return { ...json, sides: peer ? [sideName(), peer.name] : [sideName()], ...(peer ? { peer: { name: peer.name, up: view ? view.up(peer) : true } } : {}) } as typeof json & { sides: string[]; peer?: { name: string; up: boolean } };
}
