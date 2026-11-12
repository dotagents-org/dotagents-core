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

// The status bar: the current account and its usage, and how loud to say it. error and limit stop
// the account; waiting and warn ask for attention.
function statusFor(data) {
  const current = data.profiles.find((p) => p.name === data.current?.profile) || data.profiles[0];
  if (!current) return { text: "$(account) dotagents", tooltip: "No profile yet: dotagents profile add <name>", severity: "none" };
  const state = data.current?.profile === current.name ? data.current.state : current.avatar;
  const severity = state === "error" || state === "limit" ? "error" : state === "waiting" || state === "warn" ? "warning" : "none";
  const usage = usageText(current);
  const lines = data.profiles.map((p) => {
    const sides = Object.keys(data.slots || {}).filter((s) => data.slots[s] === p.name);
    return `**${p.name}**${sides.length ? ` (${sides.join(", ")})` : ""}  ${usageText(p) || p.state.replace(/-/g, " ")}`;
  });
  return { text: `$(account) ${current.name}${usage ? ` ${usage}` : ""}`, tooltip: lines.join("\n\n"), severity };
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

module.exports = { stateDir, readServer, usageText, statusFor, pickItems, newer };
