// Generates the dotagents avatars: the brand (the `..` face) and one per account, in each state.
//
// The panel draws the avatars live (surfaces/web/page/avatar.js, with open-bot-avatar's
// avatarFrame vendored in page/vendor/), so this script only makes pictures of them, for documents:
//   still/<who>-<state>.svg   one frame
//   strip/<who>-<state>.svg   24 frames of 3 s side by side
// The rules here and in avatar.js are the same; a change goes to both.
//
// Run, from a scratch folder outside the repository:
//   npm install --ignore-scripts open-bot-avatar@0.2.1
//   node <repo>/scripts/avatars/generate.mjs node_modules/open-bot-avatar <output folder>

import fs from "node:fs";
import path from "node:path";

const [lib, out] = process.argv.slice(2);
if (!lib || !out) throw new Error("usage: node generate.mjs <open-bot-avatar folder> <output folder>");
const { renderAvatarSvg, validateAvatar } = await import(path.resolve(lib, "dist/index.js"));

// Who: the body is who it is (shape and color); the eyes are the state.
const WHO = {
  dotagents: {
    color: "#171717",
    dots: true, // the brand keeps its round `..` eyes
    progress: "#8f8f8f",
    def: { version: 1, id: "dotagents", name: "dotagents", body: { path: "M33 12H67C78.6 12 88 21.4 88 33V67C88 78.6 78.6 88 67 88H33C21.4 88 12 78.6 12 67V33C12 21.4 21.4 12 33 12Z" }, eyes: { x: 50, y: 48, spacing: 24, scale: 1.3 } },
  },
  turing: {
    color: "#D77655",
    ink: "#151515",
    def: { version: 1, id: "turing", name: "turing", body: { path: "M30 14H70C80 14 86 20 86 30V70C86 80 80 86 70 86H30C20 86 14 80 14 70V30C14 20 20 14 30 14Z" }, eyes: { x: 50, y: 47, spacing: 26, scale: 1.4 } },
  },
  lovelace: {
    color: "#376B80",
    ink: "#f5f5f5",
    def: { version: 1, id: "lovelace", name: "lovelace", body: { path: "M50 12A38 38 0 1 1 49.99 12Z" }, eyes: { x: 50, y: 47, spacing: 24, scale: 1.3 } },
  },
};

// The brand's eyes are always light: the state's color goes in the dot, for every avatar.
const BRAND_EYES_INK = "#ededed";

// Every avatar shows its state's color in a dot at the corner, like presence in a chat; the eyes
// keep only the shape. On an account's body a colored eye fades (1.1:1 for red on turing's
// orange). Red: it needs you; amber: it asks for attention; green: all good; blue with a moon:
// asleep. A ring around the dot is the other state of the same color: limit (red, it comes back
// by itself at the reset) and waiting (amber, a session waits for you).
const DOT = {
  error: `<circle cx="84" cy="84" r="10" fill="#ee1d36" stroke="#ffffff" stroke-width="3"/>`,
  limit: `<circle cx="84" cy="84" r="12" fill="#ffffff"/><circle cx="84" cy="84" r="9.5" fill="none" stroke="#ee1d36" stroke-width="2.6"/><circle cx="84" cy="84" r="5.2" fill="#ee1d36"/>`,
  waiting: `<circle cx="84" cy="84" r="12" fill="#ffffff"/><circle cx="84" cy="84" r="9.5" fill="none" stroke="#f58a00" stroke-width="2.6"/><circle cx="84" cy="84" r="5.2" fill="#f58a00"/>`,
  warn: `<circle cx="84" cy="84" r="10" fill="#f58a00" stroke="#ffffff" stroke-width="3"/>`,
  // working shows itself with the dots below; no status dot.
  working: "",
  ok: `<circle cx="84" cy="84" r="10" fill="#00b84d" stroke="#ffffff" stroke-width="3"/>`,
  asleep: `<circle cx="84" cy="84" r="10" fill="#2f7bf5" stroke="#ffffff" stroke-width="3"/><path d="M87.5 78.8A5.6 5.6 0 1 0 89.2 87.2A4.4 4.4 0 0 1 87.5 78.8Z" fill="#ffffff"/>`,
};

// The seven states, most urgent first.
const STATES = {
  error: { glyph: "x" },
  limit: { glyph: "chevron" },
  waiting: { gaze: { x: 0, y: 0.2 }, glyph: "wide" },
  warn: { brows: true },
  working: { motion: "thinking", hop: true },
  ok: {},
  asleep: { glyph: "dash", depth: 4 },
};

const EYE = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="#[0-9a-fA-F]+"\/>/g;
const GLYPH = {
  dash: (cx, cy, ink) => `<rect x="${cx - 6}" y="${cy - 2.2}" width="12" height="4.4" rx="2.2" fill="${ink}"/>`,
  dot: (cx, cy, ink) => `<circle cx="${cx}" cy="${cy}" r="7" fill="${ink}"/>`,
  // Round and a little bigger, looking at you: waiting for an answer.
  wide: (cx, cy, ink) => `<circle cx="${cx}" cy="${cy}" r="7.5" fill="${ink}"/>`,
  x: (cx, cy, ink) => `<path d="M${cx - 5} ${cy - 5}L${cx + 5} ${cy + 5}M${cx + 5} ${cy - 5}L${cx - 5} ${cy + 5}" stroke="${ink}" stroke-width="4" stroke-linecap="round" fill="none"/>`,
  // ">" on the left eye, "<" on the right: squeezed shut.
  chevron: (cx, cy, ink, left) => `<path d="M${cx + (left ? -4 : 4)} ${cy - 7}L${cx + (left ? 5 : -5)} ${cy}L${cx + (left ? -4 : 4)} ${cy + 7}" stroke="${ink}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
};

// Each eye <rect> the renderer draws becomes a glyph inside its own transform group, so it keeps
// the body's perspective; brows go above it.
function eyes(svg, { glyph, brows }, ink) {
  let i = 0;
  return svg.replace(EYE, (m, x, y, w, h) => {
    const [X, Y, W, H] = [x, y, w, h].map(Number);
    const cx = X + W / 2, cy = Y + H / 2, left = i++ === 0;
    let eye = glyph ? GLYPH[glyph](cx, cy, ink, left) : m;
    if (brows) {
      const top = (glyph === "dot" ? cy - 7 : Y) - 4;
      eye += `<path d="${left ? `M${cx - 6} ${top + 1}L${cx + 5} ${top - 4}` : `M${cx + 6} ${top + 1}L${cx - 5} ${top - 4}`}" stroke="${ink}" stroke-width="3.6" stroke-linecap="round" fill="none"/>`;
    }
    return eye;
  });
}

const FRAMES = 24;
const LOOP = 3;

function frame(who, state, i) {
  const w = WHO[who], s = STATES[state];
  const ink = w.dots ? BRAND_EYES_INK : w.ink;
  const p = i / FRAMES;
  let svg = renderAvatarSvg(w.def, { color: w.color, eyeColor: ink, motion: s.motion ?? "idle", time: p * LOOP, gaze: s.gaze, depth: s.depth });
  svg = eyes(svg, { glyph: s.glyph ?? (w.dots ? "dot" : undefined), brows: s.brows }, ink);
  // Ids repeat between renders: each frame gets its own, or every frame would draw the first.
  let inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "").replace(/oba-([a-z0-9]+)-/g, `oba-$1-f${i}-`);
  let extra = "";
  if (s.hop) {
    // Two hops per loop, a little squash where it lands, and three dots below lighting in turn.
    const hop = Math.abs(Math.sin(p * Math.PI * 2));
    const [sx, sy] = hop < 0.15 ? [1.05, 0.93] : [1, 1];
    inner = `<g transform="translate(50 92) scale(${sx} ${sy}) translate(-50 -92) translate(0 ${-6 * hop})">${inner}</g>`;
    const lit = Math.floor(p * 6) % 3;
    extra += [0, 1, 2].map((k) => `<circle cx="${38 + k * 12}" cy="95" r="4.4" fill="${w.progress ?? w.color}" opacity="${k === lit ? 1 : 0.3}"/>`).join("");
  }
  extra += DOT[state];
  return inner + extra;
}

for (const dir of ["still", "strip"]) fs.mkdirSync(path.join(out, dir), { recursive: true });
for (const [who, w] of Object.entries(WHO)) {
  const v = validateAvatar(w.def);
  if (!v.ok) throw new Error(`${who}: ${v.errors.join("; ")}`);
  for (const state of Object.keys(STATES)) {
    fs.writeFileSync(path.join(out, "still", `${who}-${state}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" overflow="visible" role="img" aria-label="${who}, ${state}">${frame(who, state, 0)}</svg>`);
    let strip = "";
    for (let i = 0; i < FRAMES; i++) strip += `<svg x="${i * 100}" y="0" width="100" height="100" viewBox="0 0 100 100" overflow="visible">${frame(who, state, i)}</svg>`;
    fs.writeFileSync(path.join(out, "strip", `${who}-${state}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${100 * FRAMES} 100" width="${100 * FRAMES}" height="100">${strip}</svg>`);
  }
}
console.log(`${Object.keys(WHO).length * Object.keys(STATES).length} avatars in ${out}`);
