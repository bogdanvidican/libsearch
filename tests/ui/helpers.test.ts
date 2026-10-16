import { describe, expect, it } from 'vitest';
import { HL_END, HL_START, KiwixBook, KiwixSearchResponse } from '../../src/shared/api';
import { applyBookResult, initKiwixResults, previewRows, totalFailed, totalPending, totalRows } from '../../src/ui/kiwix';
import { isSafeReaderPath, parseHash, Route, routeToHash } from '../../src/ui/router';
import { stripMarkers, toSegments } from '../../src/ui/snippet';

const hl = (s: string) => HL_START + s + HL_END;

describe('snippet markers', () => {
  it('splits text into plain and highlighted segments', () => {
    expect(toSegments('bring ' + hl('water') + ' to a ' + hl('boil') + '.')).toEqual([
      { text: 'bring ', hl: false },
      { text: 'water', hl: true },
      { text: ' to a ', hl: false },
      { text: 'boil', hl: true },
      { text: '.', hl: false },
    ]);
  });

  it('tolerates unbalanced and back-to-back markers', () => {
    expect(toSegments(HL_START + 'cut off')).toEqual([{ text: 'cut off', hl: true }]);
    expect(toSegments('tail' + HL_END + ' rest')).toEqual([{ text: 'tail rest', hl: false }]);
    expect(toSegments(hl('a') + hl('b'))).toEqual([{ text: 'ab', hl: true }]);
    expect(toSegments('')).toEqual([]);
  });

  it('never interprets HTML', () => {
    const segs = toSegments('<img src=x onerror=alert(1)> ' + hl('<b>'));
    expect(segs[0].text).toBe('<img src=x onerror=alert(1)> ');
    expect(segs[1]).toEqual({ text: '<b>', hl: true });
  });

  it('strips markers', () => {
    expect(stripMarkers('a ' + hl('b') + ' c')).toBe('a b c');
  });
});

function book(name: string, group: KiwixBook['group']): KiwixBook {
  return { name, title: name.toUpperCase(), description: '', language: 'eng', group, homeUrl: '/content/' + name + '/' };
}
function resp(name: string, titles: string[]): KiwixSearchResponse {
  return { book: name, tookMs: 1, results: titles.map((t) => ({ title: t, url: '/content/' + name + '/A/' + t, snippet: '' })) };
}

describe('kiwix streaming merge', () => {
  const wiki = book('wikipedia', 'reference');
  const med = book('wikimed', 'reference');
  const khan = book('khan', 'khan');
  const diy = book('diy', 'qa');

  it('groups books and counts pending requests', () => {
    const s = initKiwixResults([wiki, med, khan, diy]);
    expect(s.reference.books).toEqual(['wikipedia', 'wikimed']);
    expect(s.khan.books).toEqual(['khan']);
    expect(s.qa.books).toEqual(['diy']);
    expect(totalPending(s)).toBe(4);
  });

  it('appends answers in arrival order so shown rows never move', () => {
    let s = initKiwixResults([wiki, med]);
    s = applyBookResult(s, med, resp('wikimed', ['Water', 'Boiling']));
    const firstRows = s.reference.rows.slice();
    s = applyBookResult(s, wiki, resp('wikipedia', ['Water purification']));
    expect(s.reference.rows.slice(0, 2)).toEqual(firstRows);
    expect(s.reference.rows.map((r) => r.title)).toEqual(['Water', 'Boiling', 'Water purification']);
    expect(s.reference.rows[2].bookTitle).toBe('WIKIPEDIA');
    expect(s.reference.pending).toBe(0);
  });

  it('counts failures and errors without adding rows', () => {
    let s = initKiwixResults([wiki, khan]);
    s = applyBookResult(s, wiki, null);
    s = applyBookResult(s, khan, { book: 'khan', results: [], tookMs: 5, error: { kind: 'warning', code: 'timeout', message: 'slow' } });
    expect(totalFailed(s)).toBe(2);
    expect(totalRows(s)).toBe(0);
    expect(totalPending(s)).toBe(0);
  });

  it('ignores answers for books that are not part of this search', () => {
    const s = initKiwixResults([wiki]);
    expect(applyBookResult(s, med, resp('wikimed', ['x']))).toBe(s);
  });

  it('drops duplicate URLs', () => {
    let s = initKiwixResults([wiki]);
    s = applyBookResult(s, wiki, resp('wikipedia', ['A', 'A', 'B']));
    expect(s.reference.rows.map((r) => r.title)).toEqual(['A', 'B']);
  });

  it('previews at most N rows per book and M in total', () => {
    let s = initKiwixResults([wiki, med]);
    s = applyBookResult(s, med, resp('wikimed', ['m1', 'm2', 'm3', 'm4']));
    s = applyBookResult(s, wiki, resp('wikipedia', ['w1', 'w2', 'w3']));
    expect(previewRows(s.reference.rows, 2, 4).map((r) => r.title)).toEqual(['m1', 'm2', 'w1', 'w2']);
    expect(previewRows(s.reference.rows, 2, 3).map((r) => r.title)).toEqual(['m1', 'm2', 'w1']);
  });
});

describe('hash routing', () => {
  const roundTrip = (r: Route) => expect(parseHash(routeToHash(r))).toEqual(r);

  it('round-trips every route', () => {
    roundTrip({ name: 'home' });
    roundTrip({ name: 'search', q: 'boil water', f: 'all', c: '' });
    roundTrip({ name: 'search', q: 'fractions & decimals?', f: 'khan', c: '' });
    roundTrip({ name: 'search', q: 'splint', f: 'books', c: '01 Medicine' });
    roundTrip({ name: 'read', u: '/content/wikipedia_en_medicine_maxi/A/Water purification', t: 'Water purification' });
    roundTrip({ name: 'read', u: '/epub/12/OEBPS/ch3.xhtml', t: '' });
    roundTrip({ name: 'browse', folder: '' });
    roundTrip({ name: 'browse', folder: '02 Water & Sanitation' });
    roundTrip({ name: 'library' });
    roundTrip({ name: 'settings' });
  });

  it('falls back safely on bad input', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/search?q=')).toEqual({ name: 'home' });
    expect(parseHash('#/search?q=x&f=bogus')).toEqual({ name: 'search', q: 'x', f: 'all', c: '' });
    expect(parseHash('#/nope')).toEqual({ name: 'home' });
    expect(parseHash('#/browse/%E0%A4%A')).toEqual({ name: 'browse', folder: '%E0%A4%A' });
  });

  it('only lets same-origin library paths into the reader', () => {
    expect(isSafeReaderPath('/content/x/A/Y')).toBe(true);
    expect(isSafeReaderPath('/epub/3/a.xhtml')).toBe(true);
    expect(isSafeReaderPath('javascript:alert(1)')).toBe(false);
    expect(isSafeReaderPath('//evil.example/content/')).toBe(false);
    expect(isSafeReaderPath('https://example.com/content/')).toBe(false);
    expect(isSafeReaderPath('/api/open')).toBe(false);
    expect(parseHash('#/read?u=' + encodeURIComponent('javascript:alert(1)'))).toEqual({ name: 'home' });
  });
});
