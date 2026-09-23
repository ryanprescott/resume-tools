import { checkbox, confirm, editor, input, select, Separator } from '@inquirer/prompts';
import pc from 'picocolors';
import { Interrupted } from './interrupt.js';

/**
 * Thin, consistently-themed wrappers over @inquirer/prompts.
 *
 * The wrappers exist for two reasons: one place to set the theme so every stage
 * of `tailor` looks like the same program, and one place to turn Ctrl-C into a
 * typed `Cancelled` rather than the SIGINT-shaped `ExitPromptError` that
 * inquirer throws, which would otherwise surface as a stack trace.
 */

export { Cancelled, Interrupted } from './interrupt.js';

const theme = {
  prefix: { idle: pc.cyan('?'), done: pc.green('✓') },
  style: {
    answer: (text: string) => pc.cyan(text),
    message: (text: string) => pc.bold(text),
    help: (text: string) => pc.dim(text),
    highlight: (text: string) => pc.cyan(text),
  },
};

/**
 * Ctrl-C out of a prompt means "back", not "die". Inquirer signals it as an
 * `ExitPromptError`, which would otherwise reach the top as a stack trace.
 */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Error && err.name === 'ExitPromptError') throw new Interrupted();
    throw err;
  }
}

export interface ChoiceSpec<T> {
  name: string;
  value: T;
  description?: string;
}

export function choose<T>(
  message: string,
  choices: ReadonlyArray<ChoiceSpec<T> | Separator>,
  opts: { default?: T; pageSize?: number } = {},
): Promise<T> {
  return guard(() =>
    select<T>({
      message,
      choices: choices as never,
      default: opts.default,
      pageSize: opts.pageSize ?? 10,
      theme: { ...theme, icon: { cursor: '❯' } },
    }),
  );
}

export function text(
  message: string,
  opts: { default?: string; prefill?: boolean; required?: boolean } = {},
): Promise<string> {
  return guard(() =>
    input({
      message,
      default: opts.default,
      // `editable` puts the default into the line buffer so it can be modified
      // in place, rather than being an all-or-nothing suggestion.
      prefill: opts.prefill === false ? 'tab' : 'editable',
      required: opts.required ?? false,
      theme,
    }),
  );
}

/** Multi-line capture via $EDITOR — the right shape for "tell me about X". */
export function longText(message: string, opts: { default?: string } = {}): Promise<string> {
  return guard(() =>
    editor({
      message,
      default: opts.default,
      postfix: '.md',
      waitForUserInput: false,
      theme,
    }),
  );
}

export function yesNo(message: string, opts: { default?: boolean } = {}): Promise<boolean> {
  return guard(() => confirm({ message, default: opts.default ?? false, theme }));
}

export function pick<T>(
  message: string,
  choices: ReadonlyArray<{ name: string; value: T; checked?: boolean }>,
  opts: { required?: boolean } = {},
): Promise<T[]> {
  return guard(() =>
    checkbox<T>({
      message,
      choices: choices as never,
      required: opts.required ?? false,
      pageSize: 14,
      theme,
    }),
  );
}

export { Separator };
