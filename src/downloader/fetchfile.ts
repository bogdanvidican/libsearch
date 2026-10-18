// Downloads one file into <file>.part, continuing a .part from an earlier try (HTTP Range) when the server allows.
// The caller checks the .part and renames it; a failed or cancelled download leaves the .part for next time.
import * as fs from 'fs';
import * as http from 'http';
import { codeError, get, HttpStatusError, isOfflineError } from '../server/net';

/** Firefox's User-Agent, as kit/2-download-pdf-books.sh sends it: some sites refuse anything else. */
export const USER_AGENT = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0';

export class DownloadError extends Error {
  /** http-<status> | dns | offline | timeout | tls | disk-full | cancelled | empty | not-a-book | no-links | failed */
  constructor(readonly code: string, message?: string) {
    super(message || describeDownloadError(code));
  }
}

/** Plain-language reason for a failed download, shown next to the book. */
export function describeDownloadError(code: string): string {
  const http = /^http-(\d+)$/.exec(code);
  if (http) {
    const s = Number(http[1]);
    if (s === 403 || s === 401) return `The site refused the download (${s}). Open it in Firefox and save it by hand.`;
    if (s === 404 || s === 410) return `The file is not on the site any more (${s}). The link may have moved.`;
    if (s >= 500) return `The site had a problem (${s}). Try again later.`;
    return `The site answered with an error (${s}).`;
  }
  switch (code) {
    case 'dns':
      return "The site's address could not be found. The site may be gone, or blocked on this network.";
    case 'offline':
      return 'The connection to the site failed.';
    case 'timeout':
      return 'The site stopped answering.';
    case 'tls':
      return "The secure connection failed. Check that the computer's date and time are right.";
    case 'disk-full':
      return 'The disk is full.';
    case 'empty':
      return 'The site sent an empty answer (often a check for robots). Open it in Firefox and save it by hand.';
    case 'not-a-book':
      return 'The site sent a web page instead of the book (a check for robots). Open it in Firefox and save it by hand.';
    case 'no-links':
      return 'The page lists no books to download (it may need a browser). Open it in Firefox.';
    case 'cancelled':
      return 'Stopped.';
    default:
      return 'The download failed.';
  }
}

export function toDownloadError(e: unknown): DownloadError {
  if (e instanceof DownloadError) return e;
  if (e instanceof HttpStatusError) return new DownloadError(`http-${e.status}`);
  const code = String((e as NodeJS.ErrnoException | null)?.code || '');
  if (code === 'ECANCELED') return new DownloadError('cancelled');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new DownloadError('dns');
  if (code === 'ETIMEDOUT') return new DownloadError('timeout');
  if (code === 'ENOSPC') return new DownloadError('disk-full');
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ERR_SSL|EPROTO/.test(code)) return new DownloadError('tls');
  if (isOfflineError(e)) return new DownloadError('offline');
  return new DownloadError('failed', `The download failed: ${(e as Error | null)?.message || String(e)}`);
}

export interface FetchOptions {
  headers?: Record<string, string>;
  /** Longest silence allowed (connecting, and between pieces of data). */
  stallMs: number;
  isCancelled: () => boolean;
  /** Bytes in the .part so far (including what was there before) and the full size (0 = unknown). */
  onBytes: (have: number, total: number) => void;
}

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch (e) {
    return 0;
  }
}

/** Full size from "Content-Range: bytes 4-9/10", or 0. */
export function rangeTotal(res: http.IncomingMessage): number {
  const m = /\/(\d+)\s*$/.exec(String(res.headers['content-range'] || ''));
  return m ? Number(m[1]) : 0;
}

export async function fetchToFile(url: string, file: string, o: FetchOptions, retried416 = false): Promise<{ bytes: number; total: number }> {
  if (o.isCancelled()) throw new DownloadError('cancelled');
  const part = file + '.part';
  let have = sizeOf(part);
  const headers: Record<string, string> = Object.assign({ 'User-Agent': USER_AGENT }, o.headers || {});
  if (have > 0) headers.Range = `bytes=${have}-`;
  let res: http.IncomingMessage;
  try {
    res = await get(url, headers, o.stallMs);
  } catch (e) {
    if (e instanceof HttpStatusError && e.status === 416 && have > 0 && !retried416) {
      // The .part is as long as (or longer than) the file: start again from nothing.
      fs.unlinkSync(part);
      return fetchToFile(url, file, o, true);
    }
    throw toDownloadError(e);
  }
  const resumed = have > 0 && res.statusCode === 206;
  if (!resumed) have = 0;
  const length = Number(res.headers['content-length']) || 0;
  const total = resumed ? rangeTotal(res) || (length ? have + length : 0) : length;
  let received = 0;
  o.onBytes(have, total);

  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
    let settled = false;
    let ended = false;
    let failure: unknown = null;
    const timer = setInterval(() => {
      if (o.isCancelled()) res.destroy(codeError('ECANCELED', 'cancelled'));
    }, 200);
    const finish = (e: unknown, writeFailed = false) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (!e) {
        resolve();
      } else if (writeFailed) {
        res.destroy();
        reject(toDownloadError(e));
      } else {
        res.destroy();
        // Let the file stream flush what it has, so the next try can continue from there.
        out.end(() => reject(toDownloadError(e)));
      }
    };
    const cutOff = () => {
      if (!ended) finish(failure || codeError('ECONNRESET', 'connection lost'));
    };
    res.on('data', (d: Buffer) => {
      received += d.length;
      o.onBytes(have + received, total);
      if (o.isCancelled()) res.destroy(codeError('ECANCELED', 'cancelled'));
    });
    res.on('end', () => {
      ended = true;
    });
    res.on('error', (e) => {
      failure = failure || e;
    });
    // 'close' comes after 'end' or after an error; without 'end' the answer was cut off. Node 12 (old Electron
    // fallback builds) may only say 'aborted': wait a moment for the error that says why (e.g. ETIMEDOUT).
    res.on('close', cutOff);
    res.on('aborted', () => setTimeout(cutOff, 50));
    out.on('error', (e) => finish(e, true));
    out.on('finish', () => {
      if (ended) finish(null);
    });
    res.pipe(out);
  });

  const bytes = have + received;
  if (total && bytes < total) throw new DownloadError('offline', `Only ${bytes} of ${total} bytes arrived.`);
  return { bytes, total };
}
