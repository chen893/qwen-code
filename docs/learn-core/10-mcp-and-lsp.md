# 第 10 章：MCP 与 LSP 集成 —— 外部工具和语言服务的接入

## 本章要解决的问题

Qwen Code 不只是用内置工具。它可以通过 **MCP（Model Context Protocol）** 连接外部工具服务，通过 **LSP（Language Server Protocol）** 获取语言级的智能分析。这两种协议是怎么集成的？

## 本章的核心结论

> **MCP 让 Agent 可以使用任意外部工具**——任何支持 MCP 协议的服务器提供的工具，都会被自动注册到 ToolRegistry 中，对 Agent 来说就像内置工具一样。  
> **LSP 让 Agent 拥有"代码理解"能力**——定义跳转、引用查找、诊断信息等 IDE 级功能被封装成 LspTool，让 Agent 可以进行精准的代码分析。

---

## 10.1 MCP 协议概述

MCP（Model Context Protocol）是 Anthropic 提出的一个标准协议，用于将外部工具和上下文源连接到 AI 助手。Qwen Code 实现了 MCP **客户端**（不是服务端）。

### 模块结构

```
tools/
├── mcp-client.ts          (47KB) — MCP 客户端核心实现
├── mcp-client-manager.ts  (16KB) — 多客户端管理
├── mcp-tool.ts            (16KB) — MCP 工具封装
└── sdk-control-client-transport.ts — SDK 传输层

mcp/
├── oauth-provider.ts      (28KB) — OAuth2 认证
├── oauth-token-storage.ts (6KB)  — Token 持久化
├── oauth-utils.ts         (12KB) — 认证工具函数
├── google-auth-provider.ts       — Google 认证
└── sa-impersonation-provider.ts  — 服务账号模拟
```

### McpClientManager：多服务器管理

```typescript
// 配置来自 Config
mcpServers: {
  "database-tools": {
    command: "npx",
    args: ["-y", "@db-tools/mcp-server"],
    env: { DB_URL: "postgres://..." }
  },
  "api-docs": {
    url: "https://api.example.com/mcp",
    transport: "sse"
  }
}
```

McpClientManager 为每个配置的 MCP 服务器创建一个客户端连接：

```
McpClientManager
├── createClient("database-tools")  → stdio transport（子进程）
├── createClient("api-docs")        → SSE transport（HTTP 长连接）
├── discoverTools()                 → 自动发现每个服务器提供的工具
├── discoverResources()             → 自动发现可用资源
└── 生命周期管理（连接/重连/断开）
```

### 三种传输方式

| 传输          | 适用场景 | 实现方式                        |
| ------------- | -------- | ------------------------------- |
| **stdio**     | 本地工具 | spawn 子进程，stdin/stdout 通信 |
| **SSE**       | 远程服务 | HTTP Server-Sent Events         |
| **WebSocket** | 远程服务 | TCP WebSocket                   |

### DiscoveredMCPTool：工具代理

每个 MCP 服务器提供的工具都被包装成 `DiscoveredMCPTool`——一个实现了 `DeclarativeTool` 接口的代理：

```typescript
class DiscoveredMCPTool extends BaseDeclarativeTool {
  constructor(
    private readonly mcpClient: McpClient,
    private readonly serverName: string,
    private readonly originalToolName: string,
    schema: FunctionDeclaration,
  ) {
    // 工具名称添加 mcp__ 前缀 + 服务器名
    super(`mcp__${serverName}__${originalToolName}`, ...);
  }

  build(params): ToolInvocation {
    return {
      async execute(signal) {
        // 通过 MCP 协议调用远程工具
        const result = await mcpClient.callTool(originalToolName, params);
        return { llmContent: result.content };
      }
    };
  }
}
```

**命名规则**：`mcp__<serverName>__<toolName>`，例如 `mcp__database-tools__query`。这避免了不同 MCP 服务器之间的工具名冲突。

## 10.2 MCP OAuth 认证

MCP 的 OAuth 实现是最复杂的部分（oauth-provider.ts 有 28KB）：

```
MCP OAuth 流程
     │
     ├── 1. 检查本地缓存的 Token
     │       └── 有效 → 直接使用
     │
     ├── 2. Token 过期 → 尝试 Refresh Token
     │       └── 成功 → 存储新 Token
     │
     └── 3. 无 Token 或 Refresh 失败
             ├── 发起 OAuth2 授权流程
             ├── 启动本地 HTTP 服务器接收回调
             ├── 打开浏览器让用户授权
             ├── 接收 authorization code
             ├── 交换 access token
             └── 存储 Token 到本地
```

Token 存储支持多种后端（`oauth-token-storage.ts`）：

- 文件系统存储（默认）
- Keychain 存储（macOS）
- 内存存储（测试用）

## 10.3 LSP 集成

LSP（Language Server Protocol）为代码分析提供了标准化的能力。

### 模块结构

```
lsp/
├── NativeLspService.ts       (25KB) — LSP 服务核心
├── LspServerManager.ts       (20KB) — 多服务器管理
├── LspConnectionFactory.ts   (10KB) — 连接工厂
├── LspConfigLoader.ts        (13KB) — 配置加载
├── LspLanguageDetector.ts    (5KB)  — 语言检测
├── LspResponseNormalizer.ts  (23KB) — 响应标准化
├── NativeLspClient.ts        (7KB)  — 客户端封装
├── constants.ts              (3KB)  — 常量定义
└── types.ts                  (13KB) — 类型定义
```

### NativeLspService：核心服务

NativeLspService 管理 LSP 服务器的生命周期：

```
NativeLspService
├── 根据文件语言自动选择 LSP 服务器
├── 启动 LSP 服务器进程
├── 初始化握手（initialize / initialized）
├── 文件同步（textDocument/didOpen, didChange）
├── 查询能力：
│   ├── textDocument/definition      → 定义跳转
│   ├── textDocument/references      → 引用查找
│   ├── textDocument/hover           → 悬浮信息
│   ├── textDocument/diagnostics     → 诊断信息
│   ├── textDocument/documentSymbol  → 文件符号列表
│   └── textDocument/completion      → 代码补全
└── 优雅关闭
```

### LspTool：Agent 的代码分析能力

`LspTool`（`tools/lsp.ts`，40KB）是所有 LSP 能力的封装：

```typescript
// Agent 可以这样调用：
LspTool({
  action: 'definition',
  filePath: '/project/src/auth.ts',
  line: 42,
  character: 15,
});
// → 返回 auth.ts 第 42 行第 15 列的符号定义位置

LspTool({
  action: 'references',
  filePath: '/project/src/auth.ts',
  symbolName: 'validateToken',
});
// → 返回所有引用 validateToken 的位置

LspTool({
  action: 'diagnostics',
  filePath: '/project/src/auth.ts',
});
// → 返回文件中的所有错误和警告
```

### 语言检测与服务器选择

`LspLanguageDetector` 通过文件扩展名检测语言：

```
.ts, .tsx, .js, .jsx → TypeScript/JavaScript LSP
.py                  → Python LSP (Pylsp/Pyright)
.go                  → Go LSP (gopls)
.rs                  → Rust LSP (rust-analyzer)
.java                → Java LSP (jdtls)
...
```

`LspConfigLoader` 从配置中加载 LSP 服务器的启动命令和参数。

### 响应标准化

不同 LSP 服务器的响应格式可能有差异，`LspResponseNormalizer`（23KB）负责将各种响应统一化：

```typescript
// TypeScript LSP 返回的类型可能是 TSServer 格式
// Python LSP 返回的可能是 Jedi 格式
// → 统一转换为标准化的结构，方便 LspTool 处理
```

## 10.4 MCP vs LSP 对比

| 维度               | MCP                           | LSP                             |
| ------------------ | ----------------------------- | ------------------------------- |
| **用途**           | 通用外部工具协议              | 代码语言分析协议                |
| **方向**           | Agent → 外部服务              | Agent → 语言服务器              |
| **谁发起**         | Agent 主动调用工具            | Agent 查询代码信息              |
| **连接模式**       | stdio / SSE / WebSocket       | stdio（子进程）                 |
| **生态**           | 较新，Anthropic 提出          | 成熟，微软提出，IDE 标配        |
| **在系统中的角色** | 扩展 Agent 的"手"（能做的事） | 扩展 Agent 的"眼"（能看的东西） |

## 10.5 集成到 ToolRegistry 的统一视角

无论是 MCP 工具还是 LSP 工具，最终都注册到 `ToolRegistry`：

```
ToolRegistry
├── 内置工具（ReadFile, WriteFile, Shell...）
├── MCP 工具（mcp__server__tool 格式）
├── LSP 工具（LspTool，统一入口）
├── 扩展工具（通过 ExtensionManager 注入）
└── 发现工具（通过 toolDiscoveryCommand）
```

**对 Agent 来说，所有工具是平等的**——它不需要知道一个工具是内置的还是来自 MCP 服务器。这种透明化是工具系统设计的核心价值。

## 阅读本章后应该获得的理解

- ✅ 理解 MCP 协议的三种传输方式和工具代理机制
- ✅ 知道 MCP OAuth 认证的完整流程
- ✅ 理解 LSP 集成提供的六种代码分析能力
- ✅ 知道 LspResponseNormalizer 为什么需要存在
- ✅ 理解所有工具在 ToolRegistry 中的统一视角

---

## 全文总结

恭喜你读完了全部 10 章！现在你应该有了对 `packages/core` 的全面理解：

| 层次     | 核心组件              | 你学到了什么                         |
| -------- | --------------------- | ------------------------------------ |
| 全局架构 | index.ts              | 模块地图、数据流、分层架构           |
| 配置层   | Config                | 上下文容器、二段初始化、ModelsConfig |
| LLM 抽象 | ContentGenerator      | 策略模式、动态 import、装饰器        |
| 对话引擎 | GeminiClient/Turn     | Agentic Loop、事件流、yield\* 递归   |
| 工具系统 | DeclarativeTool       | Builder 模式、状态机、截断策略       |
| Prompt   | getCoreSystemPrompt   | 动态构建、多模型适配、分层覆盖       |
| 服务层   | SessionService        | JSONL 存储、树状历史、压缩检查点     |
| 子代理   | SubagentManager       | 五层优先级、TaskTool 委派            |
| Hook     | HookSystem/MessageBus | 12 种事件、correlationId、扩展管理   |
| 外部集成 | MCP/LSP               | 协议适配、工具代理、响应标准化       |

回到 [目录索引](./00-index.md) 复习任何章节。
