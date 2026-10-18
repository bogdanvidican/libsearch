// The Kiwix reader (kiwix-tools): downloaded and unpacked into the library's Kiwix folder when it is missing.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureKiwixTools, kiwixArch, newestToolsFile } from '../../src/downloader/kiwixtools';

let tmp: string;
let server: http.Server;
let base = '';
let tarball: Buffer;
let listing = '';
const asked: string[] = [];
let n = 0;

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-kiwixtools-')));
  const src = path.join(tmp, 'src', 'kiwix-tools_linux-i586-3.8.1');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'kiwix-serve'), '#!/bin/sh\necho kiwix-serve 3.8.1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(src, 'kiwix-manage'), '#!/bin/sh\n', { mode: 0o755 });
  const tgz = path.join(tmp, 'tools.tar.gz');
  expect(spawnSync('tar', ['-czf', tgz, '-C', path.join(tmp, 'src'), 'kiwix-tools_linux-i586-3.8.1'], { env: Object.assign({}, process.env, { COPYFILE_DISABLE: '1' }) }).status).toBe(0);
  tarball = fs.readFileSync(tgz);
  server = http.createServer((req, res) => {
    const u = req.url || '';
    asked.push(u);
    if (u === '/') return res.end('ok');
    if (u === '/release/kiwix-tools/') return res.end(listing);
    if (/^\/release\/kiwix-tools\/kiwix-tools_linux-i586-[0-9.]+\.tar\.gz$/.test(u)) return res.end(tarball);
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

function kiwixDir(): string {
  const d = path.join(tmp, `lib-${++n}`, '15 Offline Encyclopedias (Kiwix)');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function opts(extra: { arch?: string; platform?: string } = {}) {
  return { mirror: base, arch: extra.arch || 'ia32', platform: extra.platform || 'linux', stallMs: 5000, isCancelled: () => false, log: () => undefined };
}

describe('kiwix-tools', () => {
  it('names the builds the way Kiwix does', () => {
    expect([kiwixArch('ia32'), kiwixArch('x64'), kiwixArch('arm64'), kiwixArch('arm'), kiwixArch('mips')]).toEqual(['i586', 'x86_64', 'aarch64', 'armhf', null]);
    const l = ['kiwix-tools_linux-i586-3.7.0.tar.gz', 'kiwix-tools_linux-i586-3.10.0.tar.gz', 'kiwix-tools_linux-i586-3.8.1.tar.gz', 'kiwix-tools_linux-x86_64-3.11.0.tar.gz'].map((f) => `<a href="${f}">${f}</a>`).join('\n');
    expect(newestToolsFile(l, 'i586')).toBe('kiwix-tools_linux-i586-3.10.0.tar.gz'); // version order, not text order
    expect(newestToolsFile(l, 'armhf')).toBeNull();
  });

  it('downloads the newest build for this computer and unpacks kiwix-serve into kiwix-tools/', async () => {
    listing = ['kiwix-tools_linux-i586-3.7.0.tar.gz', 'kiwix-tools_linux-i586-3.8.1.tar.gz', 'kiwix-tools_linux-x86_64-3.9.0.tar.gz'].map((f) => `<a href="${f}">${f}</a>`).join('\n');
    const dir = kiwixDir();
    expect(await ensureKiwixTools(dir, opts())).toBe('installed');
    const serve = path.join(dir, 'kiwix-tools', 'kiwix-serve');
    expect(fs.statSync(serve).mode & 0o111).not.toBe(0);
    expect(fs.readFileSync(serve, 'utf8')).toContain('3.8.1');
    expect(asked).toContain('/release/kiwix-tools/kiwix-tools_linux-i586-3.8.1.tar.gz');
    expect(fs.readdirSync(dir).sort()).toEqual(['kiwix-tools']); // the tar.gz is gone
  });

  it('falls back to 3.7.0, the last version with a 32-bit build, when the listing has none', async () => {
    listing = '<a href="kiwix-tools_linux-x86_64-3.9.0.tar.gz">x</a>';
    const dir = kiwixDir();
    expect(await ensureKiwixTools(dir, opts())).toBe('installed');
    expect(asked).toContain('/release/kiwix-tools/kiwix-tools_linux-i586-3.7.0.tar.gz');
  });

  it('leaves a reader that is already there alone', async () => {
    const dir = kiwixDir();
    fs.mkdirSync(path.join(dir, 'kiwix-tools'));
    fs.writeFileSync(path.join(dir, 'kiwix-tools', 'kiwix-serve'), '#!/bin/sh\n', { mode: 0o755 });
    const before = asked.length;
    expect(await ensureKiwixTools(dir, opts())).toBe('present');
    expect(asked.length).toBe(before);
  });

  it('on macOS it says the reader must be installed another way, and downloads nothing', async () => {
    const before = asked.length;
    expect(await ensureKiwixTools(kiwixDir(), opts({ platform: 'darwin' }))).toBe('unsupported');
    expect(asked.length).toBe(before);
  });
});
