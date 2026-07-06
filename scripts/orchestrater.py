#!/usr/bin/env python3
"""Internal helper for the /orchestrater skill.

This script is not the orchestration entry point. It summarizes Orca
availability and manages project-level collaboration preferences in
`.orchestrater/config.json`. Task, dispatch, message, and worker lifecycle state
must stay in native `orca orchestration`.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


CONFIG_DIR = ".orchestrater"
CONFIG_FILE = "config.json"


class HelperError(RuntimeError):
    """Raised when the local environment cannot be inspected."""


@dataclass
class OrcaResult:
    ok: bool
    command: list[str]
    returncode: int
    stdout: str
    stderr: str
    data: Any


def run_orca(args: list[str]) -> OrcaResult:
    command = ["orca", *args]
    if shutil.which("orca") is None:
        return OrcaResult(
            ok=False,
            command=command,
            returncode=127,
            stdout="",
            stderr="orca CLI not found in PATH",
            data=None,
        )

    proc = subprocess.run(
        command,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    data: Any = None
    if proc.stdout.strip():
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            data = None

    ok = proc.returncode == 0
    if isinstance(data, dict) and data.get("ok") is False:
        ok = False

    return OrcaResult(
        ok=ok,
        command=command,
        returncode=proc.returncode,
        stdout=proc.stdout,
        stderr=proc.stderr,
        data=data,
    )


def default_config() -> dict[str, Any]:
    return {
        "version": 1,
        "coordinator": {
            "mode": "current-session",
        },
        "defaults": {
            "worktree": "active",
            "strategy": "plan-first",
            "autoCreateTerminals": True,
            "onMissingRole": "broadcast",
            "maxConcurrentWorkers": 2,
        },
        "permissions": {
            "writeModel": "single-writer",
            "allowParallelWrites": False,
            "defaultWriteRole": "implementation",
        },
        "roles": [
            {
                "name": "research",
                "agent": "agy",
                "command": "agy",
                "terminalTitle": "orchestrater:research",
                "session": "dedicated",
                "writeAccess": False,
                "responsibilities": [
                    "research",
                    "compare options",
                    "summarize findings",
                ],
            }
        ],
    }


def config_path(root: Path) -> Path:
    return root / CONFIG_DIR / CONFIG_FILE


def load_config(root: Path) -> dict[str, Any] | None:
    path = config_path(root)
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise HelperError(f"{path} must contain a JSON object.")
    return data


def save_config(root: Path, config: dict[str, Any], force: bool) -> Path:
    validate_config(config)
    path = config_path(root)
    if path.exists() and not force:
        raise HelperError(f"{path} already exists. Pass --force to overwrite.")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return path


def validate_config(config: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if config.get("version") != 1:
        errors.append("version must be 1.")

    coordinator = config.get("coordinator")
    if not isinstance(coordinator, dict):
        errors.append("coordinator must be an object.")
    elif coordinator.get("mode") != "current-session":
        errors.append("coordinator.mode must be current-session.")

    defaults = config.get("defaults")
    if not isinstance(defaults, dict):
        errors.append("defaults must be an object.")
    else:
        if defaults.get("worktree") != "active":
            errors.append("defaults.worktree must be active.")
        if defaults.get("strategy") not in {"plan-first", "auto"}:
            errors.append("defaults.strategy must be plan-first or auto.")
        if not isinstance(defaults.get("autoCreateTerminals"), bool):
            errors.append("defaults.autoCreateTerminals must be boolean.")
        if defaults.get("onMissingRole") not in {"broadcast", "ask", "fail"}:
            errors.append("defaults.onMissingRole must be broadcast, ask, or fail.")
        max_workers = defaults.get("maxConcurrentWorkers")
        if not isinstance(max_workers, int) or max_workers < 1:
            errors.append("defaults.maxConcurrentWorkers must be a positive integer.")

    permissions = config.get("permissions")
    if not isinstance(permissions, dict):
        errors.append("permissions must be an object.")
    else:
        if permissions.get("writeModel") not in {"single-writer", "explicit-parallel"}:
            errors.append("permissions.writeModel must be single-writer or explicit-parallel.")
        if not isinstance(permissions.get("allowParallelWrites"), bool):
            errors.append("permissions.allowParallelWrites must be boolean.")

    roles = config.get("roles")
    if not isinstance(roles, list) or not roles:
        errors.append("roles must be a non-empty array.")
    else:
        seen_names: set[str] = set()
        seen_titles: set[str] = set()
        for idx, role in enumerate(roles):
            prefix = f"roles[{idx}]"
            if not isinstance(role, dict):
                errors.append(f"{prefix} must be an object.")
                continue
            name = role.get("name")
            title = role.get("terminalTitle")
            for key in ("name", "agent", "command", "terminalTitle"):
                if not isinstance(role.get(key), str) or not role[key].strip():
                    errors.append(f"{prefix}.{key} must be a non-empty string.")
            if isinstance(name, str):
                if name in seen_names:
                    errors.append(f"{prefix}.name duplicates {name}.")
                seen_names.add(name)
            if isinstance(title, str):
                if title in seen_titles:
                    errors.append(f"{prefix}.terminalTitle duplicates {title}.")
                seen_titles.add(title)
            if role.get("session") not in {"dedicated", "shared"}:
                errors.append(f"{prefix}.session must be dedicated or shared.")
            if not isinstance(role.get("writeAccess"), bool):
                errors.append(f"{prefix}.writeAccess must be boolean.")
            responsibilities = role.get("responsibilities", [])
            if not isinstance(responsibilities, list) or not all(
                isinstance(item, str) for item in responsibilities
            ):
                errors.append(f"{prefix}.responsibilities must be an array of strings.")

    if errors:
        raise HelperError("Invalid config:\n- " + "\n- ".join(errors))
    return errors


def compact_result(result: OrcaResult) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": result.ok,
        "command": result.command,
        "returncode": result.returncode,
    }
    if result.data is not None:
        payload["data"] = result.data
    if result.stderr.strip():
        payload["stderr"] = result.stderr.strip()
    elif result.stdout.strip() and result.data is None:
        payload["stdout"] = result.stdout.strip()
    return payload


def summarize_terminals(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        return []

    result = data.get("result")
    if not isinstance(result, dict):
        return []

    terminals = result.get("terminals")
    if not isinstance(terminals, list):
        return []

    summary = []
    for terminal in terminals:
        if not isinstance(terminal, dict):
            continue
        summary.append(
            {
                "handle": terminal.get("handle"),
                "title": terminal.get("title"),
                "command": terminal.get("command"),
                "connected": terminal.get("connected"),
                "writable": terminal.get("writable"),
                "status": terminal.get("status"),
            }
        )
    return summary


def inspect_environment() -> dict[str, Any]:
    status = run_orca(["status", "--json"])
    worktree = run_orca(["worktree", "current", "--json"]) if status.ok else None
    terminals = run_orca(["terminal", "list", "--worktree", "active", "--json"]) if status.ok else None

    return {
        "helper": "orchestrater",
        "purpose": "environment-and-config-helper",
        "orca": compact_result(status),
        "worktree": compact_result(worktree) if worktree else None,
        "terminals": compact_result(terminals) if terminals else None,
        "terminalSummary": summarize_terminals(terminals.data) if terminals else [],
        "nextStep": (
            "Use native `orca orchestration task-create`, `dispatch --inject`, and `check --wait`."
            if status.ok
            else "Start Orca or fix PATH before invoking /orchestrater."
        ),
    }


def inspect_config(root: Path) -> dict[str, Any]:
    config = load_config(root)
    if config is None:
        return {
            "exists": False,
            "path": str(config_path(root)),
            "nextStep": "Run first-use onboarding, then write .orchestrater/config.json.",
        }
    validate_config(config)
    return {
        "exists": True,
        "path": str(config_path(root)),
        "config": config,
    }


def print_text(summary: dict[str, Any]) -> None:
    orca = summary["orca"]
    print(f"Orca available: {orca['ok']}")
    if not orca["ok"]:
        detail = orca.get("stderr") or orca.get("stdout") or f"exit {orca['returncode']}"
        print(f"Reason: {detail}")
        return

    terminals = summary["terminalSummary"]
    print(f"Visible terminals in active worktree: {len(terminals)}")
    for terminal in terminals:
        handle = terminal.get("handle") or "<unknown>"
        title = terminal.get("title") or "<untitled>"
        writable = "writable" if terminal.get("writable") else "read-only"
        connected = "connected" if terminal.get("connected") else "disconnected"
        print(f"- {handle}: {title} ({connected}, {writable})")
    print(summary["nextStep"])


def print_config_text(config_summary: dict[str, Any]) -> None:
    print(f"Config path: {config_summary['path']}")
    if not config_summary["exists"]:
        print("Config exists: false")
        print(config_summary["nextStep"])
        return
    config = config_summary["config"]
    defaults = config["defaults"]
    print("Config exists: true")
    print(f"Strategy: {defaults['strategy']}")
    print(f"Auto-create terminals: {defaults['autoCreateTerminals']}")
    print("Roles:")
    for role in config["roles"]:
        write = "write" if role["writeAccess"] else "read-only"
        print(f"- {role['name']}: {role['agent']} via {role['terminalTitle']} ({write})")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect Orca state for the /orchestrater skill.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON output.")
    parser.add_argument("--root", default=".", help="Project root containing .orchestrater/config.json.")
    parser.add_argument("--init-config", action="store_true", help="Create default .orchestrater/config.json.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing config with --init-config.")
    parser.add_argument("--show-config", action="store_true", help="Print .orchestrater/config.json.")
    parser.add_argument("--validate-config", action="store_true", help="Validate .orchestrater/config.json.")
    parser.add_argument("--print-template", action="store_true", help="Print the default config template.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    root = Path(args.root).resolve()

    if args.print_template:
        json.dump(default_config(), sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0

    if args.init_config:
        path = save_config(root, default_config(), force=args.force)
        print(f"Initialized {path}")
        return 0

    if args.show_config:
        summary = inspect_config(root)
        if args.json:
            json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
            sys.stdout.write("\n")
        else:
            print_config_text(summary)
        return 0

    if args.validate_config:
        config = load_config(root)
        if config is None:
            raise HelperError(f"{config_path(root)} does not exist.")
        validate_config(config)
        print(f"Config is valid: {config_path(root)}")
        return 0

    summary = inspect_environment()
    if args.json:
        json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    else:
        print_text(summary)
    return 0 if summary["orca"]["ok"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except HelperError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
