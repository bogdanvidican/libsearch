// The books job: everything on the lists into the library folder, against a local stand-in for the internet.
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DownloadProgress } from '../../src/shared/api';
import { BooksJob, downloadBooks } from '../../src/downloader/books';
import { loadState, STATE_FILE, updateState } from '../../src/downloader/state';

let tmp: string;
let server: http.Server;
let base = '';
let closedBase = '';
const hits: Record<string, number> = {};
const ranges: Record<string, string | undefined> = {};
let caseNo = 0;

function pdf(name: string): string {
  return `%PDF-1.4\n%${name}\n` + 'x'.repeat(200);
}

function listen(handler: http.RequestListener): Promise<{ server: http.Server; base: string }> {
  const s = http.createServer(handler);
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({ server: s, base: `http://127.0.0.1:${(s.address() as { port: number }).port}` })));
}

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-books-')));
  const closed = await listen(() => undefined);
  closedBase = closed.base;
  await new Promise((r) => closed.server.close(r));
  const s = await listen((req, res) => {
    const u = decodeURIComponent((req.url || '').split('?')[0]);
    hits[u] = (hits[u] || 0) + 1;
    ranges[u] = req.headers.range as string | undefined;
    if (u === '/') return res.end('ok');
    if (u === '/403' || u.indexOf('/403/') === 0) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (u === '/202.pdf') {
      res.writeHead(202);
      return res.end();
    }
    if (u.indexOf('/html/') === 0) return res.end('<!doctype html><html><body>Checking your browser…</body></html>');
    if (u === '/page.html') return res.end('<p><a href="a.pdf">A</a></p>\n<p><a href="/pdf/b.pdf">B</a> <a href="notes.txt">no</a></p>');
    if (u === '/empty-page.html') return res.end('<p>Nothing to download here</p>');
    if (u === '/hesperian/pages/en/pdf.html') return res.end('<a href="/files/en_x_2025/en_x_2025_01.pdf">ch 1</a>');
    if (u === '/metadata/ITEM') {
      return res.end(JSON.stringify({ files: [{ name: 'Module 01.pdf' }, { name: 'Module 01_text.pdf' }, { name: 'sub/Module 02.pdf' }] }));
    }
    if (u === '/slow.pdf') {
      const body = Buffer.from(pdf('slow') + 'y'.repeat(4000));
      const m = /^bytes=(\d+)-$/.exec(String(req.headers.range || ''));
      const from = m ? Number(m[1]) : 0;
      res.writeHead(m ? 206 : 200, m ? { 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}`, 'Content-Length': body.length - from } : { 'Content-Length': body.length });
      let at = from;
      const t = setInterval(() => {
        if (res.destroyed) return clearInterval(t);
        const next = Math.min(body.length, at + 200);
        res.write(body.slice(at, next));
        at = next;
        if (at >= body.length) {
          clearInterval(t);
          res.end();
        }
      }, 20);
      res.on('close', () => clearInterval(t));
      return;
    }
    if (/\.pdf$/.test(u)) return res.end(pdf(u));
    if (/\.epub$/.test(u)) return res.end('PK\u0003\u0004epub');
    res.writeHead(404);
    res.end();
  });
  server = s.server;
  base = s.base;
});

afterAll(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Case {
  lib: string;
  run: (opts?: Partial<BooksJob>, cancelAt?: (p: DownloadProgress) => boolean) => Promise<DownloadProgress>;
}

function newCase(lines: string[]): Case {
  const root = path.join(tmp, `case-${++caseNo}`);
  const lib = path.join(root, 'Library & Co (test)');
  fs.mkdirSync(path.join(lib, '01 Medicine'), { recursive: true });
  const list = path.join(root, 'booklist-main.txt');
  fs.writeFileSync(list, lines.join('\n') + '\n');
  return {
    lib,
    run: (opts = {}, cancelAt) => {
      let cancel = false;
      const job: BooksJob = { library: lib, lists: [list], checkUrl: `${base}/`, archiveBase: base, minFreeMb: 0, stallMs: 5000, ...opts };
      return downloadBooks(job, {
        onProgress: (p) => {
          if (cancelAt && cancelAt(p)) cancel = true;
        },
        isCancelled: () => cancel,
        log: () => undefined,
      });
    },
  };
}

function head(file: string): string {
  return fs.readFileSync(file, 'utf8').slice(0, 4);
}

describe('downloadBooks', () => {
  it('downloads F, S (with Hesperian sub-folders) and A entries into the library', async () => {
    const c = newCase([
      `F|01 Medicine|F1.pdf|${base}/pdf/f1.pdf`,
      `F|13 English|Book.epub|${base}/b.epub`,
      `S|02 Water & Sanitation/Sub|${base}/page.html|href="[^"]*\\.pdf"`,
      `S|01 Medicine/Hesperian (chapters)|${base}/hesperian/pages/en/pdf.html|href="[^"]*\\.pdf"`,
      'A|09 Radio|ITEM',
    ]);
    const p = await c.run();
    expect(p.phase).toBe('done');
    for (const f of [
      '01 Medicine/F1.pdf',
      '02 Water & Sanitation/Sub/a.pdf',
      '02 Water & Sanitation/Sub/b.pdf',
      '01 Medicine/Hesperian (chapters)/en_x_2025/en_x_2025_01.pdf',
      '09 Radio/Module 01.pdf',
      '09 Radio/Module 02.pdf',
    ]) {
      expect(head(path.join(c.lib, f)), f).toBe('%PDF');
    }
    expect(head(path.join(c.lib, '13 English/Book.epub')).slice(0, 2)).toBe('PK');
    expect(fs.existsSync(path.join(c.lib, '09 Radio/Module 01_text.pdf'))).toBe(false);
    expect(p.downloaded).toBe(7);
    expect(p.failed).toBe(0);
    expect(p.running).toBe(false);
  });

  it('skips books that are already there and valid, without a request', async () => {
    const c = newCase([`F|01 Medicine|Have.pdf|${base}/pdf/have.pdf`]);
    fs.writeFileSync(path.join(c.lib, '01 Medicine/Have.pdf'), pdf('mine'));
    const p = await c.run();
    expect(hits['/pdf/have.pdf']).toBeUndefined();
    expect(p.skipped).toBe(1);
    expect(fs.readFileSync(path.join(c.lib, '01 Medicine/Have.pdf'), 'utf8')).toBe(pdf('mine'));
  });

  it('sets an HTML file named .pdf aside, downloads it again, and keeps a valid book when the new download fails', async () => {
    const c = newCase([
      `F|01 Medicine|Fixed.pdf|${base}/pdf/fixed.pdf`,
      `F|01 Medicine|Good.pdf|${base}/403/good.pdf`,
      `F|01 Medicine|Junk.pdf|${base}/403/junk.pdf`,
    ]);
    const med = path.join(c.lib, '01 Medicine');
    fs.writeFileSync(path.join(med, 'Fixed.pdf'), '<html>bot check</html>');
    fs.writeFileSync(path.join(med, 'Good.pdf'), pdf('good'));
    fs.writeFileSync(path.join(med, 'Junk.pdf'), '<html>bot check</html>');
    fs.writeFileSync(path.join(med, 'Good.pdf.part'), 'leftover');
    const p = await c.run();
    expect(head(path.join(med, 'Fixed.pdf'))).toBe('%PDF');
    expect(fs.readFileSync(path.join(med, 'Good.pdf'), 'utf8')).toBe(pdf('good'));
    expect(hits['/403/good.pdf']).toBeUndefined();
    expect(fs.existsSync(path.join(med, 'Junk.pdf'))).toBe(false);
    expect(fs.readdirSync(med).filter((n) => /\.bad$/.test(n))).toEqual([]);
    expect(p.failed).toBe(1);
  });

  it('records 403, 202-empty, bot-check HTML and empty scrape pages as failures with reasons', async () => {
    const c = newCase([
      `F|01 Medicine|Refused.pdf|${base}/403`,
      `F|01 Medicine|Empty.pdf|${base}/202.pdf`,
      `F|01 Medicine|Check.pdf|${base}/html/check.pdf`,
      `S|05 Survival|${base}/empty-page.html|href="[^"]*\\.pdf"`,
    ]);
    const p = await c.run();
    expect(p.phase).toBe('done');
    expect(p.failed).toBe(4);
    const failures = loadState(c.lib).books.failures;
    expect(failures.map((f) => `${f.folder}|${f.file}|${f.url}|${f.code}`).sort()).toEqual(
      [
        `01 Medicine|Refused.pdf|${base}/403|http-403`,
        `01 Medicine|Empty.pdf|${base}/202.pdf|empty`,
        `01 Medicine|Check.pdf|${base}/html/check.pdf|not-a-book`,
        `05 Survival|(page)|${base}/empty-page.html|no-links`,
      ].sort()
    );
    for (const f of failures) expect(f.reason.length).toBeGreaterThan(10);
    expect(fs.readdirSync(path.join(c.lib, '01 Medicine'))).toEqual([]);
  });

  it('says "offline" when the check address can\'t be reached, and downloads nothing', async () => {
    const c = newCase([`F|01 Medicine|F1.pdf|${base}/pdf/off.pdf`]);
    const p = await c.run({ checkUrl: `${closedBase}/` });
    expect(p.phase).toBe('failed');
    expect(p.notice && p.notice.code).toBe('downloads-offline');
    expect(hits['/pdf/off.pdf']).toBeUndefined();
  });

  it('refuses to start when the disk is too full', async () => {
    const c = newCase([`F|01 Medicine|F1.pdf|${base}/pdf/full.pdf`]);
    const p = await c.run({ minFreeMb: 1e9 });
    expect(p.phase).toBe('failed');
    expect(p.notice && p.notice.code).toBe('downloads-disk-full');
    expect(hits['/pdf/full.pdf']).toBeUndefined();
  });

  it('stops on cancel and the next run resumes the .part', async () => {
    const c = newCase([`F|01 Medicine|Slow.pdf|${base}/slow.pdf`]);
    const first = await c.run({}, (p) => p.fileReceived >= 600);
    expect(first.phase).toBe('cancelled');
    const part = path.join(c.lib, '01 Medicine/Slow.pdf.part');
    const kept = fs.statSync(part).size;
    expect(kept).toBeGreaterThanOrEqual(600);
    const second = await c.run();
    expect(second.phase).toBe('done');
    expect(ranges['/slow.pdf']).toBe(`bytes=${kept}-`);
    expect(head(path.join(c.lib, '01 Medicine/Slow.pdf'))).toBe('%PDF');
    expect(fs.existsSync(part)).toBe(false);
  });

  it('remembers which files a page or archive item produced', async () => {
    const c = newCase([`S|02 Water/Sub|${base}/page.html|href="[^"]*\\.pdf"`, 'A|09 Radio|ITEM']);
    await c.run();
    const col = loadState(c.lib).books.collections;
    expect(col[`S|02 Water/Sub|${base}/page.html`]).toEqual(['02 Water/Sub/a.pdf', '02 Water/Sub/b.pdf']);
    expect(col['A|09 Radio|ITEM']).toEqual(['09 Radio/Module 01.pdf', '09 Radio/Module 02.pdf']);
    expect(fs.existsSync(path.join(c.lib, STATE_FILE))).toBe(true);
  });

  it('leaves books marked as saved by hand alone', async () => {
    const c = newCase([`F|01 Medicine|ByHand.pdf|${base}/403/byhand.pdf`]);
    updateState(c.lib, (s) => {
      s.books.done.push('01 Medicine|ByHand.pdf');
    });
    const p = await c.run();
    expect(hits['/403/byhand.pdf']).toBeUndefined();
    expect(p.skipped).toBe(1);
    expect(p.failed).toBe(0);
  });
});
