import { describe, it, expect } from 'vitest';
import { applyWriteback, citedFactIds, planWriteback, promotedFactIds } from '../../src/tailor/writeback.js';
import type { Resume } from '../../src/model/schema.js';

function base(): Resume {
  return {
    contact: { name: 'Jane Doe' },
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
            bullets: [{ id: 'r1b1', text: 'Cut p99 latency 40%' }],
          },
        ],
      },
      { name: 'Skills', bullets: [{ id: 's1b1', text: 'Languages: TypeScript' }] },
    ],
  };
}

describe('planWriteback', () => {
  it('finds a fact-sourced bullet added under an existing entry', () => {
    const variant = base();
    variant.sections[0].entries![0].bullets.push({ id: 'u1', text: 'Ran the K8s migration' });

    const plan = planWriteback(base(), variant);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: 'bullet', id: 'u1', entryId: 'r1', section: 'Experience' });
  });

  it('finds a fact-sourced line added to a list section', () => {
    const variant = base();
    variant.sections[1].bullets!.push({ id: 'u2', text: 'Certifications: AWS SAA' });

    const plan = planWriteback(base(), variant);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: 'bullet', id: 'u2', section: 'Skills' });
    expect(plan[0]).not.toHaveProperty('entryId');
  });

  it('finds a whole entry that the variant added', () => {
    const variant = base();
    variant.sections[0].entries!.push({
      id: 'r2',
      title: 'Contractor',
      org: 'Beta',
      start: '2019',
      end: '2020',
      bullets: [{ id: 'u1', text: 'Built the billing service' }],
    });

    const plan = planWriteback(base(), variant);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: 'entry', section: 'Experience' });
  });

  it('ignores rewrites of existing bullets — tailoring stays in the variant', () => {
    const variant = base();
    variant.sections[0].entries![0].bullets[0].text = 'Cut p99 latency 40% via an ingest rewrite';
    expect(planWriteback(base(), variant)).toEqual([]);
  });

  it('ignores a bullet that is new but not fact-sourced', () => {
    const variant = base();
    variant.sections[0].entries![0].bullets.push({ id: 'h1a2b3c4', text: 'Something else' });
    expect(planWriteback(base(), variant)).toEqual([]);
  });
});

describe('applyWriteback', () => {
  it('puts a bullet back under the same entry it occupied in the variant', () => {
    const variant = base();
    variant.sections[0].entries![0].bullets.push({ id: 'u1', text: 'Ran the K8s migration' });

    const updated = applyWriteback(base(), planWriteback(base(), variant));
    expect(updated.sections[0].entries![0].bullets.map((b) => b.id)).toEqual(['r1b1', 'u1']);
  });

  it('creates a section that does not exist yet', () => {
    const variant = base();
    variant.sections.push({ name: 'Certifications', bullets: [{ id: 'u5', text: 'AWS SAA, 2024' }] });

    const updated = applyWriteback(base(), planWriteback(base(), variant));
    const created = updated.sections.find((s) => s.name === 'Certifications');
    expect(created?.bullets).toEqual([{ id: 'u5', text: 'AWS SAA, 2024' }]);
  });

  it('leaves the input resume untouched', () => {
    const variant = base();
    variant.sections[0].entries![0].bullets.push({ id: 'u1', text: 'Ran the K8s migration' });

    const input = base();
    applyWriteback(input, planWriteback(base(), variant));
    expect(input.sections[0].entries![0].bullets).toHaveLength(1);
  });
});

describe('promotedFactIds', () => {
  it('collects ids from both loose bullets and whole entries', () => {
    const ids = promotedFactIds([
      { kind: 'bullet', id: 'u1', text: 'a', section: 'Experience', where: 'x' },
      {
        kind: 'entry',
        section: 'Experience',
        where: 'x',
        entry: {
          id: 'r2',
          title: 't',
          org: 'o',
          start: '',
          end: '',
          bullets: [{ id: 'u7', text: 'b' }],
        },
      },
    ]);
    expect([...ids].sort()).toEqual(['u1', 'u7']);
  });
});

describe('citedFactIds', () => {
  it('picks out only the fact-shaped bullet ids', () => {
    const variant = base();
    variant.sections[0].entries![0].bullets.push({ id: 'u9', text: 'x' });
    expect([...citedFactIds(variant)]).toEqual(['u9']);
  });
});
