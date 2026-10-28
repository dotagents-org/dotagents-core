// What a TUI screen is, and the colors every screen shares.
//
// A screen is one file in tui/screens/, listed in SCREENS (tui/app.ts) in the order of the tabs.
// It reads what it shows from lib/, like the commands do, and re-reads it when `now` or
// `refresh` change. A future feature is one more screen.

import type { ReactNode } from "react";

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

// Ink takes color names or #RRGGBB, so the account colors go through as they are.
export const theme = {
  accent: "magenta",
  muted: "gray",
  own: "green",
  thirdParty: "cyan",
  level: { ok: "green", warn: "yellow", high: "red" },
  passed: "green",
  failed: "red",
  warning: "yellow",
} as const;
