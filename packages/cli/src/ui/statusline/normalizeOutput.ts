/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function normalizeStatusLineOutput(
  output: string | undefined,
): string | undefined {
  if (!output) {
    return undefined;
  }

  const normalized = output
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''));

  while (normalized.length > 0 && normalized[normalized.length - 1] === '') {
    normalized.pop();
  }

  const filtered = normalized.filter((line) => line.trim().length > 0);
  if (filtered.length === 0) {
    return undefined;
  }

  return filtered.join('\n');
}
