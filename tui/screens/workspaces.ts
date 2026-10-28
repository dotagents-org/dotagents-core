// The tracked workspaces; ↑↓ picks one, and its checklist (`dotagents check`) shows below.
// a applies the standards to it again, with its skills (what `update --all` does to each one),
// after a preview.

import fs from "node:fs";
import { Box, Text, useInput } from "ink";
import { createElement as h, useEffect, useMemo, useState } from "react";
import { loadWorkspaces } from "../../lib/machine-state.ts";
import { capture, displayPath } from "../../lib/output.ts";
import { state } from "../../lib/state.ts";
import { listSkills, resolveSkills } from "../../lib/skills.ts";
import { applyWorkspace, verifyWorkspace } from "../../lib/workspace.ts";
import { ActionView, useAction } from "../action.ts";
import { type Screen, type ScreenProps, theme } from "../screen.ts";
import { Checks } from "./checks.ts";

function WorkspacesScreen({ repo, refresh }: ScreenProps) {
  const workspaces = useMemo(() => loadWorkspaces(), [refresh]);
  const [selected, setSelected] = useState(0);
  const current = workspaces[selected];
  const apply = useAction(async () => {
    if (!current) return;
    // Skills removed from the repository or the catalog are left out, as update --all does.
    const known = listSkills(repo).map((s) => s.name);
    state.base = current.path;
    await applyWorkspace(repo, current.path, resolveSkills(repo, current.skills.filter((name) => known.includes(name))));
  });
  // A preview belongs to one workspace: picking another one drops it.
  useEffect(() => apply.cancel(), [current?.path]);
  useInput((input, key) => {
    if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelected((i) => Math.min(workspaces.length - 1, i + 1));
    if (apply.stage === "preview") {
      if (input === "y") apply.confirm();
      if (input === "n") apply.cancel();
    } else if (input === "a" && current && fs.existsSync(current.path) && apply.stage !== "previewing" && apply.stage !== "running") apply.start();
  });
  // The checklist runs only for the selected workspace: it calls git, so not for all at once.
  const events = useMemo(() => {
    if (!current || !fs.existsSync(current.path)) return null;
    return capture(() => {
      state.base = current.path;
      verifyWorkspace(repo, current.path);
    });
  }, [current?.path, refresh, apply.stage === "done"]);
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
      events ? h(Checks, { events }) : h(Text, { color: theme.failed }, "✗ folder not found; stop tracking it with: dotagents untrack"),
      h(Box, { marginTop: 1, flexDirection: "column" }, h(ActionView, { title: "Apply the standards", action: apply }), apply.stage === "idle" || apply.stage === "done" ? h(Text, { color: theme.muted }, "a apply the standards again, with its skills") : null)
    )
  );
}

export const workspacesScreen: Screen = { id: "workspaces", title: "Workspaces", Component: WorkspacesScreen };
