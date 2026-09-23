import { describe, it, expect } from 'vitest';
import { applyDecisions } from '../../src/tailor/apply.js';
import type { Resume } from '../../src/model/schema.js';
import type { Decision, Suggestion } from '../../src/tailor/types.js';

function makeResume(): Resume {
  return {
    contact: { name: 'Jane Doe', email: 'jane@example.com' },
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
            bullets: [
              { id: 'r1b1', text: 'Cut p99 latency 40%' },
              { id: 'r1b2', text: 'Led a migration' },
              { id: 'r1b3', text: 'Mentored engineers' },
            ],
          },
          {
            id: 'r2',
            title: 'Engineer',
            org: 'Beta',
            start: '2020-01',
            end: '2022-12',
            location: 'Remote',
            bullets: [{ id: 'r2b1', text: 'Built a thing' }],
          },
        ],
      },
    ],
  };
}

function baseSuggestion(overrides: Partial<Suggestion>): Suggestion {
  return {
    targetId: 'r1b1',
    kind: 'rewrite',
    before: 'Cut p99 latency 40%',
    after: 'Cut p99 latency 40% via ingest rewrite',
    sourceIds: ['r1b1'],
    rationale: 'match JD',
    jdRef: 'performance optimization',
    confidence: 0.9,
    ...overrides,
  };
}

describe('applyDecisions', () => {
  it('does not mutate the input resume', () => {
    const resume = makeResume();
    const snapshot = JSON.parse(JSON.stringify(resume));
    const decisions: Decision[] = [
      { suggestion: baseSuggestion({}), action: 'accept' },
      { suggestion: baseSuggestion({ targetId: 'r1b2', kind: 'drop' }), action: 'accept' },
    ];
    applyDecisions(resume, decisions, { company: 'Acme', title: 'Staff Engineer' }, 'base.resume.md');
    expect(resume).toEqual(snapshot);
  });

  it('applies a rewrite to the bullet text', () => {
    const resume = makeResume();
    const decisions: Decision[] = [{ suggestion: baseSuggestion({}), action: 'accept' }];
    const result = applyDecisions(resume, decisions, { company: 'Acme', title: 'Staff Engineer' }, 'base.resume.md');
    const bullet = result.sections[0].entries![0].bullets.find((b) => b.id === 'r1b1');
    expect(bullet!.text).toBe('Cut p99 latency 40% via ingest rewrite');
  });

  it('uses edited text over suggestion.after when action is edit', () => {
    const resume = makeResume();
    const decisions: Decision[] = [
      { suggestion: baseSuggestion({}), action: 'edit', editedText: 'Custom edited text' },
    ];
    const result = applyDecisions(resume, decisions, { company: 'Acme', title: 'Staff Engineer' }, 'base.resume.md');
    const bullet = result.sections[0].entries![0].bullets.find((b) => b.id === 'r1b1');
    expect(bullet!.text).toBe('Custom edited text');
  });

  it('drops a bullet', () => {
    const resume = makeResume();
    const decisions: Decision[] = [
      { suggestion: baseSuggestion({ targetId: 'r1b2', kind: 'drop' }), action: 'accept' },
    ];
    const result = applyDecisions(resume, decisions, { company: 'Acme', title: 'Staff Engineer' }, 'base.resume.md');
    const ids = result.sections[0].entries![0].bullets.map((b) => b.id);
    expect(ids).toEqual(['r1b1', 'r1b3']);
  });

  it('promotes a bullet to the front of its siblings', () => {
    const resume = makeResume();
    const decisions: Decision[] = [
      { suggestion: baseSuggestion({ targetId: 'r1b3', kind: 'promote' }), action: 'accept' },
    ];
    const result = applyDecisions(resume, decisions, { company: 'Acme', title: 'Staff Engineer' }, 'base.resume.md');
    const ids = result.sections[0].entries![0].bullets.map((b) => b.id);
    expect(ids).toEqual(['r1b3', 'r1b1', 'r1b2']);
  });

  it('demotes a bullet to the back of its siblings', () => {
    const resume = makeResume();
    const decisions: Decision[] = [
      { suggestion: baseSuggestion({ targetId: 'r1b1', kind: 'demote' }), action: 'accept' },
    ];
    const result = applyDecisions(resume, decisions, { company: 'Acme', title: 'Staff Engineer' }, 'base.resume.md');
    const ids = result.sections[0].entries![0].bullets.map((b) => b.id);
    expect(ids).toEqual(['r1b2', 'r1b3', 'r1b1']);
  });

  it('reorders a bullet by swapping with its previous sibling', () => {
    const resume = makeResume();
    const decisions: Decision[] = [
      { suggestion: baseSuggestion({ targetId: 'r1b2', kind: 'reorder' }), action: 'accept' },
    ];
    const result = applyDecisions(resume, decisions, { company: 'Acme', title: 'Staff Engineer' }, 'base.resume.md');
    const ids = result.sections[0].entries![0].bullets.map((b) => b.id);
    expect(ids).toEqual(['r1b2', 'r1b1', 'r1b3']);
  });

  it('skips rejected and skipped decisions', () => {
    const resume = makeResume();
    const decisions: Decision[] = [
      { suggestion: baseSuggestion({}), action: 'reject' },
      { suggestion: baseSuggestion({ targetId: 'r1b2', kind: 'drop' }), action: 'skip' },
    ];
    const result = applyDecisions(resume, decisions, { company: 'Acme', title: 'Staff Engineer' }, 'base.resume.md');
    expect(result.sections[0].entries![0].bullets.map((b) => b.text)).toEqual([
      'Cut p99 latency 40%',
      'Led a migration',
      'Mentored engineers',
    ]);
  });

  it('sets meta.basedOn and meta.job', () => {
    const resume = makeResume();
    const result = applyDecisions(resume, [], { company: 'Acme', title: 'Staff Engineer' }, 'base.resume.md@abc');
    expect(result.meta).toEqual({ basedOn: 'base.resume.md@abc', job: { company: 'Acme', title: 'Staff Engineer' } });
  });
});

const JOB = { company: 'Acme', title: 'Staff Engineer' };

describe('applyDecisions — added bullets', () => {
  it('appends to an entry when targetId is an entry id, keeping the fact id', () => {
    const resume = makeResume();
    const decisions: Decision[] = [
      {
        suggestion: baseSuggestion({
          targetId: 'r1',
          kind: 'add',
          before: '',
          after: 'Ran the K8s migration',
          sourceIds: ['u1'],
        }),
        action: 'accept',
      },
    ];
    const result = applyDecisions(resume, decisions, JOB, 'base.resume.md');
    const bullets = result.sections[0].entries![0].bullets;
    expect(bullets.map((b) => b.id)).toEqual(['r1b1', 'r1b2', 'r1b3', 'u1']);
    expect(bullets[3].text).toBe('Ran the K8s migration');
  });

  it('inserts after the anchor when targetId is a sibling bullet', () => {
    const resume = makeResume();
    const decisions: Decision[] = [
      {
        suggestion: baseSuggestion({
          targetId: 'r1b1',
          kind: 'add',
          before: '',
          after: 'New line',
          sourceIds: ['u2'],
        }),
        action: 'accept',
      },
    ];
    const result = applyDecisions(resume, decisions, JOB, 'base.resume.md');
    expect(result.sections[0].entries![0].bullets.map((b) => b.id)).toEqual([
      'r1b1',
      'u2',
      'r1b2',
      'r1b3',
    ]);
  });

  it('honours an edit made to an added bullet', () => {
    const resume = makeResume();
    const decisions: Decision[] = [
      {
        suggestion: baseSuggestion({ targetId: 'r1', kind: 'add', before: '', after: 'Draft', sourceIds: ['u1'] }),
        action: 'edit',
        editedText: 'Reworded by hand',
      },
    ];
    const result = applyDecisions(resume, decisions, JOB, 'base.resume.md');
    const bullets = result.sections[0].entries![0].bullets;
    expect(bullets[bullets.length - 1].text).toBe('Reworded by hand');
  });

  it('falls back to a content hash when the fact id is already taken', () => {
    const resume = makeResume();
    resume.sections[0].entries![0].bullets.push({ id: 'u1', text: 'already here' });
    const decisions: Decision[] = [
      {
        suggestion: baseSuggestion({ targetId: 'r1', kind: 'add', before: '', after: 'Another', sourceIds: ['u1'] }),
        action: 'accept',
      },
    ];
    const result = applyDecisions(resume, decisions, JOB, 'base.resume.md');
    const bullets = result.sections[0].entries![0].bullets;
    expect(bullets[bullets.length - 1].id).toMatch(/^h[0-9a-f]{8}$/);
  });
});

describe('applyDecisions — structural additions', () => {
  it('adds a new entry to an existing section', () => {
    const resume = makeResume();
    const result = applyDecisions(resume, [], JOB, 'base.resume.md', [
      {
        kind: 'entry',
        section: 'Experience',
        entry: { id: 'r3', title: 'Contractor', org: 'Beta', start: '2019', end: '2020', bullets: [] },
      },
    ]);
    expect(result.sections[0].entries!.map((e) => e.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('creates a section that does not exist yet', () => {
    const resume = makeResume();
    const result = applyDecisions(resume, [], JOB, 'base.resume.md', [
      { kind: 'bullet', section: 'Certifications', bullet: { id: 'u4', text: 'AWS SAA, 2024' } },
    ]);
    const created = result.sections.find((s) => s.name === 'Certifications');
    expect(created?.bullets).toEqual([{ id: 'u4', text: 'AWS SAA, 2024' }]);
  });

  it('matches an existing section case-insensitively rather than duplicating it', () => {
    const resume = makeResume();
    resume.sections.push({ name: 'Skills', bullets: [{ id: 's1b1', text: 'TypeScript' }] });
    const result = applyDecisions(resume, [], JOB, 'base.resume.md', [
      { kind: 'bullet', section: 'skills', bullet: { id: 'u4', text: 'Terraform' } },
    ]);
    expect(result.sections.filter((s) => s.name.toLowerCase() === 'skills')).toHaveLength(1);
    expect(result.sections.find((s) => s.name === 'Skills')!.bullets).toHaveLength(2);
  });
});
