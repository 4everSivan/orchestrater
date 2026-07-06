<!-- source: template/base -->
# orchestrater 项目事实

本文件是 `constitution.md` 的项目实施层, 是所有 AI 工具的共享基线. 只维护**项目事实**: 目录/路径, 脚本命令, skill 入口, 领域知识索引.

边界 (本文件不重复, 只引用):

- 红线 / 证据分级 / 工作模式定义 -> `constitution.md`
- 项目事实 / 路径 / 脚本 / skill 入口 -> `AGENTS.md`
- 工具专属入口 -> `CODEX.md`
- 本地外部工具与临时 skill 目录 -> `.agents/` (已忽略, 不作为项目代码)

---

## 1. 项目目标

本项目用于编写一个面向 Orca 的 agent skill: 通过 `/orchestrator` 一键建立多 agent 执行规则, 下发任务流程, 并约束任务编排行为.

<!-- source: scan/readme, confidence: MEDIUM -->

---

## 2. 沟通与输出规范

- **[强制]** 面向用户的说明/文档/解释统一中文; 中文内容默认英文半角标点.
- **[例外]** 第三方工具输出, 日志, 错误信息, 协议字段和标准 API 名称保留原始英文.
- **[强制]** 先给结论再给依据; 优先可执行建议; 复杂问题说明设计意图, 风险点, 验证方式和回滚边界.

---

## 3. 规则层级与单一事实源映射

优先级 (高->低): `constitution.md` > 工具系统指令 > 本文件 `AGENTS.md` > 工具入口 > generated subagent body > 项目 skill 源码 > 设计说明 > 单次偏好.

冲突裁决: 项目路径/脚本/数据入口以本文件为准; 用户授权不能覆盖 `constitution.md` 红线.

**每个概念只许有一个家 (single source)**:

| 概念 | 唯一归属 |
|------|---------|
| 红线 / 证据分级 / 工作模式 | `constitution.md` |
| 项目事实 / 路径 / 脚本 / 拓扑 | `AGENTS.md` |
| Codex 专属行为 | `CODEX.md` |
| 本地外部 skill/tooling | `.agents/` (忽略, 不进仓库) |

---

## 4. 事实来源优先级

1. 用户明确说明的项目意图和范围.
2. 项目根目录已跟踪或计划跟踪的源码, README, LICENSE 和治理文档.
3. 项目后续新增的 skill 入口文件, 模板, 自检清单和测试样例.
4. 官方文档和对应版本源码.

原则: `.agents/` 只可作为当前会话可用工具的来源, 不可作为本项目源码或项目事实来源.

---

## 5. 目录与路径约定

### 5.1 源码与入口

| 目录 / 文件 | 用途 |
|-------------|------|
| `README.md` | 项目目标说明. |
| `LICENSE` | 项目许可证. |
| `.gitignore` | 本地忽略规则, 必须包含 `.agents/`. |
| `constitution.md` | 项目治理红线和工作模式. |
| `AGENTS.md` | 项目事实层和协作基线. |
| `CODEX.md` | Codex 工具入口. |
| `SKILL.md` | orchestrater skill 入口和 agent 操作流程. |
| `scripts/orchestrater.py` | Orca terminal registry, list, add, dispatch 的确定性脚本. |
| `agents/openai.yaml` | Codex/OpenAI UI skill 元数据. |
| `.orchestrater/agents.json` | 项目级 agent registry, 首次运行时生成, 可提交. |
| `.agents/` | 本地使用的外部 skill/tooling 目录, 已忽略, 不是项目代码. |

### 5.2 参考资料

- `README.md` 提供项目目标.
- `SKILL.md` 定义 skill 使用流程.
- `docs/superpowers/specs/orchestrater-skill-design.md` 是已批准设计规格; 后续不要提交 `docs/superpowers/` 下的新内容.

<!-- source: scan/code-structure, confidence: LOW -->

---

## 6. 标准脚本与验证命令

| 命令 | 用途 |
|------|------|
| `git status --short` | 确认工作区改动范围, 避免混入未授权文件. |
| `rg --files -g '!.agents/**'` | 列出项目文件, 排除本地外部 skill/tooling. |
| `rg -n \"\\{\\{\" constitution.md AGENTS.md CODEX.md` | 检查治理文档没有残留模板占位符. |
| `python3 -m py_compile scripts/orchestrater.py` | 检查 orchestrater 脚本语法. |
| `python3 /Users/sivan/.codex/skills/.system/skill-creator/scripts/quick_validate.py .` | 校验 skill 结构. |

当前未检测到 package manifest 或 Makefile. 脚本验证以 Python stdlib 和 skill validator 为主.

<!-- source: scan/scripts, confidence: HIGH -->

---

## 7. 服务与拓扑

本项目当前不是运行时服务, 未检测到数据库, API, 部署描述或监控告警配置. 治理重点是 skill 指令清晰度, 执行边界, 工具调用安全和可验证工作流.

<!-- source: scan/topology, confidence: MEDIUM -->

---

## 8. 代码结构

- 语言: Markdown / skill instruction format
- 框架: Orca / Codex skill conventions
- 构建系统: 未检测到
- 入口文件: `SKILL.md`
- 架构模式: 单 skill 包 + 确定性脚本 (confidence: MEDIUM)

### 编写规范

- skill 必须说明触发条件, 输入参数, 执行阶段, 可用工具, 禁止事项和错误处理.
- 指令应把项目事实和工具环境分开: 项目事实进入 `AGENTS.md`, 工具临时能力只在用户确认后进入治理规则.
- 示例流程应可复现, 不依赖 `.agents/` 中的临时文件作为项目代码.
- 所有路径示例应以仓库根目录为基准, 并标注是否为未来计划文件.
- 默认在当前 Orca worktree 中启动多个 agent terminal, 不创建新 worktree.
- 默认 agent 为 `codex`, `claude`, `agy`; 不默认包含 `gemini`.
- agent session 复用顺序: cached terminal handle -> terminal title -> lazy create.

<!-- source: template/dim-code -->

---

## 9. 已确认环境能力

本次生成未将任何 MCP / skills 能力写入项目强制规则. 检测到的当前会话能力只能作为会话工具使用, 不构成本项目依赖.

<!-- source: capability-detect, confirmed: false -->
<!-- /source: template/base -->
