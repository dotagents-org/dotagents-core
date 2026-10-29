// The result of a checklist run through capture(): a summary line, then the items that failed
// or warn. Shared by the screens that check something.

import { Box, Text } from "ink";
import { createElement as h } from "react";
import type { Event } from "../../../core/output.ts";
import { theme } from "../screen.ts";

export function Checks({ events }: { events: Event[] }) {
  const checks = events.filter((e) => e.kind === "check");
  const passed = checks.filter((e) => e.passed).length;
  const problems = events.filter((e) => (e.kind === "check" && !e.passed) || e.kind === "warning");
  const failed = checks.length - passed;
  return h(
    Box,
    { flexDirection: "column" },
    h(
      Text,
      null,
      h(Text, { color: failed ? theme.failed : theme.passed }, failed ? "✗ " : "✓ "),
      `${passed} passed`,
      failed ? h(Text, { color: theme.failed }, `, ${failed} failed`) : null,
      problems.length > failed ? h(Text, { color: theme.warning }, `, ${problems.length - failed} to note`) : null
    ),
    ...problems.map((e, i) =>
      h(
        Box,
        { key: i, flexDirection: "column" },
        e.kind === "check" ? h(Text, { color: theme.failed }, `  ✗ ${e.text}`) : e.kind === "warning" ? h(Text, { color: theme.warning }, `  ▲ ${e.text}`) : null,
        "detail" in e && e.detail ? h(Text, { color: theme.muted }, `    ${e.detail}`) : null
      )
    )
  );
}
