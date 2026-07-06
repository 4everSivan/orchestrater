---
name: orchestrater
description: 通用 Orca 多智能体编排 skill, 在当前 worktree 中复用多个 agent terminal session。Use when the user invokes $orchestrater, wants to initialize/list project orchestration agents, choose a coordinator, add an agent with --add, send orchestration tasks through the coordinator, dispatch coordinator-approved plans with --from-coordinator, reuse existing Orca terminal sessions, persist coordination state, or coordinate multiple agents without creating new worktrees by default.
---

# Orchestrater

## 概览

在当前 Orca worktree 中编排已配置的 agent CLI。这是通用 Orca 编排 skill, 不绑定某个具体 agent 产品。所有 registry 更新, coordinator 选择, terminal 发现, 懒启动, 结构化任务记录, 决策记录和派发都应通过内置脚本完成。

不要把 `.agents/` 当作项目源码或编排 registry 输入。项目编排状态保存在 `.orchestrater/agents.json` 及同目录的状态文件中。

## 工作流

1. 派发任务或查看 live session 前, 用 `orca status --json` 确认 Orca 可用。
2. 从目标项目根目录运行 `scripts/orchestrater.py`, 处理 registry 和 dispatch。
3. 第一次 `/orchestrater` / `--init` 时选择 coordinator, 并持久化到 `.orchestrater/agents.json`。
4. 默认使用当前 worktree。除非用户明确要求未来的 worktree 模式, 不要创建新的 Orca worktree。
5. 普通任务必须先发给 coordinator。只有 coordinator 已规划并经用户或 operator 确认后, 才使用 `--from-coordinator` 派发给其他 agent。
6. 优先复用 live terminal session。缓存 handle 失效时, 先按 title 查找, 再懒创建新 terminal。
7. 多 agent 且显式指定角色时, 发送角色化 prompt。未指定角色或角色解析不可靠时, 广播同一任务。
8. 将协作状态保存在 `.orchestrater/`, 让后续轮次可以继续同一个任务。

## 命令

从目标项目根目录运行:

```bash
python3 scripts/orchestrater.py --list
python3 scripts/orchestrater.py --init --coordinator codex
python3 scripts/orchestrater.py --set-coordinator claude
python3 scripts/orchestrater.py --add reviewer --command "claude" --role review
python3 scripts/orchestrater.py "Review the current diff"
python3 scripts/orchestrater.py --from-coordinator --agent codex "Implement the requested change"
python3 scripts/orchestrater.py --from-coordinator --agent codex:implement,claude:review "Analyze this plan"
python3 scripts/orchestrater.py --status
python3 scripts/orchestrater.py --task-id task-... --record-decision "Use the reviewer's API naming recommendation"
python3 scripts/orchestrater.py --task-id task-... --close --summary "Implementation and review completed"
```

如果 `.orchestrater/agents.json` 不存在, 脚本会初始化默认 agent:

- `codex` -> `codex`
- `claude` -> `claude`
- `agy` -> `agy`

初始化会选择 coordinator, 但仍是懒启动: 只写配置, 不启动 terminal; 真正派发任务时才启动 coordinator terminal。

## 持久化状态

编排状态保存在 `.orchestrater/`:

- `agents.json`: agent 配置, command, role, terminal title, cached handle, enabled state。
- `sessions.json`: 每个 agent 最近一次 terminal session 状态。
- `tasks.jsonl`: append-only 任务生命周期事件。
- `decisions.jsonl`: append-only 用户确认, 阻塞项, 决策和最终摘要。

除非用户另有要求, 这些文件是项目级协作配置, 可以提交。

每个 agent entry 包含:

- `name`: `--agent` 使用的稳定标识。
- `command`: 启动 agent CLI 的 shell 命令。
- `role`: 默认角色标签。
- `enabled`: 默认派发时是否包含该 agent。
- `title`: Orca terminal title, 通常是 `orchestrater:<name>`。
- `terminalHandle`: 缓存的 Orca terminal handle。
- `lastSeenAt`: 最近一次观察到 live session 或成功 dispatch 的时间。

`agents.json` 还包含 `coordinator.agent`, 记录第一次初始化或后续 `--set-coordinator` 选择的 coordinator。

## 任务生命周期

把每个用户目标当作结构化任务:

1. `intake`: 记录原始目标, 选中的 agent 和角色覆盖。
2. `assign`: 创建 agent assignment。
3. `dispatch`: 先发送编排 prompt 到可复用的 coordinator terminal session。
4. `collect`: 保持任务打开, 等待 agent 响应和后续输入。
5. `synthesize`: 在对话中汇总结果, 并用 `--record-decision` 记录关键决策。
6. `close`: 用 `--close --summary` 标记任务完成。

dispatch 后脚本会打印 `taskId`。记录决策和关闭任务时使用这个 id。

## 派发语义

- 无 `--from-coordinator`: 用户任务只派发给 coordinator。
- `--from-coordinator --agent name`: 执行 coordinator 已确认计划, 派发给指定 agent。
- `--from-coordinator --agent a,b`: 执行 coordinator 已确认计划, 派发给多个 agent。
- `--from-coordinator --agent a:role,b:role`: 派发角色化 prompt。
- `--from-coordinator` 多 agent 且无角色: 广播同一任务。

发送给 coordinator 的 prompt 必须包含 task id, 用户目标, 可用 agents, 持久化状态路径和要求输出的分工计划。

发送给非 coordinator agent 的 prompt 必须包含:

- `Task ID`
- agent identity
- 显式提供的 role
- shared goal
- expected output
- coordination rule: 未经用户或 coordinator 明确要求, 不修改共享编排状态

派发前调用 `orca terminal list --worktree active --json`。只有 listed terminal connected 且 writable 时, 才能复用 cached handle。handle 失效时按 configured title 查找。仍未找到时, 用以下命令创建 terminal:

```bash
orca terminal create --worktree active --title "orchestrater:<name>" --command "<command>" --json
```

然后发送 prompt:

```bash
orca terminal send --terminal <handle> --text "<prompt>" --enter --json
```

## 失败处理

- Orca 未运行或不可达时, 报告问题并建议 `orca open --json`。
- coordinator 未选择时, 第一次调用必须选择并持久化 coordinator。
- agent command 启动失败时, 保留 registry entry, 继续派发给其他已选 agent。
- 多个 live terminal 匹配同一 title 时, 使用最近活跃的 writable terminal 并报告歧义。
- 请求的 agent 不存在时, 提示用 `--add <name> --command "<cmd>"` 添加。
- 角色解析不可靠时, 广播原始任务, 不臆造分工。
- 任务产生用户确认的决策时, 用 `--record-decision` 持久化。
- 工作完成时, 用 `--close --summary` 关闭任务。
- 永远不要扫描 `.agents/` 作为项目状态。
