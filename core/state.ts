// The state of one run: --dry-run, the counters the summary prints, and the folder paths are
// shown relative to. Every module reads it; only lib/output.ts updates the counters.

import type { Status } from "./output.ts";

export type Counts = Partial<Record<Status | "passed" | "warnings", number>>;

// base: folder that paths are shown relative to (the workspace, during init and check).
export const state: { dryRun: boolean; problems: number; counts: Counts; base: string | null } = {
  dryRun: false,
  problems: 0,
  counts: {},
  base: null,
};

export function resetState(overrides: Partial<typeof state> = {}) {
  Object.assign(state, { dryRun: false, problems: 0, counts: {}, base: null }, overrides);
}
