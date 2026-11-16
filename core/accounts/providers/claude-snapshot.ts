// What the Claude side of the usage snapshot reads (core/accounts/snapshot.ts puts the providers together):
// this side's profiles, read from Claude Code's caches and from what core/accounts/providers/claude-usage.ts
// asked of Anthropic, the newer of the two, and, when install found the other side of the machine
// (Windows from WSL, WSL from Windows), that side's too, read only. The same account on both sides
// shows the newer of the two.

import fs from "node:fs";
import path from "node:path";
import { type Activity, sessionActivity } from "../../claude-code.ts";
import { PALETTE, type Peer, type Profile, sideName, sidePeer } from "../../machine-state.ts";
import type { PeerView } from "../snapshot.ts";
import { type ProfileUsage, STALE_MS, normalize, profileUsage } from "../usage.ts";
import { liveUsage, sideProfiles } from "./claude-usage.ts";
import { liveLogin, profilePlan, slotProfile } from "./claude-store.ts";

// The live record joined to what the cache gave: it wins when it is about the profile's account
// (accountUuid) and newer. Its last error comes along either way.
function withLive(mine: ProfileUsage, live: ReturnType<typeof liveUsage>, accountUuid: string | undefined, now: Date): ProfileUsage {
  const withError = live.error ? { ...mine, error: live.error } : mine;
  const usage = live.cache && normalize(live.cache, now);
  if (!usage || !accountUuid || usage.accountUuid !== accountUuid) return withError;
  if (hasNumbers(mine) && mine.accountUuid === accountUuid && mine.fetchedAt!.getTime() >= usage.fetchedAt.getTime()) return withError;
  const stale = now.getTime() - usage.fetchedAt.getTime() > STALE_MS;
  return { ...withError, accountUuid, state: stale ? "stale" : "ok", fetchedAt: usage.fetchedAt, windows: usage.windows, source: "live" };
}

// A profile of this side: its folder's cache, set aside when it belongs to another account than the
// profile's login (in the switch in place the slot holds whichever account was switched to), then
// the live record and the running sessions.
function localUsage(p: Profile, now: Date): ProfileUsage {
  let mine = profileUsage(p, now);
  const login = liveLogin(p);
  if (login && mine.accountUuid && mine.accountUuid !== login.accountUuid)
    mine = { ...mine, accountUuid: login.accountUuid, state: "other-account", fetchedAt: null, windows: [] };
  mine = withLive(mine, liveUsage(p.name), login?.accountUuid ?? mine.accountUuid, now);
  if (mine.state === "not-signed-in" && login && !hasNumbers(mine)) mine = { ...mine, accountUuid: login.accountUuid, state: "no-data" };
  const plan = profilePlan(p);
  if (plan) mine = { ...mine, plan };
  return login?.configDir ? { ...mine, activity: sessionActivity(login.configDir) } : mine;
}

// A path the other side wrote (C:\Users\me\.claude-x), as this side reaches it
// (/mnt/c/Users/me/.claude-x); null when it isn't under that side's home.
function translate(native: string, peer: Peer) {
  const norm = (p: string) => p.replace(/[\\/]+$/, "");
  const home = norm(peer.nativeHome);
  const windowsLike = /^[a-z]:\\/i.test(home);
  const inside = windowsLike ? native.toLowerCase().startsWith(home.toLowerCase()) : native.startsWith(home);
  if (!inside) return null;
  const rest = native.slice(home.length).split(/[\\/]+/).filter(Boolean);
  return path.join(peer.home, ...rest);
}

// The other side's profiles, as this side reaches their folders; nothing when they can't be read.
function peerUsage(peer: Peer, now: Date): ProfileUsage[] {
  let profiles: Profile[] = [{ name: "claude", color: PALETTE[0], default: true, configDir: path.join(peer.nativeHome, ".claude") }];
  try {
    const data = JSON.parse(fs.readFileSync(path.join(peer.home, ".config", "dotagents", "profiles.json"), "utf8"));
    const claude = Array.isArray(data?.profiles) ? data.profiles.filter((p: Profile) => (p?.provider ?? "claude") === "claude") : [];
    if (claude.length) profiles = claude;
  } catch {
    // No dotagents there yet, or nothing to read: only its default folder.
  }
  return profiles.flatMap((p) => {
    const local = typeof p?.configDir === "string" ? translate(p.configDir, peer) : null;
    if (!local) return [];
    const mine = profileUsage({ ...p, configDir: local }, now, peer.home);
    const live = typeof p?.name === "string" ? liveUsage(p.name, path.join(peer.home, ".config", "dotagents")) : { cache: null, error: null };
    return [withLive(mine, live, live.cache?.accountUuid ?? mine.accountUuid, now)];
  });
}

const hasNumbers = (p: ProfileUsage) => (p.state === "ok" || p.state === "stale") && p.fetchedAt !== null;

// The other side's running sessions, for the account in its slot: every profile there uses its
// ~/.claude. Whether a session still runs can't be told from here (its pid is the other
// side's), so live holds the session ids that side says are running.
function peerActivity(peer: Peer, running: (peer: Peer) => Set<string> | null): { accountUuid: string; activity: Activity } | null {
  let accountUuid: unknown;
  let names: string[];
  try {
    accountUuid = JSON.parse(fs.readFileSync(path.join(peer.home, ".claude.json"), "utf8"))?.oauthAccount?.accountUuid;
    names = fs.readdirSync(path.join(peer.home, ".claude", "sessions")).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return null;
  }
  if (typeof accountUuid !== "string") return null;
  const busy: { id: string; status: string }[] = [];
  for (const name of names.slice(0, 256)) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(peer.home, ".claude", "sessions", name), "utf8"));
      if (typeof s?.sessionId === "string" && (s.status === "busy" || s.status === "waiting")) busy.push({ id: s.sessionId, status: s.status });
    } catch {
      // Being rewritten, or not one: skipped.
    }
  }
  const activity = { working: 0, waiting: 0 };
  // Nothing looks alive there: the other side isn't asked at all, so an idle WSL can shut down.
  const live = busy.length ? running(peer) : null;
  for (const s of busy) if (live?.has(s.id)) s.status === "busy" ? activity.working++ : activity.waiting++;
  return { accountUuid, activity };
}

// view: how to look at the other side; without it, it is read whenever known, and its sessions
// aren't counted (the usage command doesn't wait on the other side).
export function readClaudeUsage(now: Date, view?: PeerView): ProfileUsage[] {
  // The account in use first: the one in this side's slot; the others after, in their order.
  const current = slotProfile()?.name;
  const list = sideProfiles()
    .map((p) => localUsage(p, now))
    .sort((a, b) => Number(b.name === current) - Number(a.name === current));
  const peer = sidePeer();
  if (!peer || (view && !view.up(peer))) return list;
  const others = peerUsage(peer, now).filter(hasNumbers);
  const there = view?.running ? peerActivity(peer, view.running) : null;
  return list.map((mine) => {
    const twin = others.find((o) => o.accountUuid && o.accountUuid === mine.accountUuid);
    let out = mine;
    if (twin && !(hasNumbers(mine) && mine.fetchedAt!.getTime() >= twin.fetchedAt!.getTime()))
      out = { ...mine, state: twin.state, fetchedAt: twin.fetchedAt, windows: twin.windows, source: twin.source, from: peer.name };
    if (there && there.accountUuid === mine.accountUuid) {
      const here = out.activity ?? { working: 0, waiting: 0 };
      out = { ...out, activity: { working: here.working + there.activity.working, waiting: here.waiting + there.activity.waiting } };
    }
    return out;
  });
}

// Which profile is in each side's slot: { "WSL": "work", "Windows": "personal" }. The other side
// only while it is up (view), and only for an account this list knows.
export function readClaudeSlots(list: ProfileUsage[], view?: PeerView): Record<string, string> {
  const slots: Record<string, string> = {};
  const here = slotProfile()?.name;
  if (here) slots[sideName()] = here;
  const peer = sidePeer();
  if (!peer || (view && !view.up(peer))) return slots;
  try {
    const uuid = JSON.parse(fs.readFileSync(path.join(peer.home, ".claude.json"), "utf8"))?.oauthAccount?.accountUuid;
    const there = list.find((p) => p.accountUuid && p.accountUuid === uuid)?.name;
    if (there) slots[peer.name] = there;
  } catch {
    // Nothing signed in there, or nothing to read.
  }
  return slots;
}
