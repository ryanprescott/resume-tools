import { describe, it, expect } from 'vitest';
import {
  FactStore,
  markUsed,
  mintFactId,
  parseFacts,
  serializeFacts,
  type Fact,
} from '../../src/tailor/facts.js';

describe('parseFacts', () => {
  it('reads id and used markers off a fact line', () => {
    const facts = parseFacts(
      '# Facts\n\n- Ran the K8s migration  <!--id:u3-->  <!--used:acme,beta-->\n',
    );
    expect(facts).toEqual([{ id: 'u3', text: 'Ran the K8s migration', usedIn: ['acme', 'beta'] }]);
  });

  it('mints an id for a line you hand-added without one', () => {
    const facts = parseFacts('- Hold AWS SAA, 2024\n');
    expect(facts).toEqual([{ id: 'u1', text: 'Hold AWS SAA, 2024', usedIn: [] }]);
  });

  it('ignores prose and blank lines around the list', () => {
    const facts = parseFacts('# Facts\n\nSome explanation here.\n\n- One  <!--id:u1-->\n\n');
    expect(facts).toHaveLength(1);
  });

  it('renumbers a duplicated id rather than dropping the fact', () => {
    const facts = parseFacts('- One  <!--id:u1-->\n- Two  <!--id:u1-->\n');
    expect(facts.map((f) => f.id)).toEqual(['u1', 'u2']);
    expect(facts.map((f) => f.text)).toEqual(['One', 'Two']);
  });

  it('round-trips through serializeFacts', () => {
    const facts: Fact[] = [
      { id: 'u1', text: 'One', usedIn: [] },
      { id: 'u4', text: 'Two', usedIn: ['acme'] },
    ];
    expect(parseFacts(serializeFacts(facts))).toEqual(facts);
  });
});

describe('mintFactId', () => {
  it('fills the first free slot rather than continuing past a gap', () => {
    const facts: Fact[] = [
      { id: 'u1', text: 'a', usedIn: [] },
      { id: 'u3', text: 'b', usedIn: [] },
    ];
    expect(mintFactId(facts)).toBe('u2');
  });

  it('starts at u1 with nothing on file', () => {
    expect(mintFactId([])).toBe('u1');
  });
});

describe('FactStore', () => {
  it('does not reissue an id already handed out this run', () => {
    const store = new FactStore([{ id: 'u1', text: 'existing', usedIn: [] }]);
    const first = store.add('one');
    const second = store.add('two');
    expect([first.id, second.id]).toEqual(['u2', 'u3']);
  });

  it('separates facts captured this run from those loaded from disk', () => {
    const store = new FactStore([{ id: 'u1', text: 'existing', usedIn: [] }]);
    store.add('fresh');
    expect(store.all()).toHaveLength(2);
    expect(store.added().map((f) => f.text)).toEqual(['fresh']);
  });

  it('trims what it stores', () => {
    const store = new FactStore();
    expect(store.add('  padded  ').text).toBe('padded');
  });
});

describe('markUsed', () => {
  it('tags only the cited facts and does not duplicate an existing tag', () => {
    const facts: Fact[] = [
      { id: 'u1', text: 'a', usedIn: ['acme'] },
      { id: 'u2', text: 'b', usedIn: [] },
    ];
    const result = markUsed(facts, new Set(['u1', 'u2']), 'acme');
    expect(result[0].usedIn).toEqual(['acme']);
    expect(result[1].usedIn).toEqual(['acme']);
  });
});
