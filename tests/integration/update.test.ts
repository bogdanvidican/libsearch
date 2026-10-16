// In-app updates against a fake GitHub (API + a separate storage host, like GitHub's redirects), with a fake
// installed app and the real install script (kit/6-install-or-update-search-app.sh) doing the swap.
import { ChildProcess, spawn, spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../src/server/app';
import { resolveConfig } from '../../src/server/config';
import { saveSettings } from '../../src/server/settings';
import { compareVersions, parseVersion, pickAsset, Release, Updater, UpdaterOptions } from '../../src/server/update';

const REPO = path.join(__dirname, '..', '..');
const INSTALLER = path.join(REPO, 'kit', '6-install-or-update-search-app.sh');
const TAR_NAME = 'library-search-linux-ia32-v0.2.0.tar.gz';

let tmp: string;
let tarball: Buffer;
let tarSha: string;

/** A packaged app folder <parent>/library-search-linux-ia32 whose launcher notes that it was started. */
function makePackage(parent: string, version: string): string {
  const top = path.join(parent, 'library-search-linux-ia32');
  const kit = path.join(top, 'resources', 'app', 'kit');
  fs.mkdirSync(kit, { recursive: true });
  fs.writeFileSync(path.join(top, 'library-search'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(top, 'app-version.txt'), version + '\n');
  fs.writeFileSync(path.join(top, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'library-search', version }));
  fs.copyFileSync(INSTALLER, path.join(kit, '6-install-or-update-search-app.sh'));
  fs.writeFileSync(
    path.join(kit, '6-search-the-library.sh'),
    '#!/usr/bin/env bash\nprintf \'started %s %s\\n\' "$(cat "$(dirname "$0")/../../../app-version.txt")" "$*" >>"$(dirname "$0")/../../../relaunched.txt"\n',
    { mode: 0o755 }
  );
  return top;
}

/** An installed v0.1.0 app at <tmp>/<name>/dist/library-search-linux-ia32; returns its resources/app folder. */
function installed(name: string, opts: { auto?: boolean } = {}): string {
  const home = path.join(tmp, name);
  const top = makePackage(path.join(home, 'dist'), '0.1.0');
  saveSettings(home, { autoUpdate: opts.auto !== false });
  return path.join(top, 'resources', 'app');
}

function homeOf(appDir: string): string {
  return path.resolve(appDir, '..', '..', '..', '..');
}

// ---------- fake GitHub ----------

interface Seen {
  path: string;
  auth?: string;
  accept?: string;
  ua?: string;
}

const gh = {
  api: null as http.Server | null,
  storage: null as http.Server | null,
  apiBase: '',
  storageBase: '',
  status: 200,
  corrupt: false,
  seen: [] as Seen[],
  release(): Release {
    return {
      tag_name: 'v0.2.0',
      body: 'Faster search.\nNew icon.',
      assets: [
        { name: 'library-search-linux-ia32-v0.2.0-e13.tar.gz', url: `${gh.apiBase}/assets/9`, browser_download_url: `${gh.apiBase}/dl/x-e13`, size: 1 },
        { name: TAR_NAME, url: `${gh.apiBase}/assets/1`, browser_download_url: `${gh.apiBase}/dl/${TAR_NAME}`, size: tarball.length },
        { name: TAR_NAME + '.sha256', url: `${gh.apiBase}/assets/2`, browser_download_url: `${gh.apiBase}/dl/${TAR_NAME}.sha256`, size: 90 },
      ],
    };
  },
};

function listen(handler: http.RequestListener): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` }))
  );
}

function closedPortBase(): Promise<string> {
  return listen(() => undefined).then(({ server, base }) => new Promise<string>((r) => server.close(() => r(base))));
}

async function until<T>(fn: () => T | undefined | null | false, ms = 30000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
}

function updater(appDir: string, extra: UpdaterOptions & { argv?: string[] } = {}): Updater {
  const cfg = resolveConfig(['--no-kiwix-autostart', ...(extra.argv || [])], appDir);
  return new Updater(cfg, {
    version: '0.1.0',
    repo: 'owner/libsearch',
    apiBase: gh.apiBase,
    token: '',
    arch: 'ia32',
    platform: 'linux',
    firstCheckMs: 20,
    // The install script must not touch the real home folder (menu entry, ~/.config).
    env: Object.assign({}, process.env, { HOME: path.join(tmp, 'user'), XDG_CONFIG_HOME: '', LIBRARY_SEARCH_WAIT_SECONDS: '2' }),
    ...extra,
  });
}

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-update-')));
  const src = path.join(tmp, 'release-src');
  makePackage(src, '0.2.0');
  const tarPath = path.join(tmp, TAR_NAME);
  const r = spawnSync('tar', ['-czf', tarPath, '-C', src, 'library-search-linux-ia32'], { env: Object.assign({}, process.env, { COPYFILE_DISABLE: '1' }) });
  expect(r.status).toBe(0);
  tarball = fs.readFileSync(tarPath);
  tarSha = crypto.createHash('sha256').update(tarball).digest('hex');

  const storage = await listen((req, res) => {
    gh.seen.push({ path: req.url || '', auth: req.headers.authorization, accept: req.headers.accept, ua: req.headers['user-agent'] });
    if (req.url === `/s/${TAR_NAME}`) {
      const body = gh.corrupt ? Buffer.concat([tarball.slice(0, 100), Buffer.alloc(tarball.length - 100, 7)]) : tarball;
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    } else if (req.url === `/s/${TAR_NAME}.sha256`) {
      res.end(`${tarSha}  ${TAR_NAME}\n`);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  gh.storage = storage.server;
  gh.storageBase = storage.base;

  const api = await listen((req, res) => {
    const u = req.url || '';
    gh.seen.push({ path: u, auth: req.headers.authorization, accept: req.headers.accept, ua: req.headers['user-agent'] });
    if (u === '/repos/owner/libsearch/releases/latest') {
      if (gh.status !== 200) {
        res.writeHead(gh.status);
        res.end('{"message":"Not Found"}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(gh.release()));
    } else if (u.indexOf('/dl/') === 0) {
      res.writeHead(302, { Location: `${gh.storageBase}/s/${u.slice(4)}` });
      res.end();
    } else if (u === '/assets/1' || u === '/assets/2') {
      // Private repos: the API hands out the file only with the token and Accept: octet-stream.
      if (!req.headers.authorization || req.headers.accept !== 'application/octet-stream') {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(302, { Location: `${gh.storageBase}/s/${u === '/assets/1' ? TAR_NAME : TAR_NAME + '.sha256'}` });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  gh.api = api.server;
  gh.apiBase = api.base;
});

afterAll(() => {
  if (gh.api) gh.api.close();
  if (gh.storage) gh.storage.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------- tests ----------

describe('versions and release files', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('v0.2.0', '0.2')).toBe(0);
    expect(compareVersions('0.1.1', '0.2.0')).toBe(-1);
    expect(parseVersion('0.2.0-beta')).toBeNull();
  });

  it('picks the file for this computer, and the fallback-Electron build only when it is one', () => {
    const rel: Release = {
      tag_name: 'v1.2.0',
      assets: [
        { name: 'library-search-linux-ia32-v1.2.0-e13.tar.gz', url: '', browser_download_url: 'e13', size: 1 },
        { name: 'library-search-linux-ia32-v1.2.0.tar.gz', url: '', browser_download_url: 'main', size: 1 },
        { name: 'library-search-linux-ia32-v1.2.0.tar.gz.sha256', url: '', browser_download_url: 'sum', size: 1 },
        { name: '6-install-or-update-search-app.sh', url: '', browser_download_url: 'sh', size: 1 },
      ],
    };
    const main = pickAsset(rel, 'ia32', '');
    expect(main && [main.version, main.asset.browser_download_url, main.checksum && main.checksum.browser_download_url]).toEqual(['1.2.0', 'main', 'sum']);
    const e13 = pickAsset(rel, 'ia32', '-e13');
    expect(e13 && e13.asset.browser_download_url).toBe('e13');
    expect(pickAsset(rel, 'x64', '')).toBeNull();
  });
});

describe('when the app can update itself', () => {
  it('not in a developer copy, on macOS, or with --no-update', () => {
    expect(updater(REPO).status()).toMatchObject({ state: 'unsupported', reason: expect.stringContaining('developer copy') });
    const appDir = installed('unsupported');
    expect(updater(appDir, { platform: 'darwin' }).status().state).toBe('unsupported');
    expect(updater(appDir, { argv: ['--no-update'] }).status()).toMatchObject({ state: 'unsupported', reason: expect.stringContaining('--no-update') });
    expect(updater(appDir).status().state).toBe('idle');
  });
});

describe('checking and downloading', () => {
  it('with automatic updates off: finds the new version, downloads it only when asked, and verifies it', async () => {
    const appDir = installed('manual', { auto: false });
    const u = updater(appDir);
    gh.seen = [];
    const s = await u.check(true);
    expect(s).toMatchObject({ state: 'available', latest: '0.2.0', notes: 'Faster search.\nNew icon.', auto: false });
    expect(gh.seen[0].ua).toMatch(/^library-search\/0\.1\.0$/);
    expect(gh.seen.length).toBe(1); // nothing downloaded yet

    expect(u.downloadNow().state).toBe('downloading');
    await until(() => u.status().state === 'ready');
    const dir = path.join(homeOf(appDir), 'dist', '.update');
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, TAR_NAME))).digest('hex')).toBe(tarSha);
    expect(fs.readFileSync(path.join(dir, TAR_NAME + '.sha256'), 'utf8')).toBe(`${tarSha}  ${TAR_NAME}\n`);
    expect(u.status()).toMatchObject({ state: 'ready', downloaded: '0.2.0' });
    // Not installed when the app closes: automatic updates are off.
    expect(u.installOnExit()).toBe(false);

    // After a restart the download is still there, ready to install.
    expect(updater(appDir).status()).toMatchObject({ state: 'ready', downloaded: '0.2.0', latest: '0.2.0' });
  });

  it('with a token (private repo): uses the API address and never sends the token to the storage server', async () => {
    const appDir = installed('token');
    const u = updater(appDir, { token: 'secret-token' });
    gh.seen = [];
    await u.check(true);
    await until(() => u.status().state === 'ready');
    const api = gh.seen.filter((x) => x.path.indexOf('/assets/') === 0);
    const storage = gh.seen.filter((x) => x.path.indexOf('/s/') === 0);
    expect(api.length).toBe(2);
    expect(api.every((x) => x.auth === 'token secret-token')).toBe(true);
    expect(storage.length).toBe(2);
    expect(storage.every((x) => x.auth === undefined)).toBe(true);
  });

  it('throws a damaged download away', async () => {
    const appDir = installed('damaged');
    const u = updater(appDir);
    gh.corrupt = true;
    try {
      await u.check(true);
      await until(() => u.status().state !== 'downloading' && u.status().state !== 'checking');
    } finally {
      gh.corrupt = false;
    }
    expect(u.status()).toMatchObject({ state: 'error', error: { code: 'update-damaged' } });
    expect(fs.readdirSync(path.join(homeOf(appDir), 'dist', '.update'))).toEqual([]);
  });

  it('offline: a calm notice, not an error', async () => {
    const u = updater(installed('offline'), { apiBase: await closedPortBase() });
    const s = await u.check(true);
    expect(s.state).toBe('offline');
    expect(s.error).toMatchObject({ kind: 'info', code: 'update-offline' });
    expect(s.checkedAt).toBeGreaterThan(0);
  });

  it('says plainly when GitHub has no release (private or moved repo)', async () => {
    gh.status = 404;
    try {
      const s = await updater(installed('missing')).check(true);
      expect(s).toMatchObject({ state: 'error', error: { code: 'update-not-found' } });
      expect(s.error && s.error.fix).toMatch(/USB stick/);
    } finally {
      gh.status = 200;
    }
  });

  it('up to date when the newest release is this version', async () => {
    expect((await updater(installed('current'), { version: '0.2.0' }).check(true)).state).toBe('up-to-date');
  });

  it('with automatic updates on: checks and downloads by itself after start-up', async () => {
    const u = updater(installed('auto'));
    u.start();
    await until(() => u.status().state === 'ready');
    u.stop();
  });
});

describe('installing (the real install script)', () => {
  it('"Restart now": swaps in the new version and starts it, and the next start says it was updated', async () => {
    const appDir = installed('restart');
    const home = homeOf(appDir);
    const dest = path.join(home, 'dist', 'library-search-linux-ia32');
    const u = updater(appDir);
    await u.check(true);
    await until(() => u.status().state === 'ready');

    expect(u.installNow().state).toBe('installing');
    const statusFile = path.join(home, 'dist', '.update', 'install-status.txt');
    await until(() => fs.existsSync(statusFile) && fs.readFileSync(statusFile, 'utf8'));
    expect(fs.readFileSync(statusFile, 'utf8')).toBe('ok 0.2.0\n');
    expect(fs.readFileSync(path.join(dest, 'app-version.txt'), 'utf8')).toBe('0.2.0\n');
    expect(fs.existsSync(dest + '.old')).toBe(false);
    // The script started the new version's launcher again (in the background).
    const relaunched = path.join(dest, 'relaunched.txt');
    await until(() => fs.existsSync(relaunched) && fs.readFileSync(relaunched, 'utf8'));
    expect(fs.readFileSync(relaunched, 'utf8')).toBe('started 0.2.0 \n');
    expect(fs.readFileSync(path.join(home, 'logs', 'update.log'), 'utf8')).toMatch(/Library Search: 0\.1\.0 -> 0\.2\.0/);

    // The next start is the new version: it reports the update once and tidies up.
    const next = updater(appDir, { version: '0.2.0' });
    expect(next.status()).toMatchObject({ state: 'idle', updatedFrom: '0.1.0' });
    expect(fs.readdirSync(path.join(home, 'dist', '.update'))).toEqual([]);
  });

  it('closing the app installs the update; if the app is open again, it waits for the next close', async () => {
    const appDir = installed('busy (Kit) +1');
    const home = homeOf(appDir);
    const dest = path.join(home, 'dist', 'library-search-linux-ia32');
    const u = updater(appDir);
    await u.check(true);
    await until(() => u.status().state === 'ready');

    // Someone opened the app again: a process whose command line runs <dest>/library-search.
    let running: ChildProcess | null = spawn('/bin/sh', ['-c', 'sleep 60; exit 0', path.join(dest, 'library-search')], { stdio: 'ignore' });
    try {
      expect(u.installOnExit()).toBe(true);
      const statusFile = path.join(home, 'dist', '.update', 'install-status.txt');
      await until(() => fs.existsSync(statusFile) && fs.readFileSync(statusFile, 'utf8'));
      expect(fs.readFileSync(statusFile, 'utf8')).toBe('busy\n');
      expect(fs.readFileSync(path.join(dest, 'app-version.txt'), 'utf8')).toBe('0.1.0\n');
      expect(fs.existsSync(path.join(dest, 'relaunched.txt'))).toBe(false); // closing never restarts it
    } finally {
      running.kill();
      running = null;
    }

    // Next start (still 0.1.0): the download waits, no error, and the next close installs it.
    const again = updater(appDir);
    expect(again.status()).toMatchObject({ state: 'ready', downloaded: '0.2.0' });
    expect(again.status().error).toBeUndefined();
    expect(again.installOnExit()).toBe(true);
    const statusFile = path.join(home, 'dist', '.update', 'install-status.txt');
    await until(() => fs.existsSync(statusFile) && fs.readFileSync(statusFile, 'utf8'));
    expect(fs.readFileSync(statusFile, 'utf8')).toBe('ok 0.2.0\n');
    expect(fs.readFileSync(path.join(dest, 'app-version.txt'), 'utf8')).toBe('0.2.0\n');
  });

  it('opened again while the script still waits: the next close replaces that script, never two at once', async () => {
    const appDir = installed('reopen');
    const home = homeOf(appDir);
    const dest = path.join(home, 'dist', 'library-search-linux-ia32');
    const env = Object.assign({}, process.env, { HOME: path.join(tmp, 'user'), XDG_CONFIG_HOME: '', LIBRARY_SEARCH_WAIT_SECONDS: '60' });
    const marker = path.join(home, 'dist', '.update', 'installing.json');
    const statusFile = path.join(home, 'dist', '.update', 'install-status.txt');
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return false;
      }
    };
    const u = updater(appDir, { env });
    await u.check(true);
    await until(() => u.status().state === 'ready');
    const running = spawn('/bin/sh', ['-c', 'sleep 60; exit 0', path.join(dest, 'library-search')], { stdio: 'ignore' });
    try {
      expect(u.installOnExit()).toBe(true); // closed ... and opened again right away (`running`)
      const first = JSON.parse(fs.readFileSync(marker, 'utf8')).pid as number;
      expect(alive(first)).toBe(true);

      const again = updater(appDir, { env });
      expect(again.status()).toMatchObject({ state: 'ready', downloaded: '0.2.0' });
      expect(fs.existsSync(marker)).toBe(true); // kept: that script is still waiting
      expect(again.installOnExit()).toBe(true);
      await until(() => !alive(first), 10000);
      expect(JSON.parse(fs.readFileSync(marker, 'utf8')).pid).not.toBe(first);
    } finally {
      running.kill();
    }
    await until(() => fs.existsSync(statusFile) && fs.readFileSync(statusFile, 'utf8'));
    expect(fs.readFileSync(statusFile, 'utf8')).toBe('ok 0.2.0\n');
    expect(fs.readFileSync(path.join(dest, 'app-version.txt'), 'utf8')).toBe('0.2.0\n');
  });

  it('a failed install keeps the old version, explains why, and is not retried by itself', async () => {
    const appDir = installed('failed');
    const home = homeOf(appDir);
    const u = updater(appDir);
    await u.check(true);
    await until(() => u.status().state === 'ready');
    // The file gets damaged on disk after the download (the script checks it against the .sha256 again).
    fs.writeFileSync(path.join(home, 'dist', '.update', TAR_NAME), 'not a tarball');
    expect(u.installOnExit()).toBe(true);
    const statusFile = path.join(home, 'dist', '.update', 'install-status.txt');
    await until(() => fs.existsSync(statusFile) && fs.readFileSync(statusFile, 'utf8'));
    expect(fs.readFileSync(statusFile, 'utf8')).toMatch(/^failed The file is damaged/);
    expect(fs.readFileSync(path.join(home, 'dist', 'library-search-linux-ia32', 'app-version.txt'), 'utf8')).toBe('0.1.0\n');

    const next = updater(appDir);
    expect(next.status()).toMatchObject({ state: 'error', downloaded: '0.2.0', error: { code: 'update-install-failed' } });
    expect(next.status().error!.message).toMatch(/Version 0\.2\.0 could not be installed: The file is damaged/);
    expect(next.installOnExit()).toBe(false);
  });
});

describe('HTTP API', () => {
  it('reports update status, follows the setting, and closes the app for "Restart now"', async () => {
    const appDir = installed('api', { auto: false });
    const app = new App(resolveConfig(['--no-kiwix-autostart', '--kiwix-port', '1'], appDir), 't', {
      updater: { version: '0.1.0', repo: 'owner/libsearch', apiBase: gh.apiBase, token: '', arch: 'ia32', platform: 'linux', env: Object.assign({}, process.env, { HOME: path.join(tmp, 'user'), XDG_CONFIG_HOME: '' }) },
    });
    let quit = 0;
    app.onQuitForUpdate = () => quit++;
    const { server, base } = await listen((req, res) => void app.handle(req, res));
    const call = (method: string, p: string, body?: unknown) =>
      new Promise<any>((resolve, reject) => {
        const req = http.request(base + p, { method, headers: { 'X-Token': 't', 'Content-Type': 'application/json' } }, (res) => {
          let b = '';
          res.on('data', (d) => (b += d));
          res.on('end', () => resolve(b ? JSON.parse(b) : null));
        });
        req.on('error', reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    try {
      expect((await call('GET', '/api/status')).update).toMatchObject({ state: 'idle', current: '0.1.0', auto: false });
      expect(await call('POST', '/api/update/check', {})).toMatchObject({ state: 'available', latest: '0.2.0' });
      // Turning automatic updates on downloads the version that was found.
      expect((await call('POST', '/api/settings', { autoUpdate: true })).autoUpdate).toBe(true);
      await until(() => app.updater.status().state === 'ready');
      expect((await call('POST', '/api/update/install', {})).state).toBe('installing');
      await until(() => quit === 1, 3000);
      const statusFile = path.join(homeOf(appDir), 'dist', '.update', 'install-status.txt');
      await until(() => fs.existsSync(statusFile) && fs.readFileSync(statusFile, 'utf8'));
      expect(fs.readFileSync(statusFile, 'utf8')).toBe('ok 0.2.0\n');
    } finally {
      app.shutdown();
      server.close();
    }
  });
});
