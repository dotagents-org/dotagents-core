// The README's captures, drawn from the same lines the commands print: `usage` and `usage --short`
// for sample profiles, as SVG, once for a light and once for a dark background. Run it again after
// changing the views or the theme: node scripts/media.ts (or npm run media).

// Times are shown in UTC, so a capture doesn't depend on the machine that made it.
process.env.TZ = "UTC";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Background, ROLES, readableOn } from "../core/theme.ts";
import { type Line, type ProfileUsage, shortLines, usageLines } from "../core/usage.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repo, "docs", "media");

// A fixed moment and generic profiles, so a capture changes only when the look does.
const NOW = new Date("2026-10-28T12:00:00Z");
const at = (iso: string) => new Date(iso);
const SAMPLE: ProfileUsage[] = [
  {
    name: "work",
    color: "#D77655",
    default: true,
    state: "ok",
    fetchedAt: at("2026-10-28T11:56:00Z"),
    windows: [
      { kind: "session", pct: 72, resetsAt: at("2026-10-28T15:17:00Z"), reset: false },
      { kind: "week", pct: 48, resetsAt: at("2026-11-02T06:00:00Z"), reset: false },
      { kind: "model-week", model: "Fable", pct: 31, resetsAt: at("2026-11-02T06:00:00Z"), reset: false },
    ],
  },
  {
    name: "personal",
    color: "#376B80",
    state: "ok",
    fetchedAt: at("2026-10-28T11:58:00Z"),
    windows: [
      { kind: "session", pct: 91, resetsAt: at("2026-10-28T12:58:00Z"), reset: false },
      { kind: "week", pct: 18, resetsAt: at("2026-11-02T14:00:00Z"), reset: false },
    ],
  },
];

const FONT = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SIZE = 14;
const CHAR = SIZE * 0.6;
const LINE = SIZE * 1.5;
const PAD = 20;
const BG = { light: "#ffffff", dark: "#0a0a0a" } as const;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Lines of segments as an SVG terminal: one <text> per line, one <tspan> per segment.
function svg(lines: Line[], bg: Background, badge?: string) {
  const all: Line[] = badge ? [[{ text: " dotagents " }, { text: `  ${badge}`, bold: true }], [], ...lines] : lines;
  const width = Math.ceil(Math.max(...all.map((l) => l.reduce((n, s) => n + [...s.text].length, 0))) * CHAR + PAD * 2);
  const height = Math.ceil(all.length * LINE + PAD * 2 - (LINE - SIZE));
  const text = ROLES.text[bg];
  const rows = all.map((line, i) => {
    const y = PAD + SIZE + i * LINE - 3;
    let badgeRect = "";
    // Each segment at its own column, stretched to its exact width: the columns line up in any
    // font the viewer has, monospaced or not.
    let column = 0;
    const spans = line.map((s, j) => {
      const all = [...s.text].length;
      const lead = all - [...s.text.trimStart()].length;
      const shown = s.text.trim();
      const length = [...shown].length;
      const x = PAD + (column + lead) * CHAR;
      column += all;
      if (!shown) return "";
      const fit = `x="${x.toFixed(1)}" textLength="${(length * CHAR).toFixed(1)}" lengthAdjust="spacingAndGlyphs"`;
      if (badge && i === 0 && j === 0) {
        badgeRect = `<rect x="${PAD + (column - all) * CHAR}" y="${y - SIZE + 2}" width="${all * CHAR}" height="${SIZE + 4}" fill="${text}"/>`;
        return `<tspan ${fit} fill="${BG[bg]}">${escape(shown)}</tspan>`;
      }
      const fill = s.profile ? readableOn(s.profile, bg) : s.role ? ROLES[s.role][bg] : text;
      return `<tspan ${fit} fill="${fill}"${s.bold ? ' font-weight="700"' : ""}>${escape(shown)}</tspan>`;
    });
    return `${badgeRect}<text y="${y}" xml:space="preserve">${spans.join("")}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="dotagents ${badge ?? "usage --short"}">
<rect width="${width}" height="${height}" rx="10" fill="${BG[bg]}"/>
<g font-family="${FONT}" font-size="${SIZE}" fill="${text}">
${rows.join("\n")}
</g>
</svg>
`;
}

// Every capture, by file name in docs/media/.
export function captures(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const bg of ["light", "dark"] as const) {
    const usage = [...usageLines(SAMPLE, NOW), [], [{ text: "2 profiles, local data, no network", role: "muted" as const }]];
    files[`usage-${bg}.svg`] = svg(usage, bg, "usage");
    files[`short-${bg}.svg`] = svg(shortLines(SAMPLE, NOW), bg);
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(out, { recursive: true });
  for (const [name, content] of Object.entries(captures())) fs.writeFileSync(path.join(out, name), content);
  console.log(`Wrote the captures to ${path.relative(repo, out)}`);
}
