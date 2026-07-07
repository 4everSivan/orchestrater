---
name: orchestrater
description: Generic Orca multi-agent collaboration skill, a thin policy layer on top of the orchestration skill. Use when the user invokes /orchestrater or $orchestrater, wants a coordinator-led supervised Orca orchestration workflow, needs multiple agents to collaborate in the current worktree, wants to reuse Orca terminals, create task DAGs, dispatch with --inject, wait for worker_done/escalation/decision_gate, or distinguish supervised orchestration from full handoff.
---

# Orchestrater

Thin policy layer on top of the `orchestration` skill. **Does not re-explain Orca mechanisms** — task/dispatch/check/gate/`--ready`/3-strike circuit-breaker usage lives in the orchestration skill; this skill only adds policy increments. All coordination state lives in Orca runtime; the coordinator is stateless. Coordinator = current session, defaults to current worktree. Do not touch `.agents/`.

## Primitives

```
PREFLIGHT = orca.status ∧ terminal.list(active) ∧ git.porcelain ⇒ {blockers,warnings}
GATE(kind) = gate-create(auto blocked);  gate-resolve → ready;  kind∈{blocker,plan,conflict};  dispatch hard-rejects open gate/blocked task
SERIAL    = same-worktree multi-write tasks use --deps chain;  child ¬ready until parent completed
VERIFY    = git diff --name-only vs allowed/forbiddenPaths + record --result{verificationCommand,exitCode,filesModified};  full re-run only on suspicion
RESUME    = task-list + gate-list + dispatch-show + terminal.read;  ¬re-dispatch dispatched task
ROUTE     = readonly ⇒ orchestration run --max-concurrent N ;  write ⇒ PREFLIGHT→GATE?→dispatch --inject→check --wait→VERIFY→completed
```

**Governance rule: compress procedure, not safety conditions.** blocker list / writeAccess / `¬re-dispatch dispatched` stay explicit and human-auditable.

## Routing ROUTE

| Task | Path |
|---|---|
| Read-only fan-out (research/review/compare) | `orchestration run --spec "<goal>" --max-concurrent <maxConcurrentWorkers>`; preceded by coarse PREFLIGHT: orca available + if lazy-creating a terminal, cmd must be trusted else `GATE(plan)` |
| Write task | `task-create [--deps]` → PREFLIGHT → (blocker? `GATE`) → `dispatch --inject` → `check --wait` → VERIFY → `task-update --status completed --result` |

Use `task-list --ready` as external memory; do not track state in your head. DAG depth ≤ 3-4.

## PREFLIGHT → GATE

```
blockers: orca.down | config.{missing,invalid,bad-version} | role.unknown∧onMissing≠broadcast
         | cmd.untrusted∧¬confirmed | write∧single-writer-violation | handoff⇄supervised
warnings: terminal.missing | title.dup | worktree.dirty | readonly∧write-task | auto⇒direct-dispatch
```

- Decision blocker (needs user ruling: cmd.untrusted, conflict, plan confirm) → `GATE(kind)`; `gate-create` auto-blocks, `gate-resolve` → ready.
- Non-decision blocker (waits for condition to clear: orca.down, terminal.missing, bad-version) → `task-update --status blocked`; restore `task-update --status ready` once cleared.
- **dispatch hard-rejects open gate / blocked task** (verified: `"only ready tasks can be dispatched"`).
- **dispatch does NOT validate `--to` handle** (verified: a fake handle still returns `ok:true` and creates an empty dispatch → silent hang). PREFLIGHT must verify the handle via `terminal list` (exists, connected, writable) first; ¬trust cache.
- `plan-first` (default): emit plan + preflight, wait for user `gate-resolve`. `auto`: blocker must stop; warning may proceed but must report.
- PREFLIGHT is read-only: creates no terminal/task/dispatch, stores no runtime state.

## VERIFY

`worker_done ≠ completed`. On receiving worker_done, run VERIFY: `git diff --name-only` against `allowedPaths`/`forbiddenPaths`; record the worker's claimed `verificationCommand`+`exitCode` into `task-update --result`; full re-run only on suspicion.

- Out-of-bounds / file-overlap conflict / verification failed → `GATE(conflict)`, surface to user.
- Pass → `task-update --status completed --result`. Downstream `--deps` tasks become `--ready`.
- Verification is not a separate DAG node: it is the `completed` transition gate that unblocks the SERIAL chain.

## SERIAL (single-writer)

- Same-worktree multi-write tasks → `--deps` chain. Child ¬ready until parent completed (verified) → structurally blocks parallel writes.
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

`version` is the config schema version, not the Orca runtime version. `v1` only; unknown fields preserved but warned; `version≠1`/missing field → blocker. **Config schema validation is a soft residual** (Orca has no native config layer; coordinator self-checks against schema) — but even if mis-validated, dispatch is still hard-blocked by GATE.

## Modes

- **supervised**: multi-agent divide/review/aggregate → `orca orchestration` + this skill's policy.
- **handoff**: full transfer (handoff/handover/give to an agent to own) → `orca terminal send`/`worktree create`, **¬create lifecycle**; see orca-cli skill.
- **lightweight**: one line to an existing terminal → `terminal send`.
- Ambiguous → supervised; handoff keywords → handoff.

## Failures

| Case | Handling |
|---|---|
| orca.down | report `orca status` failure, ask user to start Orca |
| no worker | list visible terminals + missing cmd, ask user to choose/authorize |
| cmd.untrusted | ¬auto-create terminal, ask user first |
| handle stale | re-fetch via `terminal list`, ¬trust cache |
| config missing | run first-use config |
| config invalid / bad version | report error, ¬dispatch; bad version → skill unsupported |
| wait timeout (10min) | report once, let user choose continue/end/cancel/redispatch |
| escalation | resolve if coordinator can, else surface to user |
| conflict | `GATE(conflict)` |
| crash / new session | `RESUME` (see README): `task-list`+`gate-list`+`dispatch-show`+`terminal.read`; **¬re-dispatch dispatched**; dead worker on write → `GATE`, ¬auto-retry |

Write tasks ¬auto-retry; read-only retries at most once with a stated reason. Rely on Orca's native 3-strike circuit-breaker → `failed`.
