// The profiles of this machine, and their checklist (the same as `dotagents profile list`).
// i installs the configuration to every profile (`dotagents install`), after a preview.

import { Box, Text, useInput } from "ink";
import { createElement as h, useMemo } from "react";
import path from "node:path";
import { installProfiles, launcherFile, showFolder, verifyProfiles } from "../../../core/profiles.ts";
import { signedIn } from "../../../core/claude-code.ts";
import { loadProfiles } from "../../../core/machine-state.ts";
import { capture } from "../../../core/output.ts";
import { type Screen, type ScreenProps, theme } from "../screen.ts";
import { ActionView, useAction } from "../action.ts";
import { Checks } from "./checks.ts";

function ProfilesScreen({ repo, refresh }: ScreenProps) {
  const install = useAction(() => installProfiles(repo));
  useInput((input) => {
    if (install.stage === "preview") {
      if (input === "y") install.confirm();
      if (input === "n") install.cancel();
    } else if (input === "i" && install.stage !== "previewing" && install.stage !== "running") install.start();
  });
  // Read again after an install, so the checklist shows what it fixed.
  const done = install.stage === "done";
  const profiles = useMemo(() => loadProfiles(), [refresh, done]);
  const events = useMemo(() => capture(verifyProfiles), [refresh, done]);
  if (!profiles.length) return h(Text, { color: theme.muted }, "No profiles yet. Add the one in ~/.claude with: dotagents profile add <name> --default");
  const width = Math.max(...profiles.map((a) => a.name.length)) + 2;
  return h(
    Box,
    { flexDirection: "column" },
    ...profiles.map((a) => {
      const who = signedIn(a.configDir);
      return h(
        Box,
        { key: a.name, flexDirection: "column", marginBottom: 1 },
        h(
          Text,
          null,
          h(Text, { color: a.color }, "● "),
          h(Text, { color: a.color, bold: true }, a.name.padEnd(width)),
          h(Text, { color: theme.thirdParty }, a.default ? "default  " : "         "),
          who ? who.email : h(Text, { color: theme.muted }, "not signed in")
        ),
        h(Text, { color: theme.muted }, `  ${showFolder(a.configDir)} · ${path.basename(launcherFile(a.name))}`)
      );
    }),
    h(Checks, { events }),
    h(Box, { marginTop: 1, flexDirection: "column" }, h(ActionView, { title: "Install", action: install }), install.stage === "idle" || install.stage === "done" ? h(Text, { color: theme.muted }, "i install the configuration to every profile") : null)
  );
}

export const profilesScreen: Screen = { id: "profiles", title: "Profiles", Component: ProfilesScreen };
