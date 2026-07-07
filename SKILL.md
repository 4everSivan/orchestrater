---
name: orchestrater
description: Generic Orca multi-agent collaboration skill, a thin policy layer on top of the orchestration skill. Use when the user invokes /orchestrater or $orchestrater, wants a coordinator-led supervised Orca orchestration workflow, needs multiple agents to collaborate in the current worktree, wants to reuse Orca terminals, create task DAGs, dispatch with --inject, wait for worker_done/escalation/decision_gate, or distinguish supervised orchestration from full handoff.
---

# Orchestrater

Thin policy layer on top of the `orchestration` skill. **Does not re-explain Orca mechanisms** — task/dispatch/check/gate/`--ready`/3-strike circuit-breaker usage lives in the orchestration skill; this skill only adds policy increments. All coordination state lives in Orca runtime; the coordinator is stateless. Coordinator = current session, defaults to current worktree. Do not touch `.agents/`.

## Primitives

```
PREFLIGHT = orca.status ∧ terminal.list(active) ∧ git.porcelain ⇒ {blockers,warnings}
GATE(kind) = gate-create(auto blocked);  gate-resolve → ready;  kind∈{blocker,plan,conflict};  only ready tasks dispatchable
SERIAL    = same-worktree multi-write tasks use --deps chain;  child ¬ready until parent completed
VERIFY    = git diff --name-only vs allowed/forbiddenPaths + record --result{verificationCommand,exitCode,filesModified};  full re-run only on suspicion
RESUME    = task-list + gate-list + dispatch-show + terminal.read;  ¬re-dispatch dispatched task
ROUTE     = readonly ⇒ PREFLIGHT→config→select terminal→task-create→dispatch --to <handle> --inject→check --wait→aggregate
            write   ⇒ PREFLIGHT→GATE?→dispatch --to <handle> --inject→check --wait→VERIFY→completed
            orchestration run = optional auto-run only (user-explicit | strategy:auto | ¬fixed-role/session-reuse)
```

**Governance rule: compress procedure, not safety conditions.** blocker list / writeAccess / `¬re-dispatch dispatched` / handle verification stay explicit and human-auditable.

## Routing ROUTE

| Task | Path |
|---|---|
| Read-only fan-out (research/review/compare) | Default: PREFLIGHT → read `.orchestrater/config.json` → select worker terminal by role `terminalTitle` → `task-create` → `dispatch --to <terminal_handle> --inject` → `check --wait` → aggregate. `orchestration run --max-concurrent <N> --spec "<goal>"` is an optional auto-run shortcut, only when the user explicitly asks for auto-run, or config `strategy:auto` allows it, and the task needs no fixed role or session reuse. |
| Write task | `task-create [--deps]` → PREFLIGHT → (blocker? `GATE`) → `dispatch --to <terminal_handle> --inject` → `check --wait` → VERIFY → `task-update --status completed --result` |

Use `task-list --ready` as external memory; do not track state in your head. DAG depth ≤ 3-4.

## PREFLIGHT → blockers → GATE

```
blockers: orca.down | config.{missing,invalid,bad-version} | role.unknown∧onMissing≠broadcast
         | cmd.untrusted∧¬confirmed | write∧single-writer-violation | handoff⇄supervised
warnings: terminal.missing | title.dup | worktree.dirty | readonly∧write-task | auto⇒direct-dispatch
```

**Blocker phase:**

- **pre-task blocker** (found in PREFLIGHT, before `task-create`): report to user, wait for ruling or condition to clear. Do NOT `gate-create` or `task-update` — no task exists yet. Covers every blocker in the list above.
- **`orca.down`** is the strict case: issue NO `orca orchestration` write command (`task-create`/`dispatch`/`gate-create`/`task-update`/`run`); re-check with `orca status` only.
- **post-task blocker** (found after `task-create`: stale handle, worker death, VERIFY conflict, escalation): decision type (needs user ruling) → `GATE(kind)`, `kind∈{blocker,plan,conflict}`; `gate-create` auto-blocks, `gate-resolve` → ready. Conditional type (waits for condition to clear) → `task-update --status blocked`, restore `--status ready` once cleared.

**Dispatch safety** (verify before each dispatch, ¬trust cache):

- Task is `ready` — non-ready tasks are not dispatchable. Verify via `task-list`/`task-show`.
- `--to` is a **terminal handle** only — never a role name, agent name, or terminal title. Resolve from `orca terminal list --worktree active --json` by matching the role's `terminalTitle`; confirm `connected` + `writable`.
- dispatch may accept an invalid `--to` or a non-ready task without a clear error. Do not rely on dispatch to self-validate; PREFLIGHT verifies first.
- If a rule depends on a specific Orca version's behavior, verify it against the current Orca CLI before relying on it.

- `plan-first` (default): emit plan + PREFLIGHT, wait for user confirmation before `task-create` (pre-task decision, ¬gate). `auto`: blocker must stop; warning may proceed but must report.
- PREFLIGHT is read-only: creates no terminal/task/dispatch, stores no runtime state.

## VERIFY

`worker_done ≠ completed`. On receiving worker_done, run VERIFY: `git diff --name-only` against `allowedPaths`/`forbiddenPaths`; record the worker's claimed `verificationCommand`+`exitCode` into `task-update --result`; full re-run only on suspicion.

- Out-of-bounds / file-overlap conflict / verification failed → `GATE(conflict)`, surface to user.
- Pass → `task-update --status completed --result`. Downstream `--deps` tasks become `--ready`.
- Verification is not a separate DAG node: it is the `completed` transition gate that unblocks the SERIAL chain.

## SERIAL (single-writer)

- Same-worktree multi-write tasks → `--deps` chain. Child ¬ready until parent completed → structurally blocks parallel writes.
- `maxConcurrentWorkers` = 1 for the write path. `allowParallelWrites: true` + `GATE(plan)` required for parallel writes.
- Single-writer is enforced by `--deps` + `completed` gate, not verbal convention.

## First-use config

If `.orchestrater/config.json` is missing → ask 6 questions before writing it; do not execute the user task: ① coordinator mode (default `current-session`) ② role topology (default `research→agy`) ③ dedicated session per role? ④ strategy (`plan-first`/`auto`) ⑤ allow auto-creating worker terminals? ⑥ allow parallel writes? (default no, single-writer)

```
schema v1:
  coordinator.mode = current-session
  defaults{ worktree:active, strategy:plan-first|auto, autoCreateTerminals:bool,
            onMissingRole:broadcast|ask|fail, maxConcurrentWorkers:int≥1 }
  permissions{ writeModel:single-writer|explicit-parallel, allowParallelWrites:bool, defaultWriteRole }
  roles[]{ name, agent, command, terminalTitle, session:dedicated|shared,
           writeAccess:bool, responsibilities[], allowedPaths[], forbiddenPaths[] }
```

`version` is the config schema version, not the Orca runtime version. `v1` only; unknown fields preserved but warned; `version≠1`/missing field → blocker. Config schema validation is a coordinator self-check (Orca has no native config layer); even if mis-validated, dispatch is still hard-blocked by the `ready`/handle/GATE checks above.

## Modes

- **supervised**: multi-agent divide/review/aggregate → `orca orchestration` + this skill's policy.
- **handoff**: full transfer (handoff/handover/give to an agent to own) → `orca terminal send`/`worktree create`, **¬create lifecycle**; see orca-cli skill.
- **lightweight**: one line to an existing terminal → `terminal send`.
- Ambiguous → supervised; handoff keywords → handoff.

## Failures

| Case | Handling |
|---|---|
| orca.down | pre-task blocker: report `orca status` failure, ask user to start Orca; ¬any orchestration write |
| no worker | list visible terminals + missing cmd, ask user to choose/authorize |
| cmd.untrusted | pre-task blocker: ¬auto-create terminal, ask user first |
| handle stale | post-task conditional: re-fetch via `terminal list`, ¬trust cache |
| config missing | run first-use config |
| config invalid / bad version | pre-task blocker: report error, ¬dispatch; bad version → skill unsupported |
| wait timeout (10min) | report once, let user choose continue/end/cancel/redispatch |
| escalation | post-task decision: resolve if coordinator can, else `GATE`/surface to user |
| conflict | `GATE(conflict)` |
| crash / new session | `RESUME` (see README): `task-list`+`gate-list`+`dispatch-show`+`terminal.read`; **¬re-dispatch dispatched**; dead worker on write → `GATE`, ¬auto-retry |

Write tasks ¬auto-retry; read-only retries at most once with a stated reason. Rely on Orca's native 3-strike circuit-breaker → `failed`.
