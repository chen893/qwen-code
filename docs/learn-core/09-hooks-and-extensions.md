# 第 9 章：Hook 系统与扩展机制 —— 生命周期拦截与插件化

## 本章要解决的问题

如果你想在"每次工具执行前做安全检查"，或者"在 Agent 结束响应前注入额外逻辑"，怎么做？这就是 Hook 系统要解决的问题。扩展机制则是更广义的"插件化"。

## 本章的核心结论

> **Hook 系统是一个事件驱动的生命周期拦截机制。** 12 种事件覆盖了从会话开始到结束的全生命周期。Hook 的实现是**外部 Shell 命令**（CommandHook），通过 JSON stdin/stdout 通信。  
> **MessageBus 是 Hook 和核心引擎之间的通信桥梁**，使用发布-订阅 + request-response 模式。

---

## 9.1 HookEventName：12 种生命周期事件

```typescript
export enum HookEventName {
  PreToolUse          // 工具执行前 — 可拦截/修改参数
  PostToolUse         // 工具执行后 — 可注入上下文
  PostToolUseFailure  // 工具执行失败后
  Notification        // 通知事件（如权限请求）
  UserPromptSubmit    // 用户提交 Prompt 时
  SessionStart        // 会话开始
  Stop                // Agent 准备结束响应时
  SubagentStart       // 子代理开始
  SubagentStop        // 子代理结束
  PreCompact          // 对话压缩前
  SessionEnd          // 会话结束
  PermissionRequest   // 权限对话框出现时
}
```

按阶段分类：

```
会话级：  SessionStart → ... → SessionEnd
Prompt 级：UserPromptSubmit → ... → Stop
工具级：  PreToolUse → [执行] → PostToolUse / PostToolUseFailure
子代理级：SubagentStart → ... → SubagentStop
权限：    PermissionRequest / Notification
压缩：    PreCompact
```

## 9.2 HookConfig：Hook 的定义

当前只支持一种 Hook 类型——**Command Hook**（Shell 命令）：

```typescript
export interface CommandHookConfig {
  type: HookType.Command; // 固定为 'command'
  command: string; // 要执行的 Shell 命令
  name?: string; // 可选名称
  description?: string; // 描述
  timeout?: number; // 超时（毫秒）
  source?: HooksConfigSource; // 来源（project/user/system）
  env?: Record<string, string>; // 额外环境变量
}
```

**为什么用 Shell 命令而不是 JavaScript 函数？**

1. **语言无关**：Hook 可以用任何语言编写（Python、Go、甚至 Bash 脚本）
2. **安全隔离**：外部进程不能直接访问 Agent 的内存
3. **可部署性**：Hook 脚本可以独立分发和版本管理

### Hook 的输入输出协议

Hook 通过 **stdin** 接收 JSON 输入，通过 **stdout** 返回 JSON 输出：

```
stdin → {
  session_id: "abc123",
  cwd: "/project",
  hook_event_name: "PreToolUse",
  tool_name: "ShellTool",
  tool_input: { command: "rm -rf /" },
  timestamp: "2025-01-01T00:00:00Z"
}

stdout ← {
  decision: "deny",
  reason: "Dangerous command detected"
}
```

## 9.3 HookOutput：决策类型

```typescript
export type HookDecision = 'ask' | 'block' | 'deny' | 'approve' | 'allow';

export interface HookOutput {
  continue?: boolean; // 是否继续执行
  stopReason?: string; // 停止原因
  suppressOutput?: boolean; // 是否抑制输出
  systemMessage?: string; // 注入的系统消息
  decision?: HookDecision; // 决策
  reason?: string; // 原因
  hookSpecificOutput?: Record<string, unknown>; // 事件特定数据
}
```

### 专业化的输出类

不同事件有不同的输出类（用工厂模式创建）：

```typescript
export function createHookOutput(eventName, data): DefaultHookOutput {
  switch (eventName) {
    case 'PreToolUse':
      return new PreToolUseHookOutput(data);
    case 'Stop':
      return new StopHookOutput(data);
    case 'PermissionRequest':
      return new PermissionRequestHookOutput(data);
    default:
      return new DefaultHookOutput(data);
  }
}
```

**PreToolUseHookOutput** 额外支持 `getModifiedToolInput()` —— Hook 不仅可以通过/拒绝，还可以**修改工具参数**后再执行。

**StopHookOutput** 额外支持 `getStopReason()` —— 在 Agent 结束前注入反馈，让 Agent 继续。

**PermissionRequestHookOutput** 支持完整的权限决策链——allow/deny、修改输入、更新权限建议、中断执行。

## 9.4 MessageBus：通信中枢

`MessageBus`（`confirmation-bus/message-bus.ts`，126 行）是轻量但关键的组件：

```typescript
export class MessageBus extends EventEmitter {
  // 发布消息
  async publish(message: Message): Promise<void> {
    if (message.type === MessageBusType.TOOL_CONFIRMATION_REQUEST) {
      // 默认自动批准
      this.emitMessage({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: message.correlationId,
        confirmed: true,
      });
    } else {
      this.emitMessage(message);
    }
  }

  // Request-Response 模式
  async request<TReq, TRes>(
    request,
    responseType,
    timeout = 60000,
  ): Promise<TRes> {
    const correlationId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject('timeout'), timeout);

      const handler = (response: TRes) => {
        if (response.correlationId === correlationId) {
          clearTimeout(timeoutId);
          resolve(response);
        }
      };

      this.subscribe(responseType, handler);
      this.publish({ ...request, correlationId });
    });
  }
}
```

**设计亮点**：

1. **correlationId** 实现了异步 request-response——在 EventEmitter 这种纯事件模型上模拟了"方法调用"的语义
2. **超时机制**——Hook 如果太慢，不会阻塞整个系统
3. **默认批准**——如果没有 Policy Engine（已被移除），工具确认请求默认通过

## 9.5 ExtensionManager：扩展管理

扩展系统兼容 Claude 的扩展格式，通过 `ExtensionManager` 管理：

```
ExtensionManager
├── 扫描 .qwen/extensions/（项目级）
├── 扫描 ~/.qwen/extensions/（用户级）
├── 解析扩展清单（manifest）
├── 加载扩展提供的：
│   ├── 子代理配置
│   ├── Hook 配置
│   ├── 工具定义
│   └── MCP Server 配置
└── 缓存管理（refreshCache）
```

扩展可以向系统注入几乎所有类型的能力——子代理、Hook、工具，甚至 MCP 服务器配置。这使得第三方可以通过扩展来定制 Agent 行为。

### 扩展的来源优先级

```
项目扩展 > 用户扩展 > 内置默认
```

## 9.6 HookSystem 的初始化流程

```typescript
// 在 Config.initialize() 中
if (this.enableHooks) {
  this.hookSystem = new HookSystem(this);
  await this.hookSystem.initialize();

  this.messageBus = new MessageBus();

  // 订阅 Hook 执行请求
  this.messageBus.subscribe(
    MessageBusType.HOOK_EXECUTION_REQUEST,
    async (message) => {
      const results = await this.hookSystem.execute(
        message.eventName,
        message.input,
      );
      this.messageBus.publish({
        type: MessageBusType.HOOK_EXECUTION_RESPONSE,
        correlationId: message.correlationId,
        output: mergeHookResults(results),
      });
    },
  );
}
```

**流程**：

1. 核心引擎通过 MessageBus 发送 `HOOK_EXECUTION_REQUEST`
2. HookSystem 接收请求，执行所有匹配的 Hook（Shell 命令）
3. 合并多个 Hook 的结果
4. 通过 MessageBus 发送 `HOOK_EXECUTION_RESPONSE` 回去

## 阅读本章后应该获得的理解

- ✅ 知道 12 种 Hook 事件和它们的触发时机
- ✅ 理解 Command Hook 的 stdin/stdout JSON 通信协议
- ✅ 知道 PreToolUse Hook 可以修改工具参数
- ✅ 理解 MessageBus 的 correlationId request-response 模式
- ✅ 了解 ExtensionManager 的扩展加载和能力注入

---

**下一章**：[第 10 章：MCP 与 LSP 集成](./10-mcp-and-lsp.md) — 外部工具和语言服务的接入协议。
