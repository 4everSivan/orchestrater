#!/usr/bin/env python3
"""Environment helper for the /orchestrater skill.

This script is not the orchestration entry point. It only summarizes Orca
availability, the active worktree, and visible terminals so an agent can decide
which native `orca orchestration` commands to run next.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from typing import Any


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
        "purpose": "environment-inspection-only",
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


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect Orca state for the /orchestrater skill.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON output.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
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
