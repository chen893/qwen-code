/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@qwen-code/qwen-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import type { SessionStatsState } from '../contexts/SessionContext.js';
import type { VimMode } from '../contexts/VimModeContext.js';
import type { HistoryItem } from '../types.js';

export const DEFAULT_STATUS_LINE_PADDING = 2;
export const STATUS_LINE_DEBOUNCE_MS = 300;
export const DEFAULT_STATUS_LINE_TIMEOUT_MS = 5000;

export interface StatusLineConfig {
  type: 'command';
  command: string;
  padding?: number;
}

export interface StatusLineCommandInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  model: {
    id: string;
    display_name: string;
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
    mode: VimMode;
  };
}

export interface BuildStatusLineInputOptions {
  config: {
    getSessionId: () => string;
    getTranscriptPath: () => string;
    getWorkingDir: () => string;
    getProjectRoot: () => string;
    getApprovalMode: () => unknown;
    getCliVersion: () => string | undefined;
    getOutputFormat: () => string | undefined;
    getContentGeneratorConfig: () => { contextWindowSize?: number } | undefined;
  };
  currentModel: string;
  sessionStats: SessionStatsState;
  settings: LoadedSettings;
  lastCachedContentTokenCount: number;
  vimEnabled: boolean;
  vimMode?: VimMode;
  now?: Date;
}

export interface ExecuteStatusLineCommandOptions {
  config: Pick<Config, 'getDisableAllHooks' | 'isTrustedFolder' | 'getWorkingDir'>;
  statusLine?: StatusLineConfig;
  input: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  spawnProcess?: typeof import('node:child_process').spawn;
}

export interface UseStatusLineOptions {
  config: Config;
  settings: LoadedSettings;
  history: HistoryItem[];
  currentModel: string;
  sessionStats: SessionStatsState;
  vimEnabled: boolean;
  vimMode: VimMode;
}

export interface UseStatusLineResult {
  statusLineText: string | undefined;
  statusLinePadding: number;
}

export function normalizeStatusLinePadding(padding?: number): number {
  return Math.max(0, Math.floor(padding ?? DEFAULT_STATUS_LINE_PADDING));
}
