---
name: orchestrater
description: Coordinate Orca workers in the current worktree using the installed orchestrater RuntimeAdapter. Use when the user invokes /orchestrater or asks for supervised multi-agent work, task evidence, safe worker terminal reuse, or Orca task gates.
---

# Orchestrater

This skill is a policy layer over the local `orchestrater` Node CLI and Orca. Resolve `<skill-root>` as the installed skill directory (normally `~/.claude/skills/orchestrater` or `~/.codex/skills/orchestrater`) and run CLI commands as `node <skill-root>/src/cli.mjs ...`. The CLI provides deterministic configuration, preflight, terminal, and evidence facts. The coordinator retains only user confirmation, task decomposition, Orca dispatch, gate creation, and final synthesis.

## Preconditions

- Run `node <skill-root>/src/cli.mjs config validate` before every task. If the config is absent, show `config init` and only run `config init --write` after the user confirms its default roles. A v1 result is a blocker until the user reviews `config migrate`; only run `config migrate --write` after that confirmation.
- Read tasks require `node <skill-root>/src/cli.mjs preflight --task-class read --role <role>`.
- Write tasks require a user-confirmed `writeScope` JSON with non-empty relative `allowedPaths` and structured `verification` command/args.
- Never dispatch a write task when `preflight --task-class write` returns a blocker. A dirty worktree, invalid scope, non-writable role, or active writer must stop the flow.

## Read task

1. Run `node <skill-root>/src/cli.mjs preflight --task-class read --role <role>`.
2. Run `node <skill-root>/src/cli.mjs terminal resolve --role <role>`.
3. If terminal is missing, obtain user confirmation; then run `node <skill-root>/src/cli.mjs terminal create --role <role> [--confirm-command]` only when required for an untrusted command.
4. Create an Orca task, verify it is ready, dispatch to the resolved handle, wait for `worker_done`, `ask`, `escalation`, or `decision_gate`, then synthesize.

## Write task

1. Present role, writeScope, and verification to the user. In `plan-first`, wait for confirmation.
2. Run `node <skill-root>/src/cli.mjs preflight --task-class write --role <role> --write-scope '<json>'`.
3. Create an Orca task. While it is ready, run `node <skill-root>/src/cli.mjs evidence capture --task <id> --write-scope '<json>'`.
4. Resolve the terminal again and dispatch only to its unique connected/writable handle.
5. On `worker_done`, run `node <skill-root>/src/cli.mjs evidence verify --task <id>`.
6. Only a successful result may be supplied to `orca orchestration task-update --status completed --result`. Any `E_EVIDENCE_*` result creates an Orca conflict gate and leaves the task incomplete.

## Non-negotiable boundaries

- `terminalTitle` is not a dispatch target; use the handle returned by `terminal resolve`.
- Duplicate titles are blockers, never a selection heuristic.
- Do not auto-retry write tasks or overwrite an existing installation without `--force`.
- CLI policy enforcement is auditable but not an OS sandbox. Use an isolated worktree or container when workers must be prevented from touching arbitrary ignored files.
