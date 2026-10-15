// One bad ZIM file must not stop the other encyclopedias (seen on the CF-30 with a half-downloaded
// wikipedia_ro_all_maxi file: kiwix-serve refuses to start at all).
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/server/config';
import { inspectZim, Kiwix } from '../../src/server/kiwix';

let tmp: string;
let kiwixDir: string;

/** A ZIM-like file: real header magic + checksum position; `cut` bytes missing at the end. */
function fakeZim(file: string, total: number, cut = 0) {
  const h = Buffer.alloc(total - cut);
  h.writeUInt32LE(72173914, 0);
  h.writeUInt32LE(total - 16, 72); // checksumPos (low 32 bits)
  h.writeUInt32LE(0, 76);
  fs.writeFileSync(file, h);
}

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-kiwix-')));
  kiwixDir = path.join(tmp, 'lib', '15 Offline Encyclopedias (Kiwix)');
  fs.mkdirSync(path.join(tmp, 'lib', '01 Medicine'), { recursive: true });
  fs.mkdirSync(kiwixDir, { recursive: true });
  fakeZim(path.join(kiwixDir, 'wikipedia_en_medicine_maxi.zim'), 4096);
  fakeZim(path.join(kiwixDir, 'wikipedia_ro_all_maxi_2026-09.zim'), 4096, 1500); // still downloading
  fakeZim(path.join(kiwixDir, 'broken_but_complete.zim'), 4096); // the fake kiwix-serve rejects this one
  fs.writeFileSync(path.join(kiwixDir, 'notes.zim'), 'not a zim file at all, just text that is long enough to have a header area......');
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('inspectZim', () => {
  it('spots partial downloads, non-ZIM files and complete files', () => {
    expect(inspectZim(path.join(kiwixDir, 'wikipedia_en_medicine_maxi.zim')).ok).toBe(true);
    const partial = inspectZim(path.join(kiwixDir, 'wikipedia_ro_all_maxi_2026-09.zim'));
    expect(partial).toMatchObject({ ok: false, code: 'incomplete' });
    expect(partial.reason).toMatch(/Only partly downloaded: .* \(63%\)/);
    expect(inspectZim(path.join(kiwixDir, 'notes.zim'))).toMatchObject({ ok: false, code: 'not-zim' });
    fs.writeFileSync(path.join(tmp, 'empty.zim'), '');
    expect(inspectZim(path.join(tmp, 'empty.zim'))).toMatchObject({ ok: false, code: 'incomplete' });
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

describe('starting kiwix-serve with a bad file among good ones', () => {
  it('leaves the bad files out, starts with the rest, and says why', async () => {
    // Fake kiwix-serve: like the real one, it exits when any file can't be added; otherwise it serves a catalog.
    const fake = path.join(tmp, 'kiwix-serve');
    fs.writeFileSync(
      fake,
      `#!/usr/bin/env node
const http = require('http');
const port = Number(process.argv.find((a) => a.startsWith('--port=')).slice(7));
const zims = process.argv.slice(2).filter((a) => a.endsWith('.zim'));
const bad = zims.find((z) => z.indexOf('broken') >= 0);
if (bad) { console.error("Unable to add the ZIM file '" + bad + "' to the internal library."); process.exit(1); }
http.createServer((req, res) => {
  res.end('<feed>' + zims.map((z, i) => '<entry><id>urn:uuid:' + i + '</id><title>' + z + '</title><name>n' + i + '</name><link type="text/html" href="/content/n' + i + '"/></entry>').join('') + '</feed>');
}).listen(port, '127.0.0.1');
`
    );
    fs.chmodSync(fake, 0o755);
    const port = await freePort();
    const kiwix = new Kiwix(
      resolveConfig(['--library-root', path.join(tmp, 'lib'), '--kiwix-serve', fake, '--kiwix-port', String(port)], tmp)
    );
    try {
      const s = await kiwix.start();
      expect(s.state).toBe('running');
      expect(s.books).toBe(1);
      const skipped = (s.skipped || []).map((z) => [z.file, z.code]).sort();
      expect(skipped).toEqual([
        ['broken_but_complete.zim', 'rejected'],
        ['notes.zim', 'not-zim'],
        ['wikipedia_ro_all_maxi_2026-09.zim', 'incomplete'],
      ]);
      expect((s.skipped || []).every((z) => z.fix.length > 0)).toBe(true);
    } finally {
      kiwix.stop();
    }
  });
});
