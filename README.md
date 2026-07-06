# orchestrater

`orchestrater` 是一个搭配 Orca 使用的通用多智能体协作 skill。用户通过 `/orchestrater` 在当前智能体中发起协作, 当前智能体默认作为 coordinator, 再用 Orca 原生 `orca orchestration` 去创建任务、派发 worker、等待结果和处理阻塞。

这个项目不是脚本驱动的命令行项目, 也不是某个智能体产品的专属扩展。Python 文件只保留为 skill 内部的环境检查 helper。

## 核心模型

- `/orchestrater` 是用户入口。
- 当前执行 `/orchestrater` 的智能体默认是 coordinator。
- coordinator 负责拆分目标、选择 worker、派发任务、等待结果、处理 ask/escalation/decision gate, 最后汇总给用户。
- 协作状态以 Orca 原生任务、消息和 worker lifecycle 为准。
- 默认在当前 Orca worktree 中协作, 不自动创建新 worktree。
- 默认 worker 偏好只包含 `agy`; 需要其它 worker 时由用户指定或在首次协作时确认。
- 多 worker 且有明确角色时按角色拆分, 没有角色时广播任务。

## 用户用法

在智能体对话中调用:

```text
/orchestrater 分析当前项目的多智能体协作流程, 找出还缺什么
/orchestrater 让多个智能体分别评审这个设计, 最后给我汇总
/orchestrater 使用 agy 调研 Orca orchestration 的最佳用法
/orchestrater 把实现交给 agy, 当前会话负责监督和汇总
```

完整移交时也通过自然语言表达:

```text
/orchestrater handoff 给 agy 独立处理这个任务
```

这种场景是 full handoff, 不再使用监督式 worker lifecycle。

## Orca 协作流程

coordinator 执行 `/orchestrater` 后, 应使用 Orca 原生命令完成协作:

```bash
orca status --json
orca worktree current --json
orca terminal list --worktree active --json
```

创建任务:

```bash
orca orchestration task-create \
  --task-title "<短标题>" \
  --spec "<目标、上下文、约束、期望产物、验收条件>" \
  --json
```

派发给 worker:

```bash
orca orchestration dispatch \
  --task <task_id> \
  --to <worker_handle> \
  --inject \
  --json
```

等待 worker 结果和阻塞事件:

```bash
orca orchestration check \
  --wait \
  --types worker_done,escalation,decision_gate,ask \
  --timeout-ms 60000 \
  --json
```

worker 需要提问时使用 Orca ask/reply; 需要用户决策时使用 decision gate。任务完成后, coordinator 汇总每个 worker 的结论、冲突、风险和后续动作。

## Session 复用

coordinator 不应该每次都新开 worker。标准顺序是:

1. 用 `orca terminal list --worktree active --json` 查找当前 worktree 中可写的已有终端。
2. 复用匹配的 worker terminal。
3. 找不到时, 才用 `orca terminal create --worktree active` 在当前 worktree 懒启动。

示例:

```bash
orca terminal create \
  --worktree active \
  --title "orchestrater:agy" \
  --command "agy" \
  --json
```

terminal handle 是运行时状态, 不应作为长期配置写死。需要时重新从 Orca 查询。

## 监督式协作与完整移交

监督式协作适用于:

- 多智能体分工。
- 并行评审。
- coordinator 需要等待多个结果再汇总。
- 需要处理 worker 的 ask、escalation 或 decision gate。

完整移交适用于:

- 用户明确要求把任务交给另一个智能体独立处理。
- coordinator 不需要等待和汇总。
- 需要另起 worktree 做隔离执行。

完整移交时使用 Orca terminal/worktree handoff 能力, 不创建 supervised orchestration lifecycle。

## 项目文件

| 路径 | 用途 |
|------|------|
| `SKILL.md` | skill 的主执行说明, 定义 `/orchestrater` 如何使用 Orca 原生 orchestration。 |
| `scripts/orchestrater.py` | 内部环境检查 helper, 只摘要 Orca 状态、当前 worktree 和 terminal 列表。 |
| `agents/openai.yaml` | OpenAI 生态下的发现元数据, 不代表 skill 只服务某个产品。 |
| `.gitignore` | 忽略本地工具目录和生成的治理文档。 |

`.agents/` 是本地工具目录, 不是项目源码。

## Helper 验证

用户不需要直接运行 Python helper。开发这个 skill 时可以用它检查环境:

```bash
python3 scripts/orchestrater.py --json
```

项目验证:

```bash
python3 -m py_compile scripts/orchestrater.py
python3 /Users/sivan/.codex/skills/.system/skill-creator/scripts/quick_validate.py .
```
