import pc from 'picocolors';
import { ResumeParseError, looksLikeResume } from '../parse/markdown.js';
import { wrap } from './chrome.js';

/**
 * Error output people can act on.
 *
 * `line 1: unrecognized syntax` is technically true and practically useless: it
 * names neither the file nor the line, and by far the likeliest cause is that
 * the file was never a resume — a job description handed to `build`. Say that
 * instead, and say what to run.
 */

function excerpt(line: number, lineText: string): string[] {
  if (lineText.trim() === '') return [];
  const gutter = String(line);
  const shown = lineText.length > 96 ? `${lineText.slice(0, 96)}…` : lineText;
  return ['', `  ${pc.dim(`${gutter} │`)} ${shown}`];
}

export interface ParseErrorContext {
  /** Path the content came from, for naming it in the message. */
  file: string;
  /** Raw file contents, so we can tell "malformed resume" from "not a resume". */
  source: string;
  /** What to suggest instead when the file is not a resume at all. */
  suggestion?: string;
}

/** Returns the rendered message, or null if this is not a parse error. */
export function renderParseError(err: unknown, ctx: ParseErrorContext): string | null {
  if (!(err instanceof ResumeParseError)) return null;

  const out: string[] = [];
  const isResume = looksLikeResume(ctx.source);

  if (isResume) {
    out.push(pc.red(`✗ ${ctx.file} is not valid resume Markdown`));
    out.push('');
    out.push(`  ${pc.bold(`line ${err.line}`)}: ${err.detail}`);
    out.push(...excerpt(err.line, err.lineText));
    out.push('');
    out.push(
      wrap(
        'The body must be "## Section", then "### Title — Org  <!--id:r1-->" with a ' +
          '"{start} .. {end}" line under it, then "- bullet  <!--id:r1b1-->".',
        2,
        pc.dim,
      ),
    );
  } else {
    out.push(pc.red(`✗ ${ctx.file} does not look like a resume`));
    out.push('');
    out.push(
      wrap(
        'It has no YAML frontmatter with a `name:` and no `## Section` headings, so there is ' +
          'nothing here to parse as a resume.',
        2,
        pc.dim,
      ),
    );
    out.push(...excerpt(err.line, err.lineText));
    if (ctx.suggestion) {
      out.push('');
      out.push(`  ${pc.dim('did you mean')}`);
      out.push(`    ${pc.cyan(ctx.suggestion)}`);
    }
  }

  return out.join('\n');
}
