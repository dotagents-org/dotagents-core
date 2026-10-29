// An action a screen offers (install, apply the standards…), in the same two steps as the
// commands: a preview first (the --dry-run), then y applies it and n cancels. When the preview
// finds nothing to change, it says so and asks nothing.

import { Box, Text } from "ink";
import { createElement as h, useState } from "react";
import { type Event, captureAsync, displayPath } from "../../core/output.ts";
import { theme } from "./screen.ts";

export type Action = {
  stage: "idle" | "previewing" | "preview" | "running" | "done";
  events: Event[];
  start(): void;
  confirm(): void;
  cancel(): void;
};

const changes = (events: Event[]) => events.filter((e) => e.kind === "result" && e.status !== "ok");

export function useAction(run: () => void | Promise<void>): Action {
  const [stage, setStage] = useState<Action["stage"]>("idle");
  const [events, setEvents] = useState<Event[]>([]);
  const go = async (dryRun: boolean) => captureAsync(async () => void (await run()), { dryRun });
  return {
    stage,
    events,
    start() {
      setStage("previewing");
      go(true).then((found) => {
        setEvents(found);
        setStage(changes(found).length ? "preview" : "done");
      });
    },
    confirm() {
      setStage("running");
      go(false).then((done) => {
        setEvents(done);
        setStage("done");
      });
    },
    cancel() {
      setStage("idle");
      setEvents([]);
    },
  };
}

const ICON: Record<string, { icon: string; color: string }> = {
  created: { icon: "+", color: theme.passed },
  updated: { icon: "~", color: theme.warning },
  moved: { icon: "→", color: theme.passed },
  skipped: { icon: "!", color: theme.warning },
  failed: { icon: "✗", color: theme.failed },
  "would create": { icon: "+", color: theme.muted },
  "would update": { icon: "~", color: theme.muted },
  "would move": { icon: "→", color: theme.muted },
};

// The preview or the result of an action: what changes (or would), and a summary.
export function ActionView({ title, action }: { title: string; action: Action }) {
  if (action.stage === "idle") return null;
  if (action.stage === "previewing" || action.stage === "running") {
    return h(Text, { color: theme.muted }, action.stage === "previewing" ? `${title}: looking at what would change…` : `${title}: applying…`);
  }
  const list = changes(action.events);
  const ok = action.events.filter((e) => e.kind === "result" && e.status === "ok").length;
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, action.stage === "preview" ? `${title}, preview:` : `${title}:`),
    ...list.map((e, i) => {
      if (e.kind !== "result") return null;
      const { icon, color } = ICON[e.status] ?? { icon: "·", color: theme.muted };
      return h(Text, { key: i }, h(Text, { color }, `  ${icon} ${e.status.padEnd(12)} `), displayPath(e.target), e.detail ? h(Text, { color: theme.muted }, `  ${e.detail}`) : null);
    }),
    list.length ? null : h(Text, { color: theme.passed }, "  ✓ nothing to change"),
    h(Text, { color: theme.muted }, `  ${ok} already ok`),
    action.stage === "preview" ? h(Text, { color: theme.warning }, "  y apply · n cancel") : null
  );
}
