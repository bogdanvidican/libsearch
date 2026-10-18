// Book lists (F/S/A lines), read the way kit/2-download-pdf-books.sh reads them.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { entryId, parseBookList } from '../../src/downloader/booklist';

const LISTS = path.join(__dirname, '..', '..', 'kit', 'booklists');

describe('parseBookList', () => {
  it('reads F, S and A lines; the last field is the rest of the line', () => {
    const r = parseBookList(
      [
        '# comment',
        '',
        'F|02 Water & Sanitation/Sub, folder (x)|Main_Book.pdf|https://ex.org/a%20(1).pdf?a=1&b=2|x',
        'S|01 Medicine/Hesperian (chapters)|https://languages.hesperian.org/pages/en/pdf.html|href="[^"]*\\.pdf"',
        'A|09 Communications & Radio|FM_24-18_Tactical',
        'X|01 Medicine|ignored|https://ex.org/x.pdf',
      ].join('\n'),
      'test.txt'
    );
    expect(r.problems).toEqual([]);
    expect(r.entries.map((e) => [e.type, e.folder, e.a, e.b, e.line])).toEqual([
      ['F', '02 Water & Sanitation/Sub, folder (x)', 'Main_Book.pdf', 'https://ex.org/a%20(1).pdf?a=1&b=2|x', 3],
      ['S', '01 Medicine/Hesperian (chapters)', 'https://languages.hesperian.org/pages/en/pdf.html', 'href="[^"]*\\.pdf"', 4],
      ['A', '09 Communications & Radio', 'FM_24-18_Tactical', '', 5],
    ]);
  });

  it('strips a byte order mark and Windows line ends', () => {
    const r = parseBookList('﻿F|99 Mine|A.pdf|https://ex.org/a.pdf\r\nF|99 Mine|B.pdf|https://ex.org/b.pdf\r\n', 'l.txt');
    expect(r.entries.map((e) => e.a + ' ' + e.b)).toEqual(['A.pdf https://ex.org/a.pdf', 'B.pdf https://ex.org/b.pdf']);
  });

  it('reports folders that would land outside the library, and skips those lines', () => {
    const r = parseBookList(
      ['F|../evil|x.pdf|https://ex.org/x.pdf', 'F|/etc|x.pdf|https://ex.org/x.pdf', 'F|My Books|x.pdf|https://ex.org/x.pdf', 'F||x.pdf|https://ex.org/x.pdf', 'F|01 A/../../b|x.pdf|https://ex.org/x.pdf'].join('\n'),
      'local.txt'
    );
    expect(r.entries).toEqual([]);
    expect(r.problems.length).toBe(5);
    expect(r.problems[0]).toMatch(/^local\.txt:1: /);
  });

  it('reports a file name with a slash and an address that is not http(s)', () => {
    const r = parseBookList(['F|01 Medicine|a/b.pdf|https://ex.org/x.pdf', 'F|01 Medicine|b.pdf|ftp://ex.org/x.pdf', 'S|01 Medicine|https://ex.org/p|('].join('\n'), 'l');
    expect(r.entries).toEqual([]);
    expect(r.problems.length).toBe(3);
  });

  it('refuses . and .. as file names (they would point at a folder)', () => {
    const r = parseBookList(['F|01 Medicine|..|https://ex.org/x.pdf', 'F|01 Medicine|.|https://ex.org/x.pdf', 'A|01 Medicine|..'].join('\n'), 'local.txt');
    expect(r.entries).toEqual([]);
    expect(r.problems.length).toBe(3);
  });

  it('gives each entry a stable id', () => {
    const [f, s, a] = parseBookList('F|01 M|x.pdf|https://e/x.pdf\nS|01 M|https://e/p|re\nA|01 M|item', 'l').entries;
    expect([entryId(f), entryId(s), entryId(a)]).toEqual(['01 M|x.pdf', 'S|01 M|https://e/p', 'A|01 M|item']);
  });

  it('reads the lists that ship with the app without a problem', () => {
    const main = parseBookList(fs.readFileSync(path.join(LISTS, 'booklist-main.txt'), 'utf8'), 'booklist-main.txt');
    expect(main.problems).toEqual([]);
    expect(main.entries.filter((e) => e.type === 'F').length).toBe(229);
    expect(main.entries.filter((e) => e.type === 'S').length).toBe(13);
    expect(main.entries.filter((e) => e.type === 'A').length).toBe(3);
    expect(parseBookList(fs.readFileSync(path.join(LISTS, 'booklist-linux.txt'), 'utf8'), 'l').problems).toEqual([]);
  });
});
