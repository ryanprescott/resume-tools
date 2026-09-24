import { describe, it, expect } from 'vitest';
import { STAGE, describeStage, navigatorChoices, variantSlug, type NavChoice, type State } from '../../src/tailor/run.js';
import { seedSlots } from '../../src/tailor/review.js';
import { FactStore } from '../../src/tailor/facts.js';
import { emptyInterview } from '../../src/tailor/interview.js';
import type { Decision, JobSpec, Suggestion } from '../../src/tailor/types.js';

const STRIP = /\[[0-9;]*m/g;
const plain = (s: string): string => s.replace(STRIP, '');

function job(): JobSpec {
  return {
    title: 'Staff Engineer',
    seniority: 'senior',
    hardRequirements: ['React', 'AWS'],
    niceToHaves: [],
    keywords: [],
    domain: 'fintech',
    company: '',
    recruiter: '',
    occupation: 'Software Engineer',
  };
}

function blankState(): State {
  return { interview: emptyInterview() };
}

function values(choices: ReturnType<typeof navigatorChoices>): unknown[] {
  return choices.filter((c): c is NavChoice => 'value' in c).map((c) => c.value);
}

describe('navigatorChoices', () => {
  const store = new FactStore();

  it('offers only resume and quit at the very first stage', () => {
    expect(values(navigatorChoices(0, blankState(), store))).toEqual([0, 'quit']);
  });

  it('omits the "go back to" heading when there is nothing behind you', () => {
    const headings = navigatorChoices(0, blankState(), store).filter((c) => !('value' in c));
    expect(headings).toHaveLength(1);

    const state = blankState();
    state.job = job();
    const withHistory = navigatorChoices(2, state, store).filter((c) => !('value' in c));
    expect(withHistory).toHaveLength(2);
  });

  it('lists every stage behind the cursor, and none ahead of it', () => {
    const state = blankState();
    state.job = job();
    expect(values(navigatorChoices(3, state, store))).toEqual([3, 0, 1, 2, 'quit']);
  });

  it('withholds "write what I have" until there is something to write', () => {
    const state = blankState();
    state.job = job();
    expect(values(navigatorChoices(3, state, store))).not.toContain('write');

    state.decisions = [];
    expect(values(navigatorChoices(3, state, store))).toContain('write');
  });

  it('never offers write without a confirmed job', () => {
    const state = blankState();
    state.decisions = [];
    expect(values(navigatorChoices(2, state, store))).not.toContain('write');
  });
});

describe('describeStage', () => {
  const store = new FactStore();

  it('summarises an unvisited stage honestly', () => {
    expect(describeStage(STAGE.job, blankState(), store)).toBe('not read yet');
    expect(describeStage(STAGE.base, blankState(), store)).toBe('not chosen yet');
    expect(describeStage(STAGE.cut, blankState(), store)).toBe('not checked yet');
    expect(describeStage(STAGE.review, blankState(), store)).toBe('not reviewed yet');
  });

  it('summarises decisions once the review has happened', () => {
    const state = blankState();
    state.decisions = [
      { suggestion: {} as Suggestion, action: 'accept' },
      { suggestion: {} as Suggestion, action: 'accept' },
      { suggestion: {} as Suggestion, action: 'reject' },
    ];
    expect(plain(describeStage(STAGE.review, state, store))).toBe('2 accepted · 0 edited · 1 rejected');
  });

  it('says which base was chosen, and when a run is pivoting', () => {
    const state = blankState();
    const resume = { contact: { name: 'R' }, sections: [] };
    state.bases = [
      { path: 'resumes/base.resume.md', resume, occupation: 'Full Stack Developer', usedFor: [] },
    ];
    state.baseIndex = 0;
    expect(describeStage(STAGE.base, state, store)).toBe('base.resume.md');

    state.pivot = { occupation: 'IT Support', headline: 'IT Support Specialist' };
    expect(describeStage(STAGE.base, state, store)).toBe(
      'new "IT Support" base from base.resume.md · 0 related role(s)',
    );
  });
});

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    targetId: 'r1b1',
    kind: 'rewrite',
    before: 'before',
    after: 'after',
    sourceIds: ['r1b1'],
    rationale: 'r',
    jdRef: 'jd',
    confidence: 0.5,
    origin: 'model',
    ...overrides,
  };
}

describe('seedSlots', () => {
  it('carries an earlier verdict onto the same suggestion', () => {
    const s = suggestion();
    const prior: Decision[] = [{ suggestion: s, action: 'reject' }];
    expect(seedSlots([suggestion()], prior)[0].verdict).toBe('reject');
  });

  it('carries the edited text alongside an edit verdict', () => {
    const prior: Decision[] = [
      { suggestion: suggestion(), action: 'edit', editedText: 'my wording' },
    ];
    const slot = seedSlots([suggestion()], prior)[0];
    expect(slot.verdict).toBe('edit');
    expect(slot.editedText).toBe('my wording');
  });

  it('treats a skip as undecided rather than a decision', () => {
    const prior: Decision[] = [{ suggestion: suggestion(), action: 'skip' }];
    expect(seedSlots([suggestion()], prior)[0].verdict).toBeUndefined();
  });

  it('does not carry a verdict onto a suggestion whose text has changed', () => {
    const prior: Decision[] = [{ suggestion: suggestion({ after: 'old text' }), action: 'accept' }];
    expect(seedSlots([suggestion({ after: 'new text' })], prior)[0].verdict).toBeUndefined();
  });

  it('re-appends bullets you wrote yourself, which no regenerated set contains', () => {
    const mine = suggestion({ kind: 'add', before: '', after: 'my bullet', origin: 'user' });
    const prior: Decision[] = [{ suggestion: mine, action: 'accept' }];

    const slots = seedSlots([suggestion()], prior);
    expect(slots).toHaveLength(2);
    expect(slots[1].suggestion.after).toBe('my bullet');
    expect(slots[1].verdict).toBe('accept');
  });

  it('does not duplicate an authored bullet that is already in the list', () => {
    const mine = suggestion({ kind: 'add', before: '', after: 'my bullet', origin: 'user' });
    const slots = seedSlots([mine], [{ suggestion: mine, action: 'accept' }]);
    expect(slots).toHaveLength(1);
  });

  it('leaves everything undecided when there is no prior pass', () => {
    const slots = seedSlots([suggestion(), suggestion({ targetId: 'r1b2' })], []);
    expect(slots.every((s) => s.verdict === undefined)).toBe(true);
  });
});

describe('variantSlug', () => {
  it('names the variant for the title and company', () => {
    expect(variantSlug('Staff Engineer', 'Acme Corp', 'jds/whatever.md')).toBe('staff-engineer-acme-corp');
  });

  it('does not repeat the title when the job file is already named for it', () => {
    expect(variantSlug('Senior Engineer, VP', undefined, 'jds/barclays-senior-engineer-vp.md')).toBe(
      'barclays-senior-engineer-vp',
    );
  });

  it('adds the title when the job file does not carry it', () => {
    expect(variantSlug('Staff Engineer', undefined, 'jds/unknown-3.pdf')).toBe('staff-engineer-unknown-3');
  });
});
