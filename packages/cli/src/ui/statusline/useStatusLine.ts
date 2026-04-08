/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uiTelemetryService } from '@qwen-code/qwen-code-core';
import { buildStatusLineInput } from './inputBuilder.js';
import { executeStatusLineCommand } from './executor.js';
import {
  normalizeStatusLinePadding,
  STATUS_LINE_DEBOUNCE_MS,
  type StatusLineConfig,
  type UseStatusLineOptions,
  type UseStatusLineResult,
} from './types.js';

function getLastAssistantMessageId(
  history: UseStatusLineOptions['history'],
): number | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index];
    if (item.type.startsWith('gemini')) {
      return item.id;
    }
  }

  return undefined;
}

function isStatusLineConfig(value: unknown): value is StatusLineConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'command' in value &&
    (value as { type?: unknown }).type === 'command' &&
    typeof (value as { command?: unknown }).command === 'string'
  );
}

export function useStatusLine({
  config,
  settings,
  history,
  currentModel,
  sessionStats,
  vimEnabled,
  vimMode,
}: UseStatusLineOptions): UseStatusLineResult {
  const statusLine = isStatusLineConfig(settings.merged.ui?.statusLine)
    ? settings.merged.ui.statusLine
    : undefined;
  const currentApprovalMode = config.getApprovalMode();
  const statusLinePadding = normalizeStatusLinePadding(statusLine?.padding);
  const [statusLineText, setStatusLineText] = useState<string | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const lastAssistantMessageId = useMemo(
    () => getLastAssistantMessageId(history),
    [history],
  );
  const includeDirectoriesKey = JSON.stringify(
    settings.merged.context?.includeDirectories ?? [],
  );

  const clearPending = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const doUpdate = useCallback(async () => {
    if (!statusLine || statusLine.type !== 'command') {
      setStatusLineText(undefined);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const input = buildStatusLineInput({
      config,
      currentModel,
      sessionStats,
      settings,
      lastCachedContentTokenCount:
        uiTelemetryService.getLastCachedContentTokenCount(),
      vimEnabled,
      vimMode,
    });
    const text = await executeStatusLineCommand({
      config,
      statusLine,
      input,
      signal: controller.signal,
    });

    if (!controller.signal.aborted) {
      setStatusLineText((previous) => (previous === text ? previous : text));
    }
  }, [
    config,
    currentApprovalMode,
    currentModel,
    sessionStats,
    settings,
    statusLine,
    vimEnabled,
    vimMode,
  ]);

  useEffect(() => {
    if (!statusLine || statusLine.type !== 'command') {
      clearPending();
      setStatusLineText(undefined);
      return;
    }

    if (config.getDisableAllHooks() || !config.isTrustedFolder()) {
      clearPending();
      setStatusLineText(undefined);
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void doUpdate();
    }, STATUS_LINE_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [
    clearPending,
    config,
    doUpdate,
    includeDirectoriesKey,
    lastAssistantMessageId,
    sessionStats.lastPromptTokenCount,
    statusLine?.command,
    statusLine?.padding,
    currentModel,
    currentApprovalMode,
    vimEnabled,
    vimMode,
  ]);

  useEffect(
    () => () => {
      clearPending();
    },
    [clearPending],
  );

  return {
    statusLineText,
    statusLinePadding,
  };
}
