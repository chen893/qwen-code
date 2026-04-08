/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { normalizeStatusLineOutput } from './normalizeOutput.js';

describe('normalizeStatusLineOutput', () => {
  it('returns undefined for blank output', () => {
    expect(normalizeStatusLineOutput(' \r\n\t \n')).toBeUndefined();
  });

  it('normalizes Windows newlines and trims trailing whitespace', () => {
    expect(
      normalizeStatusLineOutput('branch: main  \r\nctx: 12%   \r\n\r\n'),
    ).toBe('branch: main\nctx: 12%');
  });

  it('preserves leading indentation for non-empty lines', () => {
    expect(
      normalizeStatusLineOutput('  git: main  \n    cache: warm\t\n'),
    ).toBe('  git: main\n    cache: warm');
  });
});
