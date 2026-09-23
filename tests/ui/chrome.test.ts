import { describe, it, expect } from 'vitest';
import pc from 'picocolors';
import { diffPair, layout, meter, panel, visibleLength } from '../../src/ui/chrome.js';

const STRIP = /\[[0-9;]*m/g;
const plain = (s: string): string => s.replace(STRIP, '');

describe('visibleLength', () => {
  it('ignores styling when measuring', () => {
    expect(visibleLength(pc.green(pc.bold('abcd')))).toBe(4);
  });
});

describe('layout', () => {
  it('wraps on words and indents continuation lines', () => {
    const out = layout([{ text: 'one two three four five six seven eight' }], 24, 2);
    const lines = out.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.startsWith('  '))).toBe(true);
    expect(lines.every((line) => plain(line).length <= 24)).toBe(true);
  });

  it('keeps a floor on usable width so a pathological width cannot wrap per word', () => {
    // termWidth() never goes below 48, so this only guards direct callers.
    const out = layout([{ text: 'one two three four five' }], 4, 2);
    expect(out.split('\n').every((line) => plain(line).trim().includes(' '))).toBe(true);
  });

  it('measures styled tokens by their visible width, not their escape codes', () => {
    const styled = layout([{ text: 'one two three four', style: pc.green }], 12, 0);
    const bare = layout([{ text: 'one two three four' }], 12, 0);
    expect(plain(styled)).toBe(bare);
  });

  it('lets an over-long word overflow rather than breaking it', () => {
    const out = layout([{ text: 'https://example.com/a/very/long/path' }], 12, 0);
    expect(out.split('\n')).toHaveLength(1);
  });

  it('returns a single blank line for empty input', () => {
    expect(layout([], 20, 0)).toBe('');
  });
});

describe('panel', () => {
  it('renders every line to the same visible width', () => {
    const rendered = panel({
      title: 'Suggestion 1 of 3',
      right: pc.dim('confidence') + ' ' + meter(0.8),
      lines: [pc.bold('r1b2') + ' · rewrite'],
    });
    const widths = new Set(rendered.split('\n').map((line) => visibleLength(line)));
    expect(widths.size).toBe(1);
  });

  it('stays square when the title is styled', () => {
    const rendered = panel({ title: 'x', lines: [pc.green('short'), pc.red('a much longer line here')] });
    const widths = new Set(rendered.split('\n').map((line) => visibleLength(line)));
    expect(widths.size).toBe(1);
  });
});

describe('meter', () => {
  it('fills proportionally and clamps out-of-range input', () => {
    expect(plain(meter(0, 6))).toBe('░░░░░░ 0.00');
    expect(plain(meter(1, 6))).toBe('▓▓▓▓▓▓ 1.00');
    expect(plain(meter(2, 6))).toBe('▓▓▓▓▓▓ 2.00');
  });
});

describe('diffPair', () => {
  it('shows both sides for a rewrite', () => {
    const out = plain(diffPair('Built a pipeline', 'Built a real-time pipeline'));
    expect(out).toContain('before');
    expect(out).toContain('after');
    expect(out).toContain('real-time');
  });

  it('labels an addition "new" and omits the empty before line', () => {
    const out = plain(diffPair('', 'A brand new bullet'));
    expect(out).not.toContain('before');
    expect(out).toContain('new');
  });
});
