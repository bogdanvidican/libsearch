import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { cleanPageText, deriveTitle, headingFromHead, htmlToText, isGoodMetaTitle } from '../../src/indexer/text';
import { extractEpub } from '../../src/indexer/epub';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'library');

describe('text cleanup', () => {
  it('joins hyphenated line breaks and collapses spaces', () => {
    expect(cleanPageText('water purifi-\ncation   works\n\n\n\nwell')).toBe('water purification works\n\nwell');
  });

  it('converts XHTML to text without scripts/styles and decodes entities', () => {
    expect(htmlToText('<html><head><title>x</title></head><body><p>A &amp; B</p><script>no()</script><p>C&#233;</p></body></html>')).toBe(
      'A & B\n\nCé'
    );
  });
});

describe('titles', () => {
  it('rejects junk metadata titles', () => {
    expect(isGoodMetaTitle('ES-prelims.pmd')).toBe(false);
    expect(isGoodMetaTitle('Microsoft Word - draft.doc')).toBe(false);
    expect(isGoodMetaTitle('Building Soils for Better Crops')).toBe(true);
  });

  it('humanizes file names when metadata is missing', () => {
    expect(deriveTitle({ filename: 'Surgical_Care_at_the_District_Hospital_WHO.pdf' }).title).toBe(
      'Surgical Care at the District Hospital WHO'
    );
  });

  it('builds readable titles for Hesperian chapter PDFs', () => {
    const t = deriveTitle({
      filename: 'en_wtnd_2025_09.pdf',
      head: 'Where There Is No Doctor 2025\nInstructions and Precautions\nfor Injections\n9',
    });
    expect(t).toEqual({
      title: 'Instructions and Precautions for Injections',
      series: 'Where There Is No Doctor (2025) · Chapter 9',
    });
    expect(deriveTitle({ filename: 'en_wtnd_2025_toc.pdf', head: '' }).title).toBe('Where There Is No Doctor (2025) — Contents');
  });

  it('rejects generic metadata titles like "Subject:" and "Chapter 1"', () => {
    for (const t of ['Subject:', 'Chapter 1', 'Part Two-1', 'Index', 'Section 3.2']) expect(isGoodMetaTitle(t)).toBe(false);
    expect(isGoodMetaTitle('Chapter 12: Compost Toilets')).toBe(true);
  });

  it('names numbered parts after their folder', () => {
    expect(deriveTitle({ filename: 'mcga-shs_capt_guide_chap6.1.pdf', subfolder: 'Ship Captains Medical Guide' }).title).toBe(
      'Ship Captains Medical Guide — Chapter 6.1'
    );
    expect(deriveTitle({ filename: 'GUIDE02_HomeCan_rev0715.pdf', subfolder: 'USDA Home Canning Guide' }).title).toBe(
      'USDA Home Canning Guide — Guide 2'
    );
    expect(deriveTitle({ filename: 'Some_Book_2019.pdf', subfolder: 'Misc' }).title).toBe('Some Book 2019');
    expect(
      deriveTitle({ filename: 'NEETS Module 06 - Introduction to Electronic Emission.pdf', subfolder: 'NEETS Navy Electronics' }).title
    ).toBe('NEETS Module 06 - Introduction to Electronic Emission');
  });

  it('uses the part label for Hesperian contents/index pages', () => {
    expect(deriveTitle({ filename: 'en_wwhnd_2024_indx.pdf', head: 'Index 565\nabortion, 238' }).title).toBe(
      'Where Women Have No Doctor (2024) — Index'
    );
  });

  it('skips page numbers, chapter labels and dot leaders when picking a heading', () => {
    expect(headingFromHead('ch ap ter 5\nKeeping Clean')).toBe('Keeping Clean');
    expect(headingFromHead('Part Two-1\nWorking with Your Body')).toBe('Working with Your Body');
    expect(headingFromHead('196 Family Planning\nChapter 13\nIn this chapter:')).toBe('Family Planning');
    expect(headingFromHead('4-1\nGetting Off to a\nGood Start\nCHAPTER')).toBe('Getting Off to a Good Start');
    expect(headingFromHead('Chapter 1\nIn this chapter\nWhat is a seizure? . . . . . . . 5')).toBe('');
  });
});

describe('EPUB', () => {
  it('extracts chapters in spine order with the dc:title', () => {
    const e = extractEpub(path.join(FIXTURES, '07 Metalworking', 'Forge_Basics.epub'));
    expect(e.title).toBe('Forge Basics & Smithing');
    expect(e.pages).toHaveLength(2);
    expect(e.pages[1]).toContain('Forge welding joins two pieces of iron');
    expect(e.pages.join(' ')).not.toContain('scripts are not indexed');
  });
});
