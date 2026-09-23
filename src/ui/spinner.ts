import pc from 'picocolors';
import { Interrupted } from './interrupt.js';

/**
 * A spinner for the stretches where the terminal would otherwise sit dead.
 *
 * Claude calls in this tool run from a few seconds to the better part of a
 * minute, and the stages are sequential, so an unadorned run looks hung. Two
 * things fix that: an elapsed counter, which tells you it is still alive, and a
 * label saying what it is actually doing.
 *
 * Hand-rolled rather than pulled in: it is a frame list, an interval and two
 * escape codes, and it has to interleave with `@inquirer` prompts on the same
 * stream, which is easier to guarantee when we own the writes.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 80;

/** Rotated in once the wait is long enough to be worth commenting on. */
const CHATTER = [
  'crunching',
  'combobulating',
  'reticulating splines',
  'consulting the oracle',
  'rummaging',
  'thinking hard',
  'still going',
];
const CHATTER_AFTER_MS = 6000;
const CHATTER_EVERY_MS = 4500;

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_LINE = '\r\x1b[2K';

let exitHookInstalled = false;

/** However a spinner ends, it must not leave the cursor invisible. */
function ensureCursorRestoredOnExit(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => process.stdout.write(SHOW_CURSOR));
}

function elapsed(startedAt: number): string {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

export interface SpinnerOptions {
  /** Print a ✓ line with the elapsed time when it finishes. */
  done?: string;
}

/**
 * Run `work`, animating `label` until it settles.
 *
 * Ctrl-C while it spins aborts the work and rejects with `Interrupted` rather
 * than killing the process — a `suggest` call is the longest wait in the tool
 * and the likeliest place to change your mind, so it has to be escapable. The
 * signal handed to `work` is what makes that real: without cancelling the
 * underlying request, an abandoned call keeps running and a second one starts
 * beside it when the stage is re-entered.
 *
 * A second Ctrl-C during the same wait exits outright, so a wedged request can
 * never trap you.
 */
export async function withSpinner<T>(
  label: string,
  work: (signal: AbortSignal) => Promise<T>,
  opts: SpinnerOptions = {},
): Promise<T> {
  const startedAt = Date.now();
  const controller = new AbortController();

  // Piped output gets one plain line: no escape codes in a log file, and no
  // 12-per-second writes to something that is not a screen. There is also
  // nobody at a keyboard, so there is nothing to interrupt it with.
  if (!process.stdout.isTTY) {
    process.stdout.write(`${pc.dim('…')} ${label}\n`);
    return work(controller.signal);
  }

  ensureCursorRestoredOnExit();

  let frame = 0;
  let chatter = 0;
  let lastChatterAt = 0;

  const draw = (): void => {
    const age = Date.now() - startedAt;
    const parts = [pc.cyan(FRAMES[frame % FRAMES.length]), label];

    if (age > CHATTER_AFTER_MS) {
      if (lastChatterAt === 0) lastChatterAt = age;
      else if (age - lastChatterAt > CHATTER_EVERY_MS) {
        chatter += 1;
        lastChatterAt = age;
      }
      parts.push(pc.dim(`· ${CHATTER[chatter % CHATTER.length]}`));
    }

    parts.push(pc.dim(`· ${elapsed(startedAt)}`), pc.dim('· ^C to go back'));
    process.stdout.write(CLEAR_LINE + parts.join(' '));
    frame += 1;
  };

  process.stdout.write(HIDE_CURSOR);
  draw();
  const timer = setInterval(draw, FRAME_MS);
  // Never let the animation be the reason the process stays alive.
  timer.unref();

  let interruptions = 0;
  let onInterrupt: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    onInterrupt = (): void => {
      interruptions += 1;
      if (interruptions > 1) {
        process.stdout.write(`${CLEAR_LINE}${SHOW_CURSOR}\n`);
        process.exit(130);
      }
      // Reject *before* aborting. Aborting settles the work promise
      // synchronously, and whichever settles first wins the race below — abort
      // first and the caller gets the request's own cancellation error instead
      // of an Interrupted it can act on.
      reject(new Interrupted());
      controller.abort();
    };
  });
  // Only listened for while spinning: outside this window the default SIGINT
  // behaviour, and inquirer's own handling, must be left alone.
  process.on('SIGINT', onInterrupt!);

  const settle = (): void => {
    clearInterval(timer);
    process.off('SIGINT', onInterrupt!);
    process.stdout.write(CLEAR_LINE + SHOW_CURSOR);
  };

  const running = work(controller.signal);
  // Once we have rejected, the aborted request's own rejection is expected and
  // must not surface as an unhandled rejection.
  running.catch(() => undefined);

  try {
    const result = await Promise.race([running, interrupted]);
    settle();
    if (opts.done) {
      process.stdout.write(`${pc.green('✓')} ${opts.done} ${pc.dim(`· ${elapsed(startedAt)}`)}\n`);
    }
    return result;
  } catch (err) {
    settle();
    throw err;
  }
}
