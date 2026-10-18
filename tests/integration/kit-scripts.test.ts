// The download scripts in kit/ run from inside the app and work on the library folder: they pick the folder,
// read the app's book lists plus the library's booklist-local.txt, and never put anything inside the app.
// A local HTTP server stands in for the internet; fake curl / firefox / kiwix-serve keep everything offline.
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_KIT = path.join(__dirname, '..', '..', 'kit');
const KIWIX = '15 Offline Encyclopedias (Kiwix)';

let tmp: string;
let base: string;
let server: http.Server;
let browserBin: string; // a no-op firefox
let offlineBin: string; // no-op firefox + a curl that always fails (scripts 3 and 4 would go to download.kiwix.org)
let oldCertsBin: string; // a curl that fails like Ubuntu 16.04's with expired certificates (error 60)
let caseNo = 0;

function copyDir(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const s = path.join(src, n);
    const d = path.join(dst, n);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function writeExe(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
}

/** Every file below dir, relative, sorted. */
function listFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const n of fs.readdirSync(path.join(dir, rel))) {
    const r = rel ? `${rel}/${n}` : n;
    if (fs.statSync(path.join(dir, r)).isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out.sort();
}

interface Case {
  root: string;
  kit: string;
  lib: string;
}

/** A fresh copy of kit/ at <case>/app/kit with test book lists (the real ones would go to the internet), and a
 *  library folder holding "01 Medicine". linux: undefined = no booklist-linux.txt. */
function kitCopy(lists: { main?: string; linux?: string } = {}): Case {
  const root = path.join(tmp, `case-${++caseNo}`);
  const kit = path.join(root, 'app', 'kit');
  copyDir(REPO_KIT, kit);
  fs.writeFileSync(path.join(kit, 'booklists', 'booklist-main.txt'), lists.main !== undefined ? lists.main : '# test list\n');
  const linux = path.join(kit, 'booklists', 'booklist-linux.txt');
  if (lists.linux !== undefined) fs.writeFileSync(linux, lists.linux);
  else fs.unlinkSync(linux);
  const lib = path.join(root, 'Community Rebuild Library', 'Library & Co (test)');
  fs.mkdirSync(path.join(lib, '01 Medicine'), { recursive: true });
  return { root, kit, lib };
}

/** Runs a kit script with bash. Async: the test HTTP server lives in this process. */
function run(file: string, args: string[], opts: { cwd: string; offline?: boolean; bin?: string }): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, {
      PATH: `${opts.bin || (opts.offline ? offlineBin : browserBin)}${path.delimiter}${process.env.PATH}`,
      LIBRARY_KIT_CHECK_URL: `${base}/`,
    });
    const child = spawn('bash', [file, ...args], { cwd: opts.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code: code === null ? -1 : code, out }));
  });
}

/** Calls pick_library from the repo's kit/library-folder.sh as if the script lived in kitDir. */
function pick(kitDir: string, args: string[], cwd: string): { code: number; library: string; shift: string; out: string } {
  const r = spawnSync(
    'bash',
    [
      '-c',
      '. "$1/library-folder.sh" && shift && pick_library "$@"; rc=$?; printf "\\nRESULT|%s|%s|%s\\n" "$rc" "$LIBRARY" "$LIBRARY_SHIFT"',
      path.join(kitDir, '2-download-pdf-books.sh'),
      REPO_KIT,
      ...args,
    ],
    { cwd, env: Object.assign({}, process.env, { KIT_DIR: kitDir }), encoding: 'utf8' }
  );
  const out = (r.stdout || '') + (r.stderr || '');
  const m = /^RESULT\|(\d+)\|(.*)\|(.*)$/m.exec(r.stdout || '') || ['', '-1', '', ''];
  return { code: Number(m[1]), library: m[2], shift: m[3], out };
}

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-kit-')));
  browserBin = path.join(tmp, 'bin-browser');
  writeExe(path.join(browserBin, 'firefox'), '#!/bin/sh\nexit 0\n');
  offlineBin = path.join(tmp, 'bin-offline');
  writeExe(path.join(offlineBin, 'firefox'), '#!/bin/sh\nexit 0\n');
  writeExe(path.join(offlineBin, 'curl'), `#!/bin/sh\necho "$*" >>"${path.join(tmp, 'curl.log')}"\nexit 7\n`);
  oldCertsBin = path.join(tmp, 'bin-old-certs');
  writeExe(path.join(oldCertsBin, 'curl'), '#!/bin/sh\necho "curl: (60) SSL certificate problem: certificate has expired" >&2\nexit 60\n');
  server = http.createServer((req, res) => {
    const u = req.url || '';
    if (u.indexOf('/pdf/') === 0) {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end('%PDF-1.4\n%test\n');
    } else if (u.indexOf('/html/') === 0) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>bot check</html>');
    } else {
      res.end('ok');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('library folder', () => {
  it('takes the first argument when it is a folder, and shifts it away', () => {
    const c = kitCopy();
    const r = pick(c.kit, [c.lib, 'es'], c.root);
    expect(r.code).toBe(0);
    expect(r.library).toBe(c.lib);
    expect(r.shift).toBe('1');
  });

  it('uses the current folder when it holds numbered topic folders', () => {
    const c = kitCopy();
    const r = pick(c.kit, ['es'], c.lib);
    expect(r.code).toBe(0);
    expect(r.library).toBe(c.lib);
    expect(r.shift).toBe('0');
  });

  it('explains and stops when started elsewhere without a folder', () => {
    const c = kitCopy();
    const empty = path.join(c.root, 'empty');
    fs.mkdirSync(empty);
    const r = pick(c.kit, [], empty);
    expect(r.code).toBe(1);
    expect(r.out).toContain('!! Which folder is your library? Start this inside it, or name it:');
    expect(r.out).toContain(`bash "${path.join(c.kit, '2-download-pdf-books.sh')}" "/path/to/your library"`);
    expect(fs.readdirSync(empty)).toEqual([]);
  });

  it('refuses folders inside the app', () => {
    const pkg = path.join(tmp, 'pkg');
    const home = path.join(pkg, 'home');
    const pkgKit = path.join(home, 'dist', 'library-search-linux-ia32', 'resources', 'app', 'kit');
    const books = path.join(home, 'books');
    fs.mkdirSync(pkgKit, { recursive: true });
    fs.mkdirSync(path.join(books, '01 Medicine'), { recursive: true });
    const co = path.join(tmp, 'co');
    fs.mkdirSync(path.join(co, 'kit'), { recursive: true });
    fs.mkdirSync(path.join(co, 'books'), { recursive: true });
    fs.writeFileSync(path.join(co, 'package.json'), JSON.stringify({ name: 'library-search', version: '0.4.0' }, null, 2));
    const link = path.join(tmp, 'link');
    fs.symlinkSync(books, link);

    const refused = (kitDir: string, args: string[], cwd: string, appHome: string) => {
      const r = pick(kitDir, args, cwd);
      expect(r.code, `${args.join(' ')} from ${cwd}`).toBe(1);
      expect(r.out).toContain(`is inside the app's folder (${appHome}). Books kept there would be lost when the app is deleted or reinstalled. Name a library folder outside the app.`);
    };
    refused(pkgKit, [pkgKit], tmp, home);
    refused(pkgKit, [home], tmp, home);
    refused(pkgKit, [books], tmp, home);
    refused(pkgKit, [], books, home); // started inside it, no argument
    refused(path.join(co, 'kit'), [path.join(co, 'books')], tmp, co);
    refused(pkgKit, [link], tmp, home);
    expect(fs.readdirSync(books)).toEqual(['01 Medicine']);
  });

  it('stops on a folder argument that does not exist, instead of using the current library', () => {
    const c = kitCopy();
    const typo = path.join(c.root, 'Libary');
    const r = pick(c.kit, [typo], c.lib);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`!! There is no folder "${typo}". Check the name, or start this inside your library folder without naming it.`);
    expect(fs.existsSync(typo)).toBe(false);
  });

  it('accepts the library that holds the app', () => {
    const pkg = path.join(tmp, 'holds');
    const pkgKit = path.join(pkg, 'library-search-app', 'dist', 'library-search-linux-ia32', 'resources', 'app', 'kit');
    fs.mkdirSync(pkgKit, { recursive: true });
    fs.mkdirSync(path.join(pkg, '01 Medicine'));
    const r = pick(pkgKit, [pkg], tmp);
    expect(r.code).toBe(0);
    expect(r.library).toBe(pkg);
  });
});

describe('2-download-pdf-books.sh', () => {
  it("downloads the books of booklist-main, booklist-linux and the library's booklist-local into the library", async () => {
    const c = kitCopy({
      main: `# test\nF|02 Water & Sanitation|Main_Book.pdf|${base}/pdf/main%20(1).pdf?a=1&b=2\n`,
      linux: `F|16 Linux & Ubuntu|Linux_Book.pdf|${base}/pdf/linux.pdf\n`,
    });
    fs.writeFileSync(path.join(c.lib, 'booklist-local.txt'), `F|99 My Books/Sub, folder|Local_Book.pdf|${base}/pdf/local.pdf\n`);
    const kitBefore = listFiles(c.kit);
    const r = await run(path.join(c.kit, '2-download-pdf-books.sh'), [c.lib], { cwd: c.root });
    expect(r.code, r.out).toBe(0);
    for (const f of ['02 Water & Sanitation/Main_Book.pdf', '16 Linux & Ubuntu/Linux_Book.pdf', '99 My Books/Sub, folder/Local_Book.pdf']) {
      expect(fs.readFileSync(path.join(c.lib, f), 'utf8').slice(0, 4), f).toBe('%PDF');
    }
    expect(listFiles(c.kit)).toEqual(kitBefore);
    expect(r.out).toContain('Downloaded: 3');
  });

  it('creates booklist-local.txt in the library from the template when missing', async () => {
    const c = kitCopy();
    const r = await run(path.join(c.kit, '2-download-pdf-books.sh'), [c.lib], { cwd: c.root });
    expect(r.code, r.out).toBe(0);
    expect(fs.readFileSync(path.join(c.lib, 'booklist-local.txt'), 'utf8')).toBe(
      fs.readFileSync(path.join(REPO_KIT, 'booklists', 'booklist-local-template.txt'), 'utf8')
    );
  });

  it('reads lists saved without a final newline or with Windows line ends', async () => {
    const c = kitCopy({ linux: `F|16 Linux & Ubuntu|Linux_Book.pdf|${base}/pdf/linux.pdf` });
    fs.writeFileSync(
      path.join(c.lib, 'booklist-local.txt'),
      `F|99 Mine|A.pdf|${base}/pdf/a.pdf\r\nF|99 Mine|B.pdf|${base}/pdf/b.pdf`
    );
    const r = await run(path.join(c.kit, '2-download-pdf-books.sh'), [], { cwd: c.lib }); // started inside the library
    expect(r.code, r.out).toBe(0);
    for (const f of ['16 Linux & Ubuntu/Linux_Book.pdf', '99 Mine/A.pdf', '99 Mine/B.pdf']) {
      expect(fs.existsSync(path.join(c.lib, f)), f).toBe(true);
    }
    expect(listFiles(c.lib).filter((f) => f.indexOf('\r') >= 0)).toEqual([]);
  });

  it('reads a local list saved with a byte order mark (Windows Notepad)', async () => {
    const c = kitCopy();
    fs.writeFileSync(path.join(c.lib, 'booklist-local.txt'), `﻿F|99 Mine|First.pdf|${base}/pdf/first.pdf\n`);
    const r = await run(path.join(c.kit, '2-download-pdf-books.sh'), [c.lib], { cwd: c.root });
    expect(r.code, r.out).toBe(0);
    expect(fs.existsSync(path.join(c.lib, '99 Mine', 'First.pdf')), r.out).toBe(true);
  });

  it('points to the certificate fix inside the app when curl says the certificates are too old', async () => {
    const c = kitCopy();
    const r = await run(path.join(c.kit, '2-download-pdf-books.sh'), [c.lib], { cwd: c.root, bin: oldCertsBin });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`sudo bash "${path.join(c.kit, '1-fix-https-certificates.sh')}"`);
  });

  it('lists a failed book from the local list for Firefox', async () => {
    const c = kitCopy();
    fs.writeFileSync(path.join(c.lib, 'booklist-local.txt'), `F|99 Mine|X.pdf|${base}/html/x.pdf\n`);
    const r = await run(path.join(c.kit, '2-download-pdf-books.sh'), [c.lib], { cwd: c.root });
    expect(r.code, r.out).toBe(0);
    expect(fs.readFileSync(path.join(c.lib, '2-failed-downloads.txt'), 'utf8')).toContain(`99 Mine|X.pdf|${base}/html/x.pdf`);
    expect(fs.readFileSync(path.join(c.lib, '2-failed-downloads-open-in-firefox.html'), 'utf8')).toContain(`href="${base}/html/x.pdf"`);
    expect(fs.existsSync(path.join(c.lib, '99 Mine', 'X.pdf'))).toBe(false);
  });

  it('the template has no entries, only comments', () => {
    const lines = fs
      .readFileSync(path.join(REPO_KIT, 'booklists', 'booklist-local-template.txt'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((l) => !l.startsWith('#'))).toEqual([]);
  });
});

describe('scripts 3-5', () => {
  it('3 and 4 put the Kiwix folder in the library, not next to the script', async () => {
    for (const script of ['3-download-offline-wikipedia.sh', '4-download-khan-academy.sh']) {
      const c = kitCopy();
      await run(path.join(c.kit, script), [c.lib], { cwd: c.root, offline: true });
      expect(fs.existsSync(path.join(c.lib, KIWIX)), script).toBe(true);
      expect(fs.existsSync(path.join(c.kit, KIWIX)), script).toBe(false);
    }
  });

  it('5 starts kiwix-serve from the library with its ZIM files', async () => {
    const c = kitCopy();
    const log = path.join(c.root, 'kiwix-serve.log');
    writeExe(path.join(c.lib, KIWIX, 'kiwix-tools', 'kiwix-serve'), `#!/bin/sh\npwd -P >"${log}"\nprintf '%s\\n' "$@" >>"${log}"\nexit 0\n`);
    fs.writeFileSync(path.join(c.lib, KIWIX, 'wikimed.zim'), 'ZIM');
    const r = await run(path.join(c.kit, '5-start-offline-library-in-firefox.sh'), [c.lib], { cwd: c.root });
    expect(fs.existsSync(log), r.out).toBe(true);
    expect(fs.readFileSync(log, 'utf8').split('\n')).toEqual([c.lib, '--port=8080', `${KIWIX}/wikimed.zim`, '']);
  });
});
