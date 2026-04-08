# StatusLine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Qwen Code 增加完整的自定义状态行运行时能力和 `/statusline` 配置向导。

**Architecture:** 在 `packages/cli` 新增独立 `statusline` 模块，负责 payload 构造、命令执行和 UI 调度；Footer 负责渲染；`/statusline` 作为内置命令写入脚本与用户设置。

**Tech Stack:** TypeScript, React/Ink, Vitest, 现有 `Config` / `LoadedSettings` / `uiTelemetryService`

---

### Task 1: 添加配置 schema 与设计文档

**Files:**
- Modify: `packages/cli/src/config/settingsSchema.ts`
- Test: `packages/cli/src/config/settingsSchema.test.ts`
- Create: `docs/superpowers/specs/2026-04-01-statusline-design.md`

- [ ] Step 1: 写 settings schema 失败测试
- [ ] Step 2: 运行 schema 测试确认失败
- [ ] Step 3: 增加 `ui.statusLine` 配置定义
- [ ] Step 4: 运行 schema 测试确认通过

### Task 2: 实现状态行 payload、输出清洗与执行器

**Files:**
- Create: `packages/cli/src/ui/statusline/types.ts`
- Create: `packages/cli/src/ui/statusline/inputBuilder.ts`
- Create: `packages/cli/src/ui/statusline/normalizeOutput.ts`
- Create: `packages/cli/src/ui/statusline/executor.ts`
- Test: `packages/cli/src/ui/statusline/inputBuilder.test.ts`
- Test: `packages/cli/src/ui/statusline/normalizeOutput.test.ts`
- Test: `packages/cli/src/ui/statusline/executor.test.ts`

- [ ] Step 1: 写 payload 与输出清洗失败测试
- [ ] Step 2: 运行测试确认失败
- [ ] Step 3: 写最小实现
- [ ] Step 4: 写执行器失败测试
- [ ] Step 5: 运行测试确认失败
- [ ] Step 6: 写最小执行器实现
- [ ] Step 7: 运行相关测试确认通过

### Task 3: 将状态行接入 Footer

**Files:**
- Create: `packages/cli/src/ui/statusline/useStatusLine.ts`
- Modify: `packages/cli/src/ui/components/Footer.tsx`
- Test: `packages/cli/src/ui/components/Footer.test.tsx`

- [ ] Step 1: 写 Footer 状态行失败测试
- [ ] Step 2: 运行测试确认失败
- [ ] Step 3: 接入 `useStatusLine`
- [ ] Step 4: 更新 Footer 渲染
- [ ] Step 5: 运行 Footer 测试确认通过

### Task 4: 增加 `/statusline` 命令与脚本模板

**Files:**
- Create: `packages/cli/src/ui/utils/statuslineSetup.ts`
- Create: `packages/cli/src/ui/commands/statuslineCommand.ts`
- Modify: `packages/cli/src/services/BuiltinCommandLoader.ts`
- Test: `packages/cli/src/ui/utils/statuslineSetup.test.ts`
- Test: `packages/cli/src/ui/commands/statuslineCommand.test.ts`

- [ ] Step 1: 写 `/statusline` 命令失败测试
- [ ] Step 2: 运行测试确认失败
- [ ] Step 3: 写脚本模板与 settings 写回实现
- [ ] Step 4: 注册内置命令
- [ ] Step 5: 运行命令测试确认通过

### Task 5: 验证与收尾

**Files:**
- Modify: 相关快照或测试文件

- [ ] Step 1: 运行新增测试集合
- [ ] Step 2: 运行受影响现有测试
- [ ] Step 3: 检查 diff 是否只包含本功能所需变更
- [ ] Step 4: 总结未覆盖风险
