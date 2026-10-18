// HTTP for the server and its download processes (Node 12 has no fetch). Used by updates (GitHub) and the
// downloader (books, encyclopedias, book lists). The app window itself never goes online (src/main/main.ts).
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export class HttpStatusError extends Error {
  constructor(readonly status: number, host: string) {
    super(`HTTP ${status} from ${host}`);
  }
}

export function codeError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

/**
 * GET with redirects (GitHub and download sites send files to other servers). Resolves for 2xx answers only.
 * The token never leaves the host it was meant for. `timeoutMs` is the longest silence allowed - while
 * connecting and while the body arrives - so a stalled download fails with ETIMEDOUT.
 */
export function get(url: string, headers: Record<string, string>, timeoutMs: number, redirects = 10): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }
    const mod = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!mod) {
      reject(new Error(`unsupported address ${url}`));
      return;
    }
    let current: http.IncomingMessage | null = null;
    const req = mod.get(u, { headers }, (res) => {
      const status = res.statusCode || 0;
      const loc = res.headers.location;
      if (status >= 300 && status < 400 && loc) {
        res.resume();
        if (redirects <= 0) {
          reject(new Error('too many redirects'));
          return;
        }
        const next = new URL(loc, u);
        const h = Object.assign({}, headers);
        if (next.host !== u.host) delete h.Authorization;
        get(next.toString(), h, timeoutMs, redirects - 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new HttpStatusError(status, u.host));
        return;
      }
      current = res;
      resolve(res);
    });
    req.setTimeout(timeoutMs, () => {
      const e = codeError('ETIMEDOUT', 'timed out');
      // Mid-body the answer itself must fail with the reason, not only the request.
      if (current) current.destroy(e);
      req.destroy(e);
    });
    req.on('error', reject);
  });
}

export function readBody(res: http.IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    res.on('data', (d: Buffer) => {
      n += d.length;
      if (n > max) res.destroy(new Error('answer too large'));
      else chunks.push(d);
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

export const OFFLINE_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'ECONNABORTED', 'EPIPE'];

/** No internet (or the site can't be reached at all), as opposed to a site that answered "no". */
export function isOfflineError(e: unknown): boolean {
  return OFFLINE_CODES.indexOf(String((e as NodeJS.ErrnoException | null)?.code || '')) >= 0;
}
