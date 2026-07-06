# orchestrater

`orchestrater` is a Codex skill for coordinating multiple Orca-managed agent terminals in the current worktree.

The skill keeps agent configuration and task state in the project so later turns can reuse the same agent sessions, inspect what was dispatched, record decisions, and close tasks.

## What It Does

- Starts and reuses multiple agent CLIs in the current Orca worktree.
- Defaults to `codex`, `claude`, and `agy`.
- Does not include `gemini` by default.
- Does not create new Orca worktrees by default.
- Supports natural-language task dispatch and explicit flags.
- Persists agent, session, task, and decision state under `.orchestrater/`.

## Project Files

| Path | Purpose |
|------|---------|
| `SKILL.md` | Skill entry and operating instructions. |
| `scripts/orchestrater.py` | Deterministic helper for registry, sessions, tasks, decisions, and Orca terminal dispatch. |
| `agents/openai.yaml` | UI metadata for Codex skill discovery. |
| `.orchestrater/agents.json` | Agent registry created on first use. |
| `.orchestrater/sessions.json` | Latest known Orca terminal session state. |
| `.orchestrater/tasks.jsonl` | Append-only task lifecycle events. |
| `.orchestrater/decisions.jsonl` | Append-only decisions, blockers, user confirmations, and final summaries. |

`.agents/` is local tooling and is intentionally ignored. It is not project source.

## Basic Usage

Run from the project root:

```bash
python3 scripts/orchestrater.py --init
python3 scripts/orchestrater.py --list
python3 scripts/orchestrater.py "Review the current diff"
```

First use creates `.orchestrater/agents.json` with:

```text
codex  -> codex
claude -> claude
agy    -> agy
```

Initialization writes configuration only. Agent terminals are started lazily when a task is dispatched.

## Add Or Update Agents

```bash
python3 scripts/orchestrater.py --add reviewer --command "claude" --role review
python3 scripts/orchestrater.py --add researcher --command "agy" --role research
```

Adding an agent updates the registry. It does not kill or replace an existing terminal.

## Dispatch Tasks

Dispatch to all enabled agents:

```bash
python3 scripts/orchestrater.py "Analyze the architecture and suggest next steps"
```

Dispatch to one agent:

```bash
python3 scripts/orchestrater.py --agent codex "Implement the parser change"
```

Dispatch to multiple agents with explicit roles:

```bash
python3 scripts/orchestrater.py \
  --agent codex:implement,claude:review,agy:research \
  "Improve the orchestration workflow"
```

If roles are provided, each agent receives a role-specific prompt. If roles are absent, the same task is broadcast to all selected agents.

## Structured Task Flow

Each dispatched task gets a `taskId` and moves through these phases:

1. `intake`: capture the original user goal and selected agents.
2. `assign`: build agent assignments.
3. `dispatch`: send prompts to Orca terminal sessions.
4. `collect`: wait for agent responses and follow-up.
5. `synthesize`: summarize outputs and record important decisions.
6. `close`: mark the task complete.

View persisted state:

```bash
python3 scripts/orchestrater.py --status
```

Record a decision or user confirmation:

```bash
python3 scripts/orchestrater.py \
  --task-id task-20260706070000-1234abcd \
  --record-decision "Use handle -> title -> lazy create as the session reuse order"
```

Close a task:

```bash
python3 scripts/orchestrater.py \
  --task-id task-20260706070000-1234abcd \
  --close \
  --summary "Workflow implemented and validated"
```

## Session Reuse

For each agent, dispatch uses this order:

1. Reuse cached `terminalHandle` if it is live and writable.
2. Find a live terminal by configured title, such as `orchestrater:codex`.
3. Lazily create a new terminal in the current worktree.

The helper uses Orca CLI commands:

```bash
orca status --json
orca terminal list --worktree active --json
orca terminal create --worktree active --title "orchestrater:<name>" --command "<cmd>" --json
orca terminal send --terminal <handle> --text "<prompt>" --enter --json
```

## Validation

```bash
python3 -m py_compile scripts/orchestrater.py
python3 /Users/sivan/.codex/skills/.system/skill-creator/scripts/quick_validate.py .
```

For non-invasive testing, use `--dry-run`; it does not call Orca and does not mutate terminal handles:

```bash
python3 scripts/orchestrater.py --agent codex --dry-run "Check the current design"
```

## Current Limits

- Default mode uses the current Orca worktree only.
- New-worktree orchestration is out of scope for the first version.
- Full Orca `orchestration task-create/dispatch` integration is out of scope for the first version.
- The helper does not auto-read every agent terminal or synthesize results by itself; the coordinator records decisions and closes tasks after reviewing outputs.
