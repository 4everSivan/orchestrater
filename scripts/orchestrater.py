#!/usr/bin/env python3
"""Project-local Orca agent orchestrator."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CONFIG_DIR = ".orchestrater"
CONFIG_FILE = "agents.json"
DEFAULT_AGENTS = [
    {"name": "codex", "command": "codex", "role": "implementation"},
    {"name": "claude", "command": "claude", "role": "review"},
    {"name": "agy", "command": "agy", "role": "research"},
]


class OrchestraterError(RuntimeError):
    pass


@dataclass
class CommandResult:
    ok: bool
    data: dict[str, Any] | None
    stdout: str
    stderr: str
    returncode: int


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def config_path(root: Path) -> Path:
    return root / CONFIG_DIR / CONFIG_FILE


def default_config() -> dict[str, Any]:
    agents = []
    for item in DEFAULT_AGENTS:
        name = item["name"]
        agents.append(
            {
                "name": name,
                "command": item["command"],
                "role": item["role"],
                "enabled": True,
                "title": f"orchestrater:{name}",
                "terminalHandle": None,
                "lastSeenAt": None,
            }
        )
    return {
        "version": 1,
        "worktreeMode": "active",
        "defaults": {
            "agents": [item["name"] for item in DEFAULT_AGENTS],
            "dispatch": "role-aware-or-broadcast",
        },
        "agents": agents,
    }


def load_config(root: Path, create: bool) -> dict[str, Any]:
    path = config_path(root)
    if not path.exists():
        if not create:
            raise OrchestraterError(
                f"Missing {path}. Run without a task first or pass --init to create defaults."
            )
        cfg = default_config()
        save_config(root, cfg)
        return cfg
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_config(root: Path, cfg: dict[str, Any]) -> None:
    path = config_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(cfg, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def agent_map(cfg: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {agent["name"]: agent for agent in cfg.get("agents", [])}


def run_orca(args: list[str], dry_run: bool) -> CommandResult:
    if dry_run:
        return CommandResult(
            ok=True,
            data={"dryRun": True, "command": ["orca", *args]},
            stdout=json.dumps({"dryRun": True, "command": ["orca", *args]}),
            stderr="",
            returncode=0,
        )
    if shutil.which("orca") is None:
        raise OrchestraterError("orca CLI not found in PATH.")
    proc = subprocess.run(
        ["orca", *args],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    data = None
    if proc.stdout.strip():
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            data = None
    ok = proc.returncode == 0
    if isinstance(data, dict) and data.get("ok") is False:
        ok = False
    return CommandResult(ok=ok, data=data, stdout=proc.stdout, stderr=proc.stderr, returncode=proc.returncode)


def ensure_orca_ready(dry_run: bool) -> None:
    result = run_orca(["status", "--json"], dry_run=dry_run)
    if not result.ok:
        raise OrchestraterError(
            "Orca is not ready. Start it with `orca open --json` and retry."
        )


def list_terminals(dry_run: bool) -> list[dict[str, Any]]:
    result = run_orca(["terminal", "list", "--worktree", "active", "--json"], dry_run=dry_run)
    if dry_run:
        return []
    if not result.ok or not result.data:
        raise OrchestraterError("Unable to list Orca terminals.")
    return result.data.get("result", {}).get("terminals", [])


def is_writable_terminal(term: dict[str, Any]) -> bool:
    return bool(term.get("connected")) and bool(term.get("writable"))


def terminal_timestamp(term: dict[str, Any]) -> int:
    value = term.get("lastOutputAt")
    return value if isinstance(value, int) else 0


def find_terminal(agent: dict[str, Any], terminals: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    handle = agent.get("terminalHandle")
    if handle:
        for term in terminals:
            if term.get("handle") == handle and is_writable_terminal(term):
                return term, "handle"

    title = agent.get("title")
    if title:
        matches = [
            term for term in terminals if term.get("title") == title and is_writable_terminal(term)
        ]
        if matches:
            matches.sort(key=terminal_timestamp, reverse=True)
            return matches[0], "title"

    return None, "missing"


def create_terminal(agent: dict[str, Any], dry_run: bool) -> dict[str, Any]:
    title = agent.get("title") or f"orchestrater:{agent['name']}"
    command = agent.get("command")
    if not command:
        raise OrchestraterError(f"Agent {agent['name']} has no command.")
    result = run_orca(
        [
            "terminal",
            "create",
            "--worktree",
            "active",
            "--title",
            title,
            "--command",
            command,
            "--json",
        ],
        dry_run=dry_run,
    )
    if dry_run:
        return {"handle": f"dry-run:{agent['name']}", "title": title, "connected": True, "writable": True}
    if not result.ok or not result.data:
        detail = result.stderr.strip() or result.stdout.strip()
        raise OrchestraterError(f"Failed to create terminal for {agent['name']}: {detail}")
    terminal = result.data.get("result", {}).get("terminal")
    if not terminal:
        terminal = result.data.get("result", {})
    if not terminal.get("handle"):
        raise OrchestraterError(f"Orca did not return a terminal handle for {agent['name']}.")
    return terminal


def send_task(handle: str, prompt: str, dry_run: bool) -> None:
    result = run_orca(
        ["terminal", "send", "--terminal", handle, "--text", prompt, "--enter", "--json"],
        dry_run=dry_run,
    )
    if not result.ok:
        detail = result.stderr.strip() or result.stdout.strip()
        raise OrchestraterError(f"Failed to send task to {handle}: {detail}")


def parse_agent_spec(raw: str | None, cfg: dict[str, Any]) -> list[tuple[str, str | None]]:
    if not raw:
        return [(agent["name"], None) for agent in cfg.get("agents", []) if agent.get("enabled", True)]

    selected: list[tuple[str, str | None]] = []
    for part in raw.split(","):
        item = part.strip()
        if not item:
            continue
        if ":" in item:
            name, role = item.split(":", 1)
            selected.append((name.strip(), role.strip() or None))
        else:
            selected.append((item, None))
    if not selected:
        raise OrchestraterError("No agents selected.")
    return selected


def build_prompt(agent: dict[str, Any], task: str, override_role: str | None, multi: bool) -> str:
    lines = [f"You are the {agent['name']} agent in the current Orca worktree."]
    if override_role:
        lines.append(f"Role for this task: {override_role}.")
    lines.extend(["Task:", task])
    return "\n".join(lines)


def add_agent(cfg: dict[str, Any], name: str, command: str, role: str | None) -> None:
    name = name.strip()
    if not name:
        raise OrchestraterError("Agent name cannot be empty.")
    agents = cfg.setdefault("agents", [])
    existing = agent_map(cfg).get(name)
    target = existing
    if target is None:
        target = {
            "name": name,
            "command": command,
            "role": role or "general",
            "enabled": True,
            "title": f"orchestrater:{name}",
            "terminalHandle": None,
            "lastSeenAt": None,
        }
        agents.append(target)
    else:
        target["command"] = command
        if role is not None:
            target["role"] = role
        target.setdefault("enabled", True)
        target.setdefault("title", f"orchestrater:{name}")
        target.setdefault("terminalHandle", None)
        target.setdefault("lastSeenAt", None)


def print_agent_list(cfg: dict[str, Any], terminals: list[dict[str, Any]] | None) -> None:
    terms = terminals or []
    print("Configured agents:")
    for agent in cfg.get("agents", []):
        term, source = find_terminal(agent, terms)
        if term:
            status = f"live via {source} ({term.get('handle')})"
        elif agent.get("terminalHandle"):
            status = f"stale ({agent.get('terminalHandle')})"
        else:
            status = "missing"
        enabled = "enabled" if agent.get("enabled", True) else "disabled"
        print(
            f"- {agent['name']}: command={agent.get('command')!r}, role={agent.get('role')!r}, "
            f"{enabled}, title={agent.get('title')!r}, status={status}"
        )


def dispatch(root: Path, cfg: dict[str, Any], selected: list[tuple[str, str | None]], task: str, dry_run: bool) -> int:
    ensure_orca_ready(dry_run)
    terminals = list_terminals(dry_run)
    agents = agent_map(cfg)
    missing = [name for name, _ in selected if name not in agents]
    if missing:
        raise OrchestraterError(
            "Unknown agent(s): "
            + ", ".join(missing)
            + ". Add them with `--add <name> --command \"<cmd>\"`."
        )

    failures = 0
    multi = len(selected) > 1
    for name, role in selected:
        agent = agents[name]
        term, source = find_terminal(agent, terminals)
        try:
            if term is None:
                term = create_terminal(agent, dry_run=dry_run)
                source = "created"
            handle = term.get("handle")
            if not handle:
                raise OrchestraterError(f"No terminal handle available for {name}.")
            prompt = build_prompt(agent, task, role, multi=multi)
            send_task(handle, prompt, dry_run=dry_run)
            if not dry_run:
                agent["terminalHandle"] = handle
                agent["lastSeenAt"] = utc_now()
            print(f"{name}: dispatched via {source} ({handle})")
        except OrchestraterError as exc:
            failures += 1
            print(f"{name}: failed: {exc}", file=sys.stderr)

    if not dry_run:
        save_config(root, cfg)
    return 1 if failures else 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Coordinate Orca-managed agent terminals.")
    parser.add_argument("task", nargs="*", help="Task text to dispatch.")
    parser.add_argument("--root", default=".", help="Project root containing .orchestrater/agents.json.")
    parser.add_argument("--init", action="store_true", help="Initialize default registry and exit.")
    parser.add_argument("--list", action="store_true", help="List configured agents and live terminal status.")
    parser.add_argument("--add", metavar="NAME", help="Add or update an agent.")
    parser.add_argument("--command", help="Command for --add.")
    parser.add_argument("--role", help="Role for --add or selected agent override.")
    parser.add_argument("--agent", help="Agent selector, e.g. codex or codex:implement,claude:review.")
    parser.add_argument("--dry-run", action="store_true", help="Print intended actions without calling Orca.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    root = Path(args.root).resolve()
    cfg = load_config(root, create=True)

    if args.init and not args.add and not args.list and not args.task:
        save_config(root, cfg)
        print(f"Initialized {config_path(root)}")
        return 0

    if args.add:
        if not args.command:
            raise OrchestraterError("--add requires --command.")
        add_agent(cfg, args.add, args.command, args.role)
        save_config(root, cfg)
        print(f"Saved agent {args.add} to {config_path(root)}")
        return 0

    if args.list:
        terminals: list[dict[str, Any]] | None = None
        try:
            ensure_orca_ready(args.dry_run)
            terminals = list_terminals(args.dry_run)
        except OrchestraterError as exc:
            print(f"Live status unavailable: {exc}", file=sys.stderr)
        print_agent_list(cfg, terminals)
        return 0

    task = " ".join(args.task).strip()
    if not task:
        print(f"Initialized {config_path(root)}")
        print("No task provided. Use --list, --add, or pass task text to dispatch.")
        return 0

    selected = parse_agent_spec(args.agent, cfg)
    if args.role and len(selected) == 1:
        selected = [(selected[0][0], args.role)]
    return dispatch(root, cfg, selected, task, args.dry_run)


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except OrchestraterError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
