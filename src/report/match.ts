import type { CoverageEntry, JobSpec } from '../tailor/types.js';

export function renderMatchReport(job: JobSpec, coverage: CoverageEntry[]): string {
  const matched = coverage.filter((c) => !c.gap);
  const gaps = coverage.filter((c) => c.gap);

  const lines: string[] = [];
  lines.push(`# Match report — ${job.title}`);
  lines.push('');
  lines.push(`Domain: ${job.domain} · Seniority: ${job.seniority}`);
  lines.push('');

  lines.push('## Matched requirements');
  lines.push('');
  if (matched.length === 0) {
    lines.push('(none)');
  } else {
    for (const entry of matched) {
      lines.push(`- **${entry.requirement}** — evidence: ${entry.evidenceIds.join(', ')}`);
    }
  }
  lines.push('');

  lines.push('## Gaps (talking points to prepare)');
  lines.push('');
  if (gaps.length === 0) {
    lines.push('(none)');
  } else {
    for (const entry of gaps) {
      lines.push(`- ${entry.requirement}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}
