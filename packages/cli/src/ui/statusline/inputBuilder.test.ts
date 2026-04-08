/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { ApprovalMode, type Config } from '@qwen-code/qwen-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import type { SessionStatsState } from '../contexts/SessionContext.js';
import { buildStatusLineInput } from './inputBuilder.js';
import type { BuildStatusLineInputOptions } from './types.js';

vi.mock('web-tree-sitter', () => ({
  default: class MockParser {},
}));

const createMockConfig = (
  overrides: Partial<BuildStatusLineInputOptions['config']> = {},
) =>
  ({
    getSessionId: () => 'session-123',
    getTranscriptPath: () => 'D:\\runtime\\chats\\session-123.jsonl',
    getWorkingDir: () => 'D:\\project\\repo\\packages\\cli',
    getProjectRoot: () => 'D:\\project\\repo',
    getApprovalMode: () => ApprovalMode.AUTO_EDIT,
    getCliVersion: () => '1.2.3',
    getOutputFormat: () => 'text',
    getContentGeneratorConfig: () => ({ contextWindowSize: 200000 }),
    ...overrides,
  }) as unknown as Config;

const createSessionStats = (
  overrides: Partial<SessionStatsState> = {},
): SessionStatsState => ({
  sessionId: 'session-123',
  sessionStartTime: new Date('2026-04-01T00:00:00.000Z'),
  lastPromptTokenCount: 100000,
  promptCount: 3,
  metrics: {
    models: {
      'qwen3-coder-plus': {
        api: {
          totalRequests: 2,
          totalErrors: 0,
          totalLatencyMs: 2500,
        },
        tokens: {
          prompt: 120000,
          candidates: 3000,
          total: 123000,
          cached: 800,
          thoughts: 0,
          tool: 0,
        },
      },
      'qwen3-coder': {
        api: {
          totalRequests: 1,
          totalErrors: 0,
          totalLatencyMs: 500,
        },
        tokens: {
          prompt: 4000,
          candidates: 200,
          total: 4200,
          cached: 100,
          thoughts: 0,
          tool: 0,
        },
      },
    },
    tools: {
      totalCalls: 0,
      totalSuccess: 0,
      totalFail: 0,
      totalDurationMs: 0,
      totalDecisions: {
        accept: 0,
        reject: 0,
        modify: 0,
        auto_accept: 0,
      },
      byName: {},
    },
    files: {
      totalLinesAdded: 12,
      totalLinesRemoved: 4,
    },
  },
  ...overrides,
});

const createSettings = (includeDirectories?: string[]): LoadedSettings =>
  ({
    merged: {
      context: includeDirectories
        ? {
            includeDirectories,
          }
        : {},
    },
  }) as LoadedSettings;

describe('buildStatusLineInput', () => {
  it('builds the expected payload from config and session state', () => {
    const result = buildStatusLineInput({
      config: createMockConfig(),
      currentModel: 'qwen3-coder-plus',
      sessionStats: createSessionStats(),
      settings: createSettings(['D:\\project\\repo\\docs']),
      lastCachedContentTokenCount: 321,
      vimEnabled: true,
      vimMode: 'INSERT',
      now: new Date('2026-04-01T00:00:05.000Z'),
    });

    expect(result).toEqual({
      session_id: 'session-123',
      transcript_path: 'D:\\runtime\\chats\\session-123.jsonl',
      cwd: 'D:\\project\\repo\\packages\\cli',
      permission_mode: 'auto-edit',
      model: {
        id: 'qwen3-coder-plus',
        display_name: 'qwen3-coder-plus',
      },
      workspace: {
        current_dir: 'D:\\project\\repo\\packages\\cli',
        project_dir: 'D:\\project\\repo',
        added_dirs: ['D:\\project\\repo\\docs'],
      },
      version: '1.2.3',
      output_style: {
        name: 'text',
      },
      cost: {
        total_cost_usd: 0,
        total_duration_ms: 5000,
        total_api_duration_ms: 3000,
        total_lines_added: 12,
        total_lines_removed: 4,
      },
      context_window: {
        total_input_tokens: 124000,
        total_output_tokens: 3200,
        context_window_size: 200000,
        current_usage: {
          input_tokens: 100000,
          output_tokens: 0,
          cache_read_input_tokens: 321,
        },
        used_percentage: 50,
        remaining_percentage: 50,
      },
      exceeds_200k_tokens: false,
      vim: {
        mode: 'INSERT',
      },
    });
  });

  it('omits optional sections when they are unavailable', () => {
    const result = buildStatusLineInput({
      config: createMockConfig({
        getContentGeneratorConfig: () => undefined,
      }),
      currentModel: 'qwen3-coder-plus',
      sessionStats: createSessionStats({
        lastPromptTokenCount: 0,
      }),
      settings: createSettings(),
      lastCachedContentTokenCount: 0,
      vimEnabled: false,
      now: new Date('2026-04-01T00:00:05.000Z'),
    });

    expect(result.workspace.added_dirs).toBeUndefined();
    expect(result.vim).toBeUndefined();
    expect(result.context_window.context_window_size).toBeNull();
    expect(result.context_window.used_percentage).toBeNull();
    expect(result.context_window.remaining_percentage).toBeNull();
  });
});
