// HTTP helpers shared by updates and downloads (src/server/net.ts), against local servers.
import * as http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, HttpStatusError, isOfflineError, readBody } from '../../src/server/net';

let a: http.Server;
let b: http.Server;
let aBase = '';
let bBase = '';
const seen: Record<string, string | undefined> = {};

function listen(handler: http.RequestListener): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` }))
  );
}

beforeAll(async () => {
  const sb = await listen((req, res) => {
    seen['b' + req.url] = req.headers.authorization;
    res.end('final');
  });
  b = sb.server;
  bBase = sb.base;
  const sa = await listen((req, res) => {
    seen['a' + req.url] = req.headers.authorization;
    if (req.url === '/r1') {
      res.writeHead(302, { Location: '/r2' });
      res.end();
    } else if (req.url === '/r2') {
      res.writeHead(301, { Location: `${bBase}/final` });
      res.end();
    } else if (req.url === '/range') {
      const m = /^bytes=(\d+)-$/.exec(String(req.headers.range || ''));
      const body = Buffer.from('0123456789');
      if (!m) {
        res.end(body);
        return;
      }
      const from = Number(m[1]);
      res.writeHead(206, { 'Content-Range': `bytes ${from}-9/10`, 'Content-Length': 10 - from });
      res.end(body.slice(from));
    } else if (req.url === '/416') {
      res.writeHead(416);
      res.end();
    } else if (req.url === '/403') {
      res.writeHead(403);
      res.end('no');
    } else if (req.url === '/stall') {
      res.writeHead(200, { 'Content-Length': 100 });
      res.write('abc'); // ...and nothing more
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  a = sa.server;
  aBase = sa.base;
});

afterAll(() => {
  a.close();
  b.close();
});

describe('get', () => {
  it('follows relative and cross-host redirects and drops Authorization on the new host', async () => {
    const res = await get(`${aBase}/r1`, { Authorization: 'token secret' }, 5000);
    expect(await readBody(res, 1000)).toBe('final');
    expect(seen['a/r2']).toBe('token secret');
    expect(seen['b/final']).toBeUndefined();
  });

  it('passes a Range header through and resolves 206', async () => {
    const res = await get(`${aBase}/range`, { Range: 'bytes=4-' }, 5000);
    expect(res.statusCode).toBe(206);
    expect(await readBody(res, 1000)).toBe('456789');
  });

  it('rejects 416 and 403 as HttpStatusError with the status', async () => {
    for (const s of [416, 403]) {
      const e = await get(`${aBase}/${s}`, {}, 5000).then(
        () => null,
        (err: unknown) => err
      );
      expect(e).toBeInstanceOf(HttpStatusError);
      expect((e as HttpStatusError).status).toBe(s);
    }
  });

  it('times out a server that stops sending mid-body', async () => {
    const res = await get(`${aBase}/stall`, {}, 300);
    const e = await readBody(res, 1000).then(
      () => null,
      (err: NodeJS.ErrnoException) => err
    );
    expect(e && e.code).toBe('ETIMEDOUT');
  });

  it('counts DNS failures and refused connections as offline', async () => {
    const closed = await listen(() => undefined);
    const base = closed.base;
    await new Promise((r) => closed.server.close(r));
    const refused = await get(`${base}/x`, {}, 3000).then(
      () => null,
      (err: unknown) => err
    );
    expect(isOfflineError(refused)).toBe(true);
    expect(isOfflineError(Object.assign(new Error('getaddrinfo ENOTFOUND x.invalid'), { code: 'ENOTFOUND' }))).toBe(true);
    expect(isOfflineError(new HttpStatusError(403, 'h'))).toBe(false);
  });
});
