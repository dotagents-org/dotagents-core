#!/usr/bin/env python3
"""Write a direct, readable transcript of a Claude Code or Codex session.

Reads the raw JSONL transcript that each agent keeps locally:

  Claude Code: ~/.claude/projects/<project-slug>/<session-id>.jsonl
  Codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-id>.jsonl

and writes, in order, every user message and assistant reply (verbatim) plus
a one-line entry per tool call, to:

  <project-root>/.artifacts/session-archives/<date>-<session-id>.md

The format is detected from the file itself. Re-running overwrites the file,
so it is safe to checkpoint mid-session.

Usage:
  archive_session.py --session-id <uuid>          # Claude Code or Codex
  archive_session.py --transcript /path/to/session.jsonl
  archive_session.py                              # newest session for this project
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

SYSTEM_REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.DOTALL)
COMMAND_NAME = re.compile(r"<command-name>(.*?)</command-name>", re.DOTALL)
COMMAND_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.DOTALL)
LOCAL_STDOUT = re.compile(r"<local-command-stdout>.*?</local-command-stdout>", re.DOTALL)
CODEX_REQUEST = re.compile(r"^## My request:\s*$", re.MULTILINE)
CODEX_CMD = re.compile(r'\bcmd:\s*"((?:[^"\\]|\\.)*)"')
PATCH_FILE = re.compile(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$", re.MULTILINE)
# context Codex injects as user-role messages; not typed by the user
CODEX_INJECTED = ("# AGENTS.md instructions", "<environment_context>", "<skills_instructions>", "<skill>",
                  "<user_instructions>", "<external_codex_apps", "<turn_aborted>", "<permissions")


def find_project_root(start: Path) -> Path:
    """The skill lives in <root>/{.agents,.claude,.codex}/skills/..."""
    for parent in start.parents:
        if parent.name in (".agents", ".claude", ".codex"):
            return parent.parent
    return Path.cwd()


def in_project(cwd: str | None, root: str) -> bool:
    return bool(cwd) and (cwd.lower() == root or cwd.lower().startswith(root + os.sep))


def first_json(path: Path) -> dict:
    with path.open(encoding="utf-8", errors="ignore") as f:
        for line in f:
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    return {}


def codex_meta(path: Path) -> dict:
    obj = first_json(path)
    return obj.get("payload") or {} if obj.get("type") == "session_meta" else {}


def claude_cwd(path: Path) -> str | None:
    with path.open(encoding="utf-8", errors="ignore") as f:
        for line in f:
            try:
                cwd = json.loads(line).get("cwd")
            except json.JSONDecodeError:
                continue
            if cwd:
                return cwd
    return None


def find_transcript(claude_home: Path, codex_home: Path, session_id: str | None, project_root: Path) -> Path | None:
    claude = list((claude_home / "projects").glob("*/*.jsonl"))
    codex = list((codex_home / "sessions").glob("*/*/*/rollout-*.jsonl"))
    if session_id:
        hits = [p for p in claude if p.stem == session_id] + [p for p in codex if p.stem.endswith(session_id)]
        return max(hits, key=lambda p: p.stat().st_mtime) if hits else None
    root = str(project_root).lower()
    for p in sorted(claude + codex, key=lambda p: p.stat().st_mtime, reverse=True):
        if p in codex:
            meta = codex_meta(p)
            # subagent threads are separate files; archive only top-level sessions
            if meta.get("thread_source") != "subagent" and in_project(meta.get("cwd"), root):
                return p
        elif in_project(claude_cwd(p), root):
            return p
    return None


def one_line(label: str, val: str) -> str:
    val = " ".join(val.split())
    return f"- `{label}` - {val[:200]}{'…' if len(val) > 200 else ''}"


class Session:
    """What both parsers collect; `markdown()` lays it out the same way."""

    def __init__(self, session_id: str, agent: str):
        self.session_id, self.agent = session_id, agent
        self.title = self.model = self.started = self.ended = None
        self.out: list[str] = []
        self.efforts: dict[str, None] = {}
        self.user_turns = self.assistant_msgs = 0
        self.tools: Counter = Counter()
        self.tokens: Counter = Counter()
        self.changed: dict[str, None] = {}
        self.user_edited: dict[str, None] = {}
        self.cost: dict = {}

    def stamp(self, ts: str | None) -> None:
        if ts:
            self.started = self.started or ts
            self.ended = ts

    def user(self, text: str, ts: str | None) -> None:
        self.user_turns += 1
        self.out += ["", f"## 👤 User - {(ts or '')[:16].replace('T', ' ')} UTC", "", text, ""]

    def assistant(self, text: str) -> None:
        self.out += ["", f"**🤖 {self.agent}:**", "", text, ""]

    def markdown(self) -> str:
        def duration(a: str | None, b: str | None) -> str:
            if not a or not b:
                return "?"
            secs = int((datetime.fromisoformat(b.replace("Z", "+00:00")) - datetime.fromisoformat(a.replace("Z", "+00:00"))).total_seconds())
            h, m = divmod(secs // 60, 60)
            return f"{h} h {m} min" if h else f"{m} min"

        def short(n: int) -> str:
            return f"{n / 1e6:.1f}M" if n >= 1e6 else f"{n / 1e3:.0f}k" if n >= 1e3 else str(n)

        def when(ts: str | None) -> str:
            return f"{ts[:10]} {ts[11:16]} UTC" if ts and len(ts) >= 16 else "?"

        header = [
            f"# {self.title or f'{self.agent} session ' + self.session_id}",
            "",
            "| | |",
            "|---|---|",
            f"| **Agent** | {self.agent} |",
            f"| **Session** | `{self.session_id}` |",
            f"| **Model** | `{self.model or 'unknown'}` |",
            f"| **Started** | {when(self.started)} |",
            f"| **Last activity** | {when(self.ended)} |",
            f"| **Duration** | {duration(self.started, self.ended)} |",
            f"| **Effort** | {', '.join(self.efforts) or 'unknown'} |",
            f"| **Turns** | {self.user_turns} user, {self.assistant_msgs} assistant |",
            f"| **Tool calls** | {', '.join(f'{n} {c}' for n, c in self.tools.most_common()) or 'none'} |",
            f"| **Tokens** | {', '.join(f'{k} {short(v)}' for k, v in self.tokens.items()) or 'unknown'} |",
        ]
        if self.cost:
            header.append(f"| **Cost** | US$ {self.cost.get('totalCostUSD', 0):.2f} |")

        def keep(p: str) -> bool:
            # session scratch files are temporary and only add noise
            low = p.lower()
            return "\\temp\\claude\\" not in low and "/temp/claude/" not in low and "/tmp/claude-" not in low

        edited = [p for p in self.changed if keep(p)]
        outside = [p for p in self.user_edited if keep(p) and p not in self.changed]
        footer: list[str] = []
        if edited or outside:
            footer += ["", "---", "", "## 📝 Files changed", ""]
            footer += [f"- `{p}`" for p in edited]
            if outside:
                footer += ["", "Also changed outside the edit tools (by the user, or by shell commands such as `sed`/`mv`):", ""]
                footer += [f"- `{p}`" for p in outside]
            footer += ["", "Files created, moved or deleted only through shell commands are not listed."]
        return "\n".join(header + self.out + footer).rstrip() + "\n"


def claude_user_text(content) -> str:
    if isinstance(content, list):
        content = "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    text = SYSTEM_REMINDER.sub("", content or "").strip()
    command = COMMAND_NAME.search(text)
    if command:
        args = COMMAND_ARGS.search(text)
        return f"`{command.group(1)}{' ' + args.group(1).strip() if args and args.group(1).strip() else ''}`"
    return LOCAL_STDOUT.sub("", text).strip()


def claude_tool_line(block: dict) -> str:
    name = block.get("name") or "unknown"
    inp = block.get("input") or {}
    for key in ("description", "command", "file_path", "path", "pattern", "query", "url", "prompt"):
        val = inp.get(key)
        if isinstance(val, str) and val:
            return one_line(name, val)
    return f"- `{name}`"


def parse_claude(path: Path) -> Session:
    s = Session(path.stem, "Claude")
    seen_msgs: set[str] = set()
    tool_lines: dict[str, int] = {}  # tool_use id -> index of its line in `s.out`
    with path.open(encoding="utf-8", errors="ignore") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            s.session_id = obj.get("sessionId") or s.session_id
            s.stamp(obj.get("timestamp"))
            t = obj.get("type")
            if t == "ai-title":
                s.title = obj.get("aiTitle") or s.title
            if t == "cost-state":
                s.cost = obj
            if t == "attachment" and (obj.get("attachment") or {}).get("type") == "edited_text_file":
                s.user_edited[obj["attachment"].get("filename") or "?"] = None
            if obj.get("isSidechain") or obj.get("isMeta"):
                continue
            msg = obj.get("message") or {}
            content = msg.get("content")
            is_tool_result = isinstance(content, list) and any(
                isinstance(b, dict) and b.get("type") == "tool_result" for b in content)
            if t == "user" and ("toolUseResult" in obj or is_tool_result):
                for block in content if isinstance(content, list) else []:
                    if not isinstance(block, dict) or block.get("type") != "tool_result":
                        continue
                    idx = tool_lines.get(block.get("tool_use_id"))
                    if idx is None:
                        continue
                    if block.get("is_error") and not s.out[idx].endswith("**(error)**"):
                        s.out[idx] += " **(error)**"
                    result = obj.get("toolUseResult")
                    answers = result.get("answers") if isinstance(result, dict) else None
                    if answers:
                        s.out[idx + 1:idx + 1] = [f"  - **{q}** {a}" for q, a in answers.items()]
                        # shift later indexes past the inserted answer lines
                        for k, v in tool_lines.items():
                            if v > idx:
                                tool_lines[k] = v + len(answers)
            elif t == "user":
                text = claude_user_text(msg.get("content"))
                if text:
                    s.user(text, obj.get("timestamp"))
            elif t == "assistant":
                s.model = msg.get("model") or s.model
                effort = obj.get("perTurnEffort") or obj.get("effort")
                if effort:
                    s.efforts[effort] = None
                msg_id = msg.get("id") or obj.get("uuid")
                if msg_id not in seen_msgs:
                    # one API message is split across several lines; count it once
                    seen_msgs.add(msg_id)
                    s.assistant_msgs += 1
                    usage = msg.get("usage") or {}
                    s.tokens["in"] += usage.get("input_tokens") or 0
                    s.tokens["out"] += usage.get("output_tokens") or 0
                    s.tokens["cache read"] += usage.get("cache_read_input_tokens") or 0
                    s.tokens["cache write"] += usage.get("cache_creation_input_tokens") or 0
                for block in msg.get("content") or []:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "text" and block.get("text", "").strip():
                        s.assistant(block["text"].strip())
                    elif block.get("type") == "tool_use":
                        s.tools[block.get("name") or "unknown"] += 1
                        tool_lines[block.get("id")] = len(s.out)
                        s.out.append(claude_tool_line(block))
                        inp = block.get("input") or {}
                        target = inp.get("file_path") or inp.get("notebook_path")
                        if block.get("name") in ("Edit", "Write", "NotebookEdit") and target:
                            s.changed[target] = None
    return s


def codex_user_text(text: str) -> str:
    # the IDE extension prepends open tabs; keep only what the user typed
    m = CODEX_REQUEST.search(text or "")
    return (text[m.end():] if m else text or "").strip()


def codex_tool_line(name: str, raw: str) -> str:
    if name == "exec" and "apply_patch(" in raw:
        files = PATCH_FILE.findall(raw.replace("\\n", "\n"))
        return one_line("apply_patch", ", ".join(files)) if files else "- `apply_patch`"
    if name == "exec":
        m = CODEX_CMD.search(raw)
        if m:
            cmd = m.group(1).encode().decode("unicode_escape", errors="ignore")
            return one_line("exec", cmd.splitlines()[0] if cmd.strip() else cmd)
    try:
        args = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        args = None
    if isinstance(args, dict):
        for key in ("description", "cmd", "command", "task_name", "path", "query", "url", "target"):
            val = args.get(key)
            if isinstance(val, str) and val:
                return one_line(name, val)
            if isinstance(val, list) and val:
                return one_line(name, " ".join(map(str, val)))
    if name == "apply_patch":
        files = PATCH_FILE.findall(raw or "")
        if files:
            return one_line(name, ", ".join(files))
    return f"- `{name}`"


def parse_codex(path: Path) -> Session:
    meta = codex_meta(path)
    s = Session(meta.get("id") or path.stem, "Codex")
    tool_lines: dict[str, int] = {}  # call_id -> index of its line in `s.out`
    with path.open(encoding="utf-8", errors="ignore") as f:
        # newer Codex logs the typed text as an event; older logs only keep the user-role message
        user_events = any('"user_message"' in line for line in f)
    with path.open(encoding="utf-8", errors="ignore") as f:
        for line in f:
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            s.stamp(obj.get("timestamp"))
            t, p = obj.get("type"), obj.get("payload") or {}
            pt = p.get("type")
            if t == "turn_context":
                s.model = p.get("model") or s.model
                if p.get("effort"):
                    s.efforts[p["effort"]] = None
            elif t == "event_msg" and pt == "thread_settings_applied":
                s.model = (p.get("thread_settings") or {}).get("model") or s.model
            elif t == "event_msg" and pt == "user_message":
                text = codex_user_text(p.get("message") or "")
                if text:
                    s.user(text, obj.get("timestamp"))
            elif t == "event_msg" and pt == "token_count":
                total = (p.get("info") or {}).get("total_token_usage") or {}
                if total:
                    s.tokens = Counter({"in": total.get("input_tokens") or 0, "out": total.get("output_tokens") or 0,
                                        "cache read": total.get("cached_input_tokens") or 0,
                                        "reasoning": total.get("reasoning_output_tokens") or 0})
            elif t == "event_msg" and pt == "web_search_end":
                s.tools["web_search"] += 1
                s.out.append(one_line("web_search", p.get("query") or ""))
            elif t == "response_item" and pt == "message" and p.get("role") == "user" and not user_events:
                text = "\n".join(c.get("text", "") for c in p.get("content") or []
                                 if isinstance(c, dict) and c.get("type") in ("input_text", "text")).strip()
                if text and not text.startswith(CODEX_INJECTED):
                    s.user(codex_user_text(text), obj.get("timestamp"))
            elif t == "response_item" and pt == "message" and p.get("role") == "assistant":
                text = "\n".join(c.get("text", "") for c in p.get("content") or []
                                 if isinstance(c, dict) and c.get("type") in ("output_text", "text")).strip()
                if text:
                    s.assistant_msgs += 1
                    s.assistant(text)
            elif t == "response_item" and pt in ("function_call", "custom_tool_call"):
                name = p.get("name") or "unknown"
                raw = p.get("arguments") if pt == "function_call" else p.get("input")
                raw = raw if isinstance(raw, str) else json.dumps(raw or {})
                s.tools[name] += 1
                tool_lines[p.get("call_id")] = len(s.out)
                s.out.append(codex_tool_line(name, raw))
                for target in PATCH_FILE.findall(raw.replace("\\n", "\n")):
                    s.changed[target.strip()] = None
            elif t == "response_item" and pt in ("function_call_output", "custom_tool_call_output"):
                idx = tool_lines.get(p.get("call_id"))
                output = p.get("output")
                if isinstance(output, list):
                    output = "".join(c.get("text", "") for c in output if isinstance(c, dict))
                text = output if isinstance(output, str) else ""
                failed = (pt == "custom_tool_call_output" and text and not text.startswith("Script completed")) \
                    or re.search(r"Process exited with code [1-9]", text)
                if idx is not None and failed and not s.out[idx].endswith("**(error)**"):
                    s.out[idx] += " **(error)**"
    return s


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--session-id", help="Claude Code or Codex session UUID (preferred: pass your own).")
    parser.add_argument("--transcript", type=Path, help="Explicit path to a session .jsonl transcript.")
    parser.add_argument("--project-root", type=Path, help="Override the detected project root.")
    parser.add_argument("--claude-home", type=Path, default=Path.home() / ".claude", help="Override ~/.claude.")
    parser.add_argument("--codex-home", type=Path, default=Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex"),
                        help="Override ~/.codex (defaults to $CODEX_HOME when set).")
    args = parser.parse_args()

    project_root = args.project_root or find_project_root(Path(__file__).resolve())
    transcript = args.transcript or find_transcript(args.claude_home, args.codex_home, args.session_id, project_root)
    if transcript is None or not transcript.is_file():
        print("error: transcript not found; pass --session-id or --transcript", file=sys.stderr)
        return 1

    session = parse_codex(transcript) if codex_meta(transcript) else parse_claude(transcript)
    out = project_root / ".artifacts" / "session-archives" / f"{(session.started or '')[:10]}-{session.session_id}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(session.markdown(), encoding="utf-8")
    print(f"{session.agent} transcript written -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
