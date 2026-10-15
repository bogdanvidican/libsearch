import { describe, expect, it } from 'vitest';
import { parseQuery } from '../../src/server/query';

describe('parseQuery', () => {
  it('quotes every word and joins with AND', () => {
    const q = parseQuery('boil water');
    expect(q.all).toBe('"boil" AND "water"');
    expect(q.any).toBe('"boil" OR "water"');
    expect(q.terms).toEqual(['boil', 'water']);
  });

  it('drops stop-words but keeps them when nothing else is left', () => {
    expect(parseQuery('how do I set a broken arm').terms).toEqual(['set', 'broken', 'arm']);
    expect(parseQuery('the who').terms).toEqual(['the', 'who']);
  });

  it('keeps quoted phrases and prefixes', () => {
    const q = parseQuery('"rolling boil" purif*');
    expect(q.all).toBe('"rolling boil" AND "purif"*');
  });

  it('never produces FTS syntax from user input', () => {
    for (const input of ['NEAR(a b)', 'a OR', '-water', 'col:value', '"unclosed', '^start', 'a AND (b', '***', '"""']) {
      const q = parseQuery(input);
      if (q.all) expect(q.all).toMatch(/^("([^"]|"")*"\*?)( (AND|OR) "([^"]|"")*"\*?)*$/);
    }
  });

  it('returns nothing for punctuation-only input', () => {
    expect(parseQuery(' ?! - ').all).toBeNull();
    expect(parseQuery('').all).toBeNull();
  });

  it('keeps inner punctuation (3/4, o\'clock)', () => {
    expect(parseQuery('3/4 cup').terms).toEqual(['3/4', 'cup']);
  });
});
