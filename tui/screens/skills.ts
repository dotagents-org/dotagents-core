// The own skills and the registered third-party ones (the same as `dotagents skills`).

import { Box, Text } from "ink";
import { createElement as h, useMemo } from "react";
import { listSkills } from "../../lib/skills.ts";
import { type Screen, type ScreenProps, theme } from "../screen.ts";

function SkillsScreen({ repo, refresh }: ScreenProps) {
  const all = useMemo(() => listSkills(repo), [repo, refresh]);
  const width = Math.max(...all.map((s) => s.name.length)) + 2;
  const row = (s: (typeof all)[number]) =>
    h(
      Box,
      { key: s.name },
      h(Box, { width, flexShrink: 0 }, h(Text, { color: s.kind === "own" ? theme.own : theme.thirdParty }, s.name)),
      h(Text, { color: theme.muted, wrap: "truncate-end" }, s.kind === "own" ? s.description : `${s.description} · from ${s.source}`)
    );
  const own = all.filter((s) => s.kind === "own");
  const thirdParty = all.filter((s) => s.kind === "third-party");
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, `${own.length} skills`),
    ...own.map(row),
    h(Box, { marginTop: 1 }, h(Text, { bold: true }, `${thirdParty.length} third-party`)),
    ...thirdParty.map(row)
  );
}

export const skillsScreen: Screen = { id: "skills", title: "Skills", Component: SkillsScreen };
