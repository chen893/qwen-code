/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import { getShellConfiguration } from '@qwen-code/qwen-code-core';
import {
  DEFAULT_STATUS_LINE_TIMEOUT_MS,
  type ExecuteStatusLineCommandOptions,
} from './types.js';
import { normalizeStatusLineOutput } from './normalizeOutput.js';

function decorateCommandForShell(command: string, shell: string): string {
  if (shell === 'powershell') {
    return `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
  }
  return command;
}

function spawnStatusLineProcess(
  shellConfig: ReturnType<typeof getShellConfiguration>,
  command: string,
  cwd: string,
  spawnProcess: typeof spawn | undefined,
) {
  const spawnFn = spawnProcess ?? spawn;

  if (shellConfig.shell === 'cmd') {
    return spawnFn(command, [], {
      cwd,
      env: {
        ...process.env,
        QWEN_CODE: '1',
      },
      shell: shellConfig.executable,
      windowsHide: true,
    });
  }

  return spawnFn(shellConfig.executable, [...shellConfig.argsPrefix, command], {
    cwd,
    env: {
      ...process.env,
      QWEN_CODE: '1',
    },
    shell: false,
    windowsHide: true,
  });
}

export async function executeStatusLineCommand({
  config,
  statusLine,
  input,
  signal,
  timeoutMs = DEFAULT_STATUS_LINE_TIMEOUT_MS,
  spawnProcess,
}: ExecuteStatusLineCommandOptions): Promise<string | undefined> {
  if (!statusLine || statusLine.type !== 'command') {
    return undefined;
  }

  if (config.getDisableAllHooks()) {
    return undefined;
  }

  if (!config.isTrustedFolder()) {
    return undefined;
  }

  const shellConfig = getShellConfiguration();
  const command = decorateCommandForShell(statusLine.command, shellConfig.shell);

  return await new Promise<string | undefined>((resolve) => {
    let settled = false;
    let stdout = '';
    let timeoutId: NodeJS.Timeout | undefined;

    const finish = (value: string | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve(value);
    };

    const handleAbort = () => {
      try {
        child.kill();
      } catch {
        // Ignore process termination errors during cancellation.
      }
      finish(undefined);
    };

    const onAbort = signal ? () => handleAbort() : undefined;

    const child = spawnStatusLineProcess(
      shellConfig,
      command,
      config.getWorkingDir?.() ?? process.cwd(),
      spawnProcess,
    );

    timeoutId = setTimeout(handleAbort, timeoutMs);
    if (signal && onAbort) {
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.on('error', () => {
      finish(undefined);
    });

    child.on('close', (code) => {
      if (signal?.aborted) {
        finish(undefined);
        return;
      }

      if (code !== 0) {
        finish(undefined);
        return;
      }

      finish(normalizeStatusLineOutput(stdout));
    });

    try {
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
    } catch {
      finish(undefined);
    }
  });
}
