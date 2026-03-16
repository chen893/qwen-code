# 第 7 章：服务层 —— Session、ChatRecording 与基础服务

## 本章要解决的问题

核心引擎之外，还有一系列"基础服务"在默默支撑着整个系统。Session 是怎么持久化的？聊天记录怎么存储？Shell 命令怎么安全执行？

## 本章的核心结论

> **服务层遵循"单一职责"原则**——每个服务只做一件事。这些服务不互相依赖，都通过 Config 获取配置，形成了一个扁平的服务集合。

---

## 7.1 SessionService：会话管理

`SessionService`（`services/sessionService.ts`，707 行）是最重要的服务之一。它负责会话的持久化和恢复。

### 存储格式

会话存储为 **JSONL 文件**（每行一个 JSON 对象），路径为：

```
~/.qwen/tmp/<project_hash>/chats/<sessionId>.jsonl
```

### 树状历史的存储与重建

一个关键设计：聊天记录不是线性的，而是**树状的**。每条记录有 `uuid` 和 `parentUuid`：

```typescript
// 每条 ChatRecord 都有：
{
  uuid: string;          // 本条记录的唯一 ID
  parentUuid: string;    // 父记录 ID
  sessionId: string;     // 会话 ID
  type: 'user' | 'assistant' | 'system';
  message?: Content;     // Gemini Content 对象
  timestamp: string;
}
```

**为什么是树状？** 因为用户可以"回到某个节点重新对话"（类似 Git 的分支）。系统通过 `reconstructHistory()` 从叶子节点回溯到根节点，重建线性对话历史：

```typescript
private reconstructHistory(records, leafUuid?): ChatRecord[] {
  // 1. 按 uuid 分组
  const recordsByUuid = new Map<string, ChatRecord[]>();

  // 2. 从叶子节点开始，沿 parentUuid 回溯
  let currentUuid = leafUuid ?? records[records.length - 1].uuid;
  const uuidChain: string[] = [];
  while (currentUuid && !visited.has(currentUuid)) {
    visited.add(currentUuid);
    uuidChain.push(currentUuid);
    currentUuid = recordsByUuid.get(currentUuid)?.[0].parentUuid;
  }

  // 3. 反转得到从根到叶的路径
  uuidChain.reverse();

  // 4. 聚合同一 uuid 的多条记录
  for (const uuid of uuidChain) {
    messages.push(this.aggregateRecords(recordsByUuid.get(uuid)));
  }
}
```

### 聊天压缩检查点

`buildApiHistoryFromConversation()` 还处理**压缩检查点**：

```typescript
export function buildApiHistoryFromConversation(conversation): Content[] {
  // 找到最近的压缩记录
  let lastCompressionIndex = -1;
  messages.forEach((record, index) => {
    if (record.type === 'system' && record.subtype === 'chat_compression') {
      lastCompressionIndex = index;
      compressedHistory = record.systemPayload.compressedHistory;
    }
  });

  if (compressedHistory) {
    // 用压缩后的历史 + 压缩后的新消息
    const base = structuredClone(compressedHistory);
    for (let i = lastCompressionIndex + 1; i < messages.length; i++) {
      if (record.message) base.push(structuredClone(record.message));
    }
    return base;
  }

  // 没有压缩 → 返回全部消息
  return messages.map((r) => r.message).filter(Boolean);
}
```

### 分页列表查询

```typescript
async listSessions(options: ListSessionsOptions = {}): Promise<ListSessionsResult> {
  const { cursor, size = 20 } = options;

  // 1. 读取目录中的所有 .jsonl 文件
  // 2. 按修改时间降序排列
  // 3. 过滤：mtime < cursor（游标分页）
  // 4. 逐文件读取第一条记录，验证项目哈希
  // 5. 返回 items + nextCursor + hasMore
}
```

**为什么用游标分页而不是 offset？** 因为文件可能被删除或新增，offset 会导致跳过或重复。mtime 游标保证了**稳定的分页顺序**。

## 7.2 ChatRecordingService：聊天记录

这个服务负责将聊天事件**实时追加**到 JSONL 文件：

```
recordUserMessage(message)        → 记录用户消息
recordAssistantMessage(message)   → 记录助手消息
recordToolCall(toolCall)          → 记录工具调用
recordChatCompression(info)       → 记录压缩检查点
recordUiTelemetry(event)          → 记录 UI 遥测事件
```

关键设计：**流式追加（append-only）**——只追加不修改。这保证了：

1. 写操作是 O(1) 的
2. 不会因为写入中断导致历史数据损坏
3. 可以作为审计日志使用

## 7.3 ChatCompressionService：对话压缩

```
触发条件
  currentTokens > COMPRESSION_TOKEN_THRESHOLD
      │
      ▼
保留最近的 N 条消息（COMPRESSION_PRESERVE_THRESHOLD）
      │
      ▼
用 compressionPrompt 让 LLM 总结其余历史
      │
      ▼
验证：压缩后 tokens < 原始 tokens？
      │
      ├── 是 → 替换历史，记录检查点
      └── 否 → 放弃，设置 hasFailedCompressionAttempt
```

**为什么保留最近 N 条？** 最近的消息通常包含最相关的上下文，压缩它们会丢失关键信息。保留它们 + 压缩更早的历史，是一个**局部保真**的策略。

## 7.4 ShellExecutionService：安全命令执行

Shell 命令执行涉及到安全性，所以有专门的服务：

```typescript
export interface ShellExecutionConfig {
  cwd: string;
  timeout?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
}
```

关键安全特性：

- **超时控制**：防止挂起的命令
- **AbortSignal**：用户可以随时取消
- **环境隔离**：可以指定独立的环境变量
- **输出限制**：防止大输出消耗过多内存

## 7.5 LoopDetectionService：循环检测

AI Agent 最危险的问题之一是**无限循环**——模型反复执行同样的操作。LoopDetection 通过分析事件模式来检测：

```typescript
export class LoopDetectionService {
  addAndCheck(event: ServerGeminiStreamEvent): boolean {
    // 记录事件序列
    // 检测重复模式
    // 如果检测到循环 → return true → 触发 LoopDetected 事件
  }
}
```

## 7.6 FileDiscoveryService：文件发现

这个服务维护项目的文件索引，供搜索和上下文构建使用：

```
FileDiscoveryService
├── 扫描项目目录
├── 应用 .gitignore 规则
├── 构建文件树（用于给 LLM 提供项目结构）
└── 缓存 + 增量更新
```

## 7.7 服务层设计原则

| 原则        | 体现                                               |
| ----------- | -------------------------------------------------- |
| 单一职责    | 每个 Service 只做一件事                            |
| 无状态偏好  | 大部分服务是无状态的，状态在 Config 中             |
| Append-only | 记录服务只追加不修改                               |
| 优雅降级    | 服务不可用时不影响核心功能（如遥测失败不阻塞对话） |
| 游标分页    | 避免 offset 分页的一致性问题                       |

## 阅读本章后应该获得的理解

- ✅ 理解 JSONL 格式和树状历史的存储方式
- ✅ 知道压缩检查点如何与 Session 恢复配合
- ✅ 理解游标分页的设计优势
- ✅ 了解各服务的职责和设计原则

---

**下一章**：[第 8 章：子代理与技能系统](./08-subagents-and-skills.md) — 子代理如何实现任务委派？技能 Markdown 是怎么工作的？
