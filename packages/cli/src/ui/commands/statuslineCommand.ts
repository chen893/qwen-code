/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand, SlashCommandActionReturn } from './types.js';
import { CommandKind } from './types.js';
import { runStatusLineSetup } from '../utils/statuslineSetup.js';
import { t } from '../../i18n/index.js';

export const statuslineCommand: SlashCommand = {
  name: 'statusline',
  get description() {
    return t('Set up the custom status line.');
  },
  kind: CommandKind.BUILT_IN,
  action: async (
    context,
    args,
  ): Promise<SlashCommandActionReturn> => {
    const executionMode = context.executionMode ?? 'interactive';
    if (executionMode !== 'interactive') {
      return {
        type: 'message',
        messageType: 'error',
        content: 'The /statusline command is only available in interactive mode.',
      };
    }

    return await runStatusLineSetup(context, args);
  },
};
