// Downloading one file into <file>.part: resume, redirects, errors with plain reasons, stalls and cancel.
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DownloadError, describeDownloadError, fetchToFile } from '../../src/downloader/fetchfile';

const BODY = '0123456789';
let tmp: string;
let a: http.Server;
let b: http.Server;
let base = '';
let other = '';
const ranges: Record<string, string | undefined> = {};

function listen(handler: http.RequestListener): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` }))
  );
}

function ranged(req: http.IncomingMessage, res: http.ServerResponse) {
  const m = /^bytes=(\d+)-$/.exec(String(req.headers.range || ''));
  if (!m) {
    res.writeHead(200, { 'Content-Length': BODY.length });
    res.end(BODY);
    return;
  }
  const from = Number(m[1]);
  if (from >= BODY.length) {
    res.writeHead(416);
    res.end();
    return;
  }
  res.writeHead(206, { 'Content-Range': `bytes ${from}-${BODY.length - 1}/${BODY.length}`, 'Content-Length': BODY.length - from });
  res.end(BODY.slice(from));
}

let n = 0;
function target(): string {
  return path.join(tmp, `file-${++n}.pdf`);
}

function noCancel() {
  return false;
}

async function failure(p: Promise<unknown>): Promise<DownloadError> {
  return p.then(
    () => {
      throw new Error('expected a failure');
    },
    (e: DownloadError) => e
  );
}

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-fetch-')));
  const sb = await listen((_req, res) => res.end('from the other server'));
  b = sb.server;
  other = sb.base;
  const sa = await listen((req, res) => {
    const u = req.url || '';
    ranges[u] = req.headers.range as string | undefined;
    if (u === '/data') return ranged(req, res);
    if (u === '/norange') {
      res.writeHead(200, { 'Content-Length': BODY.length });
      res.end(BODY);
      return;
    }
    if (u === '/r1') {
      res.writeHead(302, { Location: '/r2' });
      return res.end();
    }
    if (u === '/r2') {
      res.writeHead(302, { Location: '/r3?x=1' });
      return res.end();
    }
    if (u === '/r3?x=1') {
      res.writeHead(301, { Location: `${other}/file` });
      return res.end();
    }
    if (u === '/403') {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (u === '/404') {
      res.writeHead(404);
      return res.end();
    }
    if (u === '/stall') {
      res.writeHead(200, { 'Content-Length': 100 });
      res.write('abc');
      return;
    }
    if (u === '/slow') {
      res.writeHead(200, { 'Content-Length': 1000 });
      let i = 0;
      const t = setInterval(() => {
        if (res.destroyed || i++ > 50) {
          clearInterval(t);
          return;
        }
        res.write('x'.repeat(10));
      }, 30);
      res.on('close', () => clearInterval(t));
      return;
    }
    res.writeHead(500);
    res.end();
  });
  a = sa.server;
  base = sa.base;
});

afterAll(() => {
  a.close();
  b.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('fetchToFile', () => {
  it('resumes a .part with Range when the server supports it', async () => {
    const f = target();
    fs.writeFileSync(f + '.part', '0123');
    const r = await fetchToFile(`${base}/data`, f, { stallMs: 5000, isCancelled: noCancel, onBytes: () => undefined });
    expect(ranges['/data']).toBe('bytes=4-');
    expect(fs.readFileSync(f + '.part', 'utf8')).toBe(BODY);
    expect(r).toEqual({ bytes: 10, total: 10 });
    expect(fs.existsSync(f)).toBe(false); // the caller checks it before renaming
  });

  it('starts again when the server ignores Range', async () => {
    const f = target();
    fs.writeFileSync(f + '.part', 'XXXX');
    await fetchToFile(`${base}/norange`, f, { stallMs: 5000, isCancelled: noCancel, onBytes: () => undefined });
    expect(fs.readFileSync(f + '.part', 'utf8')).toBe(BODY);
  });

  it('starts again when the server says the range is past the end', async () => {
    const f = target();
    fs.writeFileSync(f + '.part', BODY + 'more');
    await fetchToFile(`${base}/data`, f, { stallMs: 5000, isCancelled: noCancel, onBytes: () => undefined });
    expect(fs.readFileSync(f + '.part', 'utf8')).toBe(BODY);
  });

  it('follows redirects', async () => {
    const f = target();
    await fetchToFile(`${base}/r1`, f, { stallMs: 5000, isCancelled: noCancel, onBytes: () => undefined });
    expect(fs.readFileSync(f + '.part', 'utf8')).toBe('from the other server');
  });

  it('turns 403, 404 and DNS failures into DownloadError codes with plain reasons', async () => {
    const opts = { stallMs: 5000, isCancelled: noCancel, onBytes: () => undefined };
    expect((await failure(fetchToFile(`${base}/403`, target(), opts))).code).toBe('http-403');
    expect((await failure(fetchToFile(`${base}/404`, target(), opts))).code).toBe('http-404');
    expect((await failure(fetchToFile('http://no-such-host.invalid/x.pdf', target(), opts))).code).toBe('dns');
    expect(describeDownloadError('http-403')).toMatch(/refused/);
    expect(describeDownloadError('dns')).toMatch(/address/);
    expect(describeDownloadError('http-503')).toMatch(/503/);
  });

  it('gives up on a stalled server after stallMs and keeps the .part', async () => {
    const f = target();
    const e = await failure(fetchToFile(`${base}/stall`, f, { stallMs: 300, isCancelled: noCancel, onBytes: () => undefined }));
    expect(e.code).toBe('timeout');
    expect(fs.readFileSync(f + '.part', 'utf8')).toBe('abc');
  });

  it('stops when cancelled and keeps the .part', async () => {
    const f = target();
    let cancel = false;
    const e = await failure(
      fetchToFile(`${base}/slow`, f, {
        stallMs: 5000,
        isCancelled: () => cancel,
        onBytes: (have) => {
          if (have >= 30) cancel = true;
        },
      })
    );
    expect(e.code).toBe('cancelled');
    const kept = fs.readFileSync(f + '.part', 'utf8').length;
    expect(kept).toBeGreaterThanOrEqual(30);
    expect(kept).toBeLessThan(1000);
  });

  it('reports progress with the bytes already on disk counted', async () => {
    const f = target();
    fs.writeFileSync(f + '.part', '0123');
    const seen: [number, number][] = [];
    await fetchToFile(`${base}/data`, f, { stallMs: 5000, isCancelled: noCancel, onBytes: (have, total) => seen.push([have, total]) });
    expect(seen[0][0]).toBeGreaterThanOrEqual(4);
    expect(seen[seen.length - 1]).toEqual([10, 10]);
  });
});
