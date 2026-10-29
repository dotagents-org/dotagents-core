// The usage of every profile, live: re-read on every tick, so a /usage in any profile shows up
// within seconds. Same words as `dotagents usage`.

import { Box, Text } from "ink";
import { createElement as h } from "react";
import { PALETTE } from "../../lib/profiles.ts";
import { defaultConfigDir } from "../../lib/claude-code.ts";
import { loadProfiles } from "../../lib/machine-state.ts";
import { type ProfileUsage, profileUsage, bar, freshnessText, levelOf, paceText, resetText, stateNote, windowLabel } from "../../lib/usage.ts";
import { type Screen, type ScreenProps, theme } from "../screen.ts";

const LABEL = 14;

function Profile({ a, now }: { a: ProfileUsage; now: Date }) {
  const note = stateNote(a);
  const fresh = freshnessText(a, now);
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    h(Text, null, h(Text, { color: a.color }, "◇ "), h(Text, { color: a.color, bold: true }, a.name), a.default ? h(Text, { color: theme.thirdParty }, "  ● default") : null),
    note
      ? h(Text, { color: theme.muted }, `  ${note}`)
      : a.windows.map((w) => {
          const color = theme.level[levelOf(w.pct)];
          const cells = bar(w.pct);
          const filled = cells.replace(/·+$/, "");
          const pace = paceText(w, now);
          return h(
            Box,
            { key: `${w.kind}${w.model ?? ""}`, flexDirection: "column" },
            h(
              Text,
              null,
              `  ${windowLabel(w).padEnd(LABEL)} `,
              h(Text, { color }, filled),
              h(Text, { color: theme.muted }, cells.slice(filled.length)),
              h(Text, { color }, `  ${String(w.pct).padStart(3)}%`),
              h(Text, { color: theme.muted }, `  ${resetText(w, now)}`)
            ),
            pace ? h(Text, { color: pace.warn ? theme.warning : theme.muted }, `  ${" ".repeat(LABEL)} ${pace.text}`) : null
          );
        }),
    fresh ? h(Text, { color: fresh.warn ? theme.warning : theme.muted }, `  └ ${fresh.text}`) : null
  );
}

function UsageScreen({ now }: ScreenProps) {
  const profiles = loadProfiles();
  const list = (profiles.length ? profiles : [{ name: "claude", color: PALETTE[0], default: true, configDir: defaultConfigDir() }]).map((a) => profileUsage(a, now));
  return h(Box, { flexDirection: "column" }, ...list.map((a) => h(Profile, { key: a.name, a, now })), h(Text, { color: theme.muted }, "local data, no network · /usage in a profile refreshes it"));
}

export const usageScreen: Screen = { id: "usage", title: "Usage", Component: UsageScreen };
