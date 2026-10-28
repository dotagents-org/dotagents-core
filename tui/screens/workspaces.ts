// The tracked workspaces; ↑↓ picks one, and its checklist (`dotagents check`) shows below.

import fs from "node:fs";
import { Box, Text, useInput } from "ink";
import { createElement as h, useMemo, useState } from "react";
import { loadWorkspaces } from "../../lib/machine-state.ts";
import { capture, displayPath } from "../../lib/output.ts";
import { state } from "../../lib/state.ts";
import { verifyWorkspace } from "../../lib/workspace.ts";
import { type Screen, type ScreenProps, theme } from "../screen.ts";
import { Checks } from "./checks.ts";

function WorkspacesScreen({ repo, refresh }: ScreenProps) {
  const workspaces = useMemo(() => loadWorkspaces(), [refresh]);
  const [selected, setSelected] = useState(0);
  useInput((_, key) => {
    if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelected((i) => Math.min(workspaces.length - 1, i + 1));
  });
  const current = workspaces[selected];
  // The checklist runs only for the selected workspace: it calls git, so not for all at once.
  const events = useMemo(() => {
    if (!current || !fs.existsSync(current.path)) return null;
    return capture(() => {
      state.base = current.path;
      verifyWorkspace(repo, current.path);
    });
  }, [current?.path, refresh]);
  if (!workspaces.length) return h(Text, { color: theme.muted }, "No workspaces tracked yet. Set one up with: dotagents init <path>");
  return h(
    Box,
    { flexDirection: "column" },
    ...workspaces.map((w, i) =>
      h(
        Text,
        { key: w.path, inverse: i === selected },
        `${i === selected ? "›" : " "} ${displayPath(w.path)}`,
        h(Text, { color: theme.muted }, `  ${w.skills.length} skill${w.skills.length === 1 ? "" : "s"}`)
      )
    ),
    h(
      Box,
      { flexDirection: "column", marginTop: 1 },
      current ? h(Text, { bold: true }, displayPath(current.path)) : null,
      events ? h(Checks, { events }) : h(Text, { color: theme.failed }, "✗ folder not found; stop tracking it with: dotagents untrack")
    )
  );
}

export const workspacesScreen: Screen = { id: "workspaces", title: "Workspaces", Component: WorkspacesScreen };
