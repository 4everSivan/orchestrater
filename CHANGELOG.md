# 更新日志

## [0.2.0] - 2026-07-10

### Added

- 新增专用于 Orchestrater 编排的 Node.js CLI（`src/cli.mjs`），负责配置解析、验证、终端解析及证据收集。
- 升级 PolicyConfig 至 `v2` 格式，支持从 `v1` 自动迁移，且在迁移时自动备份旧配置为 `config.v1.bak`。
- 实现写任务的文件差异收集（evidence capture & verify），确保 worker 以及验证脚本生成的文件均在 `allowedPaths` 内，并防范验证参数中的敏感凭据泄漏。
- 增加对 Orca CLI 兼容性及命令支持（如 `terminal list`, `--inject`, `--result`）的自动能力探针检测。
- 强制限制终端创建与证据捕获必须在带有 `--approved-plan` 的用户确认流程中进行。
- 支持 Claude Code 和 Codex 的安装器配置与插件描述元数据，增加了针对覆盖旧目录及软链接的安全性校验。
- 新增完整的 Node.js 内置单元测试套件，全面覆盖 CLI、配置、Git 工作树及证据归因模块。

### Changed

- 重构 `README.md` 与 `SKILL.md`，对齐 V2 设计，清晰限定 `dispatch --to` 必须使用终端 Handle。
- 细化安装路径与平台选项，更新手动安装指引与安全红线声明。

---

## [0.1.1] - 2026-07-07

- 强化预检阻断分类和任务分发安全检查。
- 增加 npm 分发所需的 package.json 与 bin/install.mjs 安装器。

## [0.1.0] - 2026-07-07

- 将 `/orchestrater` 对齐到 Orca 原生编排边界。
- Orca 运行时状态保留在 Orca 中，本 skill 只维护项目级策略。
- 明确受监督编排与完整交接的行为差异。
- 补充终端句柄分发、角色与会话复用、单写入者策略和验证流程。
- 泛化包安装与使用说明，避免绑定到特定智能体。
- 安装 skill 时包含 `LICENSE` 文件。
