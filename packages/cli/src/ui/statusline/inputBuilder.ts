/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type BuildStatusLineInputOptions,
  type StatusLineCommandInput,
} from './types.js';

export function buildStatusLineInput({
  config,
  currentModel,
  sessionStats,
  settings,
  lastCachedContentTokenCount,
  vimEnabled,
  vimMode,
  now = new Date(),
}: BuildStatusLineInputOptions): StatusLineCommandInput {
  const currentDir = config.getWorkingDir();
  const projectDir = config.getProjectRoot();
  const includeDirectories =
    settings.merged.context?.includeDirectories?.filter(Boolean);
  const modelMetrics = Object.values(sessionStats.metrics.models ?? {});
  const totalInputTokens = modelMetrics.reduce(
    (sum, model) => sum + (model.tokens?.prompt ?? 0),
    0,
  );
  const totalOutputTokens = modelMetrics.reduce(
    (sum, model) => sum + (model.tokens?.candidates ?? 0),
    0,
  );
  const totalApiDurationMs = modelMetrics.reduce(
    (sum, model) => sum + (model.api?.totalLatencyMs ?? 0),
    0,
  );
  const contextWindowSize =
    config.getContentGeneratorConfig()?.contextWindowSize ?? null;
  const lastPromptTokenCount = sessionStats.lastPromptTokenCount ?? 0;
  const usedPercentage =
    contextWindowSize && contextWindowSize > 0
      ? (lastPromptTokenCount / contextWindowSize) * 100
      : null;
  const remainingPercentage =
    usedPercentage === null ? null : Math.max(0, 100 - usedPercentage);

  return {
    session_id: config.getSessionId(),
    transcript_path: config.getTranscriptPath(),
    cwd: currentDir,
    permission_mode: String(config.getApprovalMode()),
    model: {
      id: currentModel,
      display_name: currentModel,
    },
    workspace: {
      current_dir: currentDir,
      project_dir: projectDir,
      ...(includeDirectories && includeDirectories.length > 0
        ? {
            added_dirs: includeDirectories,
          }
        : {}),
    },
    version: config.getCliVersion() ?? 'unknown',
    output_style: {
      name: config.getOutputFormat() ?? 'text',
    },
    cost: {
      total_cost_usd: 0,
      total_duration_ms:
        now.getTime() - sessionStats.sessionStartTime.getTime(),
      total_api_duration_ms: totalApiDurationMs,
      total_lines_added: sessionStats.metrics.files.totalLinesAdded,
      total_lines_removed: sessionStats.metrics.files.totalLinesRemoved,
    },
    context_window: {
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      context_window_size: contextWindowSize,
      current_usage: {
        input_tokens: lastPromptTokenCount,
        output_tokens: 0,
        cache_read_input_tokens: lastCachedContentTokenCount,
      },
      used_percentage: usedPercentage,
      remaining_percentage: remainingPercentage,
    },
    exceeds_200k_tokens: lastPromptTokenCount > 200000,
    ...(vimEnabled && vimMode
      ? {
          vim: {
            mode: vimMode,
          },
        }
      : {}),
  };
}
