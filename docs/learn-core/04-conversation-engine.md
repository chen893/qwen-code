# 第 4 章：对话引擎 —— Agentic Loop 的核心循环

## 本章要解决的问题

你已经知道了整体架构和配置系统。现在我们要深入**最核心的部分**：当用户输入一条消息，到模型给出最终响应，中间到底经历了哪些步骤？工具调用是如何形成循环的？

## 本章的核心结论

> **对话引擎由三层组成**：GeminiClient（会话管理器）→ GeminiChat（API 会话）→ Turn（单轮处理器）。核心的 Agentic Loop 是通过 **递归 `yield*`** 实现的——GeminiClient 在工具调用结果返回后，通过 `yield* this.sendMessageStream(...)` 递归调用自己，形成一个优雅的 Agent 循环。

---

## 4.1 三层分工

| 层级         | 文件                 | 职责                                         | 类比   |
| ------------ | -------------------- | -------------------------------------------- | ------ |
| GeminiClient | `client.ts` (786 行) | 会话管理器：压缩、循环检测、Hook、IDE 上下文 | 指挥官 |
| GeminiChat   | `geminiChat.ts`      | API 会话：history 管理、流式调用、重试       | 通信兵 |
| Turn         | `turn.ts` (419 行)   | 单轮处理器：解析响应流 → 产生事件            | 翻译官 |

## 4.2 GeminiClient.sendMessageStream() 完整流程

这是整个系统**最重要的方法**（约 260 行）。让我带你逐步走一遍：

### 第 1 步：UserPromptSubmit Hook

```typescript
// 如果启用了 Hook，先触发 UserPromptSubmit 事件
if (hooksEnabled && messageBus) {
  const response = await messageBus.request<
    HookExecutionRequest,
    HookExecutionResponse
  >({
    type: MessageBusType.HOOK_EXECUTION_REQUEST,
    eventName: 'UserPromptSubmit',
    input: { prompt: promptText },
  }, MessageBusType.HOOK_EXECUTION_RESPONSE);

  // Hook 可以阻止处理
  if (hookOutput?.isBlockingDecision()) {
    yield { type: GeminiEventType.Error, value: { error: ... } };
    return new Turn(this.getChat(), prompt_id);
  }
}
```

**为什么？** 这允许用户通过 Hook 拦截输入——比如自动审计敏感内容、添加额外上下文等。

### 第 2 步：循环检测重置 + 会话记录

```typescript
if (!options?.isContinuation) {
  this.loopDetector.reset(prompt_id); // 新 prompt → 重置循环检测器
  this.config.getChatRecordingService()?.recordUserMessage(request);
  this.stripThoughtsFromHistory(); // 清除上一轮的思维链
}
this.sessionTurnCount++; // 计数器 +1
```

### 第 3 步：对话压缩

```typescript
const compressed = await this.tryCompressChat(prompt_id, false);
if (compressed.compressionStatus === CompressionStatus.COMPRESSED) {
  yield { type: GeminiEventType.ChatCompressed, value: compressed };
}
```

**当 token 数超过阈值时**，系统会用一个专门的 LLM 调用来"总结"历史对话，用更短的文本替代长历史。这避免了上下文溢出。

### 第 4 步：IDE 上下文注入

```typescript
if (this.config.getIdeMode() && !hasPendingToolCall) {
  const { contextParts } = this.getIdeContextParts(this.forceFullIdeContext);
  if (contextParts.length > 0) {
    this.getChat().addHistory({
      role: 'user',
      parts: [{ text: contextParts.join('\n') }],
    });
  }
}
```

**为什么不在工具调用后注入？** 因为 API 要求 `functionResponse` 必须紧跟在 `functionCall` 之后。如果在中间插入 IDE 上下文，会破坏消息序列。

### 第 5 步：创建 Turn 并执行

```typescript
const turn = new Turn(this.getChat(), prompt_id);

// 附加系统 reminder（如 Plan 模式提醒、子代理提醒）
let requestToSent = [...systemReminders, ...requestToSent];

const resultStream = turn.run(this.config.getModel(), requestToSent, signal);
for await (const event of resultStream) {
  // 循环检测
  if (this.loopDetector.addAndCheck(event)) {
    yield { type: GeminiEventType.LoopDetected };
    return turn;
  }
  yield event;  // ← 把 Turn 的事件透传给调用者
}
```

### 第 6 步：Stop Hook + NextSpeaker 检查

```typescript
// 没有待执行的工具 → 对话可能结束了
if (!turn.pendingToolCalls.length) {
  // Stop Hook：让用户自定义"结束前"行为
  if (stopOutput?.shouldStopExecution()) {
    // Hook 要求继续 → 递归调用
    return yield* this.sendMessageStream(
      continueRequest, signal, prompt_id,
      { isContinuation: true },
      boundedTurns - 1,  // ← 防止无限循环
    );
  }

  // NextSpeaker 检查：是否还需要模型继续说？
  const nextSpeakerCheck = await checkNextSpeaker(...);
  if (nextSpeakerCheck?.next_speaker === 'model') {
    return yield* this.sendMessageStream(
      [{ text: 'Please continue.' }],
      signal, prompt_id, options,
      boundedTurns - 1,
    );
  }
}
```

**这就是 Agent 循环！** 注意递归的 `yield*` 语法——它不仅递归调用自己，还把递归调用产生的所有事件都**透传**到最外层。调用者完全不需要知道内部发生了多少次递归。

## 4.3 Turn.run()：事件解析引擎

Turn 是一个相对"薄"的层。它的核心逻辑：

```typescript
async *run(model, req, signal): AsyncGenerator<ServerGeminiStreamEvent> {
  try {
    const responseStream = await this.chat.sendMessageStream(model, { message: req }, prompt_id);

    for await (const streamEvent of responseStream) {
      if (signal?.aborted) {
        yield { type: GeminiEventType.UserCancelled };
        return;
      }

      // 1. 重试事件
      if (streamEvent.type === 'retry') {
        yield { type: GeminiEventType.Retry, retryInfo: streamEvent.retryInfo };
        continue;
      }

      const resp = streamEvent.value as GenerateContentResponse;

      // 2. 思维链
      const thoughtText = getThoughtText(resp);
      if (thoughtText) {
        yield { type: GeminiEventType.Thought, value: parseThought(thoughtText) };
      }

      // 3. 文本内容
      const text = getResponseText(resp);
      if (text) {
        yield { type: GeminiEventType.Content, value: text };
      }

      // 4. 工具调用
      for (const fnCall of resp.functionCalls ?? []) {
        yield this.handlePendingFunctionCall(fnCall);  // → ToolCallRequest 事件
      }

      // 5. 结束标记
      if (finishReason) {
        // MAX_TOKENS 时标记输出被截断
        if (finishReason === FinishReason.MAX_TOKENS) {
          for (const tc of this.pendingToolCalls) {
            tc.wasOutputTruncated = true;  // ← 截断标记！
          }
        }
        yield { type: GeminiEventType.Finished, value: { reason, usageMetadata } };
      }
    }
  } catch (e) {
    // 错误处理...
    yield { type: GeminiEventType.Error, value: { error: structuredError } };
  }
}
```

### 截断标记的巧妙设计

当模型的输出被 `max_tokens` 截断时，工具调用的参数可能不完整（比如 JSON 被截断了）。Turn 通过在 `ToolCallRequestInfo` 上设置 `wasOutputTruncated = true`，让下游的 `CoreToolScheduler` 知道这个工具调用**可能参数不完整**，可以做特殊处理（拒绝并要求重试）。

## 4.4 GeminiEventType：15 种事件类型

```typescript
export enum GeminiEventType {
  Content = 'content', // 文本内容（流式）
  ToolCallRequest = 'tool_call_request', // 模型请求执行工具
  ToolCallResponse = 'tool_call_response', // 工具执行结果
  ToolCallConfirmation = 'tool_call_confirmation', // 工具需要用户确认
  UserCancelled = 'user_cancelled', // 用户取消
  Error = 'error', // 错误
  ChatCompressed = 'chat_compressed', // 对话已压缩
  Thought = 'thought', // 思维链
  MaxSessionTurns = 'max_session_turns', // 达到最大轮数
  SessionTokenLimitExceeded = 'session_token_limit_exceeded', // Token 超限
  Finished = 'finished', // Turn 结束
  LoopDetected = 'loop_detected', // 检测到循环
  Citation = 'citation', // 引用
  Retry = 'retry', // 重试
  HookSystemMessage = 'hook_system_message', // Hook 系统消息
}
```

**为什么有这么多事件类型？** 因为上层 UI 需要对不同事件做不同渲染——比如 `Thought` 事件要显示折叠的思维过程，`ToolCallConfirmation` 要弹出确认对话框，`ChatCompressed` 要显示压缩通知。

## 4.5 对话压缩机制

`ChatCompressionService` 是一个独立的服务（`services/chatCompressionService.ts`）：

```
触发条件：current_tokens > COMPRESSION_TOKEN_THRESHOLD（默认约 80K）
    │
    ▼
使用专门的 compression prompt 让 LLM 总结对话历史
    │
    ▼
验证：new_tokens < old_tokens × threshold ?
    │
    ├── 是 → 用压缩后的历史替换当前历史
    └── 否 → 放弃压缩，标记 hasFailedCompressionAttempt
```

**为什么有"放弃"逻辑？** 如果压缩后的 token 反而更多（LLM 的"总结"太啰嗦了），那压缩就失败了。设置 `hasFailedCompressionAttempt = true` 防止在同一个 session 里反复尝试压缩。

## 4.6 递归 yield\* 的精妙之处

让我特别展开解释 `yield*` 的设计：

```typescript
// 在 sendMessageStream 的末尾
return (
  yield *
  this.sendMessageStream(
    continueRequest,
    signal,
    prompt_id,
    { isContinuation: true },
    boundedTurns - 1, // ← 关键：递减计数器
  )
);
```

1. **`yield*`** 不只是递归调用——它把递归调用产生的**每一个事件都透传**到最外层的 AsyncGenerator
2. **`boundedTurns - 1`** 确保有最大递归深度（默认 100），防止真正的无限循环
3. **`return yield*`** 意味着递归调用的返回值（Turn 对象）会成为当前调用的返回值
4. 调用者（上层 UI 代码）只需要 `for await (const event of client.sendMessageStream(...))` 就能收到**所有层级**的事件

这比用回调或者 EventEmitter 优雅得多——它保持了代码的线性可读性。

## 阅读本章后应该获得的理解

- ✅ 清楚 GeminiClient / GeminiChat / Turn 各自的职责
- ✅ 理解 `sendMessageStream()` 的六步完整流程
- ✅ 知道 Turn 如何将 LLM 响应流解析为 15 种事件类型
- ✅ 理解对话压缩的触发条件和失败保护
- ✅ 深入理解 `yield*` 递归实现 Agent 循环的设计

---

**下一章**：[第 5 章：工具系统](./05-tool-system.md) — 20+ 个工具是怎么注册的？CoreToolScheduler 如何管理工具调用的完整生命周期？
