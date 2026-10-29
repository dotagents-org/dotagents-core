// How dotagents looks, in one place for every surface: how many colors the output can use, the
// background they are picked for, the roles colors play (Geist's palette) and the symbols.

// 0: no colors; 1: the 16 basic ones; 2: 256; 3: 24-bit.
export type ColorLevel = 0 | 1 | 2 | 3;

type Env = Record<string, string | undefined>;

// FORCE_COLOR decides when set, with or without a terminal and over NO_COLOR, the way Node and
// most tools read it: 0 or false turns colors off, 1 or true is 16 colors, 2 and 3 go deeper. It
// also lets a surface that runs without a terminal (a status line) keep its colors. Otherwise a
// terminal gets colors unless NO_COLOR or TERM=dumb, as deep as it says it supports.
export function colorLevel(env: Env = process.env, isTTY = Boolean(process.stdout.isTTY)): ColorLevel {
  const force = env.FORCE_COLOR;
  if (force !== undefined && force !== "") {
    if (force === "0" || force === "false") return 0;
    if (force === "2" || force === "3") return Number(force) as ColorLevel;
    return 1;
  }
  if (!isTTY || env.NO_COLOR || env.TERM === "dumb") return 0;
  if (/truecolor|24bit/i.test(env.COLORTERM ?? "") || env.WT_SESSION || env.TERM_PROGRAM === "vscode") return 3;
  if (/256/.test(env.TERM ?? "")) return 2;
  return 1;
}

// The background the colors are picked for. Terminals don't say, so: DOTAGENTS_THEME=light|dark
// when set, else COLORFGBG ("15;0": the last number is the background color index) when the
// terminal exports it, else dark.
export type Background = "light" | "dark";

export function backgroundOf(env: Env = process.env): Background {
  if (env.DOTAGENTS_THEME === "light" || env.DOTAGENTS_THEME === "dark") return env.DOTAGENTS_THEME;
  const bg = Number(env.COLORFGBG?.split(";").pop());
  if (Number.isInteger(bg)) return bg === 7 || bg === 15 ? "light" : "dark";
  return "dark";
}

const BACKGROUND_HEX = { light: "#ffffff", dark: "#000000" } as const;

// The roles, in the colors of Vercel's Geist (vercel.com/geist), one hex per background, and the
// basic color that stands in at 16 colors (null: the terminal's own text color). Every role but
// the track passes 4.5:1 on its background; the track is the unused part of a bar, decorative.
// The brand has no color of its own: the badge is reverse video.
export const ROLES = {
  text: { light: "#171717", dark: "#ededed", ansi: null },
  muted: { light: "#4d4d4d", dark: "#a0a0a0", ansi: 90 },
  track: { light: "#c9c9c9", dark: "#454545", ansi: 90 },
  ok: { light: "#107d32", dark: "#01ca54", ansi: 32 },
  warn: { light: "#a25204", dark: "#fe9911", ansi: 33 },
  high: { light: "#d50322", dark: "#fe6367", ansi: 31 },
} as const;

export type Role = keyof typeof ROLES;

type Rgb = [number, number, number];
const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const hexOf = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const distance = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// WCAG contrast ratio between two #RRGGBB colors.
export function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = rgbOf(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The color itself when it is readable as text on the background (4.5:1); else the color mixed
// with black (light background) or white (dark background), step by step, until it is. A profile's
// color stays the canonical one in icons; its name is written in this variant.
export function readableOn(hex: string, background: Background) {
  const bg = BACKGROUND_HEX[background];
  if (contrast(hex, bg) >= 4.5) return hex;
  const rgb = rgbOf(hex);
  const toward = background === "light" ? 0 : 255;
  for (let t = 0.01; t <= 1; t += 0.01) {
    const out = hexOf(rgb.map((v) => v + (toward - v) * t) as Rgb);
    if (contrast(out, bg) >= 4.5) return out;
  }
  return background === "light" ? "#000000" : "#ffffff";
}

// xterm's 256 colors: a 6×6×6 cube on the levels below, and a 24-step gray ramp (232-255).
const CUBE = [0, 95, 135, 175, 215, 255];
function nearest256(rgb: Rgb) {
  const idx = rgb.map((v) => CUBE.reduce((best, level, i) => (Math.abs(level - v) < Math.abs(CUBE[best] - v) ? i : best), 0));
  const cube = 16 + 36 * idx[0] + 6 * idx[1] + idx[2];
  const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const k = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
  const gray = 8 + 10 * k;
  return distance(rgb, [gray, gray, gray]) < distance(rgb, idx.map((i) => CUBE[i]) as Rgb) ? 232 + k : cube;
}

// The 16 basic colors as xterm draws them; terminals differ, so at 16 colors this is a best guess.
const BASIC: Rgb[] = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];
function nearest16(rgb: Rgb) {
  const i = BASIC.reduce((best, c, j) => (distance(rgb, c) < distance(rgb, BASIC[best]) ? j : best), 0);
  return i < 8 ? 30 + i : 90 + i - 8;
}

const sgr = (open: string, close: string) => (text: string) => `\x1b[${open}m${text}\x1b[${close}m`;
const plain = (text: string) => text;

// A #RRGGBB color at a color level: 24-bit, the nearest of xterm's 256, the nearest basic color,
// or plain text.
export function hexColor(hex: string, level: ColorLevel) {
  if (level === 0) return plain;
  const rgb = rgbOf(hex);
  if (level === 3) return sgr(`38;2;${rgb.join(";")}`, "39");
  if (level === 2) return sgr(`38;5;${nearest256(rgb)}`, "39");
  return sgr(String(nearest16(rgb)), "39");
}

// Paints with the roles for a color level and a background: role("ok"), a profile's name in its
// readable variant, bold and reverse video.
export function painter(level: ColorLevel, background: Background) {
  const on = level > 0;
  return {
    role(name: Role) {
      const role = ROLES[name];
      if (level === 1) return role.ansi === null ? plain : sgr(String(role.ansi), "39");
      return hexColor(role[background], level);
    },
    profile: (hex: string) => hexColor(level === 1 ? hex : readableOn(hex, background), level),
    hex: (name: Role) => ROLES[name][background],
    bold: on ? sgr("1", "22") : plain,
    inverse: on ? sgr("7", "27") : plain,
  };
}

// The brand in the terminal: its name in reverse video (the text color as the background).
export const badge = (level: ColorLevel) => (level > 0 ? "\x1b[7m dotagents \x1b[27m" : "dotagents");

// The symbols the output is drawn with.
export const SYMBOLS = {
  profile: "●",
  passed: "✓",
  failed: "✗",
  warning: "▲",
  skipped: "–",
  created: "+",
  updated: "~",
  moved: "→",
} as const;
