// The usage of every profile in one list, for every surface (the usage command, its JSON, the
// status line, later the visual app): this side's profiles, read from Claude Code's caches and from
// what core/live.ts asked of Anthropic, the newer of the two, and, when install found the other side
// of the machine (Windows from WSL, WSL from Windows), that side's too, read only. The same account
// on both sides shows the newer of the two.

import fs from "node:fs";
import path from "node:path";
import { sessionActivity } from "./claude-code.ts";
import { liveUsage, sideProfiles } from "./live.ts";
import { type Peer, type Profile, loadMachine } from "./machine-state.ts";
import { PALETTE } from "./profiles.ts";
import { liveLogin } from "./switch.ts";
import { type ProfileUsage, STALE_MS, elapsedPct, normalize, profileUsage } from "./usage.ts";

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
    if (Array.isArray(data?.profiles) && data.profiles.length) profiles = data.profiles;
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

export function readUsage(now: Date): ProfileUsage[] {
  const list = sideProfiles().map((p) => localUsage(p, now));
  let peer: Peer | undefined;
  try {
    peer = loadMachine().peer;
  } catch {
    peer = undefined;
  }
  if (!peer) return list;
  const others = peerUsage(peer, now).filter(hasNumbers);
  return list.map((mine) => {
    const twin = others.find((o) => o.accountUuid && o.accountUuid === mine.accountUuid);
    if (!twin || (hasNumbers(mine) && mine.fetchedAt!.getTime() >= twin.fetchedAt!.getTime())) return mine;
    return { ...mine, state: twin.state, fetchedAt: twin.fetchedAt, windows: twin.windows, source: twin.source, from: peer.name };
  });
}

// What `usage --json` prints: a format version, when it was read, and each profile without its
// account id. Fields are only added, so scripts that read it keep working.
export function usageJson(list: ProfileUsage[], now: Date) {
  return {
    version: 1 as const,
    generatedAt: now.toISOString(),
    profiles: list.map(({ accountUuid, ...p }) => ({
      ...p,
      fetchedAt: p.fetchedAt?.toISOString() ?? null,
      windows: p.windows.map((w) => ({ ...w, resetsAt: w.resetsAt?.toISOString() ?? null, elapsedPct: elapsedPct(w, now) })),
    })),
  };
}
