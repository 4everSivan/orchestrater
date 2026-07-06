# Orchestrater Skill Design

## Status

Approved for specification. This document defines the first implementation scope for the `orchestrater` skill.

## Context

This project will produce an Orca-focused skill that coordinates multiple agent CLIs inside the current Orca worktree. The project-level `.agents/` directory is local tooling only and is not project source.

The Orca CLI was checked before this design. It supports the required primitives:

- `orca status --json` to verify runtime availability.
- `orca terminal list --worktree active --json` to inspect live terminals in the current worktree.
- `orca terminal create --worktree active --title <title> --command <cmd> --json` to start an agent terminal in the current worktree.
- `orca terminal send --terminal <handle> --text <task> --enter --json` to reuse an existing live terminal session.
- `orca terminal show/read/wait` to inspect or wait on a live terminal.

Orca does not expose a general `agents list` or `providers list` registry. The skill must therefore maintain its own project-level registry of configured agents.

## Goals

- Initialize a project-local agent registry on first use.
- Default to current-worktree orchestration, not new worktrees.
- Support default agents `codex`, `claude`, and `agy`; do not include `gemini` by default.
- Reuse existing live agent sessions instead of opening a new session for each task.
- Provide mixed natural-language and flag-based usage.
- Allow adding custom agents after initialization.
- Allow listing configured agents and their live Orca terminal status.
- Dispatch tasks to one or multiple agents.

## Non-Goals

- Do not create new Orca worktrees in the first version.
- Do not use Orca's full orchestration task system in the first version.
- Do not implement scheduled automation.
- Do not treat `.agents/` as project code or configuration.
- Do not infer global Orca provider availability beyond commands configured in this project.

## User-Facing Behavior

### First Invocation

When `$orchestrater` is invoked for the first time and `.orchestrater/agents.json` does not exist, the skill asks the user to confirm or adjust the default agent set:

- `codex` with command `codex`
- `claude` with command `claude`
- `agy` with command `agy`

Initialization writes the registry only. It does not start any agent terminals. Terminals are started lazily when a task is dispatched.

### Listing Agents

`$orchestrater --list` reads `.orchestrater/agents.json`, calls `orca terminal list --worktree active --json`, and displays:

- agent name
- command
- role
- enabled status
- terminal title
- terminal handle, if live
- live/stale/missing status

### Adding Or Updating Agents

`$orchestrater --add <name> --command "<cmd>" [--role "<role>"]` adds or updates an agent entry in `.orchestrater/agents.json`.

If an agent already exists, the skill updates the command and role but does not automatically kill or replace an existing terminal. The next dispatch validates whether the stored terminal is still usable.

### Dispatching Tasks

The skill supports mixed command styles:

- `$orchestrater <task>` dispatches to all enabled agents.
- `$orchestrater --agent codex <task>` dispatches to one agent.
- `$orchestrater --agent codex,claude <task>` dispatches to the selected agents.
- `$orchestrater --agent codex:implement,claude:review <task>` dispatches role-specific prompts.

If multiple agents are selected and roles are specified, the skill sends each agent a role-specific prompt. If multiple agents are selected without roles, it broadcasts the same task to every selected agent.

## Registry Format

The registry lives at `.orchestrater/agents.json` and should be committed as project orchestration configuration.

```json
{
  "version": 1,
  "worktreeMode": "active",
  "defaults": {
    "agents": ["codex", "claude", "agy"],
    "dispatch": "role-aware-or-broadcast"
  },
  "agents": [
    {
      "name": "codex",
      "command": "codex",
      "role": "implementation",
      "enabled": true,
      "title": "orchestrater:codex",
      "terminalHandle": null,
      "lastSeenAt": null
    },
    {
      "name": "claude",
      "command": "claude",
      "role": "review",
      "enabled": true,
      "title": "orchestrater:claude",
      "terminalHandle": null,
      "lastSeenAt": null
    },
    {
      "name": "agy",
      "command": "agy",
      "role": "research",
      "enabled": true,
      "title": "orchestrater:agy",
      "terminalHandle": null,
      "lastSeenAt": null
    }
  ]
}
```

The exact role labels are defaults. Users may change them with `--add` or by editing the registry.

## Session Reuse Algorithm

For each selected agent:

1. Read `.orchestrater/agents.json`.
2. Call `orca status --json`; if Orca is not ready, stop and tell the user to open Orca.
3. Call `orca terminal list --worktree active --json`.
4. If `terminalHandle` exists and is present, connected, and writable, reuse it.
5. If the handle is missing or stale, search live terminals by the configured `title`.
6. If a matching writable terminal is found, update `terminalHandle` and reuse it.
7. If no live terminal is found, lazily create one with:

```bash
orca terminal create --worktree active --title "orchestrater:<name>" --command "<cmd>" --json
```

8. Send the task with:

```bash
orca terminal send --terminal <handle> --text "<prompt>" --enter --json
```

9. Persist the latest handle and `lastSeenAt` after successful dispatch.

## Prompt Construction

Broadcast prompt:

```text
You are the <name> agent in the current Orca worktree.
Task:
<user task>
```

Role-specific prompt:

```text
You are the <name> agent in the current Orca worktree.
Role for this task: <role>.
Task:
<user task>
```

The skill should keep prompts plain and avoid injecting hidden state that the user did not request.

## Error Handling

- If Orca is not running or not reachable, report the issue and suggest `orca open --json`.
- If an agent command is missing or startup fails, keep the registry entry and mark that dispatch as failed; continue dispatching to other selected agents.
- If a stored terminal handle is stale, fall back to title lookup before creating a new terminal.
- If multiple live terminals match the same title, use the most recently active writable terminal and report the ambiguity.
- If selected agents do not exist, report the missing names and suggest `--add`.
- If role-specific parsing is ambiguous, fall back to broadcasting the original task.
- Never scan `.agents/` for project source or registry data.

## Design Boundaries

The first version is deliberately terminal-based. It does not create Orca worktrees because the default user requirement is to start multiple agents in the current worktree. It does not use `orca orchestration task-create` or `dispatch` because those are better suited to DAGs, decision gates, and coordinator-owned task state.

The implementation should keep registry management, Orca terminal discovery, and prompt dispatch as separate units so later versions can add independent worktree mode or orchestration-task mode without changing the core agent model.

## Validation

The first version is complete when these checks pass:

- First invocation creates `.orchestrater/agents.json` with default `codex`, `claude`, and `agy`.
- `--list` shows configured agents and current live terminal status.
- `--add` adds or updates a custom agent.
- Dispatching twice to the same agent reuses the same terminal handle when it remains live.
- A stale handle is recovered by title lookup or replaced by lazy terminal creation.
- Multi-agent dispatch with roles sends role-specific prompts.
- Multi-agent dispatch without roles broadcasts the same prompt.
- No new Orca worktree is created during default dispatch.
- `.agents/` remains ignored and is not used as project input.
