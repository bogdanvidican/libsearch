// Encyclopedia downloads: the newest file per prefix, resumed across dropped connections, renamed only when whole.
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DownloadProgress } from '../../src/shared/api';
import { loadState } from '../../src/downloader/state';
import { ZimEntry } from '../../src/downloader/zimlist';
import { downloadZims, ZimJob } from '../../src/downloader/zims';

const MAGIC = Buffer.from([0x5a, 0x49, 0x4d, 0x04]);
const ZIM = Buffer.concat([MAGIC, Buffer.alloc(60000, 7)]);
const NOT_ZIM = Buffer.from('<html>not a zim</html>' + 'x'.repeat(1000));

let tmp: string;
let server: http.Server;
let base = '';
let n = 0;
const ranges: Record<string, string[]> = {};
/** Requests of /zim/flaky/... that are cut off part way (the first two). */
let flakyCuts = 0;

function entry(dir: string, prefix: string, gb = 1): ZimEntry {
  return { id: prefix, dir, prefix, approxGb: gb, defaultOn: true, title: prefix, line: 1 };
}

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer, opts: { cutAt?: number; total?: number; slow?: boolean } = {}) {
  const total = opts.total || body.length;
  const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ''));
  const from = m ? Number(m[1]) : 0;
  const to = m && m[2] ? Number(m[2]) : body.length - 1;
  const slice = body.slice(from, to + 1);
  res.writeHead(m ? 206 : 200, m ? { 'Content-Range': `bytes ${from}-${to}/${total}`, 'Content-Length': slice.length } : { 'Content-Length': total });
  if (opts.cutAt !== undefined) {
    res.write(slice.slice(0, opts.cutAt));
    setTimeout(() => res.destroy(), 20);
    return;
  }
  if (opts.slow) {
    let at = 0;
    const t = setInterval(() => {
      if (res.destroyed) return clearInterval(t);
      res.write(slice.slice(at, at + 2000));
      at += 2000;
      if (at >= slice.length) {
        clearInterval(t);
        res.end();
      }
    }, 20);
    res.on('close', () => clearInterval(t));
    return;
  }
  res.end(slice);
}

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-zims-')));
  server = http.createServer((req, res) => {
    const u = (req.url || '').split('?')[0];
    (ranges[u] = ranges[u] || []).push(String(req.headers.range || ''));
    if (u === '/') return res.end('ok');
    if (/\/$/.test(u)) {
      const folder = u.split('/')[2];
      const names: Record<string, string[]> = {
        wiki: ['test_a_2025-01.zim', 'test_a_2026-01.zim', 'other_2026-02.zim'],
        flaky: ['test_flaky_2026-01.zim'],
        big: ['test_big_2026-01.zim'],
        bad: ['test_bad_2026-01.zim'],
        slow: ['test_slow_2026-01.zim'],
      };
      return res.end((names[folder] || []).map((f) => `<a href="${f}">${f}</a>  2026-01-01 00:00  1G`).join('\n'));
    }
    if (u === '/zim/wiki/test_a_2026-01.zim') return serveFile(req, res, ZIM);
    if (u === '/zim/flaky/test_flaky_2026-01.zim') {
      const isProbe = req.headers.range === 'bytes=0-0';
      if (!isProbe && flakyCuts < 2) {
        flakyCuts++;
        return serveFile(req, res, ZIM, { cutAt: 15000 });
      }
      return serveFile(req, res, ZIM);
    }
    if (u === '/zim/big/test_big_2026-01.zim') return serveFile(req, res, ZIM, { total: 5 * 1073741824 });
    if (u === '/zim/bad/test_bad_2026-01.zim') return serveFile(req, res, NOT_ZIM);
    if (u === '/zim/slow/test_slow_2026-01.zim') return serveFile(req, res, ZIM, { slow: true });
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

function job(entries: ZimEntry[], extra: Partial<ZimJob> = {}): { o: ZimJob; dir: string; lib: string } {
  const lib = path.join(tmp, `lib-${++n}`);
  const dir = path.join(lib, '15 Offline Encyclopedias (Kiwix)');
  fs.mkdirSync(dir, { recursive: true });
  const o: ZimJob = {
    library: lib,
    kiwixDir: dir,
    entries,
    mirror: base,
    retries: 5,
    retryDelayMs: 10,
    stallMs: 5000,
    minFreeMb: 0,
    disk: { type: () => 'ext2/ext3', free: () => 100 * 1073741824 },
    ...extra,
  };
  return { o, dir, lib };
}

function run(o: ZimJob, cancelAt?: (p: DownloadProgress) => boolean): Promise<{ p: DownloadProgress; done: string[] }> {
  const done: string[] = [];
  let cancel = false;
  return downloadZims(o, {
    onProgress: (p) => {
      if (cancelAt && cancelAt(p)) cancel = true;
    },
    isCancelled: () => cancel,
    log: () => undefined,
    onZimDone: (f) => done.push(f),
  }).then((p) => ({ p, done }));
}

describe('downloadZims', () => {
  it('downloads the newest file of a prefix and renames it only when complete', async () => {
    const { o, dir } = job([entry('wiki', 'test_a_')]);
    const { p, done } = await run(o);
    expect(p.phase).toBe('done');
    expect(p.downloaded).toBe(1);
    const file = path.join(dir, 'test_a_2026-01.zim');
    expect(fs.readFileSync(file).equals(ZIM)).toBe(true);
    expect(fs.existsSync(file + '.part')).toBe(false);
    expect(done).toEqual([file]);
    expect(fs.existsSync(path.join(dir, 'test_a_2025-01.zim'))).toBe(false);
    // A second run sees it is complete and leaves it.
    const again = await run(o);
    expect([again.p.downloaded, again.p.skipped]).toEqual([0, 1]);
  });

  it('continues after the connection drops mid-file, from the bytes on disk', async () => {
    const { o, dir } = job([entry('flaky', 'test_flaky_')]);
    const { p } = await run(o);
    expect(p.phase).toBe('done');
    expect(fs.readFileSync(path.join(dir, 'test_flaky_2026-01.zim')).equals(ZIM)).toBe(true);
    const tries = ranges['/zim/flaky/test_flaky_2026-01.zim'].filter((r) => r !== 'bytes=0-0');
    expect(tries).toEqual(['', 'bytes=15000-', 'bytes=30000-']);
  });

  it('adopts a partial .zim left by script 4', async () => {
    const { o, dir } = job([entry('wiki', 'test_a_')]);
    fs.writeFileSync(path.join(dir, 'test_a_2026-01.zim'), ZIM.slice(0, 1000));
    ranges['/zim/wiki/test_a_2026-01.zim'] = [];
    const { p } = await run(o);
    expect(p.downloaded).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'test_a_2026-01.zim')).equals(ZIM)).toBe(true);
    expect(ranges['/zim/wiki/test_a_2026-01.zim']).toContain('bytes=1000-');
  });

  it('a .part that is already whole (closed just before the rename) is finished without downloading it again', async () => {
    const { o, dir } = job([entry('wiki', 'test_a_')]);
    fs.writeFileSync(path.join(dir, 'test_a_2026-01.zim.part'), ZIM);
    ranges['/zim/wiki/test_a_2026-01.zim'] = [];
    const { p } = await run(o);
    expect(p.downloaded).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'test_a_2026-01.zim')).equals(ZIM)).toBe(true);
    expect(ranges['/zim/wiki/test_a_2026-01.zim']).toEqual(['bytes=0-0']); // only the size question
  });

  it('refuses a 4 GB+ file on FAT32', async () => {
    const { o, dir, lib } = job([entry('big', 'test_big_', 5)], { disk: { type: () => 'vfat', free: () => 100 * 1073741824 } });
    const { p } = await run(o);
    expect(p.failed).toBe(1);
    expect(fs.readdirSync(dir)).toEqual([]);
    const f = loadState(lib).zims.failures[0];
    expect([f.id, f.code]).toEqual(['test_big_', 'fat32']);
    expect(f.reason).toMatch(/FAT32/);
  });

  it('refuses when there is not enough free space', async () => {
    const { o, lib } = job([entry('wiki', 'test_a_')], { minFreeMb: 1, disk: { type: () => 'ext2/ext3', free: () => 1048576 } });
    const { p } = await run(o);
    expect(p.failed).toBe(1);
    expect(loadState(lib).zims.failures[0].code).toBe('disk-full');
  });

  it('a file without the ZIM magic is not renamed and is reported', async () => {
    const { o, dir, lib } = job([entry('bad', 'test_bad_')]);
    const { p, done } = await run(o);
    expect(p.failed).toBe(1);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(done).toEqual([]);
    expect(loadState(lib).zims.failures[0].code).toBe('not-zim');
  });

  it('cancel keeps the .part', async () => {
    const { o, dir } = job([entry('slow', 'test_slow_')]);
    const { p } = await run(o, (pr) => pr.fileReceived >= 8000);
    expect(p.phase).toBe('cancelled');
    const part = path.join(dir, 'test_slow_2026-01.zim.part');
    expect(fs.statSync(part).size).toBeGreaterThanOrEqual(8000);
    expect(fs.existsSync(path.join(dir, 'test_slow_2026-01.zim'))).toBe(false);
  });

  it('says what is missing on the mirror', async () => {
    const { o, lib } = job([entry('wiki', 'nothing_like_this_')]);
    const { p } = await run(o);
    expect(p.failed).toBe(1);
    expect(loadState(lib).zims.failures[0].code).toBe('not-found');
  });
});
