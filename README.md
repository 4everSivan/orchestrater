# orchestrater

`orchestrater` 是一个搭配 Orca 使用的通用多智能体编排 skill。它面向支持 skills 的 AI 代理环境, 通过 `/orchestrater` 入口让当前会话担任 coordinator, 基于 Orca 原生 orchestration 协调多个 worker 完成调研、评审、实现、验收和汇总。

这个项目不是一个独立编排脚本, 也不是某个智能体产品的专属插件。它解决的问题是: 把多智能体协作中容易散落在口头约定、临时 prompt、终端会话和个人偏好里的规则, 收敛成一套可安装、可审查、可恢复、可在项目内复用的 skill 流程。

协作状态由 Orca 运行时管理; 本 skill 只维护项目级协作策略和 coordinator 行为边界。

## 适用场景

- 让多个智能体在同一个 Orca worktree 中按角色协作, 例如 research、review、implementation、test、docs。
- 对复杂任务先拆分、派发、等待 worker 结果, 再由 coordinator 统一汇总。
- 对设计、实现或评审任务进行监督式多智能体协作, 保留 ask、escalation、decision gate 等交互路径。
- 在项目中固定一套角色拓扑、会话复用和写权限规则, 避免每次临时重新约定。
- 需要区分监督式协作和完整 handoff: 前者由 coordinator 持续跟进, 后者把任务交给另一个智能体独立处理。

## 设计原则

- **Orca 原生优先**: 任务、消息、dispatch、gate、worker 状态和终端 handle 都以 Orca 原生能力为准。
- **运行时状态归 Orca**: coordinator 不在本地持久化运行时 handle 或任务状态; 会话恢复时重新查询 Orca。
- **项目策略本地化**: 角色拓扑、默认策略、写权限模型保存在 `.orchestrater/config.json`。
- **首次配置强确认**: 第一次调用 `/orchestrater` 时必须完成初始化问题, 不直接执行用户任务。
- **默认单写者**: 同一 worktree 默认单写者、多读者, 写任务通过依赖顺序串行化。
- **可恢复协作**: coordinator 中断后, 新会话通过 Orca task、gate、dispatch 和 terminal 记录恢复上下文。
- **最小安装面**: npm 包只复制 skill 文件, 不修改业务代码, 不启动 worker, 不执行编排流程。

## 核心能力

- 通过 `/orchestrater` 接收用户目标, 由当前会话担任 coordinator。
- 第一次调用时生成项目级 `.orchestrater/config.json`。
- 按角色选择 worker terminal, 并复用已有会话。
- 多 worker 且角色明确时按角色拆分任务; 未指定角色时广播任务。
- 基于 Orca `task-create`、`dispatch`、`check`、`gate` 进行监督式生命周期管理。
- 区分只读任务和写任务, 对写任务进行权限、路径和验证结果检查。
- 支持长任务等待, 默认使用更长超时窗口, 超时后先汇报一次再由用户决定继续或结束。
- 支持完整 handoff 场景, 但不把 handoff 混同为受监督 orchestration。

## 工作流

```text
用户目标
  -> /orchestrater
  -> coordinator 读取或初始化 .orchestrater/config.json
  -> 预检 Orca、配置、terminal、写权限
  -> 创建 task / decision gate
  -> dispatch 到目标 terminal handle
  -> 等待 worker_done / ask / escalation / decision_gate
  -> coordinator 验收与汇总
  -> 用户确认后结束或继续
```

### Phase 1: 首次配置

`.orchestrater/config.json` 不存在时, coordinator 必须先询问以下问题并写入配置, 不直接执行用户任务:

1. coordinator 模式, 默认 `current-session`。
2. 角色拓扑, 默认 `research -> agy`。
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

### Phase 2: 监督式派发

只读任务和写任务默认都走监督式派发。coordinator 读取配置后, 按角色 `terminalTitle` 选择 worker terminal, 创建任务、派发、等待、汇总; 写任务额外做验收。

```bash
orca orchestration task-create --spec "<目标、约束、验收条件>" [--deps '["<前置任务>"]'] --json
orca orchestration dispatch --task <task_id> --to <terminal_handle> --inject --json
orca orchestration check --wait --types worker_done,escalation,decision_gate,ask --timeout-ms 600000 --json
```

`<terminal_handle>` 是 Orca terminal 的运行时 handle, 不是角色名、智能体名或 terminal title。每次派发前都应重新获取:

```bash
orca terminal list --worktree active --json
```

获取后按目标角色的 `terminalTitle` 匹配 terminal, 确认 terminal `connected` 且 `writable`, 再把 handle 传给 `dispatch --to`。

### Phase 3: 等待、汇报与超时

coordinator 等待 worker 事件时默认使用较长超时窗口。长任务建议使用 10 分钟级别的等待窗口:

```bash
orca orchestration check --wait --types worker_done,escalation,decision_gate,ask --timeout-ms 600000 --json
```

如果等待超时, coordinator 不直接重新派发, 而是先向用户汇报一次当前状态, 再询问继续等待、调整任务、结束任务或改为 handoff。

### Phase 4: 验收与汇总

`worker_done` 只表示 worker 自称完成, 不等于结果可信。coordinator 收到后会:

- 用 `git diff` 核对改动文件是否在 `allowedPaths` 和 `forbiddenPaths` 范围内。
- 要求写者说明改动文件和验证命令/结果, 无法验证时必须明确说明。
- 对 review 结果检查是否列出 findings 或明确无问题。
- 发现越权、文件冲突或验收不通过时, 创建 decision gate 交由用户裁决。

验收通过后才将任务标记为 `completed`, 并触发依赖它的后续任务。

## 监督式协作与完整移交

| 模式 | 适用场景 | Orca 能力 |
|------|----------|-----------|
| 监督式协作 | 多智能体分工、并行评审、等待汇总、处理 ask/escalation/decision gate | `orca orchestration` |
| 完整移交 | 用户明确要求把任务交给另一个智能体独立处理, 不需要等待汇总 | `orca terminal send` 或 `orca worktree create` |

意图不明确时默认按监督式处理; 出现 handoff、handover 等完整移交措辞时按移交处理。

## 安全与边界

- 不自动修改目标项目业务代码。
- 不自动提交 git commit, 不 push, 不发布 npm 包。
- 不把 Orca runtime handle 写入 `.orchestrater/config.json`。
- 不在 Orca 不可用、配置无效或 terminal 不可写时派发任务。
- 不把角色名、智能体名或 terminal title 当作 `dispatch --to` 的目标。
- 不默认并行写同一个 worktree; 如需并行写, 必须用户明确授权或使用独立 worktree。
- 不自动重试写任务; 只读任务最多重试一次且必须说明原因。
- 不把本地 `.agents/` 目录当作项目源码。

## 使用

安装后, 在支持 skills 的 AI 工具中显式调用:

```text
/orchestrater 分析当前项目的多智能体协作流程, 找出还缺什么
/orchestrater 让多个智能体分别评审这个设计, 最后给我汇总
/orchestrater 使用 agy 调研 Orca orchestration 的最佳用法
/orchestrater 把实现交给 agy, 当前会话负责监督和汇总
/orchestrater handoff 给 agy 独立处理这个任务
```

最后一条是完整移交, 不再走监督式 lifecycle。

## 安装

要求 Node.js `>=18`。安装后的运行还需要 Orca CLI 可用, 且目标智能体支持从 skill 目录加载 `SKILL.md`。

### 通过 npm / npx 安装

安装到默认用户级 skill 目录:

```bash
npx orchestrater-skill
```

默认写入:

```text
~/.claude/skills/orchestrater
```

安装到用户级 agents skills 目录:

```bash
ORCHESTRATER_SKILL_DIR="$HOME/.agents/skills/orchestrater" npx orchestrater-skill
```

安装到当前项目:

```bash
ORCHESTRATER_SKILL_DIR="$(pwd)/.agents/skills/orchestrater" npx orchestrater-skill
```

指定任意兼容 skill 目录:

```bash
ORCHESTRATER_SKILL_DIR="/path/to/skills/orchestrater" npx orchestrater-skill
```

`ORCHESTRATER_SKILL_DIR` 必须指向最终的 `orchestrater` skill 目录, 而不是上一级 skills 根目录。

### 验证安装

安装后目标目录应包含:

```text
LICENSE
README.md
SKILL.md
agents/openai.yaml
```

可以用以下命令检查:

```bash
find "${ORCHESTRATER_SKILL_DIR:-$HOME/.claude/skills/orchestrater}" -maxdepth 2 -type f | sort
```

### 手动安装

也可以把本仓库中的以下文件复制到任意兼容 skill 目录:

```text
orchestrater/
├── LICENSE
├── README.md
├── SKILL.md
└── agents/
    └── openai.yaml
```

`.orchestrater/config.json` 不随 npm 包发布, 它属于目标项目的本地协作配置, 由第一次 `/orchestrater` 调用时创建。

## 发布状态

当前 npm 包版本为 `0.1.1`。发布内容见 `CHANGELOG.md`。

## 项目结构

```text
orchestrater/
├── CHANGELOG.md          # 发布变更记录, 不打包进 npm 包
├── LICENSE               # MIT License
├── README.md             # 项目说明和安装文档
├── SKILL.md              # skill 执行说明和 coordinator 策略
├── agents/
│   └── openai.yaml       # OpenAI 生态下的发现元数据
├── bin/
│   └── install.mjs       # npm/npx 安装器
├── package.json          # npm 包定义
└── .orchestrater/
    └── config.json       # 项目级协作配置示例或本地配置
```

`.agents/` 是本地工具目录, 不是项目源码。

## 技术说明

`orchestrater` 本身不实现多智能体运行时。它通过 skill 指令约束 coordinator 使用 Orca 原生 orchestration:

- `orca orchestration task-create` 创建结构化任务。
- `orca orchestration dispatch` 把任务分发给具体 terminal handle。
- `orca orchestration check` 等待 worker、ask、escalation 和 decision gate 事件。
- `orca terminal list/read/send` 查询和操作 Orca terminal。

这种设计让运行时状态、会话复用和崩溃恢复都留在 Orca 中, skill 只负责项目级协作策略、角色选择、派发纪律和验收纪律。

## License

MIT。
