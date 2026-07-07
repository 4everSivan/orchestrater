# orchestrater

`orchestrater` 是叠在 Orca `orchestration` skill 之上的**薄策略层**。`/orchestrater` 发起协作,当前智能体作为 coordinator,用 Orca 原生 orchestration 管任务/消息/worker 生命周期,本 skill 只在其上加策略增量:preflight 门、single-writer、writeAccess、角色配置、验收。

项目内不保留任何脚本;所有协作状态在 Orca runtime,coordinator 无状态。

## 设计论点

coordinator 做的每个关键判断,都落进 Orca 运行时状态——让 Orca 的硬机制(blocked/gate 硬拒绝、`--ready` 就绪、`--deps` 串行、3 连熔断)强制后果;coordinator 只负责"检测 + 记证据"。**检测可软(LLM),执行必硬(Orca),证据可复核。** 6 个机制全是同一模式 `软检测→硬执行→可复核证据` 的实例。

承认的软残留:`.orchestrater/config.json` 的 schema 校验(Orca 无原生配置层);但即便漏检,dispatch 仍被 GATE 硬挡。

## 原语

| 原语 | 定义 |
|---|---|
| `PREFLIGHT` | `orca.status ∧ terminal.list(active) ∧ git.porcelain ⇒ {blockers,warnings}` |
| `GATE(kind)` | `task-update --status blocked` + `gate-create`;kind∈{blocker,plan,conflict};dispatch 对 open gate/blocked 硬拒 |
| `SERIAL` | 同 worktree 多写 task 用 `--deps` 串行;父 completed 前下游 ¬ready |
| `VERIFY` | `git diff --name-only` vs allowed/forbiddenPaths + 记 `--result{verificationCommand,exitCode,filesModified}`;可疑才全量重跑 |
| `RESUME` | `task-list`+`gate-list`+`dispatch-show`+`terminal.read`;¬重派 dispatched |
| `ROUTE` | readonly ⇒ `orchestration run --max-concurrent N`;write ⇒ PREFLIGHT→GATE?→dispatch→check→VERIFY→completed |

**治理规则:压流程不压安全条件。** blocker 清单 / writeAccess / `¬重派 dispatched` 保持显式可读,用户可审计。

## 用户用法

```text
/orchestrater 分析当前项目的多智能体协作流程, 找出还缺什么
/orchestrater 让多个智能体分别评审这个设计, 最后给我汇总
/orchestrater 使用 agy 调研 Orca orchestration 的最佳用法
/orchestrater 把实现交给 agy, 当前会话负责监督和汇总
/orchestrater handoff 给 agy 独立处理这个任务
```

最后一条是 full handoff,不再走监督式 lifecycle。

## 首次配置

`.orchestrater/config.json` 缺失时,coordinator 先问 6 题再写入:① coordinator 策略(默认 `current-session`)② 角色拓扑(默认 `research→agy`)③ 每角色独立 session? ④ 策略(`plan-first`/`auto`)⑤ 允许自动建 worker terminal? ⑥ 允许多 worker 并行写?(默认否,单写者)

示例:

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

`version` 是 config schema 版本,非 Orca runtime 版本。仅 `v1`;未知字段保留但 warning;`version≠1`/缺字段 → blocker。同一个 agent command 可承担多角色,但每角色默认独立 `terminalTitle` + 独立 session。不要把 Orca runtime handle 写进配置。

## 路由与写权限

只读扇出过一次粗 PREFLIGHT 后交给 `orchestration run --max-concurrent`;写任务走 `PREFLIGHT→GATE?→dispatch→check→VERIFY→completed` 手写循环。`task-list --ready` 当外部记忆,DAG 深度 ≤ 3-4。

单写者靠 `--deps` 串行 + `completed` 门:父任务过 VERIFY 前,下游写 task 不 `--ready`,Orca 结构性挡并行写。`maxConcurrentWorkers` 对写路径 = 1;`allowParallelWrites: true` + `GATE(plan)` 才可并行写。

## 验收

`worker_done ≠ completed`。coordinator 跑 `git diff --name-only` 对照 `allowedPaths`/`forbiddenPaths`,把 worker 声称的 `verificationCommand`+`exitCode` 记进 `task-update --result`;可疑才全量重跑。越权/文件交集冲突/验收不过 → `GATE(conflict)`;过 → `task-update --status completed --result`。验收不另建 DAG 节点,它就是 `completed` 转移门。

## 崩溃恢复 RESUME

coordinator 无状态,所有关键状态在 Orca。新会话用以下命令重建,核心铁律是**绝不重新 dispatch 一个 `dispatched` task**:

```bash
orca orchestration task-list --json
orca orchestration gate-list --json
# 对每个 dispatched task:
orca orchestration dispatch-show --task <id> --json
orca terminal read --terminal <handle> --json
```

| task 状态 + worker 情况 | 恢复动作 |
|---|---|
| `blocked` + open gate | 不动,把 gate 摆给用户 |
| `dispatched` + worker 活(tui-idle / heartbeat) | 继续 `check --wait`,**¬重派** |
| `dispatched` + worker 死/终端没了 | 只读 → 可重派;写 → `GATE`,¬自动重试 |
| `ready` | 先 PREFLIGHT 再派 |
| `completed` | 已验收(`--result` 有证据),跳过 |
| `failed` | Orca 已 3 连熔断,摆给用户 |

worker 实际干完但没发 `worker_done`(卡住)→ `terminal read` 判断;看着像完成仍无 `worker_done` → `GATE` 问用户,¬擅自判定。

## 监督式协作 vs 完整移交

- 监督式:多智能体分工/并行评审/等待汇总/处理 ask/escalation/decision gate → `orca orchestration` + 本 skill 策略。
- 完整移交:用户明确把任务交给另一智能体独立处理、不需等待汇总、需另起 worktree 隔离 → `orca terminal send`/`worktree create`,¬创建 lifecycle(见 orca-cli skill)。
- 歧义默认 supervised;完整移交词默认 handoff。

## 项目文件

| 路径 | 用途 |
|------|------|
| `SKILL.md` | 压缩版 agent 执行 spec,6 原语 + 策略增量。 |
| `.orchestrater/config.json` | 项目级角色拓扑和默认协作策略。 |
| `agents/openai.yaml` | OpenAI 生态下的发现元数据,不代表 skill 只服务某个产品。 |
| `.gitignore` | 忽略本地工具目录和生成的治理文档。 |

`.agents/` 是本地工具目录,不是项目源码。
