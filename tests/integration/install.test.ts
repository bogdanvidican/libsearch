// The install script (kit/6-install-or-update-search-app.sh) with a release built from the real kit/: everything the
// download kit needs ships inside the app, so the script leaves the library / old kit folder alone.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = path.join(__dirname, '..', '..');
const INSTALLER = path.join(REPO, 'kit', '6-install-or-update-search-app.sh');
const PKG = 'library-search-linux-ia32';

let tmp: string;
let tarball: string;

function copyDir(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const s = path.join(src, n);
    const d = path.join(dst, n);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** Every file below dir with its contents, skipping the app folder an install puts there. */
function snapshot(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of fs.readdirSync(path.join(dir, rel))) {
    const r = rel ? `${rel}/${n}` : n;
    if (r === 'library-search-app') continue;
    const abs = path.join(dir, r);
    if (fs.statSync(abs).isDirectory()) Object.assign(out, snapshot(dir, r));
    else out[r] = fs.readFileSync(abs, 'utf8');
  }
  return out;
}

function install(args: string[], cwd: string): { code: number; out: string } {
  const r = spawnSync('bash', [INSTALLER, ...args], {
    cwd,
    env: Object.assign({}, process.env, { HOME: path.join(tmp, 'user'), XDG_CONFIG_HOME: '' }),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  return { code: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function mkdirs(...parts: string[]): string {
  const d = path.join(tmp, ...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-install-')));
  const top = path.join(tmp, 'release-src', PKG);
  copyDir(path.join(REPO, 'kit'), path.join(top, 'resources', 'app', 'kit'));
  fs.writeFileSync(path.join(top, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'library-search', version: '0.4.0' }, null, 2));
  fs.writeFileSync(path.join(top, 'library-search'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(top, 'app-version.txt'), '0.4.0\n');
  tarball = path.join(tmp, `${PKG}-v0.4.0.tar.gz`);
  const r = spawnSync('tar', ['-czf', tarball, '-C', path.join(tmp, 'release-src'), PKG], {
    env: Object.assign({}, process.env, { COPYFILE_DISABLE: '1' }),
  });
  expect(r.status).toBe(0);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('install script and the old kit folder', () => {
  it('leaves an old kit folder alone', () => {
    const kit = mkdirs('Old Kit & Co (1)');
    for (const f of ['0-README-start-here.md', 'booklist-main.txt', '6-search-the-library.sh', '6-search-the-library.desktop', '6-install-or-update-search-app.sh']) {
      fs.writeFileSync(path.join(kit, f), 'old\n');
    }
    const before = snapshot(kit);
    const r = install([tarball, '--dir', path.join(kit, 'library-search-app'), '--no-pin'], kit);
    expect(r.code, r.out).toBe(0);
    expect(fs.readFileSync(path.join(kit, 'library-search-app', 'dist', PKG, 'app-version.txt'), 'utf8')).toBe('0.4.0\n');
    expect(snapshot(kit)).toEqual(before);
  });

  it('accepts --kit and ignores it', () => {
    const other = mkdirs('Other Kit');
    fs.writeFileSync(path.join(other, '0-README-start-here.md'), 'old\n');
    const r = install([tarball, '--dir', mkdirs('app2'), '--kit', other, '--no-pin'], mkdirs('cwd2'));
    expect(r.code, r.out).toBe(0);
    expect(snapshot(other)).toEqual({ '0-README-start-here.md': 'old\n' });
  });

  it('says where the download scripts are', () => {
    const home = mkdirs('app3');
    const r = install([tarball, '--dir', home, '--no-pin'], mkdirs('cwd3'));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(path.join(home, 'dist', PKG, 'resources', 'app', 'kit', '2-download-pdf-books.sh'));
  });

  it('a failed download points to the certificate fix inside the installed app, or to Firefox before the app is there', () => {
    const home = mkdirs('app4');
    expect(install([tarball, '--dir', home, '--no-pin'], home).code).toBe(0);
    const failed = install(['http://127.0.0.1:1/x.tar.gz', '--dir', home, '--no-pin'], home);
    expect(failed.code).toBe(1);
    expect(failed.out).toContain(`sudo bash "${path.join(home, 'dist', PKG, 'resources', 'app', 'kit', '1-fix-https-certificates.sh')}"`);
    const fresh = install(['http://127.0.0.1:1/x.tar.gz', '--dir', mkdirs('app5'), '--no-pin'], mkdirs('cwd5'));
    expect(fresh.code).toBe(1);
    expect(fresh.out).toContain('from the GitHub release page in Firefox');
  });
});
