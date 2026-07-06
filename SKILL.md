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
- 首次调用必须完成项目级协作配置问卷, 并写入 `.orchestrater/config.json`。
- 本地配置只保存角色拓扑和默认策略; 不保存 terminal handle、task id、dispatch id 或 worker lifecycle 状态。
- 复用已有 worker terminal。只有没有可用会话时才在当前 worktree 懒启动。
- 多 worker 且用户指定角色时按角色拆分; 未指定角色或角色不可靠时广播同一任务。
- 需要用户决策时使用 Orca ask/reply 或 decision gate, 不把决策埋在本地 JSONL 中。
- 完整移交不是监督式编排。用户要求 handoff/handover/交给另一个智能体独立处理时, 使用 Orca terminal/worktree handoff 方式, 不等待 worker lifecycle。

## 首次配置

每次 `/orchestrater` 先检查 `.orchestrater/config.json`。如果不存在, 必须先问完以下问题并写入配置, 不直接执行用户任务:

1. coordinator 策略是什么?
   推荐默认: `current-session`。
2. 默认角色有哪些?
   推荐默认: `research -> agy`。
3. 每个角色是否独立 session?
   推荐默认: 是, 每个角色一个 `terminalTitle`。
4. 默认协作策略是什么?
   推荐默认: `plan-first`。用户明确授权时可设为 `auto`。
5. 是否允许自动创建缺失 worker terminal?
   推荐默认: 允许, 但只在当前 worktree。
6. 当前 worktree 是否允许多个 worker 并行写文件?
   推荐默认: 不允许; 单写者、多读者。

用户回答后, 写入 `.orchestrater/config.json`。如果用户在首次请求中已经指定角色, 按用户描述初始化角色; 未指定时使用默认 `research -> agy`。

可用内部 helper 生成默认配置或校验配置:

```bash
python3 scripts/orchestrater.py --init-config
python3 scripts/orchestrater.py --show-config --json
python3 scripts/orchestrater.py --validate-config
```

也可以由 coordinator 根据用户回答写入 JSON, 再运行 `--validate-config`。

## 配置文件

`.orchestrater/config.json` 是项目级协作偏好。它可以提交, 但只包含稳定意图:

```json
{
  "version": 1,
  "coordinator": {
    "mode": "current-session"
  },
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
      "responsibilities": [
        "research",
        "compare options",
        "summarize findings"
      ]
    }
  ]
}
```

允许同一个 agent command 扮演多个角色, 但默认每个角色使用独立 `terminalTitle` 和独立 session。不要把 Orca runtime handle 写入这个文件。

`version` 是 orchestrater config schema version, 不是 Orca runtime/task version。当前只支持 `version: 1`:

- 缺失必填字段或不支持的 version: 阻止 dispatch。
- 未知字段: 允许保留, 但作为 warning, 当前 skill 忽略。
- 配置迁移或修复只能处理项目级配置偏好, 不得修改 Orca task、dispatch、message、terminal 或 worktree runtime 状态。
- 后续如增加 repair, 只能补安全默认值, 不删除用户字段。

可在 dispatch 前运行:

```bash
python3 scripts/orchestrater.py --diagnose-config --json
```

## 标准流程

1. 确认 Orca 可用:

```bash
orca status --json
```

2. 读取当前上下文:

```bash
python3 scripts/orchestrater.py --show-config --json
orca worktree current --json
orca terminal list --worktree active --json
```

3. 运行 dispatch preflight。preflight 分 blocker 和 warning:

阻断项:

- Orca runtime 不可用。
- `.orchestrater/config.json` 缺失、无效或 version 不支持。
- 目标 role 不存在, 且 `onMissingRole` 不是 `broadcast`。
- 需要自动创建 terminal, 但配置 command 不可信且用户未确认。
- 写任务违反单写者规则。
- 用户要求 full handoff, 但流程进入 supervised orchestration。
- 用户要求监督等待, 但流程进入 full handoff。

警告项:

- role terminal 不存在, 需要懒启动。
- 多个 terminal 匹配同一个 `terminalTitle`。
- 当前 worktree 有未提交改动。
- 只读角色收到疑似写任务。
- `auto` 策略会直接 dispatch。

`plan-first` 策略下, coordinator 先输出计划、blocker 和 warning, 等用户确认。`auto` 策略下, 有 blocker 必须停止; 只有 warning 时可以继续, 但必须在汇总中报告。

4. 判断模式:

- 监督式协作: 用户希望多个智能体并行/分工/评审/汇总, 使用 `orca orchestration`。
- 完整移交: 用户希望把所有权交给另一个 agent, 使用 Orca terminal send 或 worktree create prompt。
- 轻量提示: 只需要给一个已有终端发一句话时, 可直接使用 Orca terminal。

5. 监督式协作时创建任务:

```bash
orca orchestration task-create \
  --task-title "<短标题>" \
  --spec "<用户目标、约束、期望产物、验收条件>" \
  --json
```

复杂任务拆成 DAG 时, 为每个子任务创建 task, 并用 `--deps` 表达依赖关系。

6. 选择 worker:

- 优先使用用户点名的角色或 worker。
- 没有点名时, 按 `.orchestrater/config.json` 的角色拓扑选择。
- 按 role 的 `terminalTitle` 复用 `orca terminal list --worktree active --json` 中已有的可写终端。
- 找不到时, 根据 `defaults.autoCreateTerminals` 决定是否在当前 worktree 懒启动。
- 使用配置中的 `command` 创建 terminal 前, 必须确认它是可信 agent 命令。未知命令、路径型命令或包含 shell 元字符的命令必须先展示给用户确认。

```bash
orca terminal create --worktree active --title "orchestrater:<worker>" --command "<agent-command>" --json
```

7. 派发任务:

```bash
orca orchestration dispatch \
  --task <task_id> \
  --to <worker_handle> \
  --from <coordinator_handle_if_available> \
  --inject \
  --json
```

`--inject` 会把 worker lifecycle 协议注入目标终端。worker 应通过 Orca orchestration 上报 `worker_done`, `heartbeat`, `ask`, `escalation` 等事件。

8. 等待和协调:

```bash
orca orchestration check \
  --wait \
  --types worker_done,escalation,decision_gate,ask \
  --timeout-ms 600000 \
  --json
```

默认监督等待窗口是 10 分钟。第一次 wait timeout 后, 做 liveness check, 向用户汇报一次当前状态, 让用户选择继续等待、结束并汇总、取消 task 或重新派发。用户选择继续后, 不要每个窗口重复打扰; 除非出现 ask、escalation、terminal 消失、明显长时间无活动, 或用户要求每次超时都询问。

循环等待直到所有必要 worker 完成、阻塞被处理、决策门关闭或用户要求停止。遇到 worker 的阻塞问题时, 使用 `orca orchestration reply` 或 decision gate 处理, 并把需要用户判断的问题明确返回给用户。

9. 验收 worker 结果并收口:

- 汇总每个 worker 的输出、变更、风险、未完成事项。
- `worker_done` 只表示 worker 自称完成, 不等于结果可信。
- 检查 worker 是否返回 task/dispatch 关联信息、expected output、文件改动、验证结果和剩余风险。
- 写者必须说明改动文件和验证命令/结果; 无法验证时必须明确说明。
- review 必须列出 findings 或明确无问题。
- 检查是否越过 `writeAccess`、`allowedPaths` 或 `forbiddenPaths`。
- 多 worker 输出冲突时, 创建 decision gate 或向用户总结选项。
- 必要时继续创建 follow-up task 或 dispatch review task。
- 完成后用 Orca task 状态表达完成/取消/阻塞, 而不是写本地任务日志。

## Coordinator 行为

coordinator 必须先输出或内部形成清晰计划:

- 任务目标和验收条件。
- 从 `.orchestrater/config.json` 读取的 worker 列表和角色。
- 子任务依赖关系。
- 每个 worker 的 expected output。
- 每个 worker 的写权限: `writeAccess`, `allowedPaths`, `forbiddenPaths`。
- 需要用户确认的决策点。
- 收敛条件: 什么时候停止等待并汇总。

如果用户只指定一个 worker, coordinator 可以直接创建一个 task 并派发。若用户指定多个 worker:

- 有角色: 按角色创建子任务或同一 task 的不同 dispatch prompt。
- 无角色: 广播同一目标, 要求各 worker 独立给出结果。

默认采用单写者、多读者: 当前 worktree 中同一时间只有一个 implementation owner 可以写文件。review、research、test 和 docs 角色默认只读或产出建议。需要多个 worker 并行写时, 要求用户明确授权或改用独立 worktree。

写任务不得自动重试。只读任务最多建议重试 1 次, 且必须说明原因。command 启动失败不重复试超过 1 次。不能确认无副作用时, 不重复 dispatch 同一写任务。

## Full Handoff

当用户表达“交给某个智能体独立处理”“handoff”“handover”“give this to another agent”等完整移交意图时:

- 不创建 supervised orchestration lifecycle。
- 可用 `orca terminal send` 把完整上下文发送到目标 agent。
- 如用户明确要求隔离, 可创建新 worktree 并带 prompt 启动。
- 发送后停止监督, 只报告移交目标和上下文摘要。

## Helper

`scripts/orchestrater.py` 只允许作为 skill 内部 helper 使用。它可以摘要 Orca 状态、当前 worktree、terminal 列表, 以及初始化/读取/校验 `.orchestrater/config.json`。它不能作为用户入口, 不能创建自定义任务状态, 不能替代 `orca orchestration task-create/dispatch/check`。

helper 默认只输出脱敏摘要, 不返回 Orca terminal 原始 preview。只有调试时才允许显式使用:

```bash
python3 scripts/orchestrater.py --json --raw-orca
```

## 失败处理

- Orca 不可用: 报告 `orca status --json` 的失败信息, 建议用户先启动 Orca。
- 没有可用 worker: 说明当前可见终端和缺失的 agent command, 再请求用户选择或允许启动。
- 配置中的 worker command 不可信: 不自动创建 terminal, 先请求用户确认。
- terminal handle 失效: 重新用 `orca terminal list --worktree active --json` 获取, 不长期信任缓存。
- `.orchestrater/config.json` 缺失: 必须先完成首次配置问卷并写入配置。
- 配置无效: 报告校验错误, 不派发任务。
- 配置 version 不支持: 阻止 dispatch, 提示当前 helper/skill 不支持。
- wait timeout: 10 分钟窗口后汇报一次并让用户选择继续或结束。
- worker escalation: 先判断 coordinator 能否解决; 不能解决时把阻塞点交给用户。
- task 结果冲突: 创建决策门或向用户总结冲突选项。
- 不确定是否应创建新 worktree: 默认留在当前 worktree。
