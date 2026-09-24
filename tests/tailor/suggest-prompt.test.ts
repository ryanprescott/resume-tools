import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseMarkdown } from '../../src/parse/markdown.js';
import type { JobSpec } from '../../src/tailor/types.js';

const ask = vi.fn(async (_opts: { prompt: string }) => ({ suggestions: [] }));
vi.mock('../../src/claude.js', () => ({ ask: (opts: { prompt: string }) => ask(opts) }));

const { suggest } = await import('../../src/tailor/suggest.js');

const job: JobSpec = {
  title: 'Staff Engineer',
  company: '',
  recruiter: '',
  occupation: 'Software Engineer',
  seniority: 'staff',
  hardRequirements: [],
  niceToHaves: [],
  keywords: [],
  domain: 'fintech',
};

const resume = parseMarkdown(`---
name: Jane Doe
---

## Experience

### Engineer — Acme  <!--id:r1-->
2020-01 .. 2023-01

- Responsible for the ledger rewrite  <!--id:r1b1-->
- Cut p99 latency 40% by rewriting the ingest path  <!--id:r1b2-->
`);

describe('suggest prompt', () => {
  beforeEach(() => ask.mockClear());

  it('hands the model the writing warnings and the writing guide', async () => {
    await suggest(resume, job, []);
    const { prompt } = ask.mock.calls[0][0];
    expect(prompt).toContain('--- WRITING ISSUES');
    expect(prompt).toContain('r1b1: [weak-opener]');
    expect(prompt).toContain('--- HOW A BULLET SHOULD READ ---');
  });

  it('does not ask the model to supply results — that question is yours', async () => {
    await suggest(resume, job, []);
    const { prompt } = ask.mock.calls[0][0];
    expect(prompt).not.toContain('[no-outcome]');
    expect(prompt).toContain('never add a number');
  });
});
