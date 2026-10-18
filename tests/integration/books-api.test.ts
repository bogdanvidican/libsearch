// Library -> Get books through the server API, with the real downloader process (bundled into a temp file).
import { fork } from 'child_process';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../src/server/app';
import { resolveConfig } from '../../src/server/config';

const REPO = path.join(__dirname, '..', '..');
const token = 't';

let tmp: string;
let downloader: string;
let site: http.Server;
let siteBase = '';
const ranges: Record<string, string | undefined> = {};
const opened: string[] = [];

function pdf(name: string): string {
  return `%PDF-1.4\n%${name}\n` + 'x'.repeat(100);
}

/** An installed app at <tmp>/apps/<name>/dist/library-search-linux-ia32/resources/app with its own book lists. */
function installedApp(name: string, main: string[]): string {
  const appDir = path.join(tmp, 'apps', name, 'dist', 'library-search-linux-ia32', 'resources', 'app');
  const lists = path.join(appDir, 'kit', 'booklists');
  fs.mkdirSync(lists, { recursive: true });
  fs.writeFileSync(path.join(lists, 'booklist-main.txt'), main.join('\n') + '\n');
  fs.copyFileSync(path.join(REPO, 'kit', 'booklists', 'booklist-local-template.txt'), path.join(lists, 'booklist-local-template.txt'));
  fs.writeFileSync(
    path.join(lists, 'manual-downloads.txt'),
    'M|01 Medicine|Where There Is No Vet (Oxfam)|https://example.org/vet|button|6 parts\nM|04 Food|FAO Grain Storage|https://example.org/grain|print-to-pdf|\n'
  );
  return appDir;
}

interface Api {
  app: App;
  call: (method: string, p: string, body?: unknown) => Promise<{ status: number; json: any }>;
  close: () => void;
}

async function start(appDir: string, lib: string): Promise<Api> {
  const app = new App(resolveConfig(['--no-kiwix-autostart', '--kiwix-port', '1', '--library-root', lib], appDir), token, {
    downloaderPath: downloader,
    downloads: { checkUrl: `${siteBase}/`, archiveBase: siteBase, minFreeMb: 0, stallSeconds: 5 },
    openUrl: (url) => {
      opened.push(url);
      return Promise.resolve({ ok: true, how: 'firefox' });
    },
  });
  const server = http.createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, p: string, body?: unknown) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request(base + p, { method, headers: { 'X-Token': token, 'Content-Type': 'application/json' } }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode || 0, json: b ? JSON.parse(b) : null }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  return {
    app,
    call,
    close: () => {
      app.shutdown();
      server.close();
    },
  };
}

async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-books-api-')));
  downloader = path.join(tmp, 'downloader.js');
  await esbuild.build({
    entryPoints: [path.join(REPO, 'src', 'downloader', 'downloader.ts')],
    outfile: downloader,
    bundle: true,
    platform: 'node',
    target: 'node12',
    format: 'cjs',
    define: { __APP_VERSION__: JSON.stringify('0.0.0-test') },
    logLevel: 'warning',
  });
  site = http.createServer((req, res) => {
    const u = decodeURIComponent((req.url || '').split('?')[0]);
    ranges[u] = req.headers.range as string | undefined;
    if (u === '/') return res.end('ok');
    if (u === '/403.pdf') {
      res.writeHead(403);
      return res.end();
    }
    if (u === '/slow.pdf') {
      const body = Buffer.from(pdf('slow') + 'y'.repeat(6000));
      const m = /^bytes=(\d+)-$/.exec(String(req.headers.range || ''));
      const from = m ? Number(m[1]) : 0;
      res.writeHead(m ? 206 : 200, m ? { 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}`, 'Content-Length': body.length - from } : { 'Content-Length': body.length });
      let at = from;
      const t = setInterval(() => {
        if (res.destroyed) return clearInterval(t);
        const next = Math.min(body.length, at + 150);
        res.write(body.slice(at, next));
        at = next;
        if (at >= body.length) {
          clearInterval(t);
          res.end();
        }
      }, 30);
      res.on('close', () => clearInterval(t));
      return;
    }
    if (/\.pdf$/.test(u)) return res.end(pdf(u));
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  siteBase = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
});

afterAll(() => {
  site.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Get books API', () => {
  let api: Api;
  let lib: string;

  beforeAll(async () => {
    lib = path.join(tmp, 'books', 'Library & Co');
    fs.mkdirSync(path.join(lib, '01 Medicine'), { recursive: true });
    const appDir = installedApp('main', [`F|01 Medicine|A.pdf|${siteBase}/a.pdf`, `F|02 Water|B.pdf|${siteBase}/b.pdf`, `F|02 Water|Refused.pdf|${siteBase}/403.pdf`]);
    api = await start(appDir, lib);
  });

  afterAll(() => api.close());

  it('GET /api/books works without internet and lists the topics', async () => {
    const r = await api.call('GET', '/api/books');
    expect(r.status).toBe(200);
    expect(r.json.destination).toBe(lib);
    expect(r.json.topics.map((t: { folder: string; listed: number; present: number }) => [t.folder, t.listed, t.present])).toEqual([
      ['01 Medicine', 1, 0],
      ['02 Water', 2, 0],
    ]);
    expect(r.json.missing).toBe(3);
    const s = (await api.call('GET', '/api/status')).json;
    expect(s.downloads.books.phase).toBe('idle');
  });

  it('POST /api/books/download runs the downloader process and status shows its progress until done', async () => {
    const r = await api.call('POST', '/api/books/download', {});
    expect(r.status).toBe(200);
    expect(r.json.running).toBe(true);
    const done = await until(async () => {
      const b = (await api.call('GET', '/api/status')).json.downloads.books;
      return !b.running && b.phase !== 'idle' ? b : null;
    });
    expect(done.phase).toBe('done');
    expect(done.downloaded).toBe(2);
    expect(done.failed).toBe(1);
    expect(fs.readFileSync(path.join(lib, '02 Water', 'B.pdf'), 'utf8').slice(0, 4)).toBe('%PDF');
    // The library gets its own list to add books to, from the template.
    expect(fs.readFileSync(path.join(lib, 'booklist-local.txt'), 'utf8')).toMatch(/^# Your own books/);
    const o = (await api.call('GET', '/api/books')).json;
    expect(o.missing).toBe(1);
    expect(o.failures.map((f: { file: string; code: string }) => `${f.file} ${f.code}`)).toEqual(['Refused.pdf http-403']);
  });

  it('marks a failed book as done', async () => {
    const r = await api.call('POST', '/api/books/done', { id: '02 Water|Refused.pdf', done: true });
    expect(r.status).toBe(200);
    expect(r.json.failures).toEqual([]);
    expect(r.json.missing).toBe(0);
  });

  it('lists the books to save by hand, offline, and remembers ticks in the library folder', async () => {
    let r = await api.call('GET', '/api/manual');
    expect(r.status).toBe(200);
    expect(r.json.map((i: { title: string; done: boolean }) => `${i.title} ${i.done}`)).toEqual(['Where There Is No Vet (Oxfam) false', 'FAO Grain Storage false']);
    r = await api.call('POST', '/api/manual/done', { id: 'M|04 Food|https://example.org/grain', done: true });
    expect(r.status).toBe(200);
    expect(r.json[1].done).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(lib, 'library-search-downloads.json'), 'utf8')).manualDone).toEqual(['M|04 Food|https://example.org/grain']);
  });

  it('open-url opens web addresses in Firefox and refuses anything else', async () => {
    const ok = await api.call('POST', '/api/open-url', { url: `${siteBase}/403.pdf` });
    expect(ok.status).toBe(200);
    expect(opened).toEqual([`${siteBase}/403.pdf`]);
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', '']) {
      expect((await api.call('POST', '/api/open-url', { url: bad })).status).toBe(400);
    }
    expect(opened.length).toBe(1);
  });
});

describe('stopping and refusing', () => {
  it('cancel stops the process; the next start resumes', async () => {
    const lib = path.join(tmp, 'books', 'Slow Library');
    fs.mkdirSync(path.join(lib, '01 Medicine'), { recursive: true });
    const api = await start(installedApp('slow', [`F|01 Medicine|Slow.pdf|${siteBase}/slow.pdf`]), lib);
    try {
      await api.call('POST', '/api/books/download', {});
      await until(async () => (await api.call('GET', '/api/status')).json.downloads.books.fileReceived >= 600);
      await api.call('POST', '/api/books/cancel', {});
      const stopped = await until(async () => {
        const b = (await api.call('GET', '/api/status')).json.downloads.books;
        return !b.running ? b : null;
      });
      expect(stopped.phase).toBe('cancelled');
      const kept = fs.statSync(path.join(lib, '01 Medicine', 'Slow.pdf.part')).size;
      expect(kept).toBeGreaterThan(0);
      await api.call('POST', '/api/books/download', {});
      const done = await until(async () => {
        const b = (await api.call('GET', '/api/status')).json.downloads.books;
        return !b.running && b.phase === 'done' ? b : null;
      });
      expect(done.downloaded).toBe(1);
      expect(ranges['/slow.pdf']).toBe(`bytes=${kept}-`);
    } finally {
      api.close();
    }
  });

  it('the downloader stops cleanly when the app goes away mid-download', async () => {
    const lib = path.join(tmp, 'books', 'Gone Library');
    fs.mkdirSync(path.join(lib, '01 Medicine'), { recursive: true });
    const list = path.join(tmp, 'gone-list.txt');
    fs.writeFileSync(list, `F|01 Medicine|Slow.pdf|${siteBase}/slow.pdf\n`);
    const child = fork(downloader, ['--job', 'books', '--library', lib, '--list', list, '--check-url', `${siteBase}/`, '--min-free-mb', '0'], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      execArgv: [],
    });
    let stderr = '';
    child.stderr!.on('data', (d) => (stderr += d));
    const exited = new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
    await new Promise<void>((resolve) =>
      child.on('message', (m: { progress?: { fileReceived: number } }) => {
        if (m.progress && m.progress.fileReceived > 0) resolve();
      })
    );
    child.disconnect(); // what happens to the channel when the app closes
    expect(await exited, stderr).toBe(3);
    expect(fs.existsSync(path.join(lib, '01 Medicine', 'Slow.pdf.part'))).toBe(true);
    expect(fs.existsSync(path.join(lib, 'library-search-downloads.json'))).toBe(true);
  });

  it('refuses to download into a library folder inside the app', async () => {
    const appDir = installedApp('inside', [`F|01 Medicine|A.pdf|${siteBase}/a.pdf`]);
    const lib = path.join(tmp, 'apps', 'inside', 'books');
    fs.mkdirSync(path.join(lib, '01 Medicine'), { recursive: true });
    const api = await start(appDir, lib);
    try {
      const r = await api.call('POST', '/api/books/download', {});
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe('library-inside-app');
      expect((await api.call('GET', '/api/books')).json.problem.code).toBe('library-inside-app');
      expect(fs.readdirSync(path.join(lib, '01 Medicine'))).toEqual([]);
    } finally {
      api.close();
    }
  });
});
