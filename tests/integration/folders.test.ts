// Library folders chosen in the app, an app installed outside the library, and switching libraries.
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex } from '../../src/indexer/build';
import { App } from '../../src/server/app';
import { appHomeOf, checkLibraryFolder, resolveConfig } from '../../src/server/config';
import { openDb } from '../../src/server/db';
import { saveSettings } from '../../src/server/settings';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'library');

let tmp: string;
let lib: string;

function copyDir(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const s = path.join(src, n);
    const d = path.join(dst, n);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-folders-')));
  lib = path.join(tmp, 'books', 'Community Library');
  copyDir(FIXTURES, lib);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** An "installed app" far away from the library: <tmp>/apps/libsearch/dist/library-search-linux-ia32/resources/app */
function installedApp(name: string): string {
  const appDir = path.join(tmp, 'apps', name, 'dist', 'library-search-linux-ia32', 'resources', 'app');
  fs.mkdirSync(path.join(appDir, 'build', 'ui'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'index.html'), path.join(appDir, 'build', 'ui', 'index.html'));
  return appDir;
}

describe('where the app lives', () => {
  it('finds the app folder from the packaged layout, on Linux and macOS', () => {
    expect(appHomeOf('/home/u/libsearch/dist/library-search-linux-ia32/resources/app')).toBe('/home/u/libsearch');
    expect(appHomeOf('/Users/u/x/dist/library-search-darwin-arm64/library-search.app/Contents/Resources/app')).toBe('/Users/u/x');
    expect(appHomeOf('/Users/u/dev/libsearch')).toBe('/Users/u/dev/libsearch');
  });

  it('keeps data with the app, wherever it is, and finds no library when none is next to it', () => {
    const appDir = installedApp('away');
    const cfg = resolveConfig([], appDir);
    expect(cfg.appHome).toBe(path.join(tmp, 'apps', 'away'));
    expect(cfg.dataDir).toBe(path.join(tmp, 'apps', 'away'));
    expect(cfg.roots).toEqual([]);
    expect(cfg.rootsSource).toBe('auto');
  });

  it('uses the folders saved in settings, and --library-root beats them', () => {
    const appDir = installedApp('saved');
    saveSettings(path.join(tmp, 'apps', 'saved'), { libraryRoots: [lib] });
    const cfg = resolveConfig([], appDir);
    expect(cfg.roots).toEqual([lib]);
    expect(cfg.rootsSource).toBe('settings');
    const other = path.join(tmp, 'other');
    fs.mkdirSync(other, { recursive: true });
    const flagged = resolveConfig(['--library-root', other], appDir);
    expect(flagged.roots).toEqual([other]);
    expect(flagged.rootsSource).toBe('flag');
  });

  it('describes what a folder holds', () => {
    expect(checkLibraryFolder(lib)).toMatchObject({ exists: true, categories: 7, zims: 0 });
    expect(checkLibraryFolder(path.join(tmp, 'nope')).exists).toBe(false);
  });
});

describe('choosing the library folder in the app', () => {
  let server: http.Server;
  let base: string;
  let app: App;
  const token = 't';

  beforeAll(async () => {
    const appDir = installedApp('ui');
    app = new App(resolveConfig(['--no-kiwix-autostart', '--kiwix-port', '1'], appDir), token);
    server = http.createServer((req, res) => void app.handle(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => {
    app.shutdown();
    server.close();
  });

  function call(method: string, p: string, body?: unknown) {
    return new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request(base + p, { method, headers: { 'X-Token': token, 'Content-Type': 'application/json' } }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode || 0, json: b ? JSON.parse(b) : null }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  it('starts with no library and says how to choose one', async () => {
    const s = (await call('GET', '/api/status')).json;
    expect(s.roots).toEqual([]);
    expect(s.notices.map((n: { code: string }) => n.code)).toContain('no-library');
  });

  it('rejects folders that are not a library, with a plain-language fix', async () => {
    const empty = path.join(tmp, 'empty');
    fs.mkdirSync(empty, { recursive: true });
    for (const bad of ['relative/path', path.join(tmp, 'missing'), empty]) {
      const r = await call('POST', '/api/settings', { libraryRoots: [bad] });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe('bad-folder');
      expect(r.json.error.fix).toBeTruthy();
    }
  });

  it('applies a chosen folder immediately, and can go back to automatic', async () => {
    const r = await call('POST', '/api/settings', { libraryRoots: [lib] });
    expect(r.status).toBe(200);
    expect(r.json.libraryRoots).toEqual([lib]);
    let s = (await call('GET', '/api/status')).json;
    expect(s.roots).toEqual([lib]);
    expect(s.rootsSource).toBe('settings');
    expect(s.rootInfo[0]).toMatchObject({ path: lib, exists: true, categories: 7 });
    expect(s.index.pendingChanges).toBe(9);
    await call('POST', '/api/settings', { libraryRoots: [] });
    s = (await call('GET', '/api/status')).json;
    expect(s.roots).toEqual([]);
    expect(s.rootsSource).toBe('auto');
  });
});

describe('switching to a different library', () => {
  it('drops the old library\'s books on the next update', async () => {
    const appDir = installedApp('switch');
    const dataDir = path.join(tmp, 'apps', 'switch');
    await buildIndex(resolveConfig(['--library-root', lib, '--data-dir', dataDir], appDir));
    // A second, smaller library elsewhere that shares one book.
    const lib2 = path.join(tmp, 'usb', 'Library');
    fs.mkdirSync(path.join(lib2, '04 Food Preservation'), { recursive: true });
    fs.copyFileSync(
      path.join(lib, '04 Food Preservation', 'Home_Canning_Tomatoes.pdf'),
      path.join(lib2, '04 Food Preservation', 'Home_Canning_Tomatoes.pdf')
    );
    const p = await buildIndex(resolveConfig(['--library-root', lib2, '--data-dir', dataDir], appDir));
    expect(p.added).toBe(0); // the shared book is recognized, not read again
    const db = openDb(path.join(dataDir, 'index', 'library.sqlite'));
    try {
      const rows = db.all("SELECT relpath FROM docs WHERE status != 'pending'") as Array<{ relpath: string }>;
      expect(rows.map((r) => r.relpath)).toEqual(['04 Food Preservation/Home_Canning_Tomatoes.pdf']);
    } finally {
      db.close();
    }
  });
});
