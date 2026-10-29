// The usage of every profile, live: re-read on every tick, so new data from Claude Code shows up
// within seconds. The same lines as `dotagents usage`, from core/usage.ts.

import { Box, Text } from "ink";
import { createElement as h } from "react";
import { PALETTE } from "../../../core/profiles.ts";
import { defaultConfigDir } from "../../../core/claude-code.ts";
import { loadProfiles } from "../../../core/machine-state.ts";
import { type Line, profileUsage, usageLines } from "../../../core/usage.ts";
import { ROLES } from "../../../core/theme.ts";
import { type Screen, type ScreenProps, theme } from "../screen.ts";

const roleHex = (role: keyof typeof ROLES) => (role === "ok" || role === "warn" || role === "high" ? theme.level[role] : theme[role]);

// One line of segments as Ink text: a profile's name in its readable color, the rest by role.
export function LineView({ line }: { line: Line }) {
  return h(
    Text,
    null,
    line.length ? line.map((s, i) => h(Text, { key: i, bold: s.bold, color: s.profile ? theme.profile(s.profile) : s.role ? roleHex(s.role) : undefined }, s.text)) : " "
  );
}

function UsageScreen({ now }: ScreenProps) {
  const profiles = loadProfiles();
  const list = (profiles.length ? profiles : [{ name: "claude", color: PALETTE[0], default: true, configDir: defaultConfigDir() }]).map((a) => profileUsage(a, now));
  return h(
    Box,
    { flexDirection: "column" },
    ...usageLines(list, now).map((line, i) => h(LineView, { key: i, line })),
    h(Text, null, " "),
    h(Text, { color: theme.muted }, `${list.length} profile${list.length === 1 ? "" : "s"}, local data, no network`)
  );
}

export const usageScreen: Screen = { id: "usage", title: "Usage", Component: UsageScreen };
