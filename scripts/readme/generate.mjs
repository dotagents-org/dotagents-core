// Generates the README's diagrams into assets/readme/, each in a light and a dark version (the
// README picks one with <picture>). The avatars' pictures live with the avatars, in dotagents-sidebar.
//   node scripts/readme/generate.mjs
// GitHub shows these through <img>, so they carry no web fonts and no scripts; the motion is SMIL.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");
const OUT = path.join(ASSETS, "readme");
fs.mkdirSync(OUT, { recursive: true });

// The identity's roles, light and dark.
const THEMES = {
  light: { text: "#171717", muted: "#666666", card: "#ffffff", line: "#e3e3e3", group: "#fafafa", arrow: "#a1a1a1", pill: "#171717", pillText: "#ffffff", shadow: "#000000", shadowOpacity: 0.06, turing: "#D77655", lovelace: "#376B80" },
  dark: { text: "#ededed", muted: "#a0a0a0", card: "#111111", line: "#2b2b2b", group: "#0a0a0a", arrow: "#6b6b6b", pill: "#ededed", pillText: "#0a0a0a", shadow: "#000000", shadowOpacity: 0.5, turing: "#e39478", lovelace: "#6fa3b8" },
};
const FONT = `ui-monospace, 'Geist Mono', SFMono-Regular, Menlo, Consolas, monospace`;
const CHAR = 0.6; // a monospace character's width, in em

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const width = (text, size) => text.length * size * CHAR;

// --- Building blocks ---------------------------------------------------------------------------
function frame(w, h, t, body, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" font-family="${FONT}">
<defs>
<filter id="shadow" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="${t.shadow}" flood-opacity="${t.shadowOpacity}"/></filter>
<marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="${t.arrow}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>
</defs>
${body}
</svg>
`;
}

// A card: a title and a few lines; accent paints a strip on the left.
function card(t, { x, y, w, h, title, lines = [], accent, icon }) {
  const left = x + (icon ? 52 : 16);
  let s = `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${t.card}" stroke="${t.line}"/></g>`;
  if (accent) s += `<rect x="${x}" y="${y + 12}" width="3" height="${h - 24}" rx="1.5" fill="${accent}"/>`;
  if (icon) s += `<svg x="${x + 12}" y="${y + h / 2 - 16}" width="32" height="32" viewBox="-6 -6 112 112" overflow="visible">${icon}</svg>`;
  const top = y + h / 2 - ((lines.length + 1) * 18) / 2 + 13;
  s += `<text x="${left}" y="${top}" font-size="14" font-weight="700" fill="${t.text}">${esc(title)}</text>`;
  lines.forEach((l, i) => (s += `<text x="${left}" y="${top + 19 * (i + 1)}" font-size="12" fill="${t.muted}">${esc(l)}</text>`));
  return s;
}

// A group: a soft dashed frame with its name on top.
function group(t, { x, y, w, h, label }) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${t.group}" stroke="${t.line}" stroke-dasharray="4 4"/><text x="${x + 16}" y="${y + 22}" font-size="11" letter-spacing="1" fill="${t.muted}">${esc(label.toUpperCase())}</text>`;
}

// A command, in a pill centered on (cx, cy).
function pill(t, cx, cy, text, { fill = t.pill, color = t.pillText } = {}) {
  const w = width(text, 12) + 20;
  return `<rect x="${cx - w / 2}" y="${cy - 12}" width="${w}" height="24" rx="12" fill="${fill}"/><text x="${cx}" y="${cy + 4}" font-size="12" font-weight="600" text-anchor="middle" fill="${color}">${esc(text)}</text>`;
}

// A plain label on an arrow.
function note(t, cx, cy, text, anchor = "middle") {
  return `<text x="${cx}" y="${cy}" font-size="11" text-anchor="${anchor}" fill="${t.muted}">${esc(text)}</text>`;
}

// An arrow from (x1, y1) to (x2, y2): straight, or bent with a smooth curve.
function arrow(t, x1, y1, x2, y2, { bend = "h", dashed = false } = {}) {
  let d;
  if (x1 === x2 || y1 === y2) d = `M${x1} ${y1}L${x2} ${y2}`;
  else if (bend === "h") {
    const mx = (x1 + x2) / 2;
    d = `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
  } else if (bend === "corner") {
    d = `M${x1} ${y1}C${x2} ${y1} ${x2} ${y1} ${x2} ${y2}`;
  } else {
    const my = (y1 + y2) / 2;
    d = `M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
  }
  return `<path d="${d}" fill="none" stroke="${t.arrow}" stroke-width="1.6"${dashed ? ` stroke-dasharray="5 5"` : ""} marker-end="url(#head)"/>`;
}

// A question: a rounded diamond-ish pill with a border.
function question(t, { cx, cy, text }) {
  const w = width(text, 13) + 36;
  return `<g filter="url(#shadow)"><rect x="${cx - w / 2}" y="${cy - 22}" width="${w}" height="44" rx="22" fill="${t.card}" stroke="${t.text}" stroke-width="1.4"/></g><text x="${cx}" y="${cy + 5}" font-size="13" font-weight="700" text-anchor="middle" fill="${t.text}">${esc(text)}</text>`;
}

// On the dark background the brand's near-black body would vanish: there it is lifted a little.
function write(name, make) {
  for (const [theme, t] of Object.entries(THEMES)) {
    const svg = make(t);
    fs.writeFileSync(path.join(OUT, `${name}-${theme}.svg`), theme === "dark" ? svg.replace(/fill="#171717"/g, 'fill="#2e2e2e"') : svg);
  }
}

// --- How it works ------------------------------------------------------------------------------
write("how-it-works", (t) => {
  let b = group(t, { x: 0, y: 0, w: 330, h: 300, label: "your dotagents clone" });
  b += card(t, { x: 20, y: 40, w: 290, h: 110, title: "config/", lines: ["your configuration:", "instructions, rules, settings,", "skills, the Desktop icons"], accent: t.turing });
  b += card(t, { x: 20, y: 170, w: 290, h: 110, title: "standards/ + templates/", lines: ["how a workspace looks:", "AGENTS.md, .agents/,", ".artifacts/"], accent: t.lovelace });
  b += card(t, { x: 560, y: 40, w: 300, h: 110, title: "~/.claude", lines: ["every profile on the machine:", "CLAUDE.md, rules/,", "settings.json"] });
  b += card(t, { x: 560, y: 170, w: 300, h: 110, title: "app-workspace/", lines: ["AGENTS.md, .agents/skills/,", ".artifacts/, and app/:", "the project's clone, untouched"] });
  b += arrow(t, 310, 95, 556, 95) + pill(t, 433, 95, "dotagents install");
  b += arrow(t, 310, 225, 556, 225) + pill(t, 433, 225, "dotagents new, init");
  return frame(860, 300, t, b, "How it works: your clone's config goes to ~/.claude with dotagents install, and to a workspace with dotagents new or init");
});

// --- Inside a workspace ------------------------------------------------------------------------
write("workspace-skills", (t) => {
  let b = card(t, { x: 0, y: 95, w: 150, h: 70, title: "Claude Code", lines: ["reads"] });
  b += card(t, { x: 210, y: 95, w: 170, h: 70, title: ".claude/skills", lines: ["a link"] });
  b += card(t, { x: 440, y: 95, w: 170, h: 70, title: ".agents/skills/", lines: ["one per skill"] });
  b += card(t, { x: 690, y: 10, w: 290, h: 100, title: "session-archive/", lines: ["a link to config/skills/", "in your clone: an edit is", "live everywhere at once"], accent: t.turing });
  b += card(t, { x: 690, y: 150, w: 290, h: 100, title: "humanizer/", lines: ["a third-party skill:", "an installed copy, pinned", "in skills-lock.json"], accent: t.lovelace });
  b += arrow(t, 150, 130, 206, 130) + arrow(t, 380, 130, 436, 130);
  b += arrow(t, 610, 120, 686, 60) + note(t, 682, 40, "your own", "end");
  b += arrow(t, 610, 140, 686, 200) + note(t, 682, 228, "npx skills", "end");
  return frame(980, 260, t, b, "Inside a workspace: Claude Code reads .claude/skills, a link to .agents/skills/, where your skills link to your clone and third-party ones are pinned copies");
});

// --- Keeping the project's git clean -----------------------------------------------------------
write("git-clean", (t) => {
  let b = pill(t, 430, 20, "dotagents init <folder>");
  b += arrow(t, 430, 32, 430, 62);
  b += question(t, { cx: 430, cy: 88, text: "a git repository?" });
  b += card(t, { x: 0, y: 150, w: 260, h: 80, title: "applied in place", lines: ["the standards go into", "the folder itself"] });
  b += arrow(t, 346, 88, 130, 146, { bend: "corner" }) + note(t, 238, 80, "no");
  b += question(t, { cx: 600, cy: 190, text: "move it into a workspace?" });
  b += arrow(t, 514, 88, 600, 164, { bend: "corner" }) + note(t, 548, 80, "yes", "start");
  b += card(t, { x: 300, y: 280, w: 330, h: 100, title: "<folder>-workspace/", lines: ["the agent files at the top,", "<folder>/ inside: the repository,", "with nothing of the agents"], accent: t.turing });
  b += card(t, { x: 660, y: 280, w: 300, h: 100, title: "kept where it is", lines: ["e.g. an Obsidian vault: the", "agent files stay inside, hidden", "by .git/info/exclude"], accent: t.lovelace });
  b += arrow(t, 560, 214, 465, 276, { bend: "v" }) + note(t, 495, 248, "yes, recommended", "end");
  b += arrow(t, 640, 214, 810, 276, { bend: "v" }) + note(t, 745, 248, "no", "start");
  return frame(960, 390, t, b, "Keeping the project's git clean: init applies the standards to a plain folder, and offers to wrap a repository in a workspace");
});

// --- Several accounts, one view ----------------------------------------------------------------
write("accounts", (t) => {
  // Each account as a plain square in its color; its avatar lives in the dotagents sidebar.
  const tile = (color) => `<rect x="12" y="12" width="76" height="76" rx="18" fill="${color}"/>`;
  const tu = tile(t.turing), lo = tile(t.lovelace);
  let b = group(t, { x: 0, y: 0, w: 300, h: 300, label: "profiles" });
  b += card(t, { x: 20, y: 40, w: 260, h: 110, title: "turing", lines: ["a claude.ai account,", "its login in a vault", "per side"], icon: tu, accent: t.turing });
  b += card(t, { x: 20, y: 170, w: 260, h: 110, title: "lovelace", lines: ["another account,", "its own vault and", "its own Desktop app"], icon: lo, accent: t.lovelace });
  b += group(t, { x: 400, y: 0, w: 230, h: 300, label: "the slot" });
  b += card(t, { x: 420, y: 40, w: 190, h: 110, title: "WSL", lines: ["~/.claude", "one login at a", "time, shared history"] });
  b += card(t, { x: 420, y: 170, w: 190, h: 110, title: "Windows", lines: ["~/.claude", "the same, on", "the other side"] });
  b += arrow(t, 280, 95, 416, 95) + arrow(t, 280, 225, 416, 225, { dashed: true });
  b += pill(t, 348, 160, "switch");
  b += note(t, 348, 186, "on both sides");
  b += group(t, { x: 730, y: 0, w: 260, h: 300, label: "live usage" });
  b += card(t, { x: 750, y: 40, w: 220, h: 66, title: "dotagents usage", lines: ["and the status line"] });
  b += card(t, { x: 750, y: 116, w: 220, h: 66, title: "dotagents start", lines: ["the local API"] });
  b += card(t, { x: 750, y: 192, w: 220, h: 88, title: "dotagents-sidebar", lines: ["the accounts tab and", "the status bar"] });
  b += arrow(t, 610, 150, 726, 150) + note(t, 668, 140, "asks Anthropic");
  return frame(990, 300, t, b, "Several accounts, one view: switch puts a profile's login in each side's slot, and the usage of every account shows in the terminal and, through dotagents start, in the dotagents sidebar");
});

// --- Two machines, one setup -------------------------------------------------------------------
write("two-machines", (t) => {
  let b = card(t, { x: 0, y: 10, w: 260, h: 100, title: "Machine A", lines: ["edit a skill or a rule:", "live at once in every", "workspace on A"], accent: t.turing });
  b += card(t, { x: 400, y: 25, w: 180, h: 70, title: "GitHub", lines: ["your dotagents"] });
  b += card(t, { x: 800, y: 10, w: 260, h: 100, title: "Machine B", lines: ["pulled, reinstalled,", "every workspace", "refreshed"], accent: t.lovelace });
  b += arrow(t, 260, 60, 396, 60) + pill(t, 330, 60, "git push");
  b += arrow(t, 580, 60, 796, 60) + pill(t, 688, 60, "dotagents update --all");
  return frame(1060, 124, t, b, "Two machines, one setup: push from one, dotagents update --all on the other");
});

console.log(`pictures in ${OUT}`);
