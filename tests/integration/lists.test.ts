// New book lists from GitHub between app releases (K5), against a fake raw.githubusercontent.com.
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../src/server/app';
import { resolveConfig } from '../../src/server/config';
import { ListUpdater } from '../../src/server/lists';

const MAIN = ['F|01 Medicine|A.pdf|https://ex.org/a.pdf', 'F|01 Medicine|B.pdf|https://ex.org/b.pdf', 'F|02 Water|C.pdf|https://ex.org/c.pdf', 'F|02 Water|D.pdf|https://ex.org/d.pdf'];
const BUNDLED: Record<string, string> = {
  'booklist-main.txt': MAIN.join('\n') + '\n',
  'booklist-linux.txt': 'F|16 Linux|L.pdf|https://ex.org/l.pdf\n',
  'manual-downloads.txt': 'M|01 Medicine|Vet|https://ex.org/vet|button|\nM|04 Food|Grain|https://ex.org/grain|print-to-pdf|\n',
  'encyclopedias.txt': 'Z|wikipedia|wikipedia_en_medicine_maxi_|2|yes|WikiMed\nZ|phet|phet_en_all_|1|yes|PhET\n',
};

let tmp: string;
let raw: http.Server;
let rawBase = '';
let closedBase = '';
/** What the fake GitHub serves (a missing name = 404). */
let remote: Record<string, string> = {};
let n = 0;

function listen(handler: http.RequestListener): Promise<{ server: http.Server; base: string }> {
  const s = http.createServer(handler);
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({ server: s, base: `http://127.0.0.1:${(s.address() as { port: number }).port}` })));
}

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-lists-')));
  const r = await listen((req, res) => {
    const m = /^\/owner\/libsearch\/HEAD\/kit\/booklists\/([\w.-]+)$/.exec(req.url || '');
    if (m && remote[m[1]] !== undefined) return res.end(remote[m[1]]);
    res.writeHead(404);
    res.end('404: Not Found');
  });
  raw = r.server;
  rawBase = r.base;
  const closed = await listen(() => undefined);
  closedBase = closed.base;
  await new Promise((done) => closed.server.close(done));
});

afterAll(() => {
  raw.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** An installed app (<tmp>/apps/<n>/dist/library-search-linux-ia32/resources/app) with small bundled lists. */
function installed(): { appDir: string; home: string } {
  const home = path.join(tmp, 'apps', String(++n));
  const appDir = path.join(home, 'dist', 'library-search-linux-ia32', 'resources', 'app');
  fs.mkdirSync(path.join(appDir, 'kit', 'booklists'), { recursive: true });
  for (const k of Object.keys(BUNDLED)) fs.writeFileSync(path.join(appDir, 'kit', 'booklists', k), BUNDLED[k]);
  return { appDir, home };
}

function updater(appDir: string, opts: { rawBase?: string; version?: string } = {}): ListUpdater {
  return new ListUpdater(resolveConfig(['--no-kiwix-autostart'], appDir), { rawBase: opts.rawBase || rawBase, repo: 'owner/libsearch', version: opts.version || '0.5.0' });
}

describe('ListUpdater', () => {
  it("fetches newer lists, uses them, and counts the new books", async () => {
    const { appDir, home } = installed();
    remote = Object.assign({}, BUNDLED, {
      'booklist-main.txt': BUNDLED['booklist-main.txt'] + 'F|03 Farming|E.pdf|https://ex.org/e.pdf\nF|03 Farming|F.pdf|https://ex.org/f.pdf\n',
    });
    const u = updater(appDir);
    expect(u.effective('booklist-main.txt').source).toBe('app');
    const s = await u.check();
    expect([s.state, s.source, s.newBooks]).toEqual(['updated', 'github', 2]);
    expect(s.fetchedAt).toBeGreaterThan(0);
    const main = u.effective('booklist-main.txt');
    expect(main.source).toBe('github');
    expect(main.path).toBe(path.join(home, 'booklists', 'booklist-main.txt'));
    expect(fs.readFileSync(main.path, 'utf8')).toContain('F.pdf');
    // A fresh updater (the next start) keeps using them.
    expect(updater(appDir).effective('booklist-main.txt').source).toBe('github');
  });

  it("says up to date when GitHub has the same lists", async () => {
    const { appDir } = installed();
    remote = Object.assign({}, BUNDLED);
    const s = await updater(appDir).check();
    expect([s.state, s.source, s.newBooks]).toEqual(['up-to-date', 'app', 0]);
  });

  it("keeps the app's lists when the fetched list is truncated or garbled", async () => {
    const { appDir } = installed();
    remote = Object.assign({}, BUNDLED, {
      'booklist-main.txt': MAIN[0] + '\n', // cut off after one line
      'encyclopedias.txt': '<!doctype html><html>Something went wrong</html>',
      'manual-downloads.txt': BUNDLED['manual-downloads.txt'] + 'M|05 Survival|Extra|https://ex.org/x|button|\n',
    });
    const u = updater(appDir);
    await u.check();
    expect(u.effective('booklist-main.txt').source).toBe('app');
    expect(u.effective('encyclopedias.txt').source).toBe('app');
    expect(u.effective('manual-downloads.txt').source).toBe('github');
  });

  it("offline: a calm state, the app's lists stay in use", async () => {
    const { appDir } = installed();
    const u = updater(appDir, { rawBase: closedBase });
    const s = await u.check();
    expect(s.state).toBe('offline');
    expect(s.error).toBeUndefined();
    expect(u.effective('booklist-main.txt').source).toBe('app');
  });

  it('a cache from another app version is ignored', async () => {
    const { appDir } = installed();
    remote = Object.assign({}, BUNDLED, { 'booklist-main.txt': BUNDLED['booklist-main.txt'] + 'F|03 Farming|E.pdf|https://ex.org/e.pdf\n' });
    await updater(appDir, { version: '0.4.9' }).check();
    expect(updater(appDir, { version: '0.4.9' }).effective('booklist-main.txt').source).toBe('github');
    expect(updater(appDir, { version: '0.5.0' }).effective('booklist-main.txt').source).toBe('app');
  });
});

describe('Get books with lists from GitHub', () => {
  it('Get books uses the GitHub list when there is one', async () => {
    const { appDir } = installed();
    remote = Object.assign({}, BUNDLED, { 'booklist-main.txt': BUNDLED['booklist-main.txt'] + 'F|03 Farming|E.pdf|https://ex.org/e.pdf\n' });
    const lib = path.join(tmp, 'books', `Library ${n}`);
    fs.mkdirSync(path.join(lib, '01 Medicine'), { recursive: true });
    const app = new App(resolveConfig(['--no-kiwix-autostart', '--kiwix-port', '1', '--library-root', lib], appDir), 't', {
      lists: { rawBase, repo: 'owner/libsearch', version: '0.5.0' },
    });
    const server = http.createServer((req, res) => void app.handle(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const call = (method: string, p: string) =>
      new Promise<any>((resolve, reject) => {
        const req = http.request(base + p, { method, headers: { 'X-Token': 't', 'Content-Type': 'application/json' } }, (res) => {
          let b = '';
          res.on('data', (d) => (b += d));
          res.on('end', () => resolve(b ? JSON.parse(b) : null));
        });
        req.on('error', reject);
        req.end(method === 'POST' ? '{}' : undefined);
      });
    try {
      expect((await call('GET', '/api/status')).lists.state).toBe('idle');
      const s = await call('POST', '/api/lists/check');
      expect([s.state, s.newBooks]).toEqual(['updated', 1]);
      const o = await call('GET', '/api/books');
      expect(o.lists[0]).toEqual({ name: 'booklist-main.txt', source: 'github', entries: 5 });
      expect(o.topics.map((t: { folder: string }) => t.folder)).toContain('03 Farming');
    } finally {
      app.shutdown();
      server.close();
    }
  });
});
