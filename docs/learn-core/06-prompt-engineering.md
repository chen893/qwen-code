# 第 6 章：Prompt 工程 —— System Prompt 的构建艺术

## 本章要解决的问题

Prompt 是 AI 助手行为的"灵魂"。这一章要回答：System Prompt 到底写了什么？它是怎么动态构建的？为什么需要根据不同模型生成不同的示例格式？

## 本章的核心结论

> **System Prompt 不是一个静态字符串，而是一个动态构建的系统。** `getCoreSystemPrompt()` 会根据运行环境（沙箱/非沙箱）、Git 仓库状态、模型类型、用户记忆等因素，拼装出最终的 Prompt。这使得同一套核心逻辑可以适配不同场景。

---

## 6.1 getCoreSystemPrompt() 的完整结构

打开 `core/prompts.ts`（1065 行），核心函数 `getCoreSystemPrompt()` 构建的 Prompt 包含以下模块：

```
System Prompt
├── 1. 身份声明 & 核心使命
│   "You are Qwen Code, an interactive CLI agent developed by Alibaba Group"
│
├── 2. Core Mandates（核心规范）
│   ├── 遵循项目约定
│   ├── 验证库/框架可用性
│   ├── 风格和结构模仿
│   ├── 惯用的变更
│   ├── 注释规范
│   ├── 主动性边界
│   └── 路径构建规则
│
├── 3. Task Management（任务管理）
│   └── 要求频繁使用 TodoTool 跟踪任务
│
├── 4. Primary Workflows（主要工作流）
│   ├── 软件工程任务：Plan → Implement → Adapt → Verify
│   └── 新应用开发：Understand → Plan → Approve → Build → Verify → Feedback
│
├── 5. Operational Guidelines（运营指南）
│   ├── 语气风格（简洁直接）
│   └── 安全规则
│
├── 6. 动态段落
│   ├── 沙箱环境说明（如果运行在沙箱中）
│   ├── Git 仓库说明（如果是 Git 项目）
│   └── 工具调用示例（根据模型选择不同格式）
│
├── 7. Final Reminder
│   └── "Your core function is efficient and safe assistance..."
│
└── 8. User Memory（用户记忆）
    └── 追加用户保存的个人偏好
```

## 6.2 Core Mandates 的设计哲学

让我带你细读几条关键规范：

### "Never assume a library is available"

```
Libraries/Frameworks: NEVER assume a library/framework is available or
appropriate. Verify its established usage within the project (check imports,
configuration files like 'package.json', 'Cargo.toml'...)
```

**为什么这么写？** AI 编程助手最常见的问题就是"幻觉性引入"——模型自以为某个库存在，生成了 import 语句，结果编译失败。这条规则强调**先验证后使用**。

### "Do not revert changes unless asked"

```
Do Not revert changes: Do not revert changes to the codebase unless asked
to do so by the user. Only revert changes made by you...
```

**为什么？** 因为 AI 可能在遇到编译错误时过于"热心"地回滚自己的修改，反而导致用户困惑——"我刚要求的改动怎么没了？"

### 路径构建规则

```
Path Construction: Before using any file system tool, you must construct
the full absolute path... combine the absolute path of the project's root
directory with the file's path relative to the root.
```

**为什么要特别强调？** 因为 LLM 经常生成相对路径，而工具系统要求绝对路径。这条规则是大量实际使用经验的总结。

## 6.3 多模型适配的 ToolCall Examples

这是最有趣的设计之一——同样的工具调用示例，为不同模型生成**不同的格式**：

```typescript
function getToolCallExamples(model?: string): string {
  // 1. 先检查环境变量覆盖
  const toolCallStyle = process.env['QWEN_CODE_TOOL_CALL_STYLE'];
  if (toolCallStyle) {
    switch (toolCallStyle.toLowerCase()) {
      case 'qwen-coder':
        return qwenCoderToolCallExamples;
      case 'qwen-vl':
        return qwenVlToolCallExamples;
      case 'general':
        return generalToolCallExamples;
    }
  }

  // 2. 基于模型名称的正则匹配
  if (model && model.length < 100) {
    if (/qwen[^-]*-coder/i.test(model)) return qwenCoderToolCallExamples;
    if (/qwen[^-]*-vl/i.test(model)) return qwenVlToolCallExamples;
  }

  // 3. 默认
  return generalToolCallExamples;
}
```

### 三种格式的区别

| 格式         | 目标模型         | 工具调用的表示方式                               |
| ------------ | ---------------- | ------------------------------------------------ |
| `general`    | 通用 OpenAI 兼容 | `[tool_call: Shell for 'ls -la']` 自然语言风     |
| `qwen-coder` | Qwen Coder 系列  | XML 标签风：`<tool_call><function=Shell>...`     |
| `qwen-vl`    | Qwen VL 系列     | JSON 风：`{"name": "Shell", "arguments": {...}}` |

**为什么需要不同格式？** 因为不同模型在训练时接触到的工具调用格式不同。用模型熟悉的格式，可以显著提高工具调用的准确率。

## 6.4 动态段落的生成

### 沙箱环境说明（IIFE 模式）

```typescript
${(function () {
  const isSandboxExec = process.env['SANDBOX'] === 'sandbox-exec';
  const isGenericSandbox = !!process.env['SANDBOX'];

  if (isSandboxExec) {
    return `# macOS Seatbelt
You are running under macos seatbelt with limited access...`;
  } else if (isGenericSandbox) {
    return `# Sandbox
You are running in a sandbox container...`;
  } else {
    return `# Outside of Sandbox
You are running outside of a sandbox container...`;
  }
})()}
```

这里用了一个**IIFE（立即调用函数表达式）**在模板字符串中做条件生成。这种模式在大型 Prompt 构建中很常见——比用外部 if-else 拼字符串更内聚。

### Git 仓库说明

```typescript
${(function () {
  if (isGitRepository(process.cwd())) {
    return `# Git Repository
- When asked to commit, always start by gathering information:
  - \`git status\` to ensure files are tracked...
  - \`git diff HEAD\` to review all changes...
  - \`git log -n 3\` to match commit message style...`;
  }
  return '';
})()}
```

**只有当前目录是 Git 仓库时**，才注入 Git 相关指令。这避免了在非 Git 项目中给模型无关的信息。

## 6.5 自定义 System Prompt 覆盖

用户可以通过环境变量 `QWEN_SYSTEM_MD` 完全覆盖 System Prompt：

```typescript
export function getCoreSystemPrompt(
  userMemory?: string,
  model?: string,
): string {
  let systemMdEnabled = false;
  let systemMdPath = path.resolve(path.join(QWEN_CONFIG_DIR, 'system.md'));
  const resolution = resolvePathFromEnv(process.env['QWEN_SYSTEM_MD']);

  if (resolution.value && !resolution.isDisabled) {
    systemMdEnabled = true;
    if (!resolution.isSwitch) {
      systemMdPath = resolution.value;
    }
    if (!fs.existsSync(systemMdPath)) {
      throw new Error(`missing system prompt file '${systemMdPath}'`);
    }
  }

  const basePrompt = systemMdEnabled
    ? fs.readFileSync(systemMdPath, 'utf8') // ← 直接读文件替换
    : `You are Qwen Code, an interactive CLI agent...`; // ← 默认内置 Prompt

  return `${basePrompt}${memorySuffix}`; // ← 追加用户记忆
}
```

**`resolvePathFromEnv`** 是一个精巧的小函数，它能区分：

- `QWEN_SYSTEM_MD=true` → 使用默认路径
- `QWEN_SYSTEM_MD=false` → 禁用
- `QWEN_SYSTEM_MD=/path/to/file.md` → 使用自定义路径

## 6.6 压缩 Prompt

对话历史太长时触发的压缩也有自己的 Prompt：

```typescript
export function getCompressionPrompt(): string {
  return `
You are the component that summarizes internal chat history into a given structure.

First, you will think through the entire history in a private <scratchpad>.
...
The structure MUST be as follows:

<state_snapshot>
    <overall_goal>...</overall_goal>
    <key_knowledge>...</key_knowledge>
    <file_system_state>...</file_system_state>
    <recent_actions>...</recent_actions>
    <current_plan>...</current_plan>
</state_snapshot>
`.trim();
}
```

**为什么用 XML 结构？** 因为 XML 标签让 LLM 的输出更加**结构化和可预测**——解析 XML 比解析自由文本要可靠得多，而且模型对 XML 格式的遵循度通常比 JSON 更高（尤其是长内容时）。

## 6.7 项目摘要 Prompt

```typescript
export function getProjectSummaryPrompt(): string {
  return `Please analyze the conversation history above and generate 
a comprehensive project summary in markdown format...

# Project Summary
## Overall Goal
## Key Knowledge
## Recent Actions
## Current Plan
`.trim();
}
```

这个 Prompt 用于生成可保存到 `.qwen/` 的项目摘要文件——让新会话可以快速了解上一次会话的上下文。

## 6.8 Prompt 设计哲学总结

| 原则             | 实现方式                                     |
| ---------------- | -------------------------------------------- |
| **具体优于抽象** | 不说"请好好编程"，而是列出具体的行为规范     |
| **示例驱动**     | 用大量 `<example>` 展示期望的交互模式        |
| **场景适配**     | 根据环境（沙箱/Git/模型）动态调整内容        |
| **防御性编程**   | 明确禁止危险行为（幻觉引入、擅自回滚）       |
| **分层覆盖**     | 内置 → 文件覆盖 → 环境变量，用户可以逐层定制 |

## 阅读本章后应该获得的理解

- ✅ 知道 System Prompt 的 7 大模块和各自作用
- ✅ 理解为什么需要为不同模型生成不同格式的工具调用示例
- ✅ 知道自定义 Prompt 的覆盖机制
- ✅ 理解压缩 Prompt 为什么使用 XML 结构
- ✅ 掌握 Prompt 设计的五个核心原则

---

**下一章**：[第 7 章：服务层](./07-services-layer.md) — Session 管理、聊天记录、Shell 执行等基础服务的设计。
