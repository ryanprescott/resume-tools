import { describe, it, expect } from 'vitest';
import { alignCoverage, filterKnownIds } from '../../src/tailor/coverage.js';
import { filterKnownSuggestions } from '../../src/tailor/suggest.js';
import type { CoverageEntry, Suggestion } from '../../src/tailor/types.js';

describe('filterKnownIds', () => {
  it('strips fabricated evidence ids and leaves real ones untouched', () => {
    const coverage: CoverageEntry[] = [
      { requirement: 'Kubernetes', evidenceIds: ['r1b1', 'fake-id'], gap: false },
    ];
    const result = filterKnownIds(coverage, new Set(['r1b1']));
    expect(result[0].evidenceIds).toEqual(['r1b1']);
    expect(result[0].gap).toBe(false);
  });

  it('marks an entry as a gap when all its evidence ids are fabricated', () => {
    const coverage: CoverageEntry[] = [
      { requirement: 'Kubernetes', evidenceIds: ['fake-id'], gap: false },
    ];
    const result = filterKnownIds(coverage, new Set(['r1b1']));
    expect(result[0].evidenceIds).toEqual([]);
    expect(result[0].gap).toBe(true);
  });
});

function makeSuggestion(overrides: Partial<Suggestion>): Suggestion {
  return {
    targetId: 'r1b1',
    kind: 'rewrite',
    before: 'before',
    after: 'after',
    sourceIds: ['r1b1'],
    rationale: 'r',
    jdRef: 'jd',
    confidence: 0.5,
    ...overrides,
  };
}

describe('filterKnownSuggestions', () => {
  const knownIds = { bulletIds: new Set(['r1b1']), allIds: new Set(['r1b1', 'r1']) };

  it('keeps a suggestion whose targetId and sourceIds are all real', () => {
    const suggestions = [makeSuggestion({})];
    expect(filterKnownSuggestions(suggestions, knownIds)).toEqual(suggestions);
  });

  it('drops a suggestion whose targetId is fabricated', () => {
    const suggestions = [makeSuggestion({ targetId: 'fake-id' })];
    expect(filterKnownSuggestions(suggestions, knownIds)).toEqual([]);
  });

  it('drops a suggestion whose sourceIds reference a fabricated bullet', () => {
    const suggestions = [makeSuggestion({ sourceIds: ['fake-id'] })];
    expect(filterKnownSuggestions(suggestions, knownIds)).toEqual([]);
  });

  it('allows targetId to reference an entry id for promote/demote/reorder/drop', () => {
    const suggestions = [makeSuggestion({ targetId: 'r1', kind: 'promote' })];
    expect(filterKnownSuggestions(suggestions, knownIds)).toEqual(suggestions);
  });

  describe('with user-supplied facts', () => {
    const factIds = new Set(['u1']);

    it('accepts a fact id as a source', () => {
      const suggestions = [makeSuggestion({ sourceIds: ['u1'] })];
      expect(filterKnownSuggestions(suggestions, knownIds, factIds)).toEqual(suggestions);
    });

    it('still rejects a source id that is neither a bullet nor a fact', () => {
      const suggestions = [makeSuggestion({ sourceIds: ['u9'] })];
      expect(filterKnownSuggestions(suggestions, knownIds, factIds)).toEqual([]);
    });

    it('keeps an add that cites a fact', () => {
      const suggestions = [
        makeSuggestion({ targetId: 'r1', kind: 'add', before: '', sourceIds: ['u1'] }),
      ];
      expect(filterKnownSuggestions(suggestions, knownIds, factIds)).toEqual(suggestions);
    });

    it('drops an add sourced only from existing bullets — that is padding, not tailoring', () => {
      const suggestions = [
        makeSuggestion({ targetId: 'r1', kind: 'add', before: '', sourceIds: ['r1b1'] }),
      ];
      expect(filterKnownSuggestions(suggestions, knownIds, factIds)).toEqual([]);
    });

    it('drops an add whose targetId does not exist', () => {
      const suggestions = [
        makeSuggestion({ targetId: 'nope', kind: 'add', before: '', sourceIds: ['u1'] }),
      ];
      expect(filterKnownSuggestions(suggestions, knownIds, factIds)).toEqual([]);
    });
  });
});

describe('alignCoverage', () => {
  const entry = (requirement: string, evidenceIds: string[] = ['r1b1']): CoverageEntry => ({
    requirement,
    evidenceIds,
    gap: evidenceIds.length === 0,
  });

  it('turns every requirement the model skipped into a gap', () => {
    expect(alignCoverage(['Kubernetes', 'Rust'], [])).toEqual([
      { requirement: 'Kubernetes', evidenceIds: [], gap: true },
      { requirement: 'Rust', evidenceIds: [], gap: true },
    ]);
  });

  it('matches by text regardless of order, case or spacing', () => {
    const result = alignCoverage(['Kubernetes', 'Rust'], [entry('rust '), entry('kubernetes', [])]);
    expect(result.map((c) => [c.requirement, c.gap])).toEqual([
      ['Kubernetes', true],
      ['Rust', false],
    ]);
  });

  it('falls back to position for a paraphrase when every requirement was answered', () => {
    const result = alignCoverage(['5+ years of Go'], [entry('Five years of Go')]);
    expect(result).toEqual([{ requirement: '5+ years of Go', evidenceIds: ['r1b1'], gap: false }]);
  });

  it('does not trust position when the model answered only some requirements', () => {
    const result = alignCoverage(['Go', 'Rust'], [entry('Golang')]);
    expect(result.every((c) => c.gap)).toBe(true);
  });
});
