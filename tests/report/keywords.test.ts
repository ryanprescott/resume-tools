import { describe, it, expect } from 'vitest';
import { renderKeywordReport } from '../../src/report/keywords.js';
import type { Resume } from '../../src/model/schema.js';
import type { JobSpec } from '../../src/tailor/types.js';

const resume: Resume = {
  contact: { name: 'Jane Doe', email: 'jane@example.com' },
  meta: undefined,
  sections: [
    {
      name: 'Skills',
      bullets: [{ id: 's1', text: 'Languages: TypeScript, Kubernetes' }],
    },
  ],
};

const job: JobSpec = {
  title: 'Staff Engineer',
  seniority: 'staff',
  hardRequirements: ['Kubernetes'],
  niceToHaves: ['Rust'],
  keywords: ['Kubernetes', 'Rust'],
  domain: 'fintech',
  company: '',
  recruiter: '',
  occupation: 'Software Engineer',
};

describe('renderKeywordReport', () => {
  it('lists a keyword present in the resume under Present', () => {
    const report = renderKeywordReport(job, resume);
    const presentSection = report.split('## Absent')[0];
    expect(presentSection).toContain('- Kubernetes');
  });

  it('lists a keyword absent from the resume under Absent', () => {
    const report = renderKeywordReport(job, resume);
    const absentSection = report.split('## Absent')[1];
    expect(absentSection).toContain('- Rust');
  });

  it('is case-insensitive when matching keywords against resume text', () => {
    const report = renderKeywordReport({ ...job, keywords: ['kubernetes'] }, resume);
    const presentSection = report.split('## Absent')[0];
    expect(presentSection).toContain('- kubernetes');
  });
});
