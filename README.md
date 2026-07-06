# orchestrater

`orchestrater` 是一个搭配 Orca 使用的通用多智能体协作 skill。用户通过 `/orchestrater` 在当前智能体中发起协作, 当前智能体默认作为 coordinator, 再用 Orca 原生 `orca orchestration` 去创建任务、派发 worker、等待结果和处理阻塞。

这个项目不是脚本驱动的命令行项目, 也不是某个智能体产品的专属扩展。Python 文件只保留为 skill 内部的环境检查 helper。

## 核心模型

- `/orchestrater` 是用户入口。
- 当前执行 `/orchestrater` 的智能体默认是 coordinator。
- coordinator 负责拆分目标、选择 worker、派发任务、等待结果、处理 ask/escalation/decision gate, 最后汇总给用户。
- 协作状态以 Orca 原生任务、消息和 worker lifecycle 为准。
- 项目级协作偏好保存在 `.orchestrater/config.json`。
- 默认在当前 Orca worktree 中协作, 不自动创建新 worktree。
- 首次调用必须完成角色和策略配置问卷。
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

## 首次配置

第一次 `/orchestrater` 如果没有 `.orchestrater/config.json`, coordinator 必须先询问并写入项目级配置:

1. coordinator 策略, 默认 `current-session`。
2. 默认角色拓扑, 默认 `research -> agy`。
3. 每个角色是否独立 session, 默认是。
4. 默认协作策略, 推荐 `plan-first`。
5. 是否允许自动创建缺失 worker terminal, 默认仅当前 worktree 允许。
6. 当前 worktree 写权限模型, 默认单写者、多读者。

配置文件只保存稳定偏好, 不保存 Orca runtime 状态。terminal handle、task id、dispatch id、worker_done、ask/reply 和 decision gate 都由 Orca 管理。

示例:

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

同一个 agent command 可以承担多个角色, 但默认每个角色一个独立 terminal title 和独立 session。

`version` 是 orchestrater 配置 schema 版本, 不是 Orca runtime 版本。当前只支持 `version: 1`。未知字段允许保留但会产生 warning; 缺失必填字段或不支持的版本会阻止 dispatch。配置迁移只允许修改项目级偏好, 不处理 Orca task、dispatch、message 或 terminal runtime 状态。

配置诊断:

```bash
python3 scripts/orchestrater.py --diagnose-config --json
```

## Orca 协作流程

coordinator 执行 `/orchestrater` 后, 应使用 Orca 原生命令完成协作:

```bash
python3 scripts/orchestrater.py --diagnose-config --json
python3 scripts/orchestrater.py --show-config --json
orca status --json
orca worktree current --json
orca terminal list --worktree active --json
```

dispatch 前必须做 preflight。阻断项包括 Orca 不可用、配置缺失/无效/版本不支持、目标角色不存在且不能广播、配置 command 不可信且未确认、写任务违反单写者规则、full handoff 与 supervised orchestration 模式冲突。警告项包括 terminal 需要懒启动、多个 terminal 匹配同一 title、当前 worktree 有未提交改动、只读角色收到疑似写任务、`auto` 策略会直接 dispatch。

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
  --timeout-ms 600000 \
  --json
```

默认监督等待窗口是 10 分钟。第一次 timeout 后, coordinator 做 liveness check, 向用户汇报一次当前状态, 并让用户选择继续等待、结束并汇总、取消 task 或重新派发。用户选择继续后, 不要每个窗口重复打扰; 除非出现 ask、escalation、terminal 消失、明显长时间无活动, 或用户要求每次超时都询问。

worker 需要提问时使用 Orca ask/reply; 需要用户决策时使用 decision gate。`worker_done` 只表示 worker 自称完成, 不等于结果可信。任务完成后, coordinator 要检查 expected output、写权限、文件改动、验证结果、冲突和剩余风险, 再汇总每个 worker 的结论和后续动作。

## Session 复用

coordinator 不应该每次都新开 worker。标准顺序是:

1. 读取 `.orchestrater/config.json` 的角色和 `terminalTitle`。
2. 用 `orca terminal list --worktree active --json` 查找当前 worktree 中可写的已有终端。
3. 找不到时, 才用 `orca terminal create --worktree active` 在当前 worktree 懒启动。

示例:

```bash
orca terminal create \
  --worktree active \
  --title "orchestrater:research" \
  --command "agy" \
  --json
```

terminal handle 是运行时状态, 不应作为长期配置写死。需要时重新从 Orca 查询。

使用配置中的 `command` 创建 terminal 前, coordinator 必须确认它是可信 agent 命令。未知命令、路径型命令或包含 shell 元字符的命令必须先展示给用户确认。

## 写权限模型

默认采用单写者、多读者:

- `implementation` 角色默认是唯一写者。
- `research`、`review`、`test`、`docs` 默认只读或产出建议。
- coordinator 自己如果要改文件, 也算一个写者。
- 多个 worker 并行写当前 worktree 必须由用户明确授权。
- 需要并行实现时, 推荐使用独立 worktree 隔离。

派发给 worker 的任务说明应包含 `writeAccess`、`allowedPaths`、`forbiddenPaths` 和 `expectedOutput`。

写任务不得自动重试。只读任务最多建议重试 1 次, 且必须说明原因。不能确认无副作用时, 不重复 dispatch 同一写任务。

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
| `.orchestrater/config.json` | 项目级角色拓扑和默认协作策略。 |
| `scripts/orchestrater.py` | 内部 helper, 摘要 Orca 状态并初始化/读取/校验配置。 |
| `agents/openai.yaml` | OpenAI 生态下的发现元数据, 不代表 skill 只服务某个产品。 |
| `.gitignore` | 忽略本地工具目录和生成的治理文档。 |

`.agents/` 是本地工具目录, 不是项目源码。

## Helper 验证

用户不需要直接运行 Python helper。开发这个 skill 时可以用它检查环境:

```bash
python3 scripts/orchestrater.py --json
python3 scripts/orchestrater.py --init-config
python3 scripts/orchestrater.py --show-config --json
python3 scripts/orchestrater.py --validate-config
python3 scripts/orchestrater.py --diagnose-config --json
```

`--json` 默认只输出脱敏摘要, 不包含 Orca terminal 原始 preview。只有调试时才使用:

```bash
python3 scripts/orchestrater.py --json --raw-orca
```

项目验证:

```bash
python3 -m py_compile scripts/orchestrater.py
python3 /Users/sivan/.codex/skills/.system/skill-creator/scripts/quick_validate.py .
```
