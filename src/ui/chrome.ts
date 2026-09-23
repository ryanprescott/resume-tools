import pc from 'picocolors';
import { diffWords } from 'diff';

/**
 * Terminal chrome: panels, rules, aligned fields and word-level diffs.
 *
 * Everything here lays out against the *visible* width of a string, so styled
 * text can be wrapped and boxed without ANSI escapes throwing the arithmetic
 * off. That is the whole reason styling is carried as a token list rather than
 * baked into the string before layout.
 */

const ANSI = /\[[0-9;]*m/g;

export function visibleLength(text: string): number {
  return text.replace(ANSI, '').length;
}

export function termWidth(): number {
  const columns = process.stdout.columns ?? 80;
  return Math.max(48, Math.min(columns - 1, 96));
}

export interface Token {
  text: string;
  style?: (s: string) => string;
}

/**
 * Lay a token stream out into wrapped, indented lines. Words are the wrap unit;
 * a single word longer than the available width is allowed to overflow rather
 * than being broken mid-token (bullet text contains URLs and hyphenated terms).
 */
export function layout(tokens: Token[], width: number, indent = 0): string {
  const pad = ' '.repeat(indent);
  const usable = Math.max(16, width - indent);
  const lines: string[] = [];
  let current = '';
  let currentLength = 0;

  const push = (word: string, style?: (s: string) => string): void => {
    if (currentLength > 0 && currentLength + 1 + word.length > usable) {
      lines.push(current);
      current = '';
      currentLength = 0;
    }
    const sep = currentLength > 0 ? ' ' : '';
    current += sep + (style ? style(word) : word);
    currentLength += sep.length + word.length;
  };

  for (const token of tokens) {
    for (const word of token.text.split(/\s+/)) {
      if (word !== '') push(word, token.style);
    }
  }
  if (current !== '') lines.push(current);
  if (lines.length === 0) lines.push('');

  return lines.map((line) => pad + line).join('\n');
}

export function wrap(text: string, indent = 0, style?: (s: string) => string): string {
  return layout([{ text, style }], termWidth(), indent);
}

export function rule(label?: string): string {
  const width = termWidth();
  if (!label) return pc.dim('─'.repeat(width));
  const head = `── ${label} `;
  return pc.dim(head + '─'.repeat(Math.max(0, width - visibleLength(head))));
}

/** Stage banner: `━━ 2/5 · Gaps ━━━━━━━…` */
export function stage(index: number, total: number, title: string): string {
  const width = termWidth();
  const head = `━━ ${pc.dim(`${index}/${total}`)} ${pc.bold(title)} `;
  return '\n' + pc.cyan(head + pc.dim('━'.repeat(Math.max(0, width - visibleLength(head)))));
}

export interface PanelOptions {
  title: string;
  /** Right-aligned text on the top border, e.g. a confidence meter. */
  right?: string;
  /** Body lines, rendered inside the box. */
  lines: string[];
}

export function panel({ title, right, lines }: PanelOptions): string {
  const width = termWidth();
  const inner = width - 2;

  const left = `─ ${pc.bold(title)} `;
  const tail = right ? ` ${right} ─` : '';
  const fillLength = Math.max(1, inner - visibleLength(left) - visibleLength(tail));
  const top = pc.dim('┌') + left + pc.dim('─'.repeat(fillLength)) + tail + pc.dim('┐');

  const body = lines.map((line) => {
    const padding = Math.max(0, inner - 2 - visibleLength(line));
    return `${pc.dim('│')} ${line}${' '.repeat(padding)} ${pc.dim('│')}`;
  });

  const bottom = pc.dim('└' + '─'.repeat(inner) + '┘');
  return [top, ...body, bottom].join('\n');
}

/** `▓▓▓▓▓░ 0.82` */
export function meter(value: number, slots = 6): string {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * slots);
  const bar = '▓'.repeat(filled) + '░'.repeat(slots - filled);
  const tint = value >= 0.75 ? pc.green : value >= 0.4 ? pc.yellow : pc.red;
  return `${tint(bar)} ${pc.dim(value.toFixed(2))}`;
}

const LABEL_WIDTH = 8;

/** An aligned `label   value` row, with the value wrapped under itself. */
export function field(label: string, value: string, style?: (s: string) => string): string {
  const head = '  ' + pc.dim(label.padEnd(LABEL_WIDTH));
  const body = layout([{ text: value, style }], termWidth(), 2 + LABEL_WIDTH);
  return head + body.slice(2 + LABEL_WIDTH);
}

/**
 * A before/after pair with word-level emphasis: words that disappear are red on
 * the `before` line, words that arrive are green on the `after` line, and the
 * shared spine is dimmed so the eye lands on what actually changed.
 *
 * Two lines rather than one interleaved diff because a resume bullet is a
 * sentence you have to be able to *read* to judge it, and interleaving makes
 * both versions unreadable at once.
 */
export function diffPair(before: string, after: string): string {
  const parts = diffWords(before, after);

  const beforeTokens: Token[] = [];
  const afterTokens: Token[] = [];
  for (const part of parts) {
    if (part.added) {
      afterTokens.push({ text: part.value, style: (s) => pc.green(pc.bold(s)) });
    } else if (part.removed) {
      beforeTokens.push({ text: part.value, style: pc.red });
    } else {
      beforeTokens.push({ text: part.value, style: pc.dim });
      afterTokens.push({ text: part.value });
    }
  }

  const width = termWidth();
  const rows: string[] = [];
  if (before.trim() !== '') {
    rows.push('  ' + pc.dim('before'.padEnd(LABEL_WIDTH)) + layout(beforeTokens, width, 2 + LABEL_WIDTH).slice(2 + LABEL_WIDTH));
  }
  const afterLabel = before.trim() === '' ? 'new' : 'after';
  rows.push('  ' + pc.dim(afterLabel.padEnd(LABEL_WIDTH)) + layout(afterTokens, width, 2 + LABEL_WIDTH).slice(2 + LABEL_WIDTH));
  return rows.join('\n');
}

export const ok = (text: string): string => pc.green(`✓ ${text}`);
export const warn = (text: string): string => pc.yellow(`⚠ ${text}`);
export const bad = (text: string): string => pc.red(`✗ ${text}`);
export const note = (text: string): string => pc.dim(text);
