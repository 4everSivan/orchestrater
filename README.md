# orchestrater

`orchestrater` 是搭配 Orca 使用的多智能体协作 skill。用户通过 `/orchestrater` 发起协作, 当前智能体作为 coordinator, 基于 Orca 原生 orchestration 协调多个智能体完成任务: 拆分目标、派发 worker、等待结果、处理阻塞、汇总输出。

协作状态全部由 Orca 运行时管理, coordinator 不维护本地状态。

## 核心模型

- `/orchestrater` 是用户入口, 当前会话默认作为 coordinator。
- coordinator 负责理解目标、选择 worker、派发任务、等待与处理 ask/escalation/decision gate, 最后汇总。
- 任务、消息、worker 生命周期都由 Orca 原生 orchestration 管理。
- 项目级协作偏好保存在 `.orchestrater/config.json`。
- 默认在当前 Orca worktree 中协作, 不自动创建新 worktree。
- 多 worker 且有明确角色时按角色拆分, 没有角色时广播任务。

## 安装

```bash
npx orchestrater-skill
```

这会把 skill 文件写入 `~/.claude/skills/orchestrater/`。随后在 Claude Code 中用 `/orchestrater <目标>` 调用。自定义安装路径:

```bash
ORCHESTRATER_SKILL_DIR=/path/to/skills npx orchestrater-skill
```

## 用法

```text
/orchestrater 分析当前项目的多智能体协作流程, 找出还缺什么
/orchestrater 让多个智能体分别评审这个设计, 最后给我汇总
/orchestrater 使用 agy 调研 Orca orchestration 的最佳用法
/orchestrater 把实现交给 agy, 当前会话负责监督和汇总
/orchestrater handoff 给 agy 独立处理这个任务
```

最后一条是完整移交, 不再走监督式 lifecycle。

## 首次配置

`.orchestrater/config.json` 不存在时, coordinator 会先询问以下问题再写入配置, 不直接执行用户任务:

1. coordinator 模式, 默认 `current-session`。
2. 角色拓扑, 默认 `research → agy`。
3. 每个角色是否独立 session。
4. 默认协作策略, 推荐 `plan-first`, 用户明确授权时可设为 `auto`。
5. 是否允许自动创建缺失的 worker terminal, 默认仅当前 worktree 允许。
6. 当前 worktree 写权限模型, 默认单写者、多读者。

配置示例:

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

`version` 是配置 schema 版本, 目前仅支持 `v1`。同一个 agent 命令可以承担多个角色, 但每个角色默认使用独立的 `terminalTitle` 和独立 session。Orca 运行时 handle 不写入配置。

## 协作流程

**只读任务**(调研、评审、对比)交给 Orca 自驱动:

```bash
orca orchestration run --spec "<目标>" --max-concurrent <N> --json
```

**写任务**走监督式循环: 创建任务 → 派发前检查 → 派发 → 等待 → 验收 → 标记完成。

```bash
orca orchestration task-create --spec "<目标、约束、验收条件>" [--deps '["<前置任务>"]'] --json
orca orchestration dispatch --task <task_id> --to <worker> --inject --json
orca orchestration check --wait --types worker_done,escalation,decision_gate,ask --timeout-ms 600000 --json
```

派发前 coordinator 做只读检查: Orca 是否可用、配置是否有效、目标 worker terminal 是否存在、命令是否可信、是否违反写权限。检查不通过会阻断派发, 需要用户决策的问题以 decision gate 形式呈现。DAG 依赖深度建议不超过 3-4 层。

## 写权限模型

默认单写者、多读者:

- `implementation` 角色默认是唯一写者。
- `research`、`review`、`test`、`docs` 默认只读或产出建议。
- 同一 worktree 中的多个写任务通过 `--deps` 串行: 前置任务验收完成前, 后续写任务不会被派发, 从结构上避免并行写冲突。
- 需要并行写时, 必须由用户明确授权, 或使用独立 worktree 隔离。

派发给 worker 的任务说明应包含 `writeAccess`、`allowedPaths`、`forbiddenPaths` 和期望产物。写任务不自动重试; 只读任务最多重试一次且需说明原因。

## 验收

`worker_done` 只表示 worker 自称完成, 不等于结果可信。coordinator 收到后会:

- 用 `git diff` 核对改动文件是否在 `allowedPaths`/`forbiddenPaths` 范围内。
- 要求写者说明改动文件和验证命令/结果, 无法验证时必须明确说明。
- 对 review 结果检查是否列出 findings 或明确无问题。
- 发现越权、文件冲突或验收不通过时, 创建 decision gate 交由用户裁决。

验收通过后才将任务标记为 `completed`, 并触发依赖它的后续任务。

## 崩溃恢复

coordinator 不维护本地状态, 所有关键状态都在 Orca 运行时。会话中断或切换后, 新会话通过 Orca 查询重建上下文:

```bash
orca orchestration task-list --json
orca orchestration gate-list --json
orca orchestration dispatch-show --task <id> --json
orca terminal read --terminal <handle> --json
```

恢复时的核心原则是**不重新派发正在执行中的任务**。按状态处置: 阻塞的等待 gate、执行中的继续等待、已完成的跳过、失败的交由用户。写任务的 worker 失踪时不自动重试, 而是创建 decision gate。

## 监督式协作与完整移交

**监督式协作**适用于多智能体分工、并行评审、等待汇总、处理 ask/escalation/decision gate, 使用 `orca orchestration`。

**完整移交**适用于用户明确要求把任务交给另一个智能体独立处理、不需要等待汇总、或需要另起 worktree 隔离, 使用 `orca terminal send` 或 `orca worktree create`, 不创建监督式 lifecycle。

意图不明确时默认按监督式处理; 出现 handoff/handover 等完整移交措辞时按移交处理。

## 项目文件

| 路径 | 用途 |
|------|------|
| `SKILL.md` | skill 执行说明, 定义 `/orchestrater` 的协作策略。 |
| `.orchestrater/config.json` | 项目级角色拓扑和默认协作策略。 |
| `agents/openai.yaml` | OpenAI 生态下的发现元数据。 |
| `package.json` | npm 包元数据, 用于通过 `npx` 分发安装。 |
| `bin/install.mjs` | 安装器, 把 skill 文件写入 `~/.claude/skills/`。 |

`.agents/` 是本地工具目录, 不是项目源码。

## License

MIT。
