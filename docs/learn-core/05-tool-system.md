# 第 5 章：工具系统 —— DeclarativeTool、ToolRegistry 与 CoreToolScheduler

## 本章要解决的问题

AI 编程助手的核心能力就是**调用工具**——读文件、写文件、执行命令、搜索代码等等。这一章要搞清楚：工具是怎么定义的？怎么注册的？调用的完整生命周期是什么？

## 本章的核心结论

> **工具系统采用"构建者模式"（Builder Pattern）**：每个工具是一个 `DeclarativeTool` 类（工具定义），它的 `build()` 方法返回 `ToolInvocation`（具体调用）。这种分离使得"验证参数"和"执行操作"成为两个独立的阶段。  
> **CoreToolScheduler 是一个状态机**，管理每个工具调用的完整生命周期：validating → scheduled → awaiting_approval → executing → success/error/cancelled。

---

## 5.1 DeclarativeTool：工具定义模式

先看最核心的抽象——`DeclarativeTool`（`tools/tools.ts`）：

```typescript
export abstract class DeclarativeTool<TParams, TResult extends ToolResult>
  implements ToolBuilder<TParams, TResult>
{
  constructor(
    readonly name: string, // 内部名称（如 "ReadFile"）
    readonly displayName: string, // 显示名称（如 "Read File"）
    readonly description: string, // 描述（给 LLM 看）
    readonly kind: Kind, // 分类（read / edit / command / ...）
    readonly parameterSchema: unknown, // JSON Schema
    readonly isOutputMarkdown: boolean = true,
    readonly canUpdateOutput: boolean = false,
  ) {}

  get schema(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parametersJsonSchema: this.parameterSchema,
    };
  }

  // 参数验证（子类可覆盖）
  validateToolParams(_params: TParams): string | null {
    return null;
  }

  // 核心方法：构建可执行的调用实例
  abstract build(params: TParams): ToolInvocation<TParams, TResult>;
}
```

### 为什么分离 Tool 和 Invocation？

```
DeclarativeTool（工具定义）          ToolInvocation（具体调用）
┌──────────────────┐              ┌──────────────────┐
│ name             │              │ params（已验证）   │
│ schema           │   build()    │ getDescription()  │
│ description      │ ──────────→  │ shouldConfirmExecute() │
│ kind             │              │ execute()         │
│ build(rawParams) │              │ toolLocations()   │
└──────────────────┘              └──────────────────┘
```

**好处**：

1. **参数验证集中在 build()**——一个 build() 调用完成所有验证，返回的 Invocation 保证参数合法
2. **Invocation 是不可变的**——已构建的调用实例可以安全传递、排队、延迟执行
3. **单一职责**——Tool 负责"我是什么"，Invocation 负责"我怎么执行这一次"

## 5.2 ToolInvocation 接口

```typescript
export interface ToolInvocation<TParams, TResult> {
  params: TParams; // 验证过的参数
  getDescription(): string; // 描述（给 UI 显示）
  toolLocations(): ToolLocation[]; // 影响的文件路径
  shouldConfirmExecute(signal): Promise<ConfirmDetails | false>; // 是否需要确认
  execute(signal, updateOutput?): Promise<TResult>; // 执行操作
}
```

**`shouldConfirmExecute`** 是审批系统的入口——每个工具可以自己决定"这次调用是否需要用户确认"。比如：

- `ReadFileTool`：不需要确认（只读操作）
- `WriteFileTool`：需要确认（修改文件）
- `ShellTool`：几乎总是需要确认（除非 YOLO 模式）

## 5.3 Kind：工具分类系统

```typescript
export enum Kind {
  ReadOnly = 'readonly', // 读取操作（不修改文件系统）
  FileEdit = 'file_edit', // 文件编辑
  Command = 'command', // 命令执行
  Search = 'search', // 搜索
  Network = 'network', // 网络请求
  Agent = 'agent', // 代理任务
  Memory = 'memory', // 记忆/存储
  Other = 'other', // 其他
}
```

Kind 影响的是**审批策略**：在 `ApprovalMode.AUTO_EDIT` 模式下，`FileEdit` 类工具自动批准，但 `Command` 类工具仍需确认。

## 5.4 ToolResult：工具返回值

```typescript
export interface ToolResult {
  llmContent: PartListUnion; // 返回给 LLM 的内容
  returnDisplay?: ToolResultDisplay; // 返回给 UI 显示的内容
  error?: {
    message: string;
    type: ToolErrorType;
  };
  outputFile?: string; // 输出过大时保存到文件
}
```

**为什么分 `llmContent` 和 `returnDisplay`？** 因为给 LLM 看的内容和给用户看的内容往往不同——LLM 需要完整的输出来做决策，而用户可能只想看摘要。

## 5.5 ToolRegistry：工具注册中心

`ToolRegistry`（`tool-registry.ts`，526 行）负责管理所有可用工具：

```typescript
export class ToolRegistry {
  private tools: Map<string, AnyDeclarativeTool> = new Map();
  private mcpClientManager?: McpClientManager;

  // 注册内置工具
  registerTool(tool: AnyDeclarativeTool): void {
    this.tools.set(tool.name, tool);
  }

  // 获取所有工具的 Function Declaration（给 LLM 看）
  getFunctionDeclarations(): FunctionDeclaration[] {
    return [...this.tools.values()].map((t) => t.schema);
  }

  // 按名称查找工具
  getTool(name: string): AnyDeclarativeTool | undefined {
    return this.tools.get(name);
  }
}
```

### MCP 工具集成

ToolRegistry 还负责管理来自 MCP 服务器的**动态工具**。`McpClientManager` 连接 MCP 服务器，发现可用工具，包装成 `DiscoveredMCPTool` 后注册到 Registry。

### 工具发现（Discovered Tools）

除了 MCP，还有一种基于命令的工具发现：

```typescript
class DiscoveredTool extends BaseDeclarativeTool {
  constructor(config, name, description, parameterSchema) {
    // 工具是通过执行 `discoveryCommand` 发现的
    // 调用时执行 `callCommand ${toolName}`
  }
}
```

这允许项目自定义工具——在项目配置中指定一个"工具发现命令"，系统会自动发现并注册这些工具。

## 5.6 CoreToolScheduler：工具调度的状态机

这是整个工具系统最复杂的部分（1407 行）。每个工具调用有 **7 种状态**：

```
                   ┌──────────────────────────────────────┐
                   │  validating → 验证参数               │
                   ├──────────────────────────────────────┤
                   │  scheduled → 已排队                  │
                   ├──────────────────────────────────────┤
                   │  awaiting_approval → 等待用户确认    │
                   ├──────────────────────────────────────┤
                   │  executing → 执行中                  │
                   ├──────────────────────────────────────┤
                   │  success → 成功 ✅                   │
                   ├──────────────────────────────────────┤
                   │  error → 出错 ❌                     │
                   ├──────────────────────────────────────┤
                   │  cancelled → 已取消 🚫               │
                   └──────────────────────────────────────┘
```

### 状态转换流程

```
ToolCallRequest 事件（来自 Turn）
        │
        ▼
 ┌──────────────┐
 │  validating   │── 参数验证失败 ──→ error
 └──────┬───────┘
        │ 验证成功
        ▼
 ┌──────────────┐
 │  scheduled    │── 截断检测 ──→ error（参数被 max_tokens 截断）
 └──────┬───────┘
        │
        ▼
 ┌──────────────────┐
 │ shouldConfirm?   │── 不需要 ──→ executing
 └──────┬───────────┘
        │ 需要确认
        ▼
 ┌──────────────────┐
 │ awaiting_approval │── 用户拒绝 ──→ cancelled
 └──────┬───────────┘
        │ 用户批准
        ▼
 ┌──────────────┐
 │  executing    │── 执行超时/出错 ──→ error
 └──────┬───────┘
        │ 执行成功
        ▼
 ┌──────────────┐
 │   success     │
 └──────────────┘
```

### 输出截断处理

当工具输出过大（比如 `cat` 了一个大文件），系统会：

```typescript
async truncateAndSaveToFile(content, callId, tempDir, threshold, truncateLines) {
  if (content.length <= threshold) return { content };

  // 截断：保留头部 20% + 尾部 80%
  const head = Math.floor(truncateLines / 5);
  const beginning = lines.slice(0, head);
  const end = lines.slice(-(truncateLines - head));

  // 完整内容写入文件
  await fs.writeFile(outputFile, fileContent);

  return {
    content: `Tool output was too large and has been truncated.
The full output has been saved to: ${outputFile}
To read the complete output, use ReadFile with the path above.`,
    outputFile,
  };
}
```

**设计思考**：截断是**非对称**的（头少尾多），因为实践中**最后输出的信息通常更重要**（比如编译错误通常在末尾）。

### 请求队列化

```typescript
private requestQueue: Array<{
  request: ToolCallRequestInfo | ToolCallRequestInfo[];
  signal: AbortSignal;
  resolve: () => void;
  reject: (reason?: Error) => void;
}> = [];
```

工具调用是**队列化**的，不是立即执行。这解决了一个关键问题：LLM 可能在一次响应中请求多个工具调用，它们需要被**批量处理**，最后统一返回结果。

## 5.7 内置工具清单

```
工具名称            Kind        功能
───────────────────────────────────────
ReadFile           readonly    读取文件内容
WriteFile          file_edit   创建/覆盖文件
EditFile           file_edit   编辑文件（基于 old → new 替换）
GlobTool           search      文件名模式匹配
GrepTool           search      文件内容搜索
ShellTool          command     执行 Shell 命令
TaskTool           agent       委派子代理任务
TodoTool           memory      任务列表管理
MemoryTool         memory      用户记忆存储
AskUserTool        other       向用户提问
SkillTool          readonly    读取技能文档
MCPTool            *           MCP 工具代理
```

## 5.8 Modifiable Tool（可修改工具）

一个有趣的扩展是 `ModifiableTool`——某些工具（如 EditFile）支持在 IDE 中让用户**修改工具参数后再执行**：

```typescript
export interface ModifiableTool<TParams, TResult>
  extends DeclarativeTool<TParams, TResult> {
  // 告诉 IDE 如何呈现修改界面
  getModifyContext(invocation: ToolInvocation<TParams, TResult>): ModifyContext;
  // 用修改后的数据重建 Invocation
  buildModified(
    original: ToolInvocation<TParams, TResult>,
    modified: unknown,
  ): ToolInvocation<TParams, TResult>;
}
```

这使得用户可以在工具执行前审查和修改 LLM 提出的文件编辑——比 AI 直接写入更安全。

## 阅读本章后应该获得的理解

- ✅ 理解 DeclarativeTool / ToolBuilder / ToolInvocation 的分离设计
- ✅ 知道 Kind 系统如何影响审批策略
- ✅ 理解 CoreToolScheduler 的 7 种状态和转换流程
- ✅ 知道输出截断的处理策略
- ✅ 了解内置工具清单和 Modifiable Tool 扩展

---

**下一章**：[第 6 章：Prompt 工程](./06-prompt-engineering.md) — System Prompt 是怎么构建的？compressionPrompt 和 projectSummaryPrompt 是干什么的？
