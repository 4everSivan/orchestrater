# orchestrater

`orchestrater` 是一个基于 Orca 的本地多智能体编排 skill。v0.2 将配置校验、terminal 选择和写任务验收收敛为无第三方依赖的 Node CLI；Claude Code 与 Codex 的 skill 仅负责用户确认、Orca task/gate 和结果汇总。

## 保证与边界

- 写任务只能在干净的当前 worktree 中开始，并且同一时刻只允许一个已派发的写任务。
- 每个写任务都必须声明非空 `allowedPaths` 和结构化 `verification` command/args。
- dispatch 前保存 baseline 到 Orca task result；完成前校验 Git 可见的改动范围和 verification exit code。
- duplicate、stale 或不可写 terminal 都是 blocker，绝不按 title 猜测选择。
- 这是可审计 policy，不是 OS 文件沙箱。需要强制隔离时应使用独立 worktree 或容器。

## 安装

需要 Node.js `>=18`、Orca CLI，以及目标宿主的 skill 支持。

```bash
npx orchestrater-skill --host claude
npx orchestrater-skill --host codex
```

默认目标分别为 `~/.claude/skills/orchestrater` 与 `~/.codex/skills/orchestrater`。目标目录已存在时安装失败；确认替换时才使用：

```bash
npx orchestrater-skill --host codex --force
```

自定义目录必须同时提供 `ORCHESTRATER_SKILL_DIR` 和 `--allow-custom-destination`。安装器拒绝 symlink 与未授权目录；`--force` 只会替换标准或已显式授权的目标。

## 配置

目标项目使用 `.orchestrater/config.json` 保存长期角色策略。v2 示例：

```json
{
  "version": 2,
  "coordinator": { "mode": "current-session" },
  "defaults": { "worktree": "active", "strategy": "plan-first", "autoCreateTerminals": true, "onMissingRole": "ask", "maxConcurrentReadWorkers": 2 },
  "permissions": { "writeModel": "single-writer", "allowParallelWrites": false, "defaultWriteRole": "implementation" },
  "roles": [
    { "name": "implementation", "agent": "codex", "command": "codex", "terminalTitle": "orchestrater:implementation", "session": "dedicated", "writeAccess": true, "responsibilities": ["implement"] },
    { "name": "review", "agent": "claude", "command": "claude", "terminalTitle": "orchestrater:review", "session": "dedicated", "writeAccess": false, "responsibilities": ["review"] }
  ]
}
```

配置不存在时，先预览默认配置；确认角色与命令后才写入：

```bash
node ~/.claude/skills/orchestrater/src/cli.mjs config init
node ~/.claude/skills/orchestrater/src/cli.mjs config init --write
```

旧版 v1 不会自动改写。先检查：

```bash
node ~/.claude/skills/orchestrater/src/cli.mjs config validate
node ~/.claude/skills/orchestrater/src/cli.mjs config migrate
```

审阅迁移结果后，明确允许时才执行 `config migrate --write`。迁移会原子写入，并将旧配置保留为同目录 `config.v1.bak`。

## 写任务流程

写入范围是每个任务的必填输入，而不是角色的默认权限：

```json
{
  "allowedPaths": ["src/**", "test/**"],
  "verification": { "command": "npm", "args": ["test"] }
}
```

coordinator 先展示该范围并取得确认，然后创建带 scope hash 的 Orca task、运行 `preflight` 和 `evidence capture`、重新解析 terminal 后才 dispatch。收到 `worker_done` 后运行 `evidence verify`；verification 前后任一越界文件、缺 baseline、hash 不匹配或非零验证退出码都必须创建 Orca conflict gate，不能 completed。

preflight 还会执行 Orca capability probe；当前 CLI 缺少 task result、dispatch 或 terminal 所需选项时，返回 `E_RUNTIME_ORCA_INCOMPATIBLE`，不会创建 task。

## 开发与验证

```bash
npm test
npm pack --dry-run
python3 /Users/sivan/.codex/skills/.system/skill-creator/scripts/quick_validate.py .
```

Codex 的插件源位于 `hosts/orchestrater-codex/`；Claude Code 的插件源位于 `hosts/claude/`。它们共享根目录 skill 与 Node runtime，不各自复制编排逻辑。
