# 第 8 章：子代理与技能系统 —— 任务委派与可复用指令

## 本章要解决的问题

当一个任务太复杂，需要"分而治之"时，主 Agent 可以通过 `TaskTool` 将子任务委派给**子代理（Subagent）**。同时，技能（Skill）是一种可复用的指令集。这一章解答：它们是怎么工作的？

## 本章的核心结论

> **子代理是"独立的 Agent 实例"**，有自己的 System Prompt、工具集和模型配置。它通过 `TaskTool` 被调用，运行结束后将结果返回给主 Agent。  
> **技能是"Markdown 定义的指令文档"**，被读取后作为上下文注入到 Agent 的对话中。两者一个是"做"，一个是"知"。

---

## 8.1 SubagentConfig：子代理配置

```typescript
export interface SubagentConfig {
  name: string; // 唯一标识
  description: string; // 何时使用此代理
  tools?: string[]; // 允许使用的工具白名单
  systemPrompt: string; // 独立的 System Prompt
  level: SubagentLevel; // 存储级别
  filePath?: string; // 配置文件路径
  modelConfig?: Partial<ModelConfig>; // 独立的模型配置
  runConfig?: Partial<RunConfig>; // 运行限制（时间/轮数）
  color?: string; // UI 显示颜色
}
```

### 五层存储级别

```typescript
type SubagentLevel = 'session' | 'project' | 'user' | 'extension' | 'builtin';
```

```
优先级（高 → 低）：
session   → 运行时注入，只在当前会话有效
project   → .qwen/agents/ 目录下，项目级
user      → ~/.qwen/agents/ 目录下，用户级
extension → 由扩展提供
builtin   → 内置，不可修改
```

**合并规则**：如果同名子代理存在于多个级别，**高优先级覆盖低优先级**。Session 级别的子代理总是胜出。

### RunConfig：运行约束

```typescript
export interface RunConfig {
  max_time_minutes?: number; // 最大运行时间（分钟）
  max_turns?: number; // 最大对话轮数
}
```

这些约束防止子代理失控——一个"陷入循环"的子代理不会无限运行。

## 8.2 SubagentTerminateMode：五种终止原因

```typescript
export enum SubagentTerminateMode {
  GOAL = 'GOAL', // 正常完成目标 ✅
  ERROR = 'ERROR', // 遇到不可恢复的错误
  TIMEOUT = 'TIMEOUT', // 超过最大运行时间
  MAX_TURNS = 'MAX_TURNS', // 超过最大轮数
  CANCELLED = 'CANCELLED', // 被用户通过 AbortSignal 取消
}
```

**为什么区分这5种？** 每种终止都会产生不同的返回信息给主 Agent，帮助它决定是否需要重试或调整策略。

## 8.3 SubagentManager：配置管理

SubagentManager 负责从多个来源发现和合并子代理配置：

```
SubagentManager
├── 扫描 .qwen/agents/*.md（项目级）
├── 扫描 ~/.qwen/agents/*.md（用户级）
├── 接收 extension 提供的子代理
├── 加载内置子代理
├── 接收 session 级别的运行时注入
└── 按名称 + 优先级合并
```

### Markdown 格式定义

子代理通过 **Markdown + YAML Front Matter** 定义：

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools:
  - ReadFile
  - GrepTool
  - GlobTool
model:
  model: qwen3-coder-plus
  temperature: 0.3
run:
  max_turns: 20
---

You are a specialized code reviewer. Analyze the code for:

1. Potential bugs and edge cases
2. Performance issues
3. Code style violations
   ...
```

## 8.4 TaskTool：任务委派的实现

`TaskTool` 是连接主 Agent 和子代理的桥梁：

```
主 Agent: "TaskTool(agent='code-reviewer', task='review auth.ts')"
    │
    ▼
TaskTool.execute()
    │
    ├── 1. 从 SubagentManager 获取子代理配置
    ├── 2. 创建新的 GeminiClient + ContentGenerator
    ├── 3. 设置独立的 System Prompt 和工具集
    ├── 4. 以 task 作为初始用户消息
    ├── 5. 运行 Agentic Loop（和主 Agent 相同的循环！）
    ├── 6. 收集输出事件
    └── 7. 将最终结果返回给主 Agent
```

**关键设计**：子代理有自己独立的 history、tools 和 contentGenerator。它不共享主 Agent 的上下文——这是隔离性的保证。

### PromptConfig 与 ToolConfig

```typescript
interface SubagentRuntimeConfig {
  promptConfig: PromptConfig; // System Prompt 或初始消息
  modelConfig: ModelConfig; // 模型选择
  runConfig: RunConfig; // 运行约束
  toolConfig?: ToolConfig; // 工具限制
}
```

**`ToolConfig.tools`** 可以是工具名称（从 ToolRegistry 查找）或完整的 FunctionDeclaration。这允许子代理使用主 Agent 没有的工具（但通常是相反——限制子代理只能用少量工具）。

## 8.5 SkillManager：技能系统

技能是更轻量的"知识注入"机制：

```
skills/
├── SkillManager.ts      — 技能管理器
├── skillParser.ts        — Markdown 解析器
└── skillWatcher.ts       — 文件系统监听
```

### 技能格式

和子代理类似，技能也用 Markdown + YAML Front Matter：

```markdown
---
name: test-patterns
description: Testing patterns used in this project
---

# Test Patterns

## Unit Tests

- Use vitest as the test framework
- Test files should be co-located with source files
- Use `.test.ts` extension
  ...
```

### SkillManager 的工作流

```
SkillManager
├── 扫描 .qwen/skills/*.md（项目级）
├── 扫描 ~/.qwen/skills/*.md（用户级）
├── 监听文件变化（实时更新）
└── 通过 SkillTool 提供给 Agent 查询
```

当 Agent 需要了解"这个项目怎么写测试"时，它可以调用 `SkillTool` 读取相关技能文档。

### 技能 vs 子代理

| 维度     | 技能（Skill）             | 子代理（Subagent）    |
| -------- | ------------------------- | --------------------- |
| 本质     | 知识文档                  | 独立的 Agent 实例     |
| 调用方式 | 读取 + 注入上下文         | 创建新的执行环境      |
| 资源消耗 | 低（只是文本）            | 高（独立的 LLM 调用） |
| 适用场景 | "告诉 Agent 规范"         | "交给另一个专家去做"  |
| 隔离性   | 无（在主 Agent 上下文中） | 有（独立的 history）  |

## 阅读本章后应该获得的理解

- ✅ 理解子代理的五层存储级别和合并规则
- ✅ 知道 TaskTool 如何创建独立的 Agent 实例
- ✅ 理解子代理的五种终止模式
- ✅ 知道技能系统的 Markdown 格式和实时监听机制
- ✅ 能区分技能和子代理的使用场景

---

**下一章**：[第 9 章：Hook 系统与扩展机制](./09-hooks-and-extensions.md) — 生命周期拦截点和插件化架构。
