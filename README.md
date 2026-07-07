# orchestrater

`orchestrater` is a **thin policy layer** on top of the Orca `orchestration` skill. `/orchestrater` starts a collaboration; the current agent acts as coordinator and uses Orca's native orchestration for tasks/messages/worker lifecycle; this skill only adds policy increments: preflight gate, single-writer, writeAccess, role config, verification.

The project keeps no scripts; all coordination state lives in Orca runtime; the coordinator is stateless.

> Skill internals are in English to save tokens. When the agent communicates with the user, it uses the user's language.

## Design thesis

Every critical judgment the coordinator makes lands in Orca runtime state, so Orca's hard mechanisms (blocked/gate hard-reject, `--ready` readiness, `--deps` serialization, 3-strike circuit-breaker) enforce the consequences; the coordinator only detects and records evidence. **Detection may be soft (LLM); execution must be hard (Orca); evidence must be re-derivable.** The 6 mechanisms are all instances of `soft-detection → hard-execution → re-derivable-evidence`.

Acknowledged soft residual: `.orchestrater/config.json` schema validation (Orca has no native config layer); but even if mis-validated, dispatch is still hard-blocked by GATE.

## Primitives

| Primitive | Definition |
|---|---|
| `PREFLIGHT` | `orca.status ∧ terminal.list(active) ∧ git.porcelain ⇒ {blockers,warnings}` |
| `GATE(kind)` | `gate-create` (auto blocked); `gate-resolve` → ready; kind∈{blocker,plan,conflict}; dispatch hard-rejects open gate/blocked |
| `SERIAL` | same-worktree multi-write tasks use `--deps` chain; child ¬ready until parent completed |
| `VERIFY` | `git diff --name-only` vs allowed/forbiddenPaths + record `--result{verificationCommand,exitCode,filesModified}`; full re-run only on suspicion |
| `RESUME` | `task-list`+`gate-list`+`dispatch-show`+`terminal.read`; ¬re-dispatch dispatched |
| `ROUTE` | readonly ⇒ `orchestration run --max-concurrent N`; write ⇒ PREFLIGHT→GATE?→dispatch→check→VERIFY→completed |

**Governance rule: compress procedure, not safety conditions.** blocker list / writeAccess / `¬re-dispatch dispatched` stay explicit and human-auditable.

## Usage

```text
/orchestrater analyze the multi-agent collaboration flow in this project, find gaps
/orchestrater have several agents review this design in parallel, then summarize
/orchestrater use agy to research best practices for Orca orchestration
/orchestrater hand implementation to agy, current session supervises and summarizes
/orchestrater handoff to agy to own this task independently
```

The last one is a full handoff; no supervised lifecycle.

## First-use config

When `.orchestrater/config.json` is missing, the coordinator asks 6 questions before writing: ① coordinator mode (default `current-session`) ② role topology (default `research→agy`) ③ dedicated session per role? ④ strategy (`plan-first`/`auto`) ⑤ allow auto-creating worker terminals? ⑥ allow parallel writes? (default no, single-writer)

Example:

```json
{
  "version": 1,
  "coordinator": { "mode": "current-session" },
  "defaults": {
    "worktree": "active",
    "strategy": "plan-first",
    "autoCreateTerminals": true,
    "onMissingRole": "broadcast",
    "maxConcurrentWorkers": 2
  },
  "permissions": {
    "writeModel": "single-writer",
    "allowParallelWrites": false,
    "defaultWriteRole": "implementation"
  },
  "roles": [
    {
      "name": "research",
      "agent": "agy",
      "command": "agy",
      "terminalTitle": "orchestrater:research",
      "session": "dedicated",
      "writeAccess": false,
      "responsibilities": ["research", "compare options", "summarize findings"],
      "allowedPaths": [],
      "forbiddenPaths": []
    }
  ]
}
```

`version` is the config schema version, not the Orca runtime version. `v1` only; unknown fields preserved but warned; `version≠1`/missing field → blocker. One agent command may play multiple roles, but each role defaults to a dedicated `terminalTitle` + dedicated session. Do not write Orca runtime handles into the config.

## Routing and write access

Read-only fan-out goes through a coarse PREFLIGHT then `orchestration run --max-concurrent`; write tasks go through the manual loop `PREFLIGHT→GATE?→dispatch→check→VERIFY→completed`. Use `task-list --ready` as external memory; DAG depth ≤ 3-4.

Single-writer is enforced by `--deps` chain + `completed` gate: until the parent passes VERIFY, the downstream write task is not `--ready`, so Orca structurally blocks parallel writes. `maxConcurrentWorkers` = 1 for the write path; `allowParallelWrites: true` + `GATE(plan)` required for parallel writes.

## Verification

`worker_done ≠ completed`. The coordinator runs `git diff --name-only` against `allowedPaths`/`forbiddenPaths`, records the worker's claimed `verificationCommand`+`exitCode` into `task-update --result`; full re-run only on suspicion. Out-of-bounds/file-overlap/verification-failed → `GATE(conflict)`; pass → `task-update --status completed --result`. Verification is not a separate DAG node; it is the `completed` transition gate.

## Crash recovery RESUME

The coordinator is stateless; all critical state is in Orca. A new session reconstructs with these commands; the cardinal rule is **never re-dispatch a `dispatched` task**:

```bash
orca orchestration task-list --json
orca orchestration gate-list --json
# for each dispatched task:
orca orchestration dispatch-show --task <id> --json
orca terminal read --terminal <handle> --json
```

| task status + worker state | recovery action |
|---|---|
| `blocked` + open gate | leave it; surface the gate to the user |
| `dispatched` + worker alive (tui-idle / heartbeat) | keep `check --wait`, **¬re-dispatch** |
| `dispatched` + worker dead / terminal gone | read-only → may re-dispatch; write → `GATE`, ¬auto-retry |
| `ready` | PREFLIGHT first, then dispatch |
| `completed` | already verified (evidence in `--result`), skip |
| `failed` | Orca already 3-strike circuit-broke; surface to user |

If the worker finished but never sent `worker_done` (stuck) → judge via `terminal read`; looks done but no `worker_done` → `GATE` to ask the user, ¬assume.

## Supervised vs full handoff

- Supervised: multi-agent divide / parallel review / wait-to-aggregate / handle ask/escalation/decision gate → `orca orchestration` + this skill's policy.
- Full handoff: user explicitly gives the task to another agent to own independently, no wait/aggregate, or needs a separate worktree for isolation → `orca terminal send`/`worktree create`, ¬create lifecycle (see orca-cli skill).
- Ambiguous defaults to supervised; handoff keywords default to handoff.

## Project files

| Path | Purpose |
|------|------|
| `SKILL.md` | compressed agent execution spec; 6 primitives + policy increments. |
| `.orchestrater/config.json` | project-level role topology and default collaboration policy. |
| `agents/openai.yaml` | OpenAI ecosystem discovery metadata; does not mean the skill serves only one product. |
| `.gitignore` | ignores local tool dirs and generated governance docs. |

`.agents/` is a local tool directory, not project source.
