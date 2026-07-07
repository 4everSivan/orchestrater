---
name: orchestrater
description: 通用 Orca 多智能体协作 skill,叠在 orchestration skill 之上的薄策略层。Use when the user invokes /orchestrater or $orchestrater, wants a coordinator-led supervised Orca orchestration workflow, needs multiple agents to collaborate in the current worktree, wants to reuse Orca terminals, create task DAGs, dispatch with --inject, wait for worker_done/escalation/decision_gate, or distinguish supervised orchestration from full handoff.
---

# Orchestrater

薄策略层,叠在 `orchestration` skill 之上。**不重述 Orca 机制**——task/dispatch/check/gate/`--ready`/3 连熔断的用法见 orchestration skill,本 skill 只加策略增量。协作状态全在 Orca runtime,coordinator 无状态。coordinator = 当前会话,默认当前 worktree。不碰 `.agents/`。

## 原语

```
PREFLIGHT = orca.status ∧ terminal.list(active) ∧ git.porcelain ⇒ {blockers,warnings}
GATE(kind) = gate-create(自动 blocked);  gate-resolve → ready;  kind∈{blocker,plan,conflict};  dispatch 对 open gate/blocked 硬拒
SERIAL    = 同worktree多写task用 --deps 串行;  父 completed 前下游 ¬ready
VERIFY    = git diff --name-only vs allowed/forbiddenPaths + 记 --result{verificationCommand,exitCode,filesModified};  可疑才全量重跑
RESUME    = task-list + gate-list + dispatch-show + terminal.read;  ¬重派 dispatched task
ROUTE     = readonly ⇒ orchestration run --max-concurrent N ;  write ⇒ PREFLIGHT→GATE?→dispatch --inject→check --wait→VERIFY→completed
```

**治理规则:压流程不压安全条件。** blocker 清单 / writeAccess / `¬重派 dispatched` 保持显式可读,用户可审计。

## 路由 ROUTE

| 任务 | 路径 |
|---|---|
| 只读扇出(research/review/compare) | `orchestration run --spec "<目标>" --max-concurrent <maxConcurrentWorkers>`;前置粗 PREFLIGHT: orca 可用 + 若懒启 terminal 则 cmd 须可信否则 `GATE(plan)` |
| 写任务 | `task-create [--deps]` → PREFLIGHT → (blocker? `GATE`) → `dispatch --inject` → `check --wait` → VERIFY → `task-update --status completed --result` |

`task-list --ready` 当外部记忆,不自己记状态。DAG 深度 ≤ 3-4。

## PREFLIGHT → GATE

```
blockers: orca.down | config.{missing,invalid,bad-version} | role.unknown∧onMissing≠broadcast
         | cmd.untrusted∧¬confirmed | write∧single-writer-violation | handoff⇄supervised
warnings: terminal.missing | title.dup | worktree.dirty | readonly∧write-task | auto⇒direct-dispatch
```

- 决策型 blocker(需用户拍板: cmd.untrusted、conflict、plan 确认)→ `GATE(kind)`;`gate-create` 自动 blocked,`gate-resolve` → ready。
- 非决策型 blocker(等条件消除: orca.down、terminal.missing、bad-version)→ `task-update --status blocked`;条件消除后 `task-update --status ready`。
- **dispatch 对 open gate / blocked task 硬拒**(实测: `"only ready tasks can be dispatched"`)。
- **dispatch 不校验 `--to` handle**(实测: 假 handle 仍 `ok:true` 建空 dispatch → 静默挂起)。PREFLIGHT 必须先 `terminal list` 核实 handle 存在且 connected/writable,¬信缓存。
- `plan-first`(默认): 出 plan + preflight,等用户 `gate-resolve`。`auto`: blocker 必停; warning 可继续但须汇报。
- PREFLIGHT 只读,不创建 terminal/task/dispatch,不存 runtime 状态。

## VERIFY

`worker_done ≠ completed`。收到 worker_done 后跑 VERIFY:`git diff --name-only` 对照 `allowedPaths`/`forbiddenPaths`;worker 声称的 `verificationCommand`+`exitCode` 记进 `task-update --result`;可疑才全量重跑。

- 越权 / 文件交集冲突 / 验收不过 → `GATE(conflict)`,摆给用户。
- 过 → `task-update --status completed --result`。下游 `--deps` 任务随之 `--ready`。
- 验收不另建 DAG 节点:它就是 `completed` 转移门,解锁 SERIAL 链下一步。

## SERIAL(单写者)

- 同 worktree 多写 task → `--deps` 串行。父 completed(过 VERIFY)前下游 ¬ready → 结构性挡并行写。
- `maxConcurrentWorkers` 对写路径 = 1。`allowParallelWrites: true` + `GATE(plan)` 才可并行写。
- 单写者不再靠口头约定,靠 `--deps` + `completed` 门。

## 首次配置

`.orchestrater/config.json` 缺失 → 先问 6 题再写入,不执行用户任务:① coordinator 策略(默认 `current-session`)② 角色拓扑(默认 `research→agy`)③ 每角色独立 session? ④ 策略(`plan-first`/`auto`)⑤ 允许自动建 worker terminal? ⑥ 允许多 worker 并行写?(默认否,单写者)

```
schema v1:
  coordinator.mode = current-session
  defaults{ worktree:active, strategy:plan-first|auto, autoCreateTerminals:bool,
            onMissingRole:broadcast|ask|fail, maxConcurrentWorkers:int≥1 }
  permissions{ writeModel:single-writer|explicit-parallel, allowParallelWrites:bool, defaultWriteRole }
  roles[]{ name, agent, command, terminalTitle, session:dedicated|shared,
           writeAccess:bool, responsibilities[], allowedPaths[], forbiddenPaths[] }
```

`version` 是 config schema 版本,非 Orca runtime 版本。仅 `v1`;未知字段保留但 warning。**config schema 校验是软残留**(Orca 无原生配置层,coordinator 按 schema 自检)——但即便漏检,dispatch 仍被 GATE 硬挡。`version≠1`/缺字段 → blocker。

## 模式

- **supervised**:多智能体分工/评审/汇总,`orca orchestration` + 本 skill 策略。
- **handoff**:完整移交(handoff/handover/交给某智能体独立处理),`orca terminal send`/`worktree create`,**¬创建 lifecycle**,见 orca-cli skill。
- **lightweight**:给已有终端一句话,直接 `terminal send`。
- 歧义 → supervised;完整移交词 → handoff。

## 失败

| 情况 | 处置 |
|---|---|
| orca.down | 报 `orca status` 失败,请用户启动 Orca |
| 无可用 worker | 列可见终端 + 缺失 cmd,请用户选/授权 |
| cmd.untrusted | ¬自动建 terminal,先请用户确认 |
| handle stale | `terminal list` 重取,¬信缓存 |
| config missing | 走首次配置 |
| config invalid / bad version | 报错,¬派发;bad version 提示 skill 不支持 |
| wait timeout(10min) | 汇报一次,让用户选继续/结束/取消/重派 |
| escalation | coordinator 能解则解,否则交用户 |
| conflict | `GATE(conflict)` |
| 崩溃/换会话 | `RESUME`(见 README):`task-list`+`gate-list`+`dispatch-show`+`terminal.read`;**¬重派 dispatched**;写任务 worker 死 → `GATE`,¬自动重试 |

写任务 ¬自动重试;只读最多重试 1 次且说明原因。依赖 Orca 原生 3 连熔断 → `failed`。
