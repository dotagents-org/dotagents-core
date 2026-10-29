// What a TUI screen is, and the colors every screen shares.
//
// A screen is one file in tui/screens/, listed in SCREENS (tui/app.ts) in the order of the tabs.
// It reads what it shows from lib/, like the commands do, and re-reads it when `now` or
// `refresh` change. A future feature is one more screen.

import type { ReactNode } from "react";
import { ROLES, type Role, backgroundOf, readableOn } from "../../core/theme.ts";

export type ScreenProps = {
  repo: string;
  // Ticks every few seconds, for screens that show live data.
  now: Date;
  // Goes up when the user presses r.
  refresh: number;
  // The lines the screen may use: a frame taller than the terminal can't be redrawn.
  rows: number;
};

export type Screen = {
  id: string;
  title: string;
  Component: (props: ScreenProps) => ReactNode;
};

// The roles of core/theme.ts in the background's hex; Ink brings them down to the terminal's color
// level, which cli.ts sets from colorLevel() before loading the view. Profile colors go through
// readableOn().
const bg = backgroundOf();
const role = (name: Role) => ROLES[name][bg];
export const theme = {
  text: role("text"),
  muted: role("muted"),
  track: role("track"),
  level: { ok: role("ok"), warn: role("warn"), high: role("high") },
  passed: role("ok"),
  failed: role("high"),
  warning: role("warn"),
  profile: (hex: string) => readableOn(hex, bg),
} as const;
