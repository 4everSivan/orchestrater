---
name: orchestrater
description: Coordinate multiple Orca-managed agent terminal sessions in the current worktree. Use when the user invokes $orchestrater, asks to initialize or list project orchestration agents, add an agent with --add, dispatch a task to Codex/Claude/agy or custom agents, reuse existing Orca terminal sessions, or coordinate multiple agents without creating new worktrees by default.
---

# Orchestrater

## Overview

Coordinate configured agent CLIs inside the current Orca worktree. Use the bundled script for deterministic registry updates, terminal discovery, lazy terminal creation, structured task records, decisions, and dispatch.

Do not treat `.agents/` as project source or orchestration registry input. Project orchestration state lives in `.orchestrater/agents.json`.

## Workflow

1. Confirm Orca is available with `orca status --json` when dispatching or listing live sessions.
2. Use `scripts/orchestrater.py` from this skill directory for all registry and dispatch operations.
3. Default to the current worktree. Do not create a new Orca worktree unless the user explicitly asks for a future worktree mode.
4. Reuse live terminal sessions. A stale handle must fall back to title lookup before creating a new terminal.
5. If multiple agents are selected with explicit roles, dispatch role-specific prompts. If roles are absent or ambiguous, broadcast the same task.
6. Preserve coordination state in `.orchestrater/` so follow-up turns can continue the same task.

## Commands

Run commands from the target project root:

```bash
python3 scripts/orchestrater.py --list
python3 scripts/orchestrater.py --add reviewer --command "claude" --role review
python3 scripts/orchestrater.py --agent codex "Implement the requested change"
python3 scripts/orchestrater.py --agent codex:implement,claude:review "Analyze this plan"
python3 scripts/orchestrater.py "Review the current diff"
python3 scripts/orchestrater.py --status
python3 scripts/orchestrater.py --task-id task-... --record-decision "Use the reviewer's API naming recommendation"
python3 scripts/orchestrater.py --task-id task-... --close --summary "Implementation and review completed"
```

If `.orchestrater/agents.json` is missing, the script initializes it with default agents:

- `codex` -> `codex`
- `claude` -> `claude`
- `agy` -> `agy`

Initialization is lazy: it writes configuration only and does not start terminals until a task is dispatched.

## Persistent State

Keep persistent orchestration state in `.orchestrater/`:

- `agents.json`: configured agents, commands, roles, terminal titles, cached handles, enabled state.
- `sessions.json`: latest known terminal session status for each agent.
- `tasks.jsonl`: append-only task lifecycle events.
- `decisions.jsonl`: append-only user confirmations, blockers, decisions, and final summaries.

Keep these files project-local and suitable for commit unless the user says otherwise.

Each agent entry includes:

- `name`: stable identifier used in `--agent`
- `command`: shell command used to start the agent CLI
- `role`: default role label
- `enabled`: whether default dispatch includes this agent
- `title`: Orca terminal title, normally `orchestrater:<name>`
- `terminalHandle`: cached Orca terminal handle
- `lastSeenAt`: last successful live-session observation or dispatch

## Task Lifecycle

Treat each user goal as a structured task:

1. `intake`: capture the original goal, selected agents, and any role overrides.
2. `assign`: create agent assignments.
3. `dispatch`: send prompts to reusable Orca terminal sessions.
4. `collect`: leave the task open for agent responses and later user follow-up.
5. `synthesize`: summarize results in the conversation and record important decisions with `--record-decision`.
6. `close`: mark the task complete with `--close --summary`.

The script prints a `taskId` after dispatch. Use that id for decisions and closure.

## Dispatch Semantics

- No `--agent`: dispatch to all enabled agents.
- `--agent name`: dispatch to the selected agent.
- `--agent a,b`: dispatch to selected agents.
- `--agent a:role,b:role`: dispatch role-specific prompts.
- Multiple agents without roles: broadcast the same task.

Prompts sent to agents must include:

- `Task ID`
- agent identity
- role when explicitly provided
- shared goal
- expected output
- coordination rule not to mutate shared orchestration state unless asked

Before dispatching, call `orca terminal list --worktree active --json`. Reuse a cached handle only when the listed terminal is connected and writable. If the handle is stale, match by configured title. If no title match exists, create a new terminal with:

```bash
orca terminal create --worktree active --title "orchestrater:<name>" --command "<command>" --json
```

Then send the prompt with:

```bash
orca terminal send --terminal <handle> --text "<prompt>" --enter --json
```

## Failure Handling

- If Orca is not running or unreachable, report the failure and suggest `orca open --json`.
- If an agent command fails to start, keep the registry entry and continue with other selected agents.
- If multiple terminals match the same title, use the most recently active writable terminal and report the ambiguity.
- If a requested agent is missing, tell the user to add it with `--add <name> --command "<cmd>"`.
- If role parsing is ambiguous, broadcast the original task rather than inventing a split.
- If a task produces a user-confirmed decision, persist it with `--record-decision`.
- When work is complete, close the task with `--close --summary`.
- Never scan `.agents/` for project state.
