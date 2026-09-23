import { describe, it, expect } from 'vitest';
import { flattenBullets, collectKnownIds } from '../../src/model/flatten.js';
import type { Resume } from '../../src/model/schema.js';

const resume: Resume = {
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
          ],
        },
      ],
    },
    {
      name: 'Skills',
      bullets: [{ id: 's1', text: 'Languages: TypeScript, Go' }],
    },
  ],
};

describe('flattenBullets', () => {
  it('flattens bullets under entries with entry context', () => {
    const flat = flattenBullets(resume);
    expect(flat).toContainEqual({ id: 'r1b1', text: 'Cut p99 latency 40%', context: 'Staff Engineer — Acme' });
    expect(flat).toContainEqual({ id: 'r1b2', text: 'Led a migration', context: 'Staff Engineer — Acme' });
  });

  it('flattens bare section bullets with section name as context', () => {
    const flat = flattenBullets(resume);
    expect(flat).toContainEqual({ id: 's1', text: 'Languages: TypeScript, Go', context: 'Skills' });
  });
});

describe('collectKnownIds', () => {
  it('includes bullet ids in both bulletIds and allIds', () => {
    const { bulletIds, allIds } = collectKnownIds(resume);
    expect(bulletIds.has('r1b1')).toBe(true);
    expect(bulletIds.has('s1')).toBe(true);
    expect(allIds.has('r1b1')).toBe(true);
  });

  it('includes entry ids only in allIds, not bulletIds', () => {
    const { bulletIds, allIds } = collectKnownIds(resume);
    expect(allIds.has('r1')).toBe(true);
    expect(bulletIds.has('r1')).toBe(false);
  });
});
