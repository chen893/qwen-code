# Qwen Code `packages/core` 源码学习手册

> 📖 这是一套按章节拆分的多文档源码学习手册，帮助你逐步理解 Qwen Code 的核心引擎架构。
> 每个文档都可以独立阅读，建议按编号顺序学习。

---

## 文档体系

| 章节     | 文件                                                         | 核心问题                                                         |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| 第 1 章  | [01-architecture-overview.md](./01-architecture-overview.md) | 这个项目到底在做什么？整体架构长什么样？                         |
| 第 2 章  | [02-config-system.md](./02-config-system.md)                 | 配置系统如何组织？Config 类为什么这么庞大？                      |
| 第 3 章  | [03-content-generator.md](./03-content-generator.md)         | 如何支持多个 LLM 提供商？ContentGenerator 抽象层的设计           |
| 第 4 章  | [04-conversation-engine.md](./04-conversation-engine.md)     | 对话引擎的核心循环：GeminiClient → GeminiChat → Turn             |
| 第 5 章  | [05-tool-system.md](./05-tool-system.md)                     | 工具系统架构：DeclarativeTool、ToolRegistry 与 CoreToolScheduler |
| 第 6 章  | [06-prompt-engineering.md](./06-prompt-engineering.md)       | System Prompt 如何构建？Prompt 工程的设计思路                    |
| 第 7 章  | [07-services-layer.md](./07-services-layer.md)               | 服务层：Session、ChatRecording、Shell 等基础服务                 |
| 第 8 章  | [08-subagents-and-skills.md](./08-subagents-and-skills.md)   | 子代理与技能系统：如何实现任务委派？                             |
| 第 9 章  | [09-hooks-and-extensions.md](./09-hooks-and-extensions.md)   | Hook 系统与扩展机制：生命周期拦截与插件化                        |
| 第 10 章 | [10-mcp-and-lsp.md](./10-mcp-and-lsp.md)                     | MCP 协议与 LSP 集成：外部工具和语言服务的接入                    |

---

## 阅读建议

1. **第 1 章是全局地图**：先花 10 分钟通读，建立整体认知
2. **第 2-3 章是基础设施**：理解配置和 LLM 抽象是后续所有章节的前提
3. **第 4-5 章是核心引擎**：这两章是最重要的，理解了对话循环和工具系统，就理解了这个项目的灵魂
4. **第 6 章可以独立阅读**：如果你对 Prompt 工程特别感兴趣
5. **第 7-10 章是扩展模块**：根据兴趣选择性阅读

## 源码规模参考

```
packages/core/src/
├── config/          ~60KB  配置系统
├── core/            ~200KB 核心引擎（对话、Turn、Prompt、工具调度）
├── tools/           ~350KB 各种工具实现
├── services/        ~120KB 基础服务
├── models/          ~80KB  模型配置管理
├── hooks/           ~80KB  Hook 生命周期系统
├── extension/       ~130KB 扩展管理
├── subagents/       ~120KB 子代理系统
├── skills/          ~45KB  技能系统
├── mcp/             ~100KB MCP 协议实现
├── lsp/             ~110KB LSP 集成
├── utils/           ~300KB 工具函数库
├── telemetry/       ~130KB 遥测与日志
└── index.ts         ~11KB  公共 API 入口
```
