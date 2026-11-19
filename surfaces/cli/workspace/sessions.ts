// `sessions` lists Claude Code's and Codex's sessions on both sides of the machine; `sessions rm`
// deletes the ones picked, after one question in a terminal. A running one goes only when the user
// says so there; --yes never deletes one. (The archive skill writes a session to .artifacts/sessions/.)

import type { AccountLabels } from "../../../skills/archive/scripts/archive-session.ts";
import { UsageError } from "../../../core/common.ts";
import { checkWarn, displayPath, fancy, finish, header, ink, interactive, line, report, section, tone } from "../../../core/output/output.ts";
import { RECENT_MS, type Session, accountColors, accountLabels, deleteSession, listSessions, peerRunning, runningIds } from "../../../core/sessions/sessions.ts";
import { state } from "../../../core/state.ts";
import { plural, type Command, type Context, fitHint, workspaceArg } from "../shared.ts";
import { loadPrompts } from "../prompts.ts";

const { bold, muted, warn } = tone;

const pad = (n: number) => String(n).padStart(2, "0");
function when(s: Session) {
  const d = new Date(s.ended ?? s.mtime);
  if (Number.isNaN(d.getTime())) return "?";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const size = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

// The profile's name alone in a list ("work", not "work (me@example.com)").
const shortLabel = (uuid: string, labels: AccountLabels) => (labels.get(uuid) ?? uuid.slice(0, 8)).replace(/ \(.*\)$/, "");

function accountsShort(s: Session, labels: AccountLabels) {
  if (!s.accounts.length) return "account unknown";
  const names = s.accounts.map((a) => shortLabel(a, labels)).join(" + ");
  return s.accounts.length > 1 ? `${names} (shared)` : names;
}

const agentName = (s: Session) => (s.agent === "codex" ? "Codex" : "Claude Code");

function details(s: Session, labels: AccountLabels, withProject: boolean) {
  return [agentName(s), s.side, accountsShort(s, labels), size(s.bytes), withProject ? displayPath(s.localCwd ?? s.cwd ?? "?") : "", s.running ? "running" : ""].filter(Boolean).join("  ");
}

// The same details for the terminal: the account in its profile's color, what needs attention
// (running, nothing to archive into) in the warning color, the rest muted.
function paintedDetails(s: Session, labels: AccountLabels, colors: Map<string, string>, withProject: boolean) {
  const account = s.accounts.length
    ? s.accounts.map((a) => (colors.has(a) ? ink.profile(colors.get(a)!)(shortLabel(a, labels)) : muted(shortLabel(a, labels)))).join(muted(" + ")) + (s.accounts.length > 1 ? muted(" (shared)") : "")
    : muted("account unknown");
  return [
    muted(agentName(s)),
    muted(s.side),
    account,
    muted(size(s.bytes)),
    withProject ? muted(displayPath(s.localCwd ?? s.cwd ?? "?")) : "",
    s.running ? bold(warn("running")) : "",
  ]
    .filter(Boolean)
    .join("  ");
}

function json(list: Session[], labels: AccountLabels) {
  return list.map((s) => ({
    id: s.id,
    agent: s.agent,
    side: s.side,
    title: s.title,
    cwd: s.cwd,
    started: s.started,
    ended: s.ended,
    bytes: s.bytes,
    accounts: s.accounts.map((uuid) => ({ uuid, label: labels.get(uuid) ?? null })),
    shared: s.accounts.length > 1,
    running: s.running,
    file: s.file,
  }));
}

// The folder a command lists, or every project's with --all.
const scope = (ctx: Context) => (ctx.args.all ? undefined : workspaceArg(ctx));

// --agent claude|codex: only that agent's sessions
function agentArg(ctx: Context): Session["agent"] | undefined {
  const agent = ctx.args.agent;
  if (agent !== undefined && agent !== "claude" && agent !== "codex") throw new UsageError(`--agent is claude or codex, not ${agent}`);
  return agent;
}

export const sessions: Command = {
  name: "sessions",
  usage: "[path] [--all] [--agent claude|codex]",
  summary: "list Claude Code's and Codex's sessions, on both sides of the machine",
  more: ["the ones started in this folder; --all: every project's; --agent: only one agent's"],
  group: "Workspace",
  run(ctx) {
    // For the other side's `sessions rm`: the ids of the sessions this side's Claude Code runs.
    if (ctx.args.running) return void [...runningIds()].forEach((id) => console.log(id));
    const under = scope(ctx);
    const list = listSessions({ under, agent: agentArg(ctx), warn: console.error });
    const labels = accountLabels();
    if (ctx.args.json) return console.log(JSON.stringify(json(list, labels), null, 2));
    if (!fancy) {
      for (const s of list) console.log([s.id, s.agent, s.side, when(s), s.bytes, s.running ? "running" : "-", s.accounts.join("+") || "-", s.title].join("\t"));
      return;
    }
    const colors = accountColors();
    header("sessions", under ?? "every project");
    line();
    if (!list.length) return line(muted(under ? "No sessions started here. --all lists every project's.\n" : "No sessions.\n"));
    for (const s of list) {
      line(`  ${muted(when(s))}  ${bold(s.id.slice(0, 8))}  ${s.title}`);
      line(`  ${" ".repeat(28)}${paintedDetails(s, labels, colors, !under)}`);
    }
    line();
    line(muted(`${plural(list.length, "session")}. Delete some with: dotagents sessions rm${under ? "" : " --all"}`));
    line();
  },
};

// A side whose sessions can't be looked into: said once, before anything is picked. Claude Code's from the
// other side are asked of that side's dotagents, and fall back on the time; Codex's can't be seen at all
// there (or on Windows), so deleting one asks for a confirmation in a terminal, which --yes never gives.
function warnUnchecked(list: Session[]) {
  const claude = [...new Set(list.filter((s) => s.agent === "claude" && !s.checked).map((s) => s.side))];
  for (const side of claude) {
    checkWarn(`couldn't ask ${side} which sessions run there`, `a session idle there for over ${RECENT_MS / 60_000} minutes counts as stopped; close it there first, and update dotagents there with: dotagents update`);
  }
  const codex = [...new Set(list.filter((s) => s.agent === "codex" && !s.checked).map((s) => s.side))];
  for (const side of codex) {
    checkWarn(`can't see which Codex conversations are open on ${side}`, "deleting one there needs your confirmation in a terminal (--yes doesn't give it), and Codex closed on it first");
  }
}

// Ids, or unique starts of ids, to sessions; an unknown or ambiguous one fails.
export function byIds(ids: string[], all: Session[]) {
  return ids.map((id) => {
    const hits = all.filter((s) => s.id.startsWith(id));
    if (hits.length === 1) return hits[0];
    throw new Error(hits.length ? `${id} matches ${hits.length} sessions; give more of the id` : `There is no session ${id}. List them with: dotagents sessions --all`);
  });
}

async function ask(message: string, initialValue: boolean) {
  const p = await loadPrompts();
  const answer = await p.confirm({ message, initialValue });
  if (p.isCancel(answer)) {
    p.cancel("Nothing was deleted.");
    process.exit(0);
  }
  return answer;
}


export const sessionsRm: Command = {
  name: "sessions rm",
  usage: "[ids…]",
  summary: "delete sessions",
  more: ["without ids, search and pick from this folder's (--all: every project's);", "then confirm; a running one is deleted only when you say so in a terminal"],
  group: "Workspace",
  async run(ctx) {
    const { args, positional } = ctx;
    const ask_ = interactive && !args.yes && !state.dryRun;
    if (!interactive && !args.yes && !state.dryRun) throw new UsageError("Add --yes to delete without a terminal to confirm in, or --dry-run to see what would go");
    let chosen: Session[];
    if (positional.length) {
      chosen = byIds(positional, listSessions({ peerRunning, agent: agentArg(ctx), warn: console.error }));
      header("sessions rm");
      warnUnchecked(chosen);
    } else {
      if (!interactive) throw new UsageError("Pass the ids to delete (dotagents sessions lists them), or run it in a terminal to pick them");
      const under = scope(ctx);
      const pool = listSessions({ under, peerRunning, agent: agentArg(ctx), warn: console.error });
      const labels = accountLabels();
      header("sessions rm", under ?? "every project");
      warnUnchecked(pool);
      // Running sessions are listed too, marked running: deleting one asks once more.
      const free = pool;
      if (!free.length) {
        line();
        line(muted(under ? "No sessions started here. --all picks from every project's." : "No sessions."));
        return;
      }
      // Searched by everything a row shows: title, folder, side, account, archive folder.
      // One key per row, not the id: the same conversation may be on both sides, and marking one is not marking both
      const keyOf = (s: Session) => `${s.side}\u0000${s.file}`;
      const searchable = new Map(free.map((s) => [keyOf(s), `${when(s)} ${s.title} ${details(s, labels, true)}`.toLowerCase()]));
      const p = await loadPrompts();
      const picked = await p.autocompleteMultiselect({
        message: "Which sessions should be deleted?",
        placeholder: "Type to search: title, folder, side, account",
        maxItems: 8,
        options: free.map((s) => {
          const label = `${when(s)}  ${s.title}`;
          return { value: keyOf(s), label, hint: fitHint(details(s, labels, !under), label) };
        }),
        filter: (search, option) => searchable.get(option.value)!.includes(search.trim().toLowerCase()),
      });
      if (p.isCancel(picked) || !picked.length) {
        p.cancel("Nothing was deleted.");
        process.exit(0);
      }
      chosen = free.filter((s) => picked.includes(keyOf(s)));
    }

    // A running session goes only when the user says so in a terminal, its Claude Code ended first on
    // this side. --yes doesn't answer this one. A Codex conversation dotagents can't see the processes
    // of (the other side, Windows) can't be said stopped: it asks like a running one. One it sees open
    // here is never asked about: close it first.
    const unsure = (s: Session) => s.agent === "codex" && !s.checked;
    const running = chosen.filter((s) => s.running || unsure(s));
    const doomed = chosen.filter((s) => !running.includes(s));
    let alsoRunning: Session[] = [];
    if (running.length && ask_) {
      const askable = running.filter((s) => s.agent !== "codex" || (unsure(s) && !s.rolloutOpen));
      // What happens to each agent's: Claude Code's process is closed first on this side; Codex's can't be
      // closed by dotagents, and its delete may reach a conversation a running Codex owns
      const claude = askable.filter((s) => s.agent === "claude");
      const codex = askable.filter((s) => s.agent === "codex");
      const here = claude.filter((s) => s.pid !== null).length;
      const what = [
        claude.length ? (here === claude.length ? "Claude Code is closed first" : here ? "Claude Code is closed first on this side, and on the other only its files go" : "Claude Code on the other side can't be closed from here: only its files go, close it there") : "",
        codex.length ? "Codex is not closed: codex delete may reach a conversation it still has open, so close it first" : "",
      ].filter(Boolean).join("; ");
      const word = askable.some((s) => s.running) ? "still running" : "possibly still open";
      if (askable.length && (await ask(`${plural(askable.length, "session")} ${askable.length === 1 ? "is" : "are"} ${word}. Delete ${askable.length === 1 ? "it" : "them"} anyway? (${what})`, false))) alsoRunning = askable;
    }
    const kept = running.filter((s) => !alsoRunning.includes(s));
    if (kept.length) section("Plan");
    for (const s of kept) {
      const why = s.agent === "codex" && (s.checked || s.rolloutOpen) ? "close it first" : ask_ ? "kept, as answered" : "confirm in a terminal to delete it";
      report("skipped", s.file, `${s.id.slice(0, 8)} ${s.running ? "is still running" : "may still be open"}; ${why}`);
    }
    doomed.push(...alsoRunning);
    if (!doomed.length) return finish();

    // --yes answers for the user; --dry-run shows what would go.
    if (ask_ && !(await ask(`Delete ${plural(doomed.length, "session")}? It can't be brought back.`, false))) {
      (await loadPrompts()).cancel("Nothing was deleted.");
      return;
    }
    if (!ask_) {
      section("Plan");
      line(`  ${plural(doomed.length, "session")} deleted`);
    }
    section("Sessions");
    for (const s of doomed) deleteSession(s, { evenRunning: alsoRunning.includes(s) });
    finish();
  },
};
