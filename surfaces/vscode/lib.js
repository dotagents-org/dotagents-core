// What the extension decides without VS Code, so the tests can run it: where the running
// `dotagents start` leaves its address, the status bar's text, the account list, and whether a
// release is newer.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The same folder as core/machine-state.ts' stateDir.
function stateDir(env = process.env, home = os.homedir()) {
  return env.DOTAGENTS_STATE_DIR || path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "dotagents");
}

// The server's address: { port, token, pid }, or null when there is none to read.
function readServer(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, "start.json"), "utf8"));
    return typeof data?.port === "number" && typeof data?.token === "string" && typeof data?.pid === "number" ? data : null;
  } catch {
    return null;
  }
}

const label = (w) => (w.kind === "session" ? "5h" : w.kind === "week" ? "7d" : w.model || "model");

// "5h 79%  7d 38%": the session and the week, two spaces apart (no middle dot, as in the CLI).
function usageText(profile) {
  return profile.windows
    .filter((w) => w.kind !== "model-week")
    .map((w) => `${label(w)} ${w.pct}%`)
    .join("  ");
}

// "3h17m", "4d18h": the time to a reset, short, as in the statusLine.
function shortSpan(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h${String(m % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d${h % 24}h`;
}

// The statusLine of the identity (`dotagents usage --short`), in the status bar, as parts with a
// tone each, since a status bar item has one color: the name in the account's color, each window's
// label dimmed, its 8-cell bar (used in ━ in the level's color, the rest in ─ in the track's) and
// its percentage in the level's color, from 70% on with ↻ and the time to the reset.
// personal  5h ━━━━━━── 79% ↻ 3h17m  7d ━━━───── 38%
const level = (pct) => (pct >= 90 ? "high" : pct >= 70 ? "warn" : "ok");
// The state's dot, as on the avatars: red needs you, amber asks for attention, green is fine,
// blue is asleep; a ring (limit, waiting) is the other state of the same color.
const DOTS = { error: ["circle-filled", "red"], limit: ["target", "red"], waiting: ["target", "amber"], warn: ["circle-filled", "amber"], ok: ["circle-filled", "green"], asleep: ["circle-filled", "blue"] };
function parts(profile, state, now = Date.now()) {
  const out = [{ text: `$(dotagents-accounts) ${profile.name}`, tone: "name" }];
  const dot = DOTS[state];
  if (dot) out.push({ text: `$(${dot[0]})`, tone: dot[1] });
  for (const w of profile.windows.filter((w) => w.kind !== "model-week")) {
    const used = Math.max(0, Math.min(8, Math.round((w.pct / 100) * 8)));
    const tone = level(w.pct);
    const reset = w.pct >= 70 && w.resetsAt ? ` ↻ ${shortSpan(Date.parse(w.resetsAt) - now)}` : "";
    out.push({ text: label(w), tone: "label" });
    if (used) out.push({ text: "━".repeat(used), tone });
    if (used < 8) out.push({ text: "─".repeat(8 - used), tone: "track" });
    out.push({ text: `${w.pct}%${reset}`, tone });
  }
  return out;
}

// The identity's terminal roles, by the theme's kind; the account's color on a dark theme a third
// of the way to white, as in the panel, or a dark one (#376B80) fades into it.
// The dots keep the avatars' colors on both themes.
const DOT_COLORS = { red: "#ee1d36", amber: "#f58a00", green: "#00b84d", blue: "#2f7bf5" };
const TONES = {
  light: { label: "#4d4d4d", track: "#c9c9c9", ok: "#107d32", warn: "#a25204", high: "#d50322", ...DOT_COLORS },
  dark: { label: "#a0a0a0", track: "#454545", ok: "#01ca54", warn: "#fe9911", high: "#fe6367", ...DOT_COLORS },
};
function toneColor(tone, account, dark) {
  if (tone !== "name") return TONES[dark ? "dark" : "light"][tone];
  if (!dark || !/^#[0-9a-f]{6}$/i.test(account || "")) return account || undefined;
  const mix = (i) => Math.round(parseInt(account.slice(i, i + 2), 16) + (255 - parseInt(account.slice(i, i + 2), 16)) / 3).toString(16).padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

// The status bar: the current account, its state's dot and its usage, in parts. No background:
// it would override the parts' colors, and the dot already says what needs you.
function statusFor(data, now = Date.now()) {
  const current = data.profiles.find((p) => p.name === data.current?.profile) || data.profiles[0];
  if (!current) return { text: "$(dotagents-accounts) dotagents", parts: [{ text: "$(dotagents-accounts) dotagents", tone: "name" }], tooltip: "No profile yet: dotagents profile add <name>" };
  const state = data.current?.profile === current.name ? data.current.state : current.avatar;
  const list = parts(current, state, now);
  const lines = data.profiles.map((p) => {
    const sides = Object.keys(data.slots || {}).filter((s) => data.slots[s] === p.name);
    return `**${p.name}**${sides.length ? ` (${sides.join(", ")})` : ""}  ${usageText(p) || p.state.replace(/-/g, " ")}`;
  });
  return { text: list.map((x) => x.text).join(" "), parts: list, color: current.color, tooltip: lines.join("\n\n") };
}

// The accounts to pick from, the current one marked.
function pickItems(data) {
  return data.profiles.map((p) => {
    const sides = Object.keys(data.slots || {}).filter((s) => data.slots[s] === p.name);
    return {
      label: `${p.name === data.current?.profile ? "$(check) " : ""}${p.name}`,
      profile: p.name,
      description: usageText(p),
      detail: sides.length ? `in the slot on ${sides.join(" and ")}` : p.avatar === "error" ? "no login here" : "",
    };
  });
}

// Whether version a (x.y.z) is newer than b.
function newer(a, b) {
  const x = String(a).split(".").map(Number);
  const y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

module.exports = { stateDir, readServer, usageText, statusFor, toneColor, pickItems, newer };
