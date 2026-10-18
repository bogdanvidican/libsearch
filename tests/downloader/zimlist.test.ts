// The encyclopedia list (kit/booklists/encyclopedias.txt) and picking the newest file from the Kiwix mirror's listing.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { newestZimFile, parseZimList } from '../../src/downloader/zimlist';

const LIST = path.join(__dirname, '..', '..', 'kit', 'booklists', 'encyclopedias.txt');

describe('parseZimList', () => {
  it('reads the fields; the title is the rest of the line', () => {
    const r = parseZimList('﻿# c\r\nZ|wikipedia|wikipedia_en_medicine_maxi_|2|yes|WikiMed | medicine\r\n', 'e.txt');
    expect(r.problems).toEqual([]);
    expect(r.entries).toEqual([
      { id: 'wikipedia_en_medicine_maxi_', dir: 'wikipedia', prefix: 'wikipedia_en_medicine_maxi_', approxGb: 2, defaultOn: true, title: 'WikiMed | medicine', line: 2 },
    ]);
  });

  it('reports a bad mirror folder, prefix, size or yes/no', () => {
    const r = parseZimList(
      ['Z|../x|a_|1|yes|T', 'Z|wikipedia|no-underscore|1|yes|T', 'Z|wikipedia|a_|lots|yes|T', 'Z|wikipedia|a_|1|maybe|T', 'Z|wikipedia|a_|1|no|'].join('\n'),
      'e.txt'
    );
    expect(r.entries).toEqual([]);
    expect(r.problems.length).toBe(5);
  });

  it("the shipped list has script 3's twenty encyclopedias, plus the two big ones", () => {
    const r = parseZimList(fs.readFileSync(LIST, 'utf8'), 'encyclopedias.txt');
    expect(r.problems).toEqual([]);
    expect(r.entries.length).toBe(22);
    expect(r.entries.filter((e) => e.defaultOn).length).toBe(20);
    const khan = r.entries.filter((e) => e.prefix === 'khanacademy_en_all_')[0];
    expect(khan).toMatchObject({ dir: 'other', approxGb: 168, defaultOn: false });
  });
});

describe('newestZimFile', () => {
  const listing = [
    '<a href="wikipedia_en_medicine_maxi_2024-12.zim">wikipedia_en_medicine_maxi_2024-12.zim</a>  2024-12-10 08:32  2.1G',
    '<a href="wikipedia_en_medicine_maxi_2026-01.zim">wikipedia_en_medicine_maxi_2026-01.zim</a>  2026-01-11 08:32  2.2G',
    '<a href="wikipedia_en_medicine_maxi_2025-06.zim">wikipedia_en_medicine_maxi_2025-06.zim</a>  2025-06-02 08:32  2.2G',
    '<a href="wikipedia_en_medicine_nopic_2026-02.zim">wikipedia_en_medicine_nopic_2026-02.zim</a>  2026-02-01 08:32  0.9G',
  ].join('\n');

  it('picks the newest file that starts with the prefix', () => {
    expect(newestZimFile(listing, 'wikipedia_en_medicine_maxi_')).toBe('wikipedia_en_medicine_maxi_2026-01.zim');
    expect(newestZimFile(listing, 'wikipedia_en_medicine_nopic_')).toBe('wikipedia_en_medicine_nopic_2026-02.zim');
  });

  it('returns null when the mirror has none, and treats dots in the prefix literally', () => {
    expect(newestZimFile(listing, 'khanacademy_en_all_')).toBeNull();
    expect(newestZimFile('<a href="diyXstackexchangeXcom_en_all_2025-01.zim">', 'diy.stackexchange.com_en_all_')).toBeNull();
  });
});
