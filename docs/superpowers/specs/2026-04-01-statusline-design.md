# 自定义状态行设计

## 目标

为 Qwen Code 新增可配置的自定义状态行能力，并提供 `/statusline` 向导命令，完整覆盖：

- `settings.ui.statusLine` 运行时配置
- `stdin JSON -> stdout text` 的脚本协议
- Footer 底部多行渲染
- 300ms 防抖、取消、超时、静默降级
- `trust` 与 `disableAllHooks` 安全边界
- `/statusline` 生成脚本并写入用户级 settings

## 范围

本次实现包含两条主线：

1. 运行时状态行
2. `/statusline` 配置向导

不包含：

- 新的 `statusLine.type`
- 远程会话、订阅配额等当前仓库缺失的数据源
- 真正自由生成的 agent 式脚本生成器

## 配置模型

状态行配置放在 `settings.ui.statusLine`：

```ts
type StatusLineConfig = {
  type: 'command';
  command: string;
  padding?: number;
};
```

语义：

- `command`：完整命令字符串，交给当前 shell 直接执行
- `padding`：状态行左右额外留白，默认 `2`

## 输入协议

运行时将当前会话状态序列化为 JSON，通过 `stdin` 传给脚本。首版协议如下：

```ts
type StatusLineCommandInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  model: {
    id: string | null;
    display_name: string | null;
  };
  workspace: {
    current_dir: string;
    project_dir: string;
    added_dirs?: string[];
  };
  version: string;
  output_style: {
    name: string;
  };
  cost: {
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_duration_ms: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
  context_window: {
    total_input_tokens: number;
    total_output_tokens: number;
    context_window_size: number | null;
    current_usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
    } | null;
    used_percentage: number | null;
    remaining_percentage: number | null;
  };
  exceeds_200k_tokens: boolean;
  vim?: {
    mode: 'INSERT' | 'NORMAL';
  };
};
```

字段来源：

- `session_id` / `transcript_path`：`Config`
- `workspace.*`：`Config` 与 settings
- `model.*`：当前运行模型
- `cost` / `context_window`：`SessionStatsContext` + `uiTelemetryService`
- `vim`：`VimModeContext`

## 运行时结构

在 `packages/cli/src/ui/statusline/` 下新增独立模块：

- `types.ts`：协议与运行时类型
- `inputBuilder.ts`：构建状态行输入
- `normalizeOutput.ts`：清洗脚本输出
- `executor.ts`：命令执行、超时、取消
- `useStatusLine.ts`：调度与 React 集成

设计原则：

- 状态采集靠近 UI
- 命令执行与 UI 解耦
- 不把状态行注册为普通 hook 事件
- 但安全边界遵守 hooks 总开关与 trust 规则

## 触发与调度

更新触发条件：

- 首次挂载
- 最后一条 assistant 消息变化
- `approvalMode` 变化
- `vimMode` 变化
- 当前模型变化
- `ui.statusLine` 配置变化
- 工作目录或额外目录变化

治理规则：

- 300ms 防抖
- 新请求先取消旧请求
- 默认 5000ms 超时
- 非零退出码、超时、异常、空输出全部降级为空状态行
- 输出不变时不触发 UI 更新

## 安全边界

状态行执行前检查：

- `settings.disableAllHooks`
- `config.isTrustedFolder()`

任一条件不满足：

- 不执行命令
- Footer 不显示状态行
- debug 模式记录跳过原因

## Footer 行为

状态行挂在现有 Footer 左侧区域上方：

- 上层：状态行，多行显示
- 下层：现有 footer 左侧提示

渲染规则：

- 支持多行
- 支持 ANSI 文本
- `padding` 通过左右 margin 生效
- 状态行存在时不覆盖高优先级的退出/模式提示

## `/statusline` 命令

新增内置 slash command：

- 命令名：`statusline`
- 作用：状态行配置向导

向导职责：

1. 解析用户参数或使用默认提示
2. 根据平台选择脚本模板
3. 生成脚本并写入 `~/.qwen/statusline.sh` 或 `~/.qwen/statusline.ps1`
4. 写入用户级 `settings.json` 的 `ui.statusLine`
5. 返回结果消息与必要提示

首版采用受控模板生成，不实现开放式 agent 自由生成。

## 测试策略

测试覆盖：

- settings schema
- 输入构造
- 输出清洗
- 执行器超时/中止/退出码处理
- Footer 渲染
- `/statusline` 命令写文件与写 settings

## 风险

- Ink 对 OSC 8 链接的支持有限，首版仅保证多行和 ANSI
- 文档中的部分高级字段在当前仓库无稳定来源，按可选字段留空
- Windows shell 编码与进程终止行为需要单独测试
