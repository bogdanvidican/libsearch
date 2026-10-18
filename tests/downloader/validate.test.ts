// What counts as a real book file (bot-check pages and empty answers don't), as kit/2-download-pdf-books.sh checks.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { isValidContent, isValidFile } from '../../src/downloader/validate';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'library');

describe('isValidContent', () => {
  it('a PDF must say %PDF in its first 1024 bytes', () => {
    expect(isValidContent('a.pdf', Buffer.from('%PDF-1.4\n...'))).toBe(true);
    expect(isValidContent('a.pdf.part', Buffer.from('\n\n%PDF-1.7'))).toBe(true);
    expect(isValidContent('A.PDF', Buffer.from('%PDF-1.4'))).toBe(true);
    expect(isValidContent('a.pdf', Buffer.from('<html><body>Please verify you are human</body></html>'))).toBe(false);
    expect(isValidContent('a.pdf', Buffer.alloc(0))).toBe(false);
    expect(isValidContent('a.pdf', Buffer.concat([Buffer.alloc(1100, 32), Buffer.from('%PDF')]))).toBe(false);
  });

  it('an EPUB must start with PK', () => {
    expect(isValidContent('b.epub', Buffer.from('PK\u0003\u0004rest'))).toBe(true);
    expect(isValidContent('b.epub', Buffer.from('<html>no</html>'))).toBe(false);
  });

  it('anything else must not be a web page', () => {
    expect(isValidContent('c.txt', Buffer.from('plain text'))).toBe(true);
    expect(isValidContent('c.djvu', Buffer.from('<!doctype html><HTML>'))).toBe(false);
  });
});

describe('isValidFile', () => {
  it('reads the start of real files', () => {
    expect(isValidFile(path.join(FIXTURES, '01 Medicine', 'First_Aid_Basics.pdf'))).toBe(true);
    expect(isValidFile(path.join(FIXTURES, '07 Metalworking', 'Forge_Basics.epub'))).toBe(true);
    expect(isValidFile(path.join(FIXTURES, '02 Water & Sanitation', 'Blocked_Download.pdf'))).toBe(false);
    expect(isValidFile(path.join(os.tmpdir(), 'no-such-file-' + Date.now() + '.pdf'))).toBe(false);
    const empty = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-val-')), 'e.pdf');
    fs.writeFileSync(empty, '');
    expect(isValidFile(empty)).toBe(false);
  });
});
