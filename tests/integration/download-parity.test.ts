// The app's downloader and kit/2-download-pdf-books.sh, run on the same lists against the same local server,
// must save the same files and list the same failures (handoff §7 "Bash parity").
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadBooks } from '../../src/downloader/books';
import { loadState } from '../../src/downloader/state';

const REPO_KIT = path.join(__dirname, '..', '..', 'kit');
/** Files each side writes about the run itself, not books. */
const NOTES = ['library-search-downloads.json', 'booklist-local.txt', '2-download-log.txt', '2-failed-downloads.txt', '2-failed-downloads-open-in-firefox.html'];

let tmp: string;
let server: http.Server;
let base = '';

function copyDir(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const s = path.join(src, n);
    const d = path.join(dst, n);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function books(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const n of fs.readdirSync(path.join(dir, rel))) {
    const r = rel ? `${rel}/${n}` : n;
    if (fs.statSync(path.join(dir, r)).isDirectory()) out.push(...books(dir, r));
    else if (!rel && NOTES.indexOf(n) >= 0) continue;
    else out.push(`${r} ${fs.statSync(path.join(dir, r)).size}`);
  }
  return out.sort();
}

function runBash(script: string, lib: string, bin: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      LIBRARY_KIT_CHECK_URL: `${base}/`,
      LIBRARY_KIT_ARCHIVE_BASE: base,
    });
    const child = spawn('bash', [script, lib], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code: code === null ? -1 : code, out }));
  });
}

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-parity-')));
  server = http.createServer((req, res) => {
    const u = decodeURIComponent((req.url || '').split('?')[0]);
    if (u === '/') return res.end('ok');
    if (u === '/r') {
      res.writeHead(302, { Location: '/pdf/redirected.pdf' });
      return res.end();
    }
    if (u === '/403.pdf') {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (u === '/202.pdf') {
      res.writeHead(202);
      return res.end();
    }
    if (u.indexOf('/html/') === 0) return res.end('<!doctype html><html><body>Checking your browser…</body></html>');
    if (u === '/page.html') {
      return res.end(
        [
          `<a href="${base}/pdf/absolute.pdf">abs</a> <a href="/pdf/rooted.pdf">root</a>`,
          '<a href="relative.pdf">rel</a> <a href="My Book.pdf">space</a> <a href="get.pdf?id=1&amp;x=2">amp</a>',
          '<a href="blocked/403.pdf">blocked</a>',
        ].join('\n')
      );
    }
    if (u === '/empty-page.html') return res.end('<p>nothing</p>');
    if (u === '/hesperian/pages/en/pdf.html') return res.end('<a href="/files/en_x_2025/en_x_2025_01.pdf">1</a><a href="/files/en_x_2025/en_x_2025_02.pdf">2</a>');
    if (u === '/metadata/ITEM') return res.end(JSON.stringify({ files: [{ name: 'Module 01.pdf' }, { name: 'Module 01_text.pdf' }, { name: 'sub/Module 02.pdf' }] }));
    if (u === '/metadata/EMPTY') return res.end(JSON.stringify({ files: [] }));
    if (/\/403\.pdf$/.test(u)) {
      res.writeHead(403);
      return res.end();
    }
    if (/\.pdf$/.test(u)) return res.end(`%PDF-1.4\n%${u}\n` + 'x'.repeat(100));
    if (/\.epub$/.test(u)) return res.end('PK\u0003\u0004 epub');
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('app downloader vs 2-download-pdf-books.sh', () => {
  it('the app and 2-download-pdf-books.sh produce the same files and the same failure list', async () => {
    const kit = path.join(tmp, 'app', 'kit');
    copyDir(REPO_KIT, kit);
    fs.writeFileSync(
      path.join(kit, 'booklists', 'booklist-main.txt'),
      [
        '# parity test',
        `F|01 Medicine|Good.pdf|${base}/pdf/good.pdf`,
        `F|01 Medicine|Redirected.pdf|${base}/r`,
        `F|01 Medicine|Refused.pdf|${base}/403.pdf`,
        `F|01 Medicine|Empty.pdf|${base}/202.pdf`,
        `F|01 Medicine|Check.pdf|${base}/html/check.pdf`,
        `F|13 English|Book.epub|${base}/book.epub`,
        `S|02 Water & Sanitation/Pages|${base}/page.html|href="[^"]*\\.pdf[^"]*"`,
        `S|05 Survival|${base}/empty-page.html|href="[^"]*\\.pdf"`,
        `S|01 Medicine/Hesperian (chapters)|${base}/hesperian/pages/en/pdf.html|href="[^"]*\\.pdf"`,
        'A|09 Radio|ITEM',
        'A|09 Radio|EMPTY',
      ].join('\n') + '\n'
    );
    fs.writeFileSync(path.join(kit, 'booklists', 'booklist-linux.txt'), `F|16 Linux & Ubuntu|Linux.pdf|${base}/pdf/linux.pdf\n`);
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'firefox'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    const libs = ['bash', 'app'].map((side) => {
      const lib = path.join(tmp, side, 'Library & Co (parity)');
      fs.mkdirSync(path.join(lib, '01 Medicine'), { recursive: true });
      fs.writeFileSync(path.join(lib, 'booklist-local.txt'), `F|99 Mine|Local.pdf|${base}/pdf/local.pdf\n`);
      return lib;
    });

    const bash = await runBash(path.join(kit, '2-download-pdf-books.sh'), libs[0], bin);
    expect(bash.code, bash.out).toBe(0);
    const app = await downloadBooks(
      {
        library: libs[1],
        lists: [path.join(kit, 'booklists', 'booklist-main.txt'), path.join(kit, 'booklists', 'booklist-linux.txt'), path.join(libs[1], 'booklist-local.txt')],
        checkUrl: `${base}/`,
        archiveBase: base,
        minFreeMb: 0,
        stallMs: 5000,
      },
      { onProgress: () => undefined, isCancelled: () => false, log: () => undefined }
    );
    expect(app.phase).toBe('done');

    expect(books(libs[1])).toEqual(books(libs[0]));
    expect(books(libs[0]).length).toBeGreaterThan(12);
    const bashFailures = fs
      .readFileSync(path.join(libs[0], '2-failed-downloads.txt'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .sort();
    const appFailures = loadState(libs[1])
      .books.failures.map((f) => `${f.folder}|${f.file}|${f.url}`)
      .sort();
    expect(appFailures).toEqual(bashFailures);
    expect(appFailures.length).toBe(6);
  });
});
