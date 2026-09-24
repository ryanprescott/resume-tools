import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../src/parse/markdown.js';
import { lintResume } from '../../src/lint/bullets.js';
import { lintSummary, renderLint } from '../../src/ui/lint.js';

const STRIP = /\[[0-9;]*m/g;
const plain = (s: string): string => s.replace(STRIP, '');

const resume = parseMarkdown(`---
name: Jane Doe
---

## Experience

### Engineer — Acme  <!--id:r1-->
2020-01 .. 2023-01

- Successfully designed MongoDB queries  <!--id:r1b1-->
- Configured nginx  <!--id:r1b2-->
`);

describe('renderLint', () => {
  it('says so when there is nothing to report', () => {
    expect(plain(renderLint(resume, []))).toContain('no writing issues');
  });

  it('shows each flagged bullet under its location, with its text', () => {
    const out = plain(renderLint(resume, lintResume(resume)));
    expect(out).toContain('Experience › Engineer — Acme');
    expect(out).toContain('r1b1   Successfully designed MongoDB queries');
    expect(out).toContain('filler');
  });

  it('folds bullets with no stated result into one line unless asked for all', () => {
    const findings = lintResume(resume);
    const folded = plain(renderLint(resume, findings));
    expect(folded).toContain('2 bullet(s) say what you did, not what came of it: r1b1, r1b2');
    expect(folded).not.toContain('r1b2   Configured nginx');

    const all = plain(renderLint(resume, findings, { all: true }));
    expect(all).toContain('r1b2   Configured nginx');
  });
});

describe('lintSummary', () => {
  it('counts warnings and suggestions separately', () => {
    expect(plain(lintSummary(lintResume(resume)))).toBe('lint: 1 warning(s), 2 suggestion(s)');
  });
});
