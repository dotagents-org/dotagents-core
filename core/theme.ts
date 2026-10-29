// How dotagents looks, in one place for every surface: how many colors the output can use, the
// roles colors play, and the symbols. The surfaces turn a role into their own color (picocolors in
// the commands, Ink in the full-screen view); a profile's own #RRGGBB goes through hexColor.

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

// A color given as #RRGGBB (a profile's color): 24-bit at level 3, else the closest of the 256
// xterm colors, which even 16-color terminals mostly show. Plain text without colors.
export function hexColor(hex: string, level: ColorLevel) {
  if (level === 0) return (text: string) => text;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const cube = (v: number) => Math.round((v / 255) * 5);
  const code = level === 3 ? `38;2;${r};${g};${b}` : `38;5;${16 + 36 * cube(r) + 6 * cube(g) + cube(b)}`;
  return (text: string) => `\x1b[${code}m${text}\x1b[39m`;
}

// What each color means, as a basic color name both picocolors and Ink know.
export const ROLES = {
  brand: "magenta",
  muted: "gray",
  info: "cyan",
  ok: "green",
  warn: "yellow",
  high: "red",
} as const;

export type Role = keyof typeof ROLES;

// The symbols the output is drawn with.
export const SYMBOLS = {
  profile: "●",
  passed: "✓",
  failed: "✗",
  warning: "!",
  created: "+",
  updated: "~",
  moved: "→",
} as const;
