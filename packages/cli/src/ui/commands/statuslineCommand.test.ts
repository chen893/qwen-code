/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { statuslineCommand } from './statuslineCommand.js';
import { runStatusLineSetup } from '../utils/statuslineSetup.js';

vi.mock('web-tree-sitter', () => ({
  default: class MockParser {},
}));

vi.mock('../utils/statuslineSetup.js', () => ({
  runStatusLineSetup: vi.fn(),
}));

describe('statuslineCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-interactive execution', async () => {
    const context = createMockCommandContext({
      executionMode: 'non_interactive',
    });

    const result = await statuslineCommand.action!(context, 'show git branch');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'The /statusline command is only available in interactive mode.',
    });
    expect(runStatusLineSetup).not.toHaveBeenCalled();
  });

  it('delegates setup to the statusline helper in interactive mode', async () => {
    vi.mocked(runStatusLineSetup).mockResolvedValue({
      type: 'message',
      messageType: 'info',
      content: 'configured',
    });

    const context = createMockCommandContext({
      executionMode: 'interactive',
      invocation: {
        raw: '/statusline show git branch',
        name: 'statusline',
        args: 'show git branch',
      },
    });

    const result = await statuslineCommand.action!(context, 'show git branch');

    expect(runStatusLineSetup).toHaveBeenCalledWith(
      context,
      'show git branch',
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'configured',
    });
  });
});
