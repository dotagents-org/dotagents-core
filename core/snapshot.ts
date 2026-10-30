// The usage of every profile in one list, for every surface (the usage command, its JSON, the
// status line, later the visual app): this side's profiles, read from Claude Code's caches, and, when
// install found the other side of the machine (Windows from WSL, WSL from Windows), that side's
// caches too, read only. The same account on both sides shows the newer of the two.

import fs from "node:fs";
import path from "node:path";
import { defaultConfigDir } from "./claude-code.ts";
import { type Peer, type Profile, loadMachine, loadProfiles } from "./machine-state.ts";
import { PALETTE } from "./profiles.ts";
import { type ProfileUsage, profileUsage } from "./usage.ts";

// The profiles of this side; without any, the one in ~/.claude.
function localProfiles(): Profile[] {
  const profiles = loadProfiles();
  return profiles.length ? profiles : [{ name: "claude", color: PALETTE[0], default: true, configDir: defaultConfigDir() }];
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
    return local ? [profileUsage({ ...p, configDir: local }, now, peer.home)] : [];
  });
}

const hasNumbers = (p: ProfileUsage) => (p.state === "ok" || p.state === "stale") && p.fetchedAt !== null;

export function readUsage(now: Date): ProfileUsage[] {
  const list = localProfiles().map((p) => profileUsage(p, now));
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
    return { ...mine, state: twin.state, fetchedAt: twin.fetchedAt, windows: twin.windows, from: peer.name };
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
      windows: p.windows.map((w) => ({ ...w, resetsAt: w.resetsAt?.toISOString() ?? null })),
    })),
  };
}
