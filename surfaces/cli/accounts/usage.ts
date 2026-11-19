// `usage`: how much of each profile's plan is used, from Claude Code's cache and from what dotagents
// last asked of Anthropic; --refresh asks now.

import { LABELS } from "../../../core/accounts/provider-labels.ts";
import { readAll, usageJson } from "../../../core/accounts/snapshot.ts";
import { captureAsync, fancy, ink } from "../../../core/output/output.ts";
import { refreshUsage } from "../../../core/accounts/usage-refresh.ts";
import { type Line, type ProfileUsage, shortLines, usageLines } from "../../../core/accounts/usage.ts";
import { badge, colorLevel } from "../../../core/output/theme.ts";
import { readLog } from "../../../core/sessions/revision.ts";
import { type Ratio, type WindowSpend, spendReport } from "../../../core/accounts/spend.ts";
import { activeProfiles, providerFor } from "../../../core/accounts/providers.ts";
import { displayPath } from "../../../core/output/output.ts";
import { plural, type Command } from "../shared.ts";

const usd = (n: number) => `US$ ${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const count = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const hhmm = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });

// usage --spend: what 1% of each window cost, and where the current window's spend went
function spendView(json: boolean) {
  // Claude's and ChatGPT's: the account each profile's saved login is (a Claude account, a ChatGPT user)
  const profiles = activeProfiles().map((p) => ({ name: p.name, accountUuid: providerFor(p).account(p)?.id ?? null }));
  const { profiles: report, unattributedUsd } = spendReport(profiles, { folder: (cwd) => displayPath(cwd) });
  const since = Math.min(...report.flatMap((p) => (p.week ? [Date.parse(p.week.from)] : [])), Date.now());
  const revisionUsd = readLog().filter((e) => Date.parse(e.at) >= since).reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
  // version 2: ChatGPT's profiles, a window's totalTokens, models and workspaces as [name, dollars, tokens]
  if (json) return console.log(JSON.stringify({ version: 2, profiles: report, unattributedUsd, revisionUsd }, null, 2));
  const { bold, muted } = { bold: ink.bold, muted: ink.role("muted") };
  const label = { session: "5h", week: "7d" } as const;
  const ratioLine = (r: Ratio) => {
    const head = `  ${label[r.window]}  `;
    if (r.tokensPerPct === null) return `${head}${muted(`no rise of the % with spend to measure yet${r.unexplainedPct ? `; ${r.unexplainedPct}% rose with no spend here` : ""}`)}`;
    const share = r.unexplainedPct ? `; ${Math.round((100 * r.unexplainedPct) / (r.unexplainedPct + r.explainedPct))}% of the rise had no spend here` : "";
    // ChatGPT's spend has no price here: tokens only
    const cost = r.usdPerPct === null ? bold(`${count(r.tokensPerPct)} tokens`) : `${bold(usd(r.usdPerPct))} ≈ ${count(r.tokensPerPct)} tokens`;
    return `${head}1% ≈ ${cost}  ${muted(`${r.pairs} reading${r.pairs === 1 ? "" : "s"}${share}`)}`;
  };
  const windowLines = (kind: "session" | "week", w: WindowSpend | null) => {
    if (!w) return [];
    const priced = w.totalUsd !== null;
    const top = (list: [string, number, number][]) => list.slice(0, 4).map(([k, v, t]) => `${k} ${priced ? usd(v) : `${count(t)} tokens`}`).join("  ");
    return [`  this ${label[kind]} window, since ${hhmm(w.from)}  ${bold(priced ? usd(w.totalUsd!) : `${count(w.totalTokens)} tokens`)}`, ...(w.models.length ? [`    ${muted("models")}  ${top(w.models)}`] : []), ...(w.workspaces.length ? [`    ${muted("folders")}  ${top(w.workspaces)}`] : [])];
  };
  console.log(`${badge(colorLevel())}  ${bold("usage --spend")}`);
  for (const p of report) {
    console.log(`\n${ink.bold(p.name)}`);
    for (const r of p.ratios) console.log(ratioLine(r));
    for (const line of [...windowLines("session", p.session), ...windowLines("week", p.week)]) console.log(line);
  }
  console.log("");
  if (revisionUsd) console.log(muted(`prompt revision since the oldest week shown: ${usd(revisionUsd)}`));
  if (unattributedUsd) console.log(muted(`spend under an account that is no profile: ${usd(unattributedUsd)}`));
  console.log(muted("At the API's prices, for Claude; ChatGPT's in tokens, since OpenAI's prices aren't kept here. For a subscription the dollar is only a unit to compare with. The % comes in whole numbers, so the relation is rough until there are days of readings; dotagents start keeps them, one per minute."));
}

// The segments of a line, painted with the roles; a profile's name in its readable color.
function paintLine(line: Line) {
  return line
    .map((s) => {
      let text = s.profile ? ink.profile(s.profile)(s.text) : s.role ? ink.role(s.role)(s.text) : s.text;
      if (s.bold) text = ink.bold(text);
      return text;
    })
    .join("");
}

function terminalView(list: ProfileUsage[], now: Date) {
  console.log(`${badge(colorLevel())}  ${ink.bold("usage")}\n`);
  for (const line of usageLines(list, now)) console.log(paintLine(line));
  console.log(`\n${ink.role("muted")(`${plural(list.length, "profile")}; --refresh asks ${[...new Set(list.map((p) => LABELS[p.provider ?? "claude"].company))].join(" and ")} for fresh numbers`)}`);
}

// One line per window, easy to grep: "<profile> <window> <pct> <resets at> fetched <at>", then
// "(live)" when the numbers came from Anthropic and "(from <side>)" when from the other side.
function plainView(list: ProfileUsage[]) {
  const width = Math.max(...list.map((a) => a.name.length)) + 2;
  for (const a of list) {
    if (a.state !== "ok" && a.state !== "stale") {
      console.log(`${a.name.padEnd(width)}${a.state}`);
      continue;
    }
    for (const w of a.windows) {
      const kind = w.kind === "model-week" ? `week-${(w.model ?? "").toLowerCase()}` : w.kind;
      console.log(`${a.name.padEnd(width)}${kind.padEnd(13)}${String(w.pct).padStart(3)}  ${w.resetsAt?.toISOString() ?? "-"}  fetched ${a.fetchedAt?.toISOString()}${a.source === "live" ? "  (live)" : ""}${a.state === "stale" ? "  (stale)" : ""}${a.from ? `  (from ${a.from})` : ""}`);
    }
  }
}

export const usage: Command = {
  name: "usage",
  usage: "[--refresh] [--short] [--json] [--spend]",
  summary: "show how much of each profile's plan is used",
  more: ["from each account's last live ask, and Claude Code's cache;", "--refresh: ask Anthropic and OpenAI for fresh numbers first;", "--spend: what 1% of each window costs (Claude in dollars, ChatGPT in tokens), and where its spend went"],
  group: "Profiles",
  async run({ args }) {
    if (args.watch) throw new Error("usage --watch was removed with the full-screen view; run usage --refresh, or usage again");
    if (args.refresh) {
      // Its lines would mix into the JSON or the short line: kept, and only failures shown.
      const events = await captureAsync(() => refreshUsage({ force: true }));
      for (const e of events) if (e.kind === "result" && e.status === "failed") console.error(`${e.target}: couldn't refresh: ${e.detail}`);
    }
    if (args.spend) return spendView(Boolean(args.json));
    const now = new Date();
    // Every provider's profiles, as the start API lists them.
    const list = readAll(now);
    if (args.json) return console.log(JSON.stringify(usageJson(list, now), null, 2));
    if (args.short) return console.log(shortLines(list, now).map(paintLine).join("\n"));
    if (!fancy) return plainView(list);
    terminalView(list, now);
  },
};
