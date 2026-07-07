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

## 安装环境与方式

安装环境:

- Node.js 18 或更高版本, 用于执行 `npx` 安装器。
- Orca CLI 可用, 因为 `/orchestrater` 的实际协作依赖 Orca 原生 orchestration。
- 目标智能体支持从 skill 目录加载 `SKILL.md`。

`npx orchestrater-skill` 只负责把 skill 文件复制到目标 skill 目录。后续协作仍然在支持 skills 的智能体中通过 `/orchestrater` 触发, 不是运行一个 Node.js 或 Python 编排脚本。

### 安装到全局 skill 目录

适合希望在多个项目中复用 `/orchestrater` 的场景。默认目标目录是用户级 skill 目录:

```bash
npx orchestrater-skill
```

默认会写入:

```text
~/.claude/skills/orchestrater
```

如果你的智能体使用其他全局 skill 根目录, 显式指定完整目标目录:

```bash
ORCHESTRATER_SKILL_DIR="$HOME/.agents/skills/orchestrater" npx orchestrater-skill
```

### 安装到项目内 skill 目录

适合希望把 `/orchestrater` 作为当前项目专属能力维护的场景。目标目录应是当前项目约定的 skill 目录:

```bash
ORCHESTRATER_SKILL_DIR="$(pwd)/.agents/skills/orchestrater" npx orchestrater-skill
```

如果项目使用其他目录布局, 只需要把 `ORCHESTRATER_SKILL_DIR` 指向最终的 `orchestrater` skill 目录:

```bash
ORCHESTRATER_SKILL_DIR="$(pwd)/skills/orchestrater" npx orchestrater-skill
```

### 验证安装结果

安装后目标目录应包含以下文件:

```bash
find "$ORCHESTRATER_SKILL_DIR" -maxdepth 2 -type f | sort
```

至少应看到:

```text
LICENSE
README.md
SKILL.md
agents/openai.yaml
```

`/orchestrater` 是通用 skill 入口, 在任何支持 skill 加载的 Orca 兼容智能体中都可调用, 不绑定特定产品。

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

**只读任务**(调研、评审、对比)和**写任务**默认都走监督式派发: coordinator 读取 `.orchestrater/config.json`, 按角色 `terminalTitle` 选择 worker terminal, 创建任务、派发、等待、汇总; 写任务额外做验收。

```bash
orca orchestration task-create --spec "<目标、约束、验收条件>" [--deps '["<前置任务>"]'] --json
orca orchestration dispatch --task <task_id> --to <terminal_handle> --inject --json
orca orchestration check --wait --types worker_done,escalation,decision_gate,ask --timeout-ms 600000 --json
```

`<terminal_handle>` 是 Orca terminal 的运行时 handle, 不是角色名、智能体名或 terminal title。获取和校验步骤:

1. `orca terminal list --worktree active --json` 列出当前 worktree 的 terminal。
2. 按目标角色的 `terminalTitle` 匹配到对应 terminal。
3. 确认 terminal `connected` 且 `writable`。
4. 把 handle 传给 `dispatch --to`; 每次派发前重新获取, 不缓存 handle。

如果用户明确要求自动运行, 或配置 `strategy` 为 `auto`, 且任务不要求固定角色或 session 复用, 可以用 Orca 自驱动作为快捷路径:

```bash
orca orchestration run --max-concurrent <N> --spec "<目标>" --json
```

派发前 coordinator 做只读检查: Orca 是否可用、配置是否有效、terminal handle 是否存在且可用、命令是否可信、是否违反写权限。检查不通过会阻断派发, 需要用户决策的问题以 decision gate 呈现。阻塞分两类: 任务创建前发现的(如 Orca 不可用、配置缺失、命令不可信)直接向用户汇报, 不创建 gate; 任务创建后发现的(如 worker 失踪、验收冲突)才用 gate 或 `task-update --status blocked`。DAG 依赖深度建议不超过 3-4 层。

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
| `bin/install.mjs` | 安装器, 把 skill 文件写入兼容 skill 目录(可用 `ORCHESTRATER_SKILL_DIR` 覆盖)。 |

`.agents/` 是本地工具目录, 不是项目源码。

## License

MIT。
