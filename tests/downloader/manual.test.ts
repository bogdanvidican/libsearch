// The books to save by hand (kit/booklists/manual-downloads.txt): parsing, the README staying in step, and the ticks.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manualItems, parseManualList, setManualDone } from '../../src/downloader/manual';
import { loadState } from '../../src/downloader/state';

const KIT = path.join(__dirname, '..', '..', 'kit');
const LIST = path.join(KIT, 'booklists', 'manual-downloads.txt');

let tmp: string;

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-manual-')));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('parseManualList', () => {
  it('reads the fields; the note is the rest of the line', () => {
    const r = parseManualList(
      '﻿# c\r\nM|01 Medicine|A book (x)|https://ex.org/a?b=1&c=2|print-to-pdf|Menu | Print | Save\r\n',
      'm.txt'
    );
    expect(r.problems).toEqual([]);
    expect(r.items).toEqual([
      {
        id: 'M|01 Medicine|https://ex.org/a?b=1&c=2',
        folder: '01 Medicine',
        title: 'A book (x)',
        url: 'https://ex.org/a?b=1&c=2',
        how: 'print-to-pdf',
        note: 'Menu | Print | Save',
        line: 2,
      },
    ]);
  });

  it('reports a bad folder, a missing title, an address that is not http(s) and an unknown way to save', () => {
    const r = parseManualList(
      ['M|../x|T|https://ex.org/a|button|', 'M|01 A||https://ex.org/a|button|', 'M|01 A|T|ftp://ex.org/a|button|', 'M|01 A|T|https://ex.org/a|fax|'].join('\n'),
      'm.txt'
    );
    expect(r.items).toEqual([]);
    expect(r.problems.length).toBe(4);
  });

  it('the shipped list has every item once, without a problem', () => {
    const r = parseManualList(fs.readFileSync(LIST, 'utf8'), 'manual-downloads.txt');
    expect(r.problems).toEqual([]);
    expect(r.items.length).toBe(38);
    expect(new Set(r.items.map((i) => i.id)).size).toBe(38);
  });

  it('is in step with the manual download sections of the kit guide', () => {
    const readme = fs.readFileSync(path.join(KIT, '0-README-start-here.md'), 'utf8');
    const section = readme.slice(readme.indexOf('## 3. Manual downloads in Firefox'), readme.indexOf('## Khan Academy'));
    expect(section.length).toBeGreaterThan(1000);
    const inGuide = (section.match(/https?:\/\/[^\s)]+/g) || []).sort();
    const inList = parseManualList(fs.readFileSync(LIST, 'utf8'), 'm').items.map((i) => i.url).sort();
    expect(inList).toEqual(inGuide);
  });
});

describe('manualItems', () => {
  function setup(): { root: string; list: string } {
    const root = path.join(tmp, 'lib-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(path.join(root, '01 Medicine'), { recursive: true });
    const list = path.join(root, '..', path.basename(root) + '-manual.txt');
    fs.writeFileSync(
      list,
      ['M|01 Medicine|Where There Is No Vet (Oxfam)|https://ex.org/vet|button|6 parts', 'M|04 Food Preservation|FAO Grain Storage|https://ex.org/grain|print-to-pdf|'].join('\n')
    );
    return { root, list };
  }

  it('ticks an item by itself when a file with its title words is in the folder', () => {
    const s = setup();
    fs.writeFileSync(path.join(s.root, '01 Medicine', 'Where_There_Is_No_Vet_part1.pdf'), '%PDF');
    const items = manualItems(s.list, [s.root], loadState(s.root));
    expect(items.map((i) => [i.title, i.done, i.auto])).toEqual([
      ['Where There Is No Vet (Oxfam)', false, true],
      ['FAO Grain Storage', false, false],
    ]);
  });

  it('remembers ticks in the library folder, and can untick', () => {
    const s = setup();
    setManualDone(s.root, 'M|04 Food Preservation|https://ex.org/grain', true);
    expect(manualItems(s.list, [s.root], loadState(s.root))[1].done).toBe(true);
    expect(loadState(s.root).manualDone).toEqual(['M|04 Food Preservation|https://ex.org/grain']);
    setManualDone(s.root, 'M|04 Food Preservation|https://ex.org/grain', false);
    expect(manualItems(s.list, [s.root], loadState(s.root))[1].done).toBe(false);
  });
});
