---
name: orchestrater
description: 通用 Orca 多智能体协作 skill。Use when the user invokes /orchestrater or $orchestrater, wants a coordinator-led Orca orchestration workflow, needs multiple agents to collaborate in the current worktree, wants to reuse existing Orca terminal sessions, create task DAGs with orca orchestration task-create, dispatch work with dispatch --inject, wait for worker_done/escalation/decision_gate events, or distinguish supervised orchestration from full handoff.
---

# Orchestrater

## 定位

`/orchestrater` 是一个搭配 Orca 使用的专业多智能体协作 skill。它不属于任何单一智能体产品, 也不通过项目内 Python 脚本实现任务编排。真正的任务、消息、worker 生命周期、阻塞问题和决策门都应交给 Orca 原生 `orca orchestration` 管理。

当前执行 `/orchestrater` 的智能体默认就是 coordinator。coordinator 负责理解目标、拆分任务、选择或启动 worker、通过 Orca 派发任务、等待结果、处理阻塞并汇总给用户。

默认只在当前 Orca worktree 中协作。只有用户明确要求隔离实现、另起工作树或完整移交时, 才创建新 worktree 或做 full handoff。

不要扫描或修改 `.agents/`。该目录是本地工具/skill 目录, 不是本项目源码。

## 执行原则

- 使用 Orca 原生 orchestration 作为协作状态的事实来源。
- 默认 coordinator 是当前会话, 不额外创建 coordinator 终端。
- 默认 worker 集合只包含 `agy`; 其它 worker 由用户指定或首次协作时确认。
- 复用已有 worker terminal。只有没有可用会话时才在当前 worktree 懒启动。
- 多 worker 且用户指定角色时按角色拆分; 未指定角色或角色不可靠时广播同一任务。
- 需要用户决策时使用 Orca ask/reply 或 decision gate, 不把决策埋在本地 JSONL 中。
- 完整移交不是监督式编排。用户要求 handoff/handover/交给另一个智能体独立处理时, 使用 Orca terminal/worktree handoff 方式, 不等待 worker lifecycle。

## 标准流程

1. 确认 Orca 可用:

```bash
orca status --json
```

2. 读取当前上下文:

```bash
orca worktree current --json
orca terminal list --worktree active --json
```

3. 判断模式:

- 监督式协作: 用户希望多个智能体并行/分工/评审/汇总, 使用 `orca orchestration`。
- 完整移交: 用户希望把所有权交给另一个 agent, 使用 Orca terminal send 或 worktree create prompt。
- 轻量提示: 只需要给一个已有终端发一句话时, 可直接使用 Orca terminal。

4. 监督式协作时创建任务:

```bash
orca orchestration task-create \
  --task-title "<短标题>" \
  --spec "<用户目标、约束、期望产物、验收条件>" \
  --json
```

复杂任务拆成 DAG 时, 为每个子任务创建 task, 并用 `--deps` 表达依赖关系。

5. 选择 worker:

- 优先使用用户点名的 worker。
- 没有点名时, 根据任务需要选择当前可用 worker。
- 首次没有偏好时, 默认只包含 `agy`; 如需要其它 agent, 先向用户确认或按用户要求添加。
- 复用 `orca terminal list --worktree active --json` 中已有的可写终端。
- 没有可用终端时, 在当前 worktree 懒启动:

```bash
orca terminal create --worktree active --title "orchestrater:<worker>" --command "<agent-command>" --json
```

6. 派发任务:

```bash
orca orchestration dispatch \
  --task <task_id> \
  --to <worker_handle> \
  --from <coordinator_handle_if_available> \
  --inject \
  --json
```

`--inject` 会把 worker lifecycle 协议注入目标终端。worker 应通过 Orca orchestration 上报 `worker_done`, `heartbeat`, `ask`, `escalation` 等事件。

7. 等待和协调:

```bash
orca orchestration check \
  --wait \
  --types worker_done,escalation,decision_gate,ask \
  --timeout-ms 60000 \
  --json
```

循环等待直到所有必要 worker 完成、阻塞被处理、决策门关闭或用户要求停止。遇到 worker 的阻塞问题时, 使用 `orca orchestration reply` 或 decision gate 处理, 并把需要用户判断的问题明确返回给用户。

8. 汇总与收口:

- 汇总每个 worker 的输出、变更、风险、未完成事项。
- 必要时继续创建 follow-up task 或 dispatch review task。
- 完成后用 Orca task 状态表达完成/取消/阻塞, 而不是写本地任务日志。

## Coordinator 行为

coordinator 必须先输出或内部形成清晰计划:

- 任务目标和验收条件。
- worker 列表和角色。
- 子任务依赖关系。
- 每个 worker 的 expected output。
- 需要用户确认的决策点。
- 收敛条件: 什么时候停止等待并汇总。

如果用户只指定一个 worker, coordinator 可以直接创建一个 task 并派发。若用户指定多个 worker:

- 有角色: 按角色创建子任务或同一 task 的不同 dispatch prompt。
- 无角色: 广播同一目标, 要求各 worker 独立给出结果。

## Full Handoff

当用户表达“交给某个智能体独立处理”“handoff”“handover”“give this to another agent”等完整移交意图时:

- 不创建 supervised orchestration lifecycle。
- 可用 `orca terminal send` 把完整上下文发送到目标 agent。
- 如用户明确要求隔离, 可创建新 worktree 并带 prompt 启动。
- 发送后停止监督, 只报告移交目标和上下文摘要。

## Helper

`scripts/orchestrater.py` 只允许作为 skill 内部环境检查 helper 使用。它可以摘要 Orca 状态、当前 worktree 和当前 worktree 的 terminal 列表, 不能作为用户入口, 不能创建自定义任务状态, 不能替代 `orca orchestration task-create/dispatch/check`。

## 失败处理

- Orca 不可用: 报告 `orca status --json` 的失败信息, 建议用户先启动 Orca。
- 没有可用 worker: 说明当前可见终端和缺失的 agent command, 再请求用户选择或允许启动。
- terminal handle 失效: 重新用 `orca terminal list --worktree active --json` 获取, 不长期信任缓存。
- worker escalation: 先判断 coordinator 能否解决; 不能解决时把阻塞点交给用户。
- task 结果冲突: 创建决策门或向用户总结冲突选项。
- 不确定是否应创建新 worktree: 默认留在当前 worktree。
