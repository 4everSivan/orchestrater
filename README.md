# orchestrater

`orchestrater` 是一个用于编排 Orca 当前工作树中多个 agent 终端会话的 Codex skill。

它会把 agent 配置和任务状态持久化在项目内, 让后续对话可以复用同一批 agent 会话, 查看已派发任务, 记录决策, 并关闭任务。

## 功能

- 在当前 Orca worktree 中启动并复用多个 agent CLI。
- 默认 agent 为 `codex`, `claude`, `agy`。
- 默认不包含 `gemini`。
- 默认不创建新的 Orca worktree。
- 支持自然语言任务派发和显式参数。
- 在 `.orchestrater/` 下持久化 agent, session, task, decision 状态。

## 项目文件

| 路径 | 用途 |
|------|------|
| `SKILL.md` | skill 入口和执行说明。 |
| `scripts/orchestrater.py` | 处理 registry, sessions, tasks, decisions 和 Orca terminal dispatch 的确定性脚本。 |
| `agents/openai.yaml` | Codex skill 发现用 UI 元数据。 |
| `.orchestrater/agents.json` | 首次使用时创建的 agent registry。 |
| `.orchestrater/sessions.json` | 当前已知 Orca terminal session 状态。 |
| `.orchestrater/tasks.jsonl` | append-only 任务生命周期事件。 |
| `.orchestrater/decisions.jsonl` | append-only 决策, 阻塞, 用户确认和最终摘要。 |

`.agents/` 是本地工具目录, 已被忽略, 不是项目源码。

## 基本用法

在项目根目录执行:

```bash
python3 scripts/orchestrater.py --init
python3 scripts/orchestrater.py --list
python3 scripts/orchestrater.py "Review the current diff"
```

首次使用会创建 `.orchestrater/agents.json`, 默认内容为:

```text
codex  -> codex
claude -> claude
agy    -> agy
```

初始化只写入配置, 不会立即启动 agent 终端。真正派发任务时才会懒启动终端。

## 添加或更新 Agent

```bash
python3 scripts/orchestrater.py --add reviewer --command "claude" --role review
python3 scripts/orchestrater.py --add researcher --command "agy" --role research
```

添加 agent 只更新 registry, 不会杀掉或替换已有终端。

## 派发任务

派发给所有已启用 agent:

```bash
python3 scripts/orchestrater.py "Analyze the architecture and suggest next steps"
```

派发给单个 agent:

```bash
python3 scripts/orchestrater.py --agent codex "Implement the parser change"
```

带角色派发给多个 agent:

```bash
python3 scripts/orchestrater.py \
  --agent codex:implement,claude:review,agy:research \
  "Improve the orchestration workflow"
```

如果指定角色, 每个 agent 会收到角色化 prompt。未指定角色时, 同一个任务会广播给所有选中的 agent。

## 结构化任务流程

每次派发任务都会生成一个 `taskId`, 并按以下阶段推进:

1. `intake`: 记录原始用户目标和选中的 agent。
2. `assign`: 生成 agent 分工。
3. `dispatch`: 把 prompt 发送到 Orca terminal session。
4. `collect`: 等待 agent 响应和后续输入。
5. `synthesize`: 汇总输出并记录关键决策。
6. `close`: 标记任务完成。

查看持久化状态:

```bash
python3 scripts/orchestrater.py --status
```

记录决策或用户确认:

```bash
python3 scripts/orchestrater.py \
  --task-id task-20260706070000-1234abcd \
  --record-decision "使用 handle -> title -> lazy create 作为 session 复用顺序"
```

关闭任务:

```bash
python3 scripts/orchestrater.py \
  --task-id task-20260706070000-1234abcd \
  --close \
  --summary "工作流已实现并验证"
```

## Session 复用

每个 agent 的派发顺序:

1. 如果缓存的 `terminalHandle` 仍 live 且 writable, 直接复用。
2. 按配置的 terminal title 查找 live 终端, 例如 `orchestrater:codex`。
3. 仍未找到时, 在当前 worktree 中懒创建新终端。

脚本使用的 Orca CLI 命令:

```bash
orca status --json
orca terminal list --worktree active --json
orca terminal create --worktree active --title "orchestrater:<name>" --command "<cmd>" --json
orca terminal send --terminal <handle> --text "<prompt>" --enter --json
```

## 验证

```bash
python3 -m py_compile scripts/orchestrater.py
python3 /Users/sivan/.codex/skills/.system/skill-creator/scripts/quick_validate.py .
```

非侵入式测试使用 `--dry-run`; 它不会调用 Orca, 也不会写入 terminal handle:

```bash
python3 scripts/orchestrater.py --agent codex --dry-run "Check the current design"
```

## 当前限制

- 默认只使用当前 Orca worktree。
- 第一版不支持自动创建新 worktree。
- 第一版不接入完整 Orca `orchestration task-create/dispatch`。
- 脚本不会自动读取每个 agent 终端并自行汇总结果; coordinator 需要在审阅输出后记录决策并关闭任务。
