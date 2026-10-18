// Library -> Get books -> Encyclopedias through the server API, with the real downloader process.
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../src/server/app';
import { resolveConfig } from '../../src/server/config';
import { loadState, updateState } from '../../src/downloader/state';

const REPO = path.join(__dirname, '..', '..');
const KIWIX = '15 Offline Encyclopedias (Kiwix)';
/** Enough of a ZIM file: the magic, and the checksum position at the end (so whole can be told from cut off). */
const ZIM = Buffer.alloc(30004, 0);
ZIM.writeUInt32LE(72173914, 0);
ZIM.writeUInt32LE(ZIM.length - 16, 72);
const token = 't';

let tmp: string;
let downloader: string;
let mirror: http.Server;
let mirrorBase = '';
let n = 0;

function serveZim(req: http.IncomingMessage, res: http.ServerResponse, slow: boolean) {
  const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ''));
  const from = m ? Number(m[1]) : 0;
  const to = m && m[2] ? Number(m[2]) : ZIM.length - 1;
  const body = ZIM.slice(from, to + 1);
  res.writeHead(m ? 206 : 200, m ? { 'Content-Range': `bytes ${from}-${to}/${ZIM.length}`, 'Content-Length': body.length } : { 'Content-Length': ZIM.length });
  if (!slow || body.length < 10) return res.end(body);
  let at = 0;
  const t = setInterval(() => {
    if (res.destroyed) return clearInterval(t);
    res.write(body.slice(at, at + 500));
    at += 500;
    if (at >= body.length) {
      clearInterval(t);
      res.end();
    }
  }, 30);
  res.on('close', () => clearInterval(t));
}

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-zims-api-')));
  downloader = path.join(tmp, 'downloader.js');
  await esbuild.build({
    entryPoints: [path.join(REPO, 'src', 'downloader', 'downloader.ts')],
    outfile: downloader,
    bundle: true,
    platform: 'node',
    target: 'node12',
    format: 'cjs',
    define: { __APP_VERSION__: JSON.stringify('0.0.0-test'), __UPDATE_REPO__: JSON.stringify('test/repo') },
    logLevel: 'warning',
  });
  mirror = http.createServer((req, res) => {
    const u = (req.url || '').split('?')[0];
    if (u === '/') return res.end('ok');
    if (u === '/zim/test/') {
      return res.end(['test_a_2026-01.zim', 'test_b_2026-01.zim', 'test_slow_2026-01.zim'].map((f) => `<a href="${f}">${f}</a>`).join('\n'));
    }
    if (u === '/zim/test/test_a_2026-01.zim' || u === '/zim/test/test_b_2026-01.zim') return serveZim(req, res, false);
    if (u === '/zim/test/test_slow_2026-01.zim') return serveZim(req, res, true);
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => mirror.listen(0, '127.0.0.1', () => r()));
  mirrorBase = `http://127.0.0.1:${(mirror.address() as { port: number }).port}`;
});

afterAll(() => {
  mirror.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Api {
  app: App;
  lib: string;
  restarts: number;
  call: (method: string, p: string, body?: unknown) => Promise<{ status: number; json: any }>;
  close: () => void;
}

/** An installed app with a small encyclopedia list, and a library whose Kiwix folder already has a reader. */
function setup(): { appDir: string; lib: string } {
  const name = `z${++n}`;
  const appDir = path.join(tmp, 'apps', name, 'dist', 'library-search-linux-ia32', 'resources', 'app');
  fs.mkdirSync(path.join(appDir, 'kit', 'booklists'), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, 'kit', 'booklists', 'encyclopedias.txt'),
    'Z|test|test_a_|1|yes|Test A\nZ|test|test_b_|2|no|Test B\nZ|test|test_slow_|1|no|Slow one\n'
  );
  const lib = path.join(tmp, 'books', `Library ${name}`);
  fs.mkdirSync(path.join(lib, '01 Medicine'), { recursive: true });
  fs.mkdirSync(path.join(lib, KIWIX, 'kiwix-tools'), { recursive: true });
  fs.writeFileSync(path.join(lib, KIWIX, 'kiwix-tools', 'kiwix-serve'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return { appDir, lib };
}

async function start(appDir: string, lib: string): Promise<Api> {
  const api = { restarts: 0 } as Api;
  const app = new App(resolveConfig(['--no-kiwix-autostart', '--kiwix-port', '1', '--library-root', lib], appDir), token, {
    downloaderPath: downloader,
    downloads: { checkUrl: `${mirrorBase}/`, mirror: mirrorBase, minFreeMb: 0, stallSeconds: 5 },
    restartKiwix: () => {
      api.restarts++;
      return Promise.resolve();
    },
  });
  const server = http.createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  api.app = app;
  api.lib = lib;
  api.call = (method, p, body) =>
    new Promise((resolve, reject) => {
      const req = http.request(base + p, { method, headers: { 'X-Token': token, 'Content-Type': 'application/json' } }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode || 0, json: b ? JSON.parse(b) : null }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  api.close = () => {
    app.shutdown();
    server.close();
  };
  return api;
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

const zimsJob = (api: Api) => api.call('GET', '/api/status').then((r) => r.json.downloads.zims);

describe('Encyclopedias API', () => {
  it('lists the encyclopedias with what is on disk, offline', async () => {
    const { appDir, lib } = setup();
    fs.writeFileSync(path.join(lib, KIWIX, 'test_a_2025-01.zim'), ZIM);
    fs.writeFileSync(path.join(lib, KIWIX, 'test_b_2026-01.zim.part'), ZIM.slice(0, 1000));
    const api = await start(appDir, lib);
    try {
      const r = await api.call('GET', '/api/zims');
      expect(r.status).toBe(200);
      expect(r.json.destination).toBe(lib);
      expect(r.json.kiwixDir).toBe(path.join(lib, KIWIX));
      expect(r.json.reader).toBe('ok');
      expect(r.json.items.map((i: { id: string; state: string; have: number }) => [i.id, i.state, i.have])).toEqual([
        ['test_a_', 'ready', ZIM.length],
        ['test_b_', 'partial', 1000],
        ['test_slow_', 'missing', 0],
      ]);
    } finally {
      api.close();
    }
  });

  it('downloads the selected ones and restarts kiwix-serve after each', async () => {
    const { appDir, lib } = setup();
    const api = await start(appDir, lib);
    try {
      const r = await api.call('POST', '/api/zims/download', { ids: ['test_b_'] });
      expect(r.status).toBe(200);
      const done = await until(async () => {
        const z = await zimsJob(api);
        return !z.running && z.phase !== 'idle' ? z : null;
      });
      expect(done.phase).toBe('done');
      expect(fs.readFileSync(path.join(lib, KIWIX, 'test_b_2026-01.zim')).equals(ZIM)).toBe(true);
      expect(api.restarts).toBe(1);
      const st = loadState(lib).zims;
      expect([st.selected, st.resume]).toEqual([['test_b_'], false]);
      expect((await api.call('POST', '/api/zims/download', { ids: ['nope_'] })).status).toBe(400);
    } finally {
      api.close();
    }
  });

  it('a run that was interrupted by closing the app continues on the next start', async () => {
    const { appDir, lib } = setup();
    updateState(lib, (s) => {
      s.zims.selected = ['test_a_'];
      s.zims.resume = true;
    });
    const api = await start(appDir, lib);
    try {
      api.app.resumeDownloads(50);
      const done = await until(async () => {
        const z = await zimsJob(api);
        return !z.running && z.phase === 'done' ? z : null;
      });
      expect(done.downloaded).toBe(1);
      expect(fs.existsSync(path.join(lib, KIWIX, 'test_a_2026-01.zim'))).toBe(true);
    } finally {
      api.close();
    }
  });

  it('cancel stops it and it stays stopped after a restart', async () => {
    const { appDir, lib } = setup();
    const first = await start(appDir, lib);
    try {
      await first.call('POST', '/api/zims/download', { ids: ['test_slow_'] });
      await until(async () => (await zimsJob(first)).fileReceived > 0);
      await first.call('POST', '/api/zims/cancel', {});
      const stopped = await until(async () => {
        const z = await zimsJob(first);
        return !z.running ? z : null;
      });
      expect(stopped.phase).toBe('cancelled');
      expect(loadState(lib).zims.resume).toBe(false);
      expect(fs.existsSync(path.join(lib, KIWIX, 'test_slow_2026-01.zim.part'))).toBe(true);
    } finally {
      first.close();
    }
    const second = await start(appDir, lib);
    try {
      second.app.resumeDownloads(50);
      await new Promise((r) => setTimeout(r, 600));
      expect((await zimsJob(second)).phase).toBe('idle');
    } finally {
      second.close();
    }
  });
});
