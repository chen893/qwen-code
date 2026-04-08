/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { SettingScope } from '../../config/settings.js';
import { runStatusLineSetup } from './statuslineSetup.js';

vi.mock('web-tree-sitter', () => ({
  default: class MockParser {},
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const existsSync = vi.fn();
  const mkdirSync = vi.fn();
  const readFileSync = vi.fn();
  const writeFileSync = vi.fn();
  return {
    ...actual,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    default: {
      ...(actual as unknown as Record<string, unknown>),
      existsSync,
      mkdirSync,
      readFileSync,
      writeFileSync,
    },
  } as unknown as typeof import('node:fs');
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(),
    platform: vi.fn(),
  };
});

describe('runStatusLineSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue('C:\\Users\\tester');
    vi.mocked(os.platform).mockReturnValue('win32');
  });

  it('asks for confirmation before overwriting a non-empty script', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('Write-Host "existing"');

    const context = createMockCommandContext({
      invocation: {
        raw: '/statusline show git branch',
        name: 'statusline',
        args: 'show git branch',
      },
    });

    const result = await runStatusLineSetup(context, 'show git branch');

    expect(result).toEqual({
      type: 'confirm_action',
      prompt: expect.anything(),
      originalInvocation: {
        raw: '/statusline show git branch',
      },
    });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(context.services.settings.setValue).not.toHaveBeenCalled();
  });

  it('writes the script and saves ui.statusLine settings', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const context = createMockCommandContext({
      invocation: {
        raw: '/statusline show git branch',
        name: 'statusline',
        args: 'show git branch',
      },
    });

    const result = await runStatusLineSetup(context, 'show git branch');

    expect(fs.mkdirSync).toHaveBeenCalledWith('C:\\Users\\tester\\.qwen', {
      recursive: true,
    });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'C:\\Users\\tester\\.qwen\\statusline.ps1',
      expect.any(String),
      'utf8',
    );
    expect(context.services.settings.setValue).toHaveBeenCalledWith(
      SettingScope.User,
      'ui.statusLine',
      expect.objectContaining({
        type: 'command',
        padding: 2,
        command: expect.stringContaining('statusline.ps1'),
      }),
    );
    expect(context.ui.reloadCommands).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('statusline.ps1'),
      }),
    );
  });
});
