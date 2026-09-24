import pc from 'picocolors';
import { describeLocation, flattenBullets } from '../model/flatten.js';
import type { Resume } from '../model/schema.js';
import { countBySeverity, type Finding } from '../lint/bullets.js';
import { termWidth } from './chrome.js';

/**
 * The `lint` report: findings grouped by where they sit, each bullet shown once
 * with everything wrong with it underneath. Reading the bullet next to the
 * complaint is what makes the complaint actionable.
 */
export function renderLint(
  resume: Resume,
  findings: readonly Finding[],
  opts: { all?: boolean } = {},
): string {
  if (findings.length === 0) return pc.green('✓ no writing issues found');

  // "No result stated" is true of most bullets on most resumes. Listed one by
  // one it buries the warnings, so by default it is a count and the ids.
  const folded = opts.all ? [] : findings.filter((f) => f.rule === 'no-outcome');
  const shown = findings.filter((f) => !folded.includes(f));

  const text = new Map(flattenBullets(resume).map((b) => [b.id, b.text]));
  const byBullet = new Map<string, Finding[]>();
  for (const finding of shown) {
    const list = byBullet.get(finding.id) ?? [];
    list.push(finding);
    byBullet.set(finding.id, list);
  }

  const out: string[] = [];
  let lastWhere = '';
  const clip = Math.max(40, termWidth() - 10);
  for (const [id, list] of byBullet) {
    const where = describeLocation(resume, id);
    if (where !== lastWhere) {
      out.push('', pc.bold(where));
      lastWhere = where;
    }
    const body = text.get(id) ?? '';
    out.push(`  ${pc.dim(id.padEnd(6))} ${body.length > clip ? `${body.slice(0, clip - 1)}…` : body}`);
    for (const finding of list) {
      const mark = finding.severity === 'warn' ? pc.yellow('⚠') : pc.cyan('·');
      out.push(`         ${mark} ${pc.dim(finding.rule)}  ${finding.message}`);
    }
  }

  if (folded.length > 0) {
    out.push(
      '',
      `${pc.cyan('·')} ${pc.dim('no-outcome')}  ${folded.length} bullet(s) say what you did, not what came of it: ` +
        pc.dim(folded.map((f) => f.id).join(', ')),
      pc.dim('  a number — users, %, time saved, $, volume — is the fastest upgrade a bullet can get (--all lists each)'),
    );
  }

  out.push('', lintSummary(findings));
  return out.join('\n').replace(/^\n/, '');
}

/** One line, for places that only have room to say whether to look. */
export function lintSummary(findings: readonly Finding[]): string {
  const { warn, info } = countBySeverity(findings);
  if (warn + info === 0) return 'lint: no writing issues';
  const parts = [
    warn > 0 ? pc.yellow(`${warn} warning(s)`) : '',
    info > 0 ? pc.cyan(`${info} suggestion(s)`) : '',
  ].filter(Boolean);
  return `lint: ${parts.join(', ')}`;
}
