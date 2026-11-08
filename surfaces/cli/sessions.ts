// `sessions` lists Claude Code's sessions on both sides of the machine; `sessions rm` deletes the
// ones picked, archiving each first into its project's .artifacts/session-archives/ when there is
// one. A session without that folder, or whose archive failed, is deleted only when the user says
// so; --yes never deletes one whose archive failed. --no-archive deletes without archiving any.

import path from "node:path";
import * as p from "@clack/prompts";
import type { AccountLabels } from "../../skills/session-archive/scripts/archive-session.ts";
import { UsageError } from "../../core/common.ts";
import { checkWarn, displayPath, fancy, finish, header, interactive, line, report, section, tone } from "../../core/output.ts";
import { RECENT_MS, type Session, accountLabels, archiveSession, deleteSession, listSessions, peerRunning, runningIds } from "../../core/sessions.ts";
import { state } from "../../core/state.ts";
import { type Command, type Context, fitHint, workspaceArg } from "./shared.ts";

const { bold, muted, warn } = tone;

const pad = (n: number) => String(n).padStart(2, "0");
function when(s: Session) {
  const d = new Date(s.ended ?? s.mtime);
  if (Number.isNaN(d.getTime())) return "?";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const size = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

// The profile's name alone in a list ("turing", not "turing (me@example.com)").
const shortLabel = (uuid: string, labels: AccountLabels) => (labels.get(uuid) ?? uuid.slice(0, 8)).replace(/ \(.*\)$/, "");

function accountsShort(s: Session, labels: AccountLabels) {
  if (!s.accounts.length) return "account unknown";
  const names = s.accounts.map((a) => shortLabel(a, labels)).join(" + ");
  return s.accounts.length > 1 ? `${names} (shared)` : names;
}

const archiveNote = (s: Session) => (s.root ? `archives to ${displayPath(s.root)}` : "no .artifacts, not archived");

function details(s: Session, labels: AccountLabels, withProject: boolean) {
  return [s.side, accountsShort(s, labels), size(s.bytes), withProject ? displayPath(s.localCwd ?? s.cwd ?? "?") : "", archiveNote(s), s.running ? "running" : ""].filter(Boolean).join("  ");
}

function json(list: Session[], labels: AccountLabels) {
  return list.map((s) => ({
    id: s.id,
    side: s.side,
    title: s.title,
    cwd: s.cwd,
    started: s.started,
    ended: s.ended,
    bytes: s.bytes,
    accounts: s.accounts.map((uuid) => ({ uuid, label: labels.get(uuid) ?? null })),
    shared: s.accounts.length > 1,
    archiveRoot: s.root,
    running: s.running,
    file: s.file,
  }));
}

// The folder a command lists, or every project's with --all.
const scope = (ctx: Context) => (ctx.args.all ? undefined : workspaceArg(ctx));

export const sessions: Command = {
  name: "sessions",
  usage: "[path] [--all]",
  summary: "list Claude Code's sessions, on both sides of the machine",
  more: ["the ones started in this folder; --all: every project's"],
  group: "Workspace",
  run(ctx) {
    // For the other side's `sessions rm`: the ids of the sessions this side's Claude Code runs.
    if (ctx.args.running) return void [...runningIds()].forEach((id) => console.log(id));
    const under = scope(ctx);
    const list = listSessions({ under });
    const labels = accountLabels();
    if (ctx.args.json) return console.log(JSON.stringify(json(list, labels), null, 2));
    if (!fancy) {
      for (const s of list) console.log([s.id, s.side, when(s), s.bytes, s.running ? "running" : "-", s.root ?? "-", s.accounts.join("+") || "-", s.title].join("\t"));
      return;
    }
    header("sessions", under ?? "every project");
    line();
    if (!list.length) return line(muted(under ? "No sessions started here. --all lists every project's.\n" : "No sessions.\n"));
    for (const s of list) {
      line(`  ${muted(when(s))}  ${bold(s.id.slice(0, 8))}  ${s.title}`);
      line(`  ${" ".repeat(28)}${(s.running ? warn : muted)(details(s, labels, !under))}`);
    }
    line();
    line(muted(`${list.length} session${list.length === 1 ? "" : "s"}. Delete some with: dotagents sessions rm${under ? "" : " --all"}`));
    line();
  },
};

// A side whose dotagents couldn't say which sessions it runs: said once, before anything is picked.
function warnUnchecked(list: Session[]) {
  const sides = [...new Set(list.filter((s) => !s.checked).map((s) => s.side))];
  for (const side of sides) {
    checkWarn(`couldn't ask ${side} which sessions run there`, `a session idle there for over ${RECENT_MS / 60_000} minutes counts as stopped; close it there first, and update dotagents there with: dotagents update`);
  }
}

// Ids, or unique starts of ids, to sessions; an unknown or ambiguous one fails.
function byIds(ids: string[], all: Session[]) {
  return ids.map((id) => {
    const hits = all.filter((s) => s.id.startsWith(id));
    if (hits.length === 1) return hits[0];
    throw new Error(hits.length ? `${id} matches ${hits.length} sessions; give more of the id` : `There is no session ${id}. List them with: dotagents sessions --all`);
  });
}

async function ask(message: string, initialValue: boolean) {
  const answer = await p.confirm({ message, initialValue });
  if (p.isCancel(answer)) {
    p.cancel("Nothing was deleted.");
    process.exit(0);
  }
  return answer;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What happens to the sessions picked: archived first, deleted without an archive, or nothing.
type Mode = "archive" | "bare" | "cancel";

const folders = (list: Session[], dir: (s: Session) => string | null) => [...new Set(list.map((s) => path.basename(dir(s) ?? "?")))].join(", ");

// "1 into app-workspace; 1 has no .artifacts (asks next)".
function archiveHint(doomed: Session[]) {
  const into = doomed.filter((s) => s.root);
  const bare = doomed.length - into.length;
  return `${into.length} into ${folders(into, (s) => s.root)}${bare ? `; ${bare} ${bare === 1 ? "has" : "have"} no .artifacts (asks next)` : ""}`;
}

async function chooseMode(doomed: Session[]): Promise<Mode> {
  const archivable = doomed.some((s) => s.root);
  if (!archivable) line(muted(`  None of them can be archived: ${folders(doomed, (s) => s.localCwd ?? s.cwd)} has no .artifacts/session-archives/`));
  const mode = await p.select<Mode>({
    message: `What should happen to ${plural(doomed.length, "session")}?`,
    initialValue: "cancel",
    options: [
      ...(archivable ? [{ value: "archive" as const, label: "Archive, then delete", hint: archiveHint(doomed) }] : []),
      { value: "bare", label: "Delete without archiving" },
      { value: "cancel", label: "Cancel" },
    ],
  });
  return p.isCancel(mode) ? "cancel" : mode;
}

export const sessionsRm: Command = {
  name: "sessions rm",
  usage: "[ids…]",
  summary: "delete sessions, archiving each into .artifacts first",
  more: ["without ids, search and pick from this folder's (--all: every project's);", "then archive and delete, delete without archiving, or cancel;", "--no-archive: delete without archiving"],
  group: "Workspace",
  async run(ctx) {
    const { args, positional } = ctx;
    const ask_ = interactive && !args.yes && !state.dryRun;
    if (!interactive && !args.yes && !state.dryRun) throw new UsageError("Add --yes to delete without a terminal to confirm in, or --dry-run to see what would go");
    let chosen: Session[];
    if (positional.length) {
      chosen = byIds(positional, listSessions({ peerRunning }));
      header("sessions rm");
      warnUnchecked(chosen);
    } else {
      if (!interactive) throw new UsageError("Pass the ids to delete (dotagents sessions lists them), or run it in a terminal to pick them");
      const under = scope(ctx);
      const pool = listSessions({ under, peerRunning });
      const labels = accountLabels();
      header("sessions rm", under ?? "every project");
      warnUnchecked(pool);
      const free = pool.filter((s) => !s.running);
      if (!free.length) {
        line();
        line(muted(pool.length ? "Every session here is running." : under ? "No sessions started here. --all picks from every project's." : "No sessions."));
        return;
      }
      // Searched by everything a row shows: title, folder, side, account, archive folder.
      const searchable = new Map(free.map((s) => [s.id, `${when(s)} ${s.title} ${details(s, labels, true)}`.toLowerCase()]));
      const picked = await p.autocompleteMultiselect({
        message: "Which sessions should be deleted?",
        placeholder: "Type to search: title, folder, side, account",
        maxItems: 8,
        options: free.map((s) => {
          const label = `${when(s)}  ${s.title}`;
          return { value: s.id, label, hint: fitHint(details(s, labels, !under), label) };
        }),
        filter: (search, option) => searchable.get(option.value)!.includes(search.trim().toLowerCase()),
      });
      if (p.isCancel(picked) || !picked.length) {
        p.cancel("Nothing was deleted.");
        process.exit(0);
      }
      chosen = free.filter((s) => picked.includes(s.id));
    }

    const running = chosen.filter((s) => s.running);
    const doomed = chosen.filter((s) => !s.running);
    if (running.length) section("Plan");
    for (const s of running) report("skipped", s.file, `${s.id.slice(0, 8)} is still running; close it first`);
    if (!doomed.length) return finish();

    // --no-archive and --yes answer for the user; --dry-run shows the archiving way.
    const mode: Mode = args["no-archive"] ? "bare" : ask_ ? await chooseMode(doomed) : "archive";
    if (mode === "cancel") {
      p.cancel("Nothing was deleted.");
      return;
    }
    const archive = mode === "archive";
    const bare = doomed.filter((s) => !s.root);
    if (!ask_) {
      section("Plan");
      if (!archive) line(`  ${warn(`${plural(doomed.length, "session")} deleted without an archive (--no-archive)`)}`);
      else {
        line(`  ${plural(doomed.length - bare.length, "session")} archived, then deleted`);
        if (bare.length) line(`  ${warn(`${plural(bare.length, "session")} deleted without an archive: ${folders(bare, (s) => s.localCwd ?? s.cwd)} has no .artifacts/session-archives/`)}`);
      }
    }
    if (ask_ && archive && bare.length && !(await ask(`${plural(bare.length, "session")} can't be archived first. Delete ${bare.length === 1 ? "it" : "them"} anyway?`, false))) {
      doomed.splice(0, doomed.length, ...doomed.filter((s) => s.root));
      for (const s of bare) report("ok", s.file, "kept, as answered");
    }

    const labels = accountLabels();
    section("Sessions");
    for (const s of doomed) {
      if (!archive) {
        // Asked for: nothing to warn about.
      } else if (s.root) {
        const archived = archiveSession(s, labels);
        if (!archived.ok) {
          const keep = !ask_ || !(await ask(`Couldn't archive ${s.id.slice(0, 8)} (${archived.error}). Delete it anyway?`, false));
          if (keep) {
            report("skipped", s.file, "kept: its archive failed");
            continue;
          }
        }
      } else {
        checkWarn(`${s.id.slice(0, 8)} not archived`, `${displayPath(s.localCwd ?? s.cwd ?? "?")} has no .artifacts/session-archives/`);
      }
      deleteSession(s);
    }
    finish();
  },
};
