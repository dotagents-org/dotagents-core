// The command line's prompts and spinner (@clack/prompts), loaded the first time a command needs them.

import type * as Clack from "@clack/prompts";
import { tone, type Step } from "../../core/output.ts";

let loaded: Promise<typeof Clack> | null = null;
export const loadPrompts = () =>
  (loaded ??= import("@clack/prompts").then((clack) => {
    clack.updateSettings({ withGuide: false }); // without their rail, like the rest of the output
    return clack;
  }));

// The spinner of a slow step, as the core's step drawer (setStepDrawer in core/output.ts).
export async function spinnerStep(message: string): Promise<Step> {
  const spin = (await loadPrompts()).spinner({ indicator: "dots" });
  spin.start(message);
  return { done: (ok) => (ok ? spin.stop(tone.muted(message)) : spin.error(message)) };
}
