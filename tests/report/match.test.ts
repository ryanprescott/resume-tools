import { describe, it, expect } from 'vitest';
import { renderMatchReport } from '../../src/report/match.js';
import type { CoverageEntry, JobSpec } from '../../src/tailor/types.js';

const job: JobSpec = {
  title: 'Staff Engineer',
  seniority: 'staff',
  hardRequirements: ['Kubernetes', 'Distributed systems'],
  niceToHaves: ['Rust'],
  keywords: ['Kubernetes', 'Rust', 'Distributed systems'],
  domain: 'fintech',
  company: '',
  recruiter: '',
  occupation: 'Software Engineer',
};

const coverage: CoverageEntry[] = [
  { requirement: 'Kubernetes', evidenceIds: ['r1b1'], gap: false },
  { requirement: 'Distributed systems', evidenceIds: [], gap: true },
];

describe('renderMatchReport', () => {
  it('lists matched requirements with their evidence ids', () => {
    const report = renderMatchReport(job, coverage);
    expect(report).toContain('## Matched requirements');
    expect(report).toContain('**Kubernetes** — evidence: r1b1');
  });

  it('lists gaps under the talking-points section', () => {
    const report = renderMatchReport(job, coverage);
    expect(report).toContain('## Gaps (talking points to prepare)');
    expect(report).toContain('- Distributed systems');
  });

  it('includes the job title and domain in the header', () => {
    const report = renderMatchReport(job, coverage);
    expect(report).toContain('# Match report — Staff Engineer');
    expect(report).toContain('Domain: fintech');
  });
});
