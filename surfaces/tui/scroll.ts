// A list taller than the screen: shows the lines that fit, ↑↓ moves through them, and a line on
// each side says how many are hidden. Ink can't redraw a frame taller than the terminal, so a
// screen whose content can grow puts it in here.

import { Box, Text, useInput } from "ink";
import { type ReactNode, createElement as h, useState } from "react";
import { theme } from "./screen.ts";

export function ScrollList({ lines, rows }: { lines: ReactNode[]; rows: number }) {
  const [offset, setOffset] = useState(0);
  const fits = lines.length <= rows;
  // Two lines go to the "more" notes when the list doesn't fit.
  const visible = fits ? lines.length : Math.max(1, rows - 2);
  const last = Math.max(0, lines.length - visible);
  const start = Math.min(offset, last);
  useInput((_, key) => {
    if (fits) return;
    if (key.upArrow) setOffset(Math.max(0, start - 1));
    if (key.downArrow) setOffset(Math.min(last, start + 1));
    if (key.pageUp) setOffset(Math.max(0, start - visible));
    if (key.pageDown) setOffset(Math.min(last, start + visible));
  });
  if (fits) return h(Box, { flexDirection: "column" }, ...lines);
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { color: theme.muted }, start > 0 ? `↑ ${start} more` : " "),
    ...lines.slice(start, start + visible),
    h(Text, { color: theme.muted }, start < last ? `↓ ${lines.length - start - visible} more   ↑↓ scroll` : " ")
  );
}
