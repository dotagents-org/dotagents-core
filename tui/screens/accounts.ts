// The accounts of this machine, and their checklist (the same as `dotagents account list`).
// i installs the configuration to every account (`dotagents install`), after a preview.

import { Box, Text, useInput } from "ink";
import { createElement as h, useMemo } from "react";
import path from "node:path";
import { installAccounts, launcherFile, showFolder, verifyAccounts } from "../../lib/accounts.ts";
import { signedIn } from "../../lib/claude-code.ts";
import { loadAccounts } from "../../lib/machine-state.ts";
import { capture } from "../../lib/output.ts";
import { type Screen, type ScreenProps, theme } from "../screen.ts";
import { ActionView, useAction } from "../action.ts";
import { Checks } from "./checks.ts";

function AccountsScreen({ repo, refresh }: ScreenProps) {
  const install = useAction(() => installAccounts(repo));
  useInput((input) => {
    if (install.stage === "preview") {
      if (input === "y") install.confirm();
      if (input === "n") install.cancel();
    } else if (input === "i" && install.stage !== "previewing" && install.stage !== "running") install.start();
  });
  // Read again after an install, so the checklist shows what it fixed.
  const done = install.stage === "done";
  const accounts = useMemo(() => loadAccounts(), [refresh, done]);
  const events = useMemo(() => capture(verifyAccounts), [refresh, done]);
  if (!accounts.length) return h(Text, { color: theme.muted }, "No accounts yet. Add the one in ~/.claude with: dotagents account add <name> --default");
  const width = Math.max(...accounts.map((a) => a.name.length)) + 2;
  return h(
    Box,
    { flexDirection: "column" },
    ...accounts.map((a) => {
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
    h(Box, { marginTop: 1, flexDirection: "column" }, h(ActionView, { title: "Install", action: install }), install.stage === "idle" || install.stage === "done" ? h(Text, { color: theme.muted }, "i install the configuration to every account") : null)
  );
}

export const accountsScreen: Screen = { id: "accounts", title: "Accounts", Component: AccountsScreen };
