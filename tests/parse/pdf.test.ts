import { describe, it, expect } from 'vitest';
import { checkCoverage } from '../../src/parse/pdf.js';
import type { Resume } from '../../src/model/schema.js';

const resume: Resume = {
  contact: { name: 'Jane Doe', email: 'jane@example.com', location: 'Remote' },
  meta: undefined,
  sections: [
    {
      name: 'Experience',
      entries: [
        {
          id: 'r1',
          title: 'Staff Engineer',
          org: 'Acme',
          start: '2023-01',
          end: 'present',
          location: 'Remote',
          bullets: [{ id: 'r1b1', text: 'Cut p99 latency 40% by rewriting the ingest path' }],
        },
      ],
    },
    {
      name: 'Skills',
      bullets: [{ id: 's1', text: 'Languages: TypeScript, Go, Python' }],
    },
  ],
};

describe('checkCoverage', () => {
  it('does not flag a pdf line fully represented in the resume', () => {
    const pdfText = 'Jane Doe\nCut p99 latency 40% by rewriting the ingest path\n';
    const discrepancies = checkCoverage(pdfText, resume);
    expect(discrepancies).toHaveLength(0);
  });

  it('flags a pdf line describing content absent from any bullet', () => {
    const pdfText =
      'Jane Doe\nCut p99 latency 40% by rewriting the ingest path\n' +
      'Managed a distributed team of twelve backend engineers across three continents\n';
    const discrepancies = checkCoverage(pdfText, resume);
    expect(discrepancies).toContain('Managed a distributed team of twelve backend engineers across three continents');
  });

  it('ignores short or noise lines like page numbers and whitespace', () => {
    const pdfText = 'Jane Doe\n\n   \n1\nPage 1 of 2\n';
    const discrepancies = checkCoverage(pdfText, resume);
    expect(discrepancies).toHaveLength(0);
  });
});
