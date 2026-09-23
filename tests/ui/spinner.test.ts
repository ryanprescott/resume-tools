import { describe, it, expect, vi, afterEach } from 'vitest';
import { withSpinner } from '../../src/ui/spinner.js';
import { Interrupted } from '../../src/ui/interrupt.js';

/**
 * The animated path needs a TTY, so these cover the contract that holds either
 * way: the value passes through, errors propagate, and piped output stays clean.
 */
function captureStdout(): { output: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  return { output: () => chunks.join(''), restore: () => spy.mockRestore() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withSpinner', () => {
  it('returns whatever the work returns', async () => {
    const { restore } = captureStdout();
    await expect(withSpinner('working', async () => 42)).resolves.toBe(42);
    restore();
  });

  it('propagates a rejection rather than swallowing it', async () => {
    const { restore } = captureStdout();
    await expect(
      withSpinner('working', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    restore();
  });

  it('writes one plain line and no escape codes when stdout is not a TTY', async () => {
    const wasTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const { output, restore } = captureStdout();

    await withSpinner('reading the job description', async () => 'ok');

    const written = output();
    restore();
    Object.defineProperty(process.stdout, 'isTTY', { value: wasTTY, configurable: true });

    expect(written).toBe('… reading the job description\n');
    expect(written).not.toContain('\x1b[?25l');
    expect(written).not.toContain('\r');
  });

  it('rejects with Interrupted and aborts the work when Ctrl-C arrives mid-spin', async () => {
    const wasTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const { restore } = captureStdout();
    const listenersBefore = process.listenerCount('SIGINT');

    let seen: AbortSignal | undefined;
    const spinning = withSpinner('working', (signal) => {
      seen = signal;
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });

    await new Promise((r) => setTimeout(r, 30));
    process.emit('SIGINT');

    await expect(spinning).rejects.toBeInstanceOf(Interrupted);
    expect(seen?.aborted).toBe(true);
    // The handler is installed only for the duration of the wait.
    expect(process.listenerCount('SIGINT')).toBe(listenersBefore);

    restore();
    Object.defineProperty(process.stdout, 'isTTY', { value: wasTTY, configurable: true });
  });

  it('leaves no SIGINT listener behind after a normal finish', async () => {
    const wasTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const { restore } = captureStdout();
    const before = process.listenerCount('SIGINT');

    await withSpinner('working', async () => 'ok');

    expect(process.listenerCount('SIGINT')).toBe(before);
    restore();
    Object.defineProperty(process.stdout, 'isTTY', { value: wasTTY, configurable: true });
  });

  it('still runs the work when output is not a TTY', async () => {
    const wasTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const { restore } = captureStdout();

    const ran = vi.fn(async () => 'done');
    await withSpinner('working', ran);

    restore();
    Object.defineProperty(process.stdout, 'isTTY', { value: wasTTY, configurable: true });
    expect(ran).toHaveBeenCalledOnce();
  });
});
