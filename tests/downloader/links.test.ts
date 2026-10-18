// Link rules ported from kit/2-download-pdf-books.sh (resolve, file names, Hesperian folders, archive.org items).
import { describe, expect, it } from 'vitest';
import { archivePdfNames, fileNameFromUrl, resolveLink, scrapeFolder, scrapeLinks } from '../../src/downloader/links';

const PAGE = 'https://site.org/books/list/index.html?x=1';

describe('resolveLink', () => {
  it('keeps absolute links, and completes //, / and relative ones like script 2', () => {
    expect(resolveLink(PAGE, 'http://other.org/a.pdf')).toBe('http://other.org/a.pdf');
    expect(resolveLink(PAGE, 'https://other.org/a.pdf')).toBe('https://other.org/a.pdf');
    expect(resolveLink(PAGE, '//cdn.org/a.pdf')).toBe('https://cdn.org/a.pdf');
    expect(resolveLink(PAGE, '/files/a.pdf')).toBe('https://site.org/files/a.pdf');
    expect(resolveLink(PAGE, 'a.pdf')).toBe('https://site.org/books/list/a.pdf');
    expect(resolveLink(PAGE, '../up/a.pdf')).toBe('https://site.org/books/list/../up/a.pdf'); // not normalized, as bash
  });

  it('decodes &amp; and turns spaces into %20', () => {
    expect(resolveLink(PAGE, 'get.php?id=1&amp;f=My Book.pdf')).toBe('https://site.org/books/list/get.php?id=1&f=My%20Book.pdf');
  });
});

describe('scrapeLinks', () => {
  it('finds every match line by line, strips href="…", and returns them sorted without duplicates', () => {
    const html = [
      '<a href="b.pdf">B</a> <a href="a.pdf">A</a>',
      '<a href="a.pdf">again</a><a href="x.htm">no</a>',
      '<a href="c', 'd.pdf">split over lines - not a match, as grep</a>',
    ].join('\n');
    expect(scrapeLinks(html, 'href="[^"]*\\.pdf"')).toEqual(['a.pdf', 'b.pdf']);
  });

  it('works with the regexes the lists use', () => {
    expect(scrapeLinks('<a href="/images/x/y.pdf">', 'href="/images/[^"]*\\.pdf"')).toEqual(['/images/x/y.pdf']);
    expect(scrapeLinks('<a href="z.pdf?download=1">', 'href="[^"]*\\.pdf[^"]*"')).toEqual(['z.pdf?download=1']);
  });
});

describe('file names', () => {
  it('uses the last path segment without the query, %20 as _, and adds .pdf when missing', () => {
    expect(fileNameFromUrl('https://e.org/a/My%20Book.pdf?x=1#p')).toBe('My_Book.pdf');
    expect(fileNameFromUrl('https://e.org/a/Book.PDF')).toBe('Book.PDF');
    expect(fileNameFromUrl('https://e.org/get/12345')).toBe('12345.pdf');
  });

  it('puts Hesperian chapters into a folder named after their parent folder', () => {
    const hes = 'https://languages.hesperian.org/pages/en/pdf.html';
    expect(scrapeFolder('01 Medicine/Hesperian (chapters)', hes, 'https://h.org/files/en_wtnd_2025/en_wtnd_2025_01.pdf?v=2')).toBe(
      '01 Medicine/Hesperian (chapters)/en_wtnd_2025'
    );
    expect(scrapeFolder('08 Electrical', 'https://ibiblio.org/x/index.html', 'https://ibiblio.org/x/DC/a.pdf')).toBe('08 Electrical');
  });
});

describe('archivePdfNames', () => {
  it('lists the PDFs of an archive.org item without the _text.pdf copies', () => {
    const json = JSON.stringify({
      files: [{ name: 'Module 01.pdf' }, { name: 'Module 01_text.pdf' }, { name: 'sub/Module 02.pdf' }, { name: 'cover.jpg' }],
      metadata: { title: 'NEETS' },
    });
    expect(archivePdfNames(json)).toEqual(['Module 01.pdf', 'sub/Module 02.pdf']);
    expect(archivePdfNames('not json')).toEqual([]);
  });
});
