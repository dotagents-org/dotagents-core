#!/usr/bin/env python3
"""Write a direct, readable transcript of a Claude Code session.

Reads the raw JSONL transcript Claude Code keeps under
~/.claude/projects/<project-slug>/<session-id>.jsonl and writes, in order,
every user message and assistant reply (verbatim) plus a one-line entry per
tool call, to:

  <project-root>/.artifacts/session-archives/<date>-<session-id>.md

Re-running overwrites the file, so it is safe to checkpoint mid-session.

Usage:
  archive_session.py --session-id <uuid>
  archive_session.py --transcript /path/to/session.jsonl
  archive_session.py                      # newest transcript for this project
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


def find_project_root(start: Path) -> Path:
    """The skill lives in <root>/{.agents,.claude,.codex}/skills/..."""
    for parent in start.parents:
        if parent.name in (".agents", ".claude", ".codex"):
            return parent.parent
    return Path.cwd()


def find_transcript(claude_home: Path, session_id: str | None, project_root: Path) -> Path | None:
    projects = claude_home / "projects"
    if session_id:
        hits = list(projects.glob(f"*/{session_id}.jsonl"))
        return max(hits, key=lambda p: p.stat().st_mtime) if hits else None
    root = str(project_root).lower()
    for p in sorted(projects.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
        with p.open(encoding="utf-8", errors="ignore") as f:
            for line in f:
                try:
                    cwd = json.loads(line).get("cwd")
                except json.JSONDecodeError:
                    continue
                if cwd:
                    if cwd.lower() == root or cwd.lower().startswith(root + os.sep):
                        return p
                    break
    return None


def user_text(content) -> str:
    if isinstance(content, list):
        content = "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    text = SYSTEM_REMINDER.sub("", content or "").strip()
    command = COMMAND_NAME.search(text)
    if command:
        args = COMMAND_ARGS.search(text)
        return f"`{command.group(1)}{' ' + args.group(1).strip() if args and args.group(1).strip() else ''}`"
    return LOCAL_STDOUT.sub("", text).strip()


def tool_line(block: dict) -> str:
    name = block.get("name") or "unknown"
    inp = block.get("input") or {}
    for key in ("description", "command", "file_path", "path", "pattern", "query", "url", "prompt"):
        val = inp.get(key)
        if isinstance(val, str) and val:
            val = " ".join(val.split())
            return f"- `{name}` - {val[:200]}{'…' if len(val) > 200 else ''}"
    return f"- `{name}`"


def render(path: Path) -> tuple[str, str, str]:
    session_id = path.stem
    title, model, started, ended = None, None, None, None
    out: list[str] = []
    efforts: dict[str, None] = {}
    user_turns, assistant_msgs = 0, 0
    tools: Counter = Counter()
    tokens: Counter = Counter()
    seen_msgs: set[str] = set()
    tool_lines: dict[str, int] = {}  # tool_use id -> index of its line in `out`
    changed: dict[str, None] = {}
    user_edited: dict[str, None] = {}
    errors = 0
    cost: dict = {}

    with path.open(encoding="utf-8", errors="ignore") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            session_id = obj.get("sessionId") or session_id
            started = started or obj.get("timestamp")
            ended = obj.get("timestamp") or ended
            t = obj.get("type")
            if t == "ai-title":
                title = obj.get("aiTitle") or title
            if t == "cost-state":
                cost = obj
            if t == "attachment" and (obj.get("attachment") or {}).get("type") == "edited_text_file":
                user_edited[obj["attachment"].get("filename") or "?"] = None
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
                    if block.get("is_error") and not out[idx].endswith("**(error)**"):
                        errors += 1
                        out[idx] += " **(error)**"
                    answers = (obj.get("toolUseResult") or {}).get("answers") if isinstance(obj.get("toolUseResult"), dict) else None
                    if answers:
                        out[idx + 1:idx + 1] = [f"  - **{q}** {a}" for q, a in answers.items()]
                        # shift later indexes past the inserted answer lines
                        for k, v in tool_lines.items():
                            if v > idx:
                                tool_lines[k] = v + len(answers)
            elif t == "user":
                text = user_text(msg.get("content"))
                if text:
                    user_turns += 1
                    out +=["", f"## 👤 User - {(obj.get('timestamp') or '')[:16].replace('T', ' ')} UTC", "", text, ""]
            elif t == "assistant":
                model = msg.get("model") or model
                effort = obj.get("perTurnEffort") or obj.get("effort")
                if effort:
                    efforts[effort] = None
                msg_id = msg.get("id") or obj.get("uuid")
                if msg_id not in seen_msgs:
                    # one API message is split across several lines; count it once
                    seen_msgs.add(msg_id)
                    assistant_msgs += 1
                    usage = msg.get("usage") or {}
                    tokens["in"] += usage.get("input_tokens") or 0
                    tokens["out"] += usage.get("output_tokens") or 0
                    tokens["cache read"] += usage.get("cache_read_input_tokens") or 0
                    tokens["cache write"] += usage.get("cache_creation_input_tokens") or 0
                for block in msg.get("content") or []:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "text" and block.get("text", "").strip():
                        out += ["", "**🤖 Claude:**", "", block["text"].strip(), ""]
                    elif block.get("type") == "tool_use":
                        tools[block.get("name") or "unknown"] += 1
                        tool_lines[block.get("id")] = len(out)
                        out.append(tool_line(block))
                        target = (block.get("input") or {}).get("file_path") or (block.get("input") or {}).get("notebook_path")
                        if block.get("name") in ("Edit", "Write", "NotebookEdit") and target:
                            changed[target] = None

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
        f"# {title or 'Session ' + session_id}",
        "",
        "| | |",
        "|---|---|",
        f"| **Session** | `{session_id}` |",
        f"| **Model** | `{model or 'unknown'}` |",
        f"| **Started** | {when(started)} |",
        f"| **Last activity** | {when(ended)} |",
        f"| **Duration** | {duration(started, ended)} |",
        f"| **Effort** | {', '.join(efforts) or 'unknown'} |",
        f"| **Turns** | {user_turns} user, {assistant_msgs} assistant |",
        f"| **Tool calls** | {', '.join(f'{n} {c}' for n, c in tools.most_common()) or 'none'} |",
        f"| **Tokens** | {', '.join(f'{k} {short(v)}' for k, v in tokens.items())} |",
    ]
    if cost:
        header += [
            f"| **Cost** | US$ {cost.get('totalCostUSD', 0):.2f} |",
        ]

    def keep(p: str) -> bool:
        # session scratch files are temporary and only add noise
        return "\\temp\\claude\\" not in p.lower() and "/temp/claude/" not in p.lower()

    edited = [p for p in changed if keep(p)]
    outside = [p for p in user_edited if keep(p) and p not in changed]
    footer: list[str] = []
    if edited or outside:
        footer += ["", "---", "", "## 📝 Files changed", ""]
        footer += [f"- `{p}`" for p in edited]
        if outside:
            footer += ["", "Also changed outside the edit tools (by the user, or by shell commands such as `sed`/`mv`):", ""]
            footer += [f"- `{p}`" for p in outside]
        footer += ["", "Files created, moved or deleted only through shell commands are not listed."]
    return session_id, (started or "")[:10], "\n".join(header + out + footer).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--session-id", help="Claude Code session UUID (preferred: pass your own).")
    parser.add_argument("--transcript", type=Path, help="Explicit path to a session .jsonl transcript.")
    parser.add_argument("--project-root", type=Path, help="Override the detected project root.")
    parser.add_argument("--claude-home", type=Path, default=Path.home() / ".claude", help="Override ~/.claude.")
    args = parser.parse_args()

    project_root = args.project_root or find_project_root(Path(__file__).resolve())
    transcript = args.transcript or find_transcript(args.claude_home, args.session_id, project_root)
    if transcript is None or not transcript.is_file():
        print("error: transcript not found; pass --session-id or --transcript", file=sys.stderr)
        return 1

    session_id, date, markdown = render(transcript)
    out = project_root / ".artifacts" / "session-archives" / f"{date}-{session_id}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(markdown, encoding="utf-8")
    print(f"transcript written -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
