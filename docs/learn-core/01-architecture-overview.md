# 第 1 章：架构概览 —— 这个项目到底在做什么？

## 本章要解决的问题

当你第一次打开 `packages/core/src/` 目录，你会看到 22 个子目录和两百多个源文件。你完全不知道从哪里开始。

这一章要帮你做的事情只有一件：**建立全局地图**。让你在脑子里有一个清晰的画面——哪些文件是核心，哪些是辅助，数据是怎么流动的。

## 本章的核心结论

> **`packages/core` 是一个 AI 编程助手的"无头引擎"（headless engine）。** 它不包含任何 UI，只负责：接收用户请求 → 构造 Prompt → 调用 LLM API → 解析模型响应 → 调度工具执行 → 把结果送回给上层（CLI 或 IDE 插件）。

---

## 1.1 项目定位

Qwen Code 是阿里巴巴推出的 AI 编程助手（类似 GitHub Copilot CLI / Cursor）。整个仓库是 monorepo 结构，`packages/core` 是其中最核心的包，它被 CLI (`packages/cli`) 和其他前端 consume。

打开 `index.ts`（310 行），你会发现它是一个纯粹的 **"导出聚合器"**——把所有子模块的公共 API 重新导出。这告诉我们：`packages/core` 被设计为一个 **SDK/库**，消费方通过 `import { ... } from '@anthropic/core'` 的方式使用。

## 1.2 模块地图

下面是每个子目录的**一句话定位**，帮你在脑子里建起骨架：

```
src/
├── config/          🟢 配置中心 — Config 类是整个系统的"上帝对象"
├── core/            🔴 核心引擎 — 对话循环、LLM 调用、Turn 管理
├── models/          🟡 模型管理 — 多 Provider 模型注册与切换
├── tools/           🔴 工具系统 — 20+ 个工具的定义与注册
├── services/        🟡 基础服务 — Session、文件发现、Git、Shell
├── prompts/         🟢 Prompt 注册 — MCP Prompt 注册表
├── hooks/           🟡 生命周期 — PreToolUse / Stop 等 Hook 拦截
├── extension/       🟡 扩展管理 — 兼容 Claude 格式的插件系统
├── subagents/       🟡 子代理   — 任务委派和多 Agent 协作
├── skills/          🟢 技能系统 — Markdown 定义的可复用指令
├── mcp/             🟡 MCP 协议 — Model Context Protocol 客户端
├── lsp/             🟡 LSP 集成 — 语言服务器协议支持
├── ide/             🟢 IDE 集成 — 编辑器上下文感知
├── telemetry/       🟢 遥测日志 — 使用统计和日志上报
├── qwen/            🟢 通义认证 — Qwen OAuth2 认证和内容生成
├── confirmation-bus/🟢 消息总线 — Hook 和工具确认的通信中枢
├── output/          🟢 输出格式 — JSON 格式化
├── utils/           📦 工具函数 — 100+ 个辅助工具
├── test-utils/      ⚪ 测试辅助
├── mocks/           ⚪ 测试 Mock
├── __mocks__/       ⚪ 测试 Mock
└── generated/       ⚪ 自动生成代码
```

> 🔴 = 最核心，必须精读  
> 🟡 = 重要，建议通读  
> 🟢 = 辅助，按需阅读  
> 📦/⚪ = 工具/测试

## 1.3 核心数据流

**理解这张数据流图，就理解了这个项目 80% 的架构。** 我把这个过程分为几个阶段：

```
用户输入 "帮我修复这个 bug"
        │
        ▼
┌─────────────────┐
│   GeminiClient   │  ← 对话管理器，维护会话状态
│   (client.ts)    │     负责：session 管理、压缩、循环检测
└────────┬────────┘
         │ sendMessageStream()
         ▼
┌─────────────────┐
│   GeminiChat     │  ← 对话会话，管理 history
│   (geminiChat.ts)│     负责：API 调用、重试、流处理
└────────┬────────┘
         │ generateContentStream()
         ▼
┌─────────────────────┐
│   ContentGenerator   │  ← LLM 提供商抽象层
│  (contentGenerator.ts)│    OpenAI / Gemini / Anthropic / Qwen OAuth
└────────┬────────────┘
         │ HTTP/SDK call
         ▼
    ┌─────────┐
    │ LLM API │  ← 外部 API (通义千问 / GPT-4 / Gemini...)
    └────┬────┘
         │ 流式响应
         ▼
┌─────────────────┐
│      Turn        │  ← 单轮对话处理器
│    (turn.ts)     │     负责：解析响应 → 产生事件流
└────────┬────────┘
         │ ServerGeminiStreamEvent（事件流）
         ▼
   ┌─────────────────────────────────────────┐
   │  事件类型分发:                            │
   │  • Content    → 文本输出给用户            │
   │  • ToolCall   → 交给 CoreToolScheduler   │
   │  • Thought    → 思维链展示               │
   │  • Error      → 错误处理                 │
   │  • Finished   → 判断是否需要继续         │
   └────────┬────────────────────────────────┘
            │ (如果有工具调用)
            ▼
   ┌─────────────────────┐
   │  CoreToolScheduler   │  ← 工具调度器
   │ (coreToolScheduler.ts)│    验证 → 确认 → 执行 → 返回结果
   └─────────────────────┘
            │ 工具结果
            ▼
      再次发送给 LLM → 循环...
```

### 关键设计洞察

这里有几个非常值得关注的设计决策：

1. **事件驱动流式架构**：`Turn.run()` 返回的是 `AsyncGenerator<ServerGeminiStreamEvent>`——不是一个完整的响应对象，而是一个事件流。这使得 UI 可以实时展示思考过程和工具调用。

2. **递归的 Agentic Loop**：注意 `GeminiClient.sendMessageStream()` 在工具调用执行完成后会**再次调用自己**（通过 `yield*` 委托），形成了一个递归的 Agent 循环，直到模型不再请求工具调用。

3. **多层重试**：重试不止一个入口——`retryWithBackoff`（网络级）、`GeminiChat` 的内容重试（空响应/无效内容）、`InvalidStreamError` 重试（流异常），各自有独立的重试预算。

## 1.4 分层架构

从依赖关系来看，可以把 `packages/core` 分为五层：

```
┌───────────────────────────────────────────┐
│            扩展层 (Extension Layer)        │
│  hooks / extension / subagents / skills   │
├───────────────────────────────────────────┤
│            工具层 (Tool Layer)             │
│  tools/* / CoreToolScheduler / ToolRegistry│
├───────────────────────────────────────────┤
│          对话引擎层 (Engine Layer)          │
│  GeminiClient / GeminiChat / Turn         │
├───────────────────────────────────────────┤
│          LLM 抽象层 (Abstraction Layer)    │
│  ContentGenerator / models / prompts      │
├───────────────────────────────────────────┤
│          基础设施层 (Infrastructure)        │
│  config / services / utils / telemetry    │
└───────────────────────────────────────────┘
```

**上层依赖下层，下层不依赖上层**（大部分情况下——有少量通过 Config 的间接访问打破了这个规则）。

## 1.5 入口文件 `index.ts` 的秘密

`index.ts` 有 310 行，你可能觉得它只是无脑导出，但如果你仔细看，会发现有一些有趣的模式：

1. **有重复导出**——比如 `./tools/tools.js` 和 `./core/coreToolScheduler.js` 被导出了两次。这不是 bug，而是为了向后兼容（推测：历史上重组过代码结构）。

2. **按"域"分区导出**——注释把导出分成了 Configuration & Models / Core Engine / Tools / Services / LSP / MCP / Telemetry / Extensions & Subagents / Utilities 等区域。这种组织方式映射了我们上面的模块地图。

3. **选择性导出**——不是所有子模块都被完整导出的。比如 `mcp/` 只导出了 OAuth 相关的几个类，`telemetry/` 只导出了特定的 logger 和事件类型。这意味着它们有大量的"内部实现"不暴露给消费方。

## 阅读本章后应该获得的理解

- ✅ 知道 `packages/core` 是一个无头 AI 编程助手引擎
- ✅ 能说出 `src/` 下每个子目录的一句话职责
- ✅ 理解核心数据流：用户输入 → Client → Chat → ContentGenerator → LLM → Turn 事件流 → 工具调度 → 循环
- ✅ 知道分层架构的五层结构
- ✅ 理解 `index.ts` 作为公共 API 边界的设计意图

---

**下一章**：[第 2 章：配置系统](./02-config-system.md) — 深入 Config 这个"上帝对象"，理解它为什么这么大，以及它管理着哪些状态。
