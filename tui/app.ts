// The full-screen view of dotagents: a header, one tab per screen, the active screen and the
// keys. `dotagents` with no arguments opens it in a terminal; `dotagents usage --watch` opens it
// on the usage screen. Built with Ink, without JSX: Node runs .ts but doesn't turn JSX into code.

import fs from "node:fs";
import path from "node:path";
import { Box, Text, render, useApp, useInput } from "ink";
import { createElement as h, useEffect, useState } from "react";
import { type Screen, theme } from "./screen.ts";
import { accountsScreen } from "./screens/accounts.ts";
import { skillsScreen } from "./screens/skills.ts";
import { usageScreen } from "./screens/usage.ts";
import { workspacesScreen } from "./screens/workspaces.ts";

// In the order of the tabs; the number keys follow it.
export const SCREENS: Screen[] = [usageScreen, accountsScreen, workspacesScreen, skillsScreen];

const TICK_MS = 2000;

export function App({ repo, initial = SCREENS[0].id }: { repo: string; initial?: string }) {
  const { exit } = useApp();
  const [index, setIndex] = useState(Math.max(0, SCREENS.findIndex((s) => s.id === initial)));
  const [now, setNow] = useState(() => new Date());
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  useInput((input, key) => {
    const n = SCREENS.length;
    if (input === "q" || key.escape) return exit();
    if ((key.tab && key.shift) || key.leftArrow) return setIndex((i) => (i + n - 1) % n);
    if (key.tab || key.rightArrow) return setIndex((i) => (i + 1) % n);
    if (/^[1-9]$/.test(input) && Number(input) <= n) return setIndex(Number(input) - 1);
    if (input === "r") {
      setRefresh((r) => r + 1);
      setNow(new Date());
    }
  });
  const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
  const screen = SCREENS[index];
  return h(
    Box,
    { flexDirection: "column", paddingX: 1 },
    h(Text, null, h(Text, { backgroundColor: theme.accent, color: "white", bold: true }, " dotagents "), h(Text, { color: theme.muted }, ` ${version}`)),
    h(
      Box,
      { marginY: 1 },
      ...SCREENS.map((s, i) => h(Text, { key: s.id, inverse: i === index, color: i === index ? undefined : theme.muted }, ` ${i + 1} ${s.title} `))
    ),
    h(screen.Component, { key: screen.id, repo, now, refresh }),
    h(Box, { marginTop: 1 }, h(Text, { color: theme.muted }, `tab ←→ screens · 1-${SCREENS.length} jump · ↑↓ select · r reload · q quit`))
  );
}

export async function runTui(repo: string, initial?: string) {
  const app = render(h(App, { repo, initial }));
  await app.waitUntilExit();
}
