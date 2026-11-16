// Asking each provider for the usage of its profiles, the same way for both: the pacing between
// asks, the backoff after a failure, the record kept in <state>/usage/<profile>.json (core/usage-
// record.ts), and the report. What is asked, of whom, how often and in what shape the answer is
// kept is each provider's (core/providers.ts, its usage member).

import { report, section } from "./output.ts";
import { type UsageOptions, providerFor, providers } from "./providers.ts";
import { state } from "./state.ts";
import { BACKOFF_MS, MAX_BACKOFF_MS, readRecord, writeRecord } from "./usage-record.ts";
import type { Profile } from "./machine-state.ts";

export type LiveResult = { status: "updated" | "ok" | "failed"; detail: string };

// Asks for one profile's usage, unless it was asked a moment ago or is backing off. force skips the
// wait between asks (for a provider that allows it), never the backoff after an error.
export async function fetchUsage(p: Profile, options: UsageOptions = {}): Promise<LiveResult> {
  const { usage } = providerFor(p);
  const now = options.now ?? Date.now;
  const record = readRecord(p.name);
  const askedAt = Number(record.askedAtMs) || 0;
  const wait = Math.max(usage.forceable && options.force ? 0 : askedAt + usage.every(p), Number(record.retryAtMs) || 0) - now();
  if (wait > 0) return { status: "ok", detail: record.error ? `${record.error}; again in ${Math.ceil(wait / 1000)}s` : `asked ${Math.round((now() - askedAt) / 1000)}s ago` };
  if (!usage.hasLogin(p)) return { status: "failed", detail: "no login saved for it" };
  if (state.dryRun) return { status: "ok", detail: usage.dryRun };

  writeRecord(p.name, { ...record, askedAtMs: now() });
  const asked = await usage.ask(p, { ...options, now });
  if (asked.ok) {
    writeRecord(p.name, asked.record);
    asked.afterWrite?.();
    return { status: "updated", detail: usage.done };
  }
  const failures = (Number(record.failures) || 0) + 1;
  const backoff = Math.max(asked.retryAfter ?? 0, Math.min(BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS));
  writeRecord(p.name, { ...record, askedAtMs: now(), failures, retryAtMs: now() + backoff, error: asked.error, ...(asked.refusedMark ? { refused: asked.refusedMark } : {}) });
  return { status: "failed", detail: asked.error };
}

// usage --refresh, and each tick of the dashboard's server: every provider's profiles. force
// (usage --refresh) asks now the providers that allow it.
export async function refreshUsage(options: UsageOptions = {}) {
  section("Refresh");
  await Promise.all(
    providers().map(async ({ usage }) => {
      const say = (p: Profile, res: LiveResult) => report(res.status === "ok" && state.dryRun ? "would update" : res.status, p.name, res.detail);
      const profiles = usage.profiles();
      if (usage.together) {
        const results = await Promise.all(profiles.map(async (p) => ({ p, res: await fetchUsage(p, options) })));
        for (const { p, res } of results) say(p, res);
      } else {
        for (const p of profiles) say(p, await fetchUsage(p, options));
      }
    })
  );
}
