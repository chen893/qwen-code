/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getShellConfiguration,
  type Config,
} from '@qwen-code/qwen-code-core';
import { executeStatusLineCommand } from './executor.js';

vi.mock('web-tree-sitter', () => ({
  default: class MockParser {},
}));

const spawnMock = vi.fn();

vi.mock('@qwen-code/qwen-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@qwen-code/qwen-code-core')>();
  return {
    ...actual,
    getShellConfiguration: vi.fn(() => ({
      executable: 'bash',
      argsPrefix: ['-c'],
      shell: 'bash',
    })),
  };
});

class MockChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  kill = vi.fn(() => {
    this.emit('close', 1);
    return true;
  });
}

const createMockConfig = (overrides: Partial<Config> = {}) =>
  ({
    getDisableAllHooks: () => false,
    isTrustedFolder: () => true,
    ...overrides,
  }) as Config;

describe('executeStatusLineCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnMock.mockReset();
  });

  it('skips execution when hooks are disabled', async () => {
    const result = await executeStatusLineCommand({
      config: createMockConfig({
        getDisableAllHooks: () => true,
      }),
      statusLine: {
        type: 'command',
        command: 'echo status',
      },
      input: {
        cwd: 'D:\\project\\repo',
      },
      spawnProcess: spawnMock as never,
    });

    expect(result).toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('skips execution for untrusted workspaces', async () => {
    const result = await executeStatusLineCommand({
      config: createMockConfig({
        isTrustedFolder: () => false,
      }),
      statusLine: {
        type: 'command',
        command: 'echo status',
      },
      input: {
        cwd: 'D:\\project\\repo',
      },
      spawnProcess: spawnMock as never,
    });

    expect(result).toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('writes JSON to stdin and returns normalized stdout on success', async () => {
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child as never);

    const promise = executeStatusLineCommand({
      config: createMockConfig(),
      statusLine: {
        type: 'command',
        command: 'echo status',
      },
      input: {
        cwd: 'D:\\project\\repo',
      },
      spawnProcess: spawnMock as never,
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setImmediate(resolve));
    child.stdout.write('branch: main  \nctx: 12%   \n\n');
    child.emit('close', 0);

    await expect(promise).resolves.toBe('branch: main\nctx: 12%');
    expect(spawnMock).toHaveBeenCalledWith(
      'bash',
      ['-c', 'echo status'],
      expect.objectContaining({
        shell: false,
        env: expect.objectContaining({
          QWEN_CODE: '1',
        }),
      }),
    );
    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({
        cwd: 'D:\\project\\repo',
      }),
    );
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('returns undefined when the command exits with a non-zero code', async () => {
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child as never);

    const promise = executeStatusLineCommand({
      config: createMockConfig(),
      statusLine: {
        type: 'command',
        command: 'echo status',
      },
      input: {
        cwd: 'D:\\project\\repo',
      },
      spawnProcess: spawnMock as never,
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setImmediate(resolve));
    child.stdout.write('branch: main');
    child.emit('close', 1);

    await expect(promise).resolves.toBeUndefined();
  });

  it('kills the running command when the signal is aborted', async () => {
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child as never);

    const controller = new AbortController();
    const promise = executeStatusLineCommand({
      config: createMockConfig(),
      statusLine: {
        type: 'command',
        command: 'echo status',
      },
      input: {
        cwd: 'D:\\project\\repo',
      },
      signal: controller.signal,
      spawnProcess: spawnMock as never,
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(promise).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalled();
  });

  it.runIf(process.platform === 'win32')(
    'executes quoted commands correctly when the configured shell is cmd.exe',
    async () => {
      vi.mocked(getShellConfiguration).mockReturnValue({
        executable: 'C:\\WINDOWS\\system32\\cmd.exe',
        argsPrefix: ['/d', '/s', '/c'],
        shell: 'cmd',
      });

      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'statusline-executor-win-'),
      );
      const scriptPath = path.join(tempDir, 'statusline-sample.mjs');

      try {
        fs.writeFileSync(
          scriptPath,
          [
            "import fs from 'node:fs';",
            "const raw = fs.readFileSync(0, 'utf8');",
            "if (!raw.trim()) process.exit(0);",
            "process.stdout.write('statusline ok');",
          ].join('\n'),
          'utf8',
        );

        await expect(
          executeStatusLineCommand({
            config: createMockConfig({
              getWorkingDir: () => tempDir,
            }),
            statusLine: {
              type: 'command',
              command: `node "${scriptPath}"`,
            },
            input: {
              cwd: tempDir,
            },
          }),
        ).resolves.toBe('statusline ok');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    },
  );
});
