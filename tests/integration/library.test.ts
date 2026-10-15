// Builds a real index from tests/fixtures/library (needs pdftotext/pdfinfo on PATH) and exercises
// search, browse and the HTTP API end to end.
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex } from '../../src/indexer/build';
import { App } from '../../src/server/app';
import { resolveConfig } from '../../src/server/config';
import { openDb } from '../../src/server/db';
import { listCategories, listProblems, searchBooks } from '../../src/server/search';
import { HL_END, HL_START } from '../../src/shared/api';

const APP_DIR = path.join(__dirname, '..', '..');
const FIXTURES = path.join(APP_DIR, 'tests', 'fixtures', 'library');

let tmp: string;
let lib: string;

function cfgFor(dataDir: string) {
  return resolveConfig(['--library-root', lib, '--data-dir', dataDir, '--no-kiwix-autostart', '--kiwix-port', '1'], APP_DIR);
}

function copyDir(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const s = path.join(src, n);
    const d = path.join(dst, n);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-test-'));
  lib = path.join(tmp, 'library');
  copyDir(FIXTURES, lib);
  const p = await buildIndex(cfgFor(path.join(tmp, 'data')));
  expect(p.phase).toBe('done');
  expect(p.added).toBe(8);
  expect(p.failed).toBe(1); // the HTML page named .pdf
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function search(q: string, category?: string) {
  const db = openDb(cfgFor(path.join(tmp, 'data')).indexPath);
  try {
    return searchBooks(db, q, { category });
  } finally {
    db.close();
  }
}

describe('book search', () => {
  it('finds the right page with highlighted snippets', () => {
    const r = search('boil water');
    expect(r.matchMode).toBe('all');
    expect(r.results[0].title).toBe('Safe Drinking Water: A Field Guide');
    expect(r.results[0].page).toBe(2);
    expect(r.results[0].snippet).toContain(`${HL_START}boil${HL_END}`);
  });

  it('uses stemming and drops stop-words for natural questions', () => {
    const r = search('how do I set a broken arm with splints');
    expect(r.results[0].title).toBe('First Aid Basics');
    expect(r.results[0].page).toBe(2);
  });

  it('answers the acceptance queries', () => {
    expect(search('fractions').results[0].title).toBe('Fractions for Grade 4');
    expect(search('chmod').results[0].title).toBe('The Ubuntu Command Line');
    expect(search('canning tomatoes').results[0].title).toBe('Home Canning Guide 3: Tomatoes');
    expect(search('solar panel wiring').results[0].page).toBe(2);
  });

  it('matches scanned books by title only and flags them', () => {
    const r = search('survival');
    expect(r.results[0]).toMatchObject({ title: 'Survival FM 21-76 (1957 scan)', scanned: true, page: 0 });
  });

  it('searches EPUB chapters', () => {
    const r = search('forge welding borax');
    expect(r.results[0]).toMatchObject({ kind: 'epub', page: 2, title: 'Forge Basics & Smithing' });
  });

  it('falls back to any-word matching', () => {
    const r = search('xyzzy chlorine');
    expect(r.matchMode).toBe('any');
    expect(r.results[0].page).toBe(3);
  });

  it('filters by category folder', () => {
    const r = search('water', '01 Medicine');
    expect(r.results.every((x) => x.category === 'Medicine')).toBe(true);
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('uses Hesperian-style titles with a series label', () => {
    const r = search('home cures');
    expect(r.results[0].title).toBe('Where There Is No Doctor - Chapter 1: Home Cures');
  });
});

describe('browse + problems', () => {
  it('lists categories (not the Kiwix folder) and problem files', () => {
    const db = openDb(cfgFor(path.join(tmp, 'data')).indexPath);
    try {
      const cats = listCategories(db).map((c) => c.label);
      expect(cats).toContain('Medicine');
      expect(cats.some((c) => /kiwix/i.test(c))).toBe(false);
      const problems = listProblems(db);
      expect(problems.find((p) => p.status === 'error')!.relpath).toBe('02 Water & Sanitation/Blocked_Download.pdf');
      expect(problems.find((p) => p.status === 'scanned')!.title).toContain('Survival');
    } finally {
      db.close();
    }
  });
});

describe('incremental rebuild', () => {
  it('skips unchanged files, picks up changes and removals', async () => {
    const dataDir = path.join(tmp, 'data');
    let p = await buildIndex(cfgFor(dataDir));
    expect([p.added, p.updated, p.removed]).toEqual([0, 0, 0]);

    fs.unlinkSync(path.join(lib, '11 Math & Science', 'Fractions_Grade_4.pdf'));
    // A real edit (content changes); PDF readers ignore comments after %%EOF.
    fs.appendFileSync(path.join(lib, '01 Medicine', 'First_Aid_Basics.pdf'), '\n% edited\n');
    p = await buildIndex(cfgFor(dataDir));
    expect([p.added, p.updated, p.removed]).toEqual([0, 1, 1]);
    expect(search('fractions').results).toHaveLength(0);
    expect(search('splint').results[0].title).toBe('First Aid Basics');
  });

  it('does not re-index files that only got new dates (library copied without keeping dates)', async () => {
    const dataDir = path.join(tmp, 'data');
    const later = new Date(Date.now() + 60000);
    const touchAll = (dir: string) => {
      for (const n of fs.readdirSync(dir)) {
        const p = path.join(dir, n);
        if (fs.statSync(p).isDirectory()) touchAll(p);
        else fs.utimesSync(p, later, later);
      }
    };
    touchAll(lib);
    const app = new App(cfgFor(dataDir), 't');
    expect((await app.status(true)).index.pendingChanges).toBe(0);
    const p = await buildIndex(cfgFor(dataDir));
    expect([p.added, p.updated, p.removed]).toEqual([0, 0, 0]);
    app.shutdown();
  });

  it('can be cancelled and resumed', async () => {
    const dataDir = path.join(tmp, 'data-cancel');
    let calls = 0;
    await expect(buildIndex(cfgFor(dataDir), { isCancelled: () => ++calls > 6 })).rejects.toThrow('cancelled');
    const p = await buildIndex(cfgFor(dataDir));
    expect(p.phase).toBe('done');
    const db = openDb(cfgFor(dataDir).indexPath);
    try {
      expect((db.get("SELECT COUNT(*) AS n FROM docs WHERE status = 'pending'") as { n: number }).n).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('HTTP API', () => {
  let server: http.Server;
  let base: string;
  const token = 'test-token';

  beforeAll(async () => {
    // Serve the UI page from a self-contained app dir, so the test never depends on a previous `npm run build`.
    const appDir = path.join(tmp, 'app');
    fs.mkdirSync(path.join(appDir, 'build', 'ui'), { recursive: true });
    fs.copyFileSync(path.join(APP_DIR, 'src', 'ui', 'index.html'), path.join(appDir, 'build', 'ui', 'index.html'));
    const cfg = resolveConfig(
      ['--library-root', lib, '--data-dir', path.join(tmp, 'data'), '--no-kiwix-autostart', '--kiwix-port', '1'],
      appDir
    );
    const app = new App(cfg, token);
    server = http.createServer((req, res) => void app.handle(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    app.setPort(addr.port);
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => server.close());

  function get(p: string, headers: Record<string, string> = { 'X-Token': token }) {
    return new Promise<{ status: number; body: string; type: string }>((resolve, reject) => {
      http
        .get(base + p, { headers }, (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => resolve({ status: res.statusCode || 0, body, type: String(res.headers['content-type']) }));
        })
        .on('error', reject);
    });
  }

  it('rejects API calls without the token', async () => {
    expect((await get('/api/status', {})).status).toBe(401);
  });

  it('reports status', async () => {
    const r = await get('/api/status');
    expect(r.status).toBe(200);
    const s = JSON.parse(r.body);
    expect(s.index.exists).toBe(true);
    expect(s.index.docs).toBeGreaterThan(5);
    expect(s.kiwix.state).toBe('no-zims');
    expect(s.roots).toEqual([fs.realpathSync(lib)]);
  });

  it('searches over HTTP', async () => {
    const r = JSON.parse((await get('/api/search?q=' + encodeURIComponent('boil water'))).body);
    expect(r.results[0].page).toBe(2);
  });

  it('serves EPUB chapters for the reader, without scripts', async () => {
    const s = JSON.parse((await get('/api/search?q=borax')).body);
    const id = s.results[0].docId;
    const r = await get(`/epub/${id}/OEBPS/text/ch2.xhtml`, {});
    expect(r.status).toBe(200);
    expect(r.type).toContain('text/html');
    expect(r.body).toContain('Forge welding');
    expect(r.body).not.toContain('<script');
  });

  it('saves the theme and stamps it on the served page', async () => {
    const post = (body: string) =>
      new Promise<string>((resolve, reject) => {
        const req = http.request(
          base + '/api/settings',
          { method: 'POST', headers: { 'X-Token': token, 'Content-Type': 'application/json' } },
          (res) => {
            let b = '';
            res.on('data', (d) => (b += d));
            res.on('end', () => resolve(b));
          }
        );
        req.on('error', reject);
        req.end(body);
      });
    expect(JSON.parse((await get('/api/settings')).body)).toEqual({ theme: 'system' });
    expect((await get('/')).body).not.toContain('<html data-theme');
    expect(JSON.parse(await post('{"theme":"dark"}'))).toEqual({ theme: 'dark' });
    const html = (await get('/')).body;
    expect(html).toContain('<html data-theme="dark"');
    expect(html).toContain('<meta name="ls-theme" content="dark">');
    expect(JSON.parse(await post('{"theme":"purple"}'))).toEqual({ theme: 'dark' }); // invalid values are ignored
    expect(JSON.parse(await post('{"theme":"system"}'))).toEqual({ theme: 'system' });
  });

  it('answers unknown paths through the kiwix proxy with a friendly 503 when kiwix is down', async () => {
    const r = await get('/content/wikipedia/A/Water', {});
    expect(r.status).toBe(503);
    expect(r.body).toContain('encyclopedia server is not running');
  });
});
