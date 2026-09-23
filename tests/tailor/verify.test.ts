import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../src/parse/markdown.js';
import { verifySuggestions } from '../../src/tailor/verify.js';
import type { Suggestion } from '../../src/tailor/types.js';

const resume = parseMarkdown(`---
name: R
---

## Experience

### Engineer — Acme  <!--id:r1-->
2022 .. present

- Built the ledger  <!--id:r1b1-->
`);

const base: Suggestion = {
  targetId: 'r1b1',
  kind: 'drop',
  before: 'Built the ledger',
  after: '',
  sourceIds: ['r1b1'],
  rationale: 'irrelevant to the role',
  jdRef: '',
  confidence: 0.9,
  origin: 'model',
};

describe('verifySuggestions', () => {
  // Neither case reaches the model: these would throw on a missing login otherwise.
  it('approves a drop without fact-checking an empty bullet', async () => {
    const { approved, rejected } = await verifySuggestions(resume, [base]);
    expect(approved).toEqual([base]);
    expect(rejected).toEqual([]);
  });

  it('approves your own text without fact-checking it', async () => {
    const mine: Suggestion = { ...base, kind: 'add', after: 'Ran the help desk', origin: 'user' };
    expect((await verifySuggestions(resume, [mine])).approved).toEqual([mine]);
  });
});
