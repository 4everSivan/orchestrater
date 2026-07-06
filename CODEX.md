<!-- source: template/tool-entry/codex -->
# Codex

@constitution.md
@AGENTS.md

本文件只描述 Codex 工具自身的专属能力与行为. Codex 原生读取 `AGENTS.md` 获取项目事实; 工程原则见 `constitution.md`.

---

## 1. 会话管理

- **长时间任务**: 大型独立工作流建议开启新会话, 避免上下文污染.
- **上下文卫生**: 接近上下文上限时主动总结关键事实并交接.
- **项目边界**: 扫描和改动项目代码时默认排除 `.agents/`, 因为它是本地使用的外部 skill/tooling 目录.

---

## 2. Codex 专属能力

- **文件编辑**: 手工改文件使用 patch, 保持改动小而可审查.
- **验证优先**: 生成或修改 skill 后, 至少执行占位符检查, 路径检查和工作区 diff 检查.
- **上下文引用**: 使用 `constitution.md` 判断红线和工作模式, 使用 `AGENTS.md` 判断项目事实.
- **外部能力**: 当前会话检测到的 MCP/skills 不自动成为项目依赖; 只有 `AGENTS.md` 明确写入且用户确认后才可视为强制规则.

---

## 3. 已确认环境能力

本次生成未确认写入特定 MCP / skills 能力. 如后续需要把 Context7, Semble, TokenSave, Headroom, Fetch 或某个 skill 作为项目强制流程, 必须由用户明确确认后再更新 `AGENTS.md`.

<!-- source: capability-detect, confirmed: false -->

---

## 4. Skill 索引

当前项目的 skill 入口是 `SKILL.md`. `.agents/` 下的 skill 是本地使用的外部能力, 不属于本项目源码索引.

后续新增项目 skill 后, 在这里登记:

| Skill | 入口 | 用途 | 验证 |
|-------|------|------|------|
| orchestrater | `SKILL.md` | 在当前 Orca worktree 中编排和复用多个 agent terminal | `python3 -m py_compile scripts/orchestrater.py`; `quick_validate.py .` |

<!-- source: user-input -->
<!-- /source: template/tool-entry/codex -->
