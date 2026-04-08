/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStatusLine } from './useStatusLine.js';

vi.mock('web-tree-sitter', () => ({
  default: class MockParser {},
}));

vi.mock('@qwen-code/qwen-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@qwen-code/qwen-code-core')>();
  return {
    ...actual,
    uiTelemetryService: {
      getLastCachedContentTokenCount: vi.fn(() => 0),
    },
  };
});

vi.mock('./executor.js', () => ({
  executeStatusLineCommand: vi.fn(),
}));

import { executeStatusLineCommand } from './executor.js';

describe('useStatusLine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(executeStatusLineCommand).mockResolvedValue('branch: main');
  });

  it('re-runs the status line command when approval mode changes', async () => {
    let approvalMode = 'default';
    const config = {
      getDisableAllHooks: () => false,
      isTrustedFolder: () => true,
      getApprovalMode: () => approvalMode,
      getSessionId: () => 'session-1',
      getTranscriptPath: () => '/tmp/session-1.jsonl',
      getWorkingDir: () => '/repo',
      getProjectRoot: () => '/repo',
      getCliVersion: () => '1.0.0',
      getOutputFormat: () => 'text',
      getContentGeneratorConfig: () => ({ contextWindowSize: 1000 }),
    };
    const settings = {
      merged: {
        ui: {
          statusLine: {
            type: 'command',
            command: 'echo status',
            padding: 2,
          },
        },
        context: {},
      },
    };
    const sessionStats = {
      lastPromptTokenCount: 100,
      sessionStartTime: new Date('2026-04-02T00:00:00.000Z'),
      metrics: {
        models: {},
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
      },
    };

    const { rerender } = renderHook(() =>
      useStatusLine({
        config: config as never,
        settings: settings as never,
        history: [],
        currentModel: 'qwen3-coder',
        sessionStats: sessionStats as never,
        vimEnabled: false,
        vimMode: 'NORMAL',
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    approvalMode = 'auto-edit';
    rerender();

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(executeStatusLineCommand).toHaveBeenCalledTimes(2);
    expect(vi.mocked(executeStatusLineCommand).mock.calls[1]?.[0]).toMatchObject(
      {
        input: expect.objectContaining({
          permission_mode: 'auto-edit',
        }),
      },
    );
  });
});
