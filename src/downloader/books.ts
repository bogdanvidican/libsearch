// The books job: downloads everything on the book lists that the library folder doesn't have yet, with the same
// rules as kit/2-download-pdf-books.sh. Safe to stop at any time: finished books are skipped next time and a
// half-downloaded one continues from its .part.
import * as fs from 'fs';
import * as path from 'path';
import { DownloadFailure, DownloadProgress, Notice } from '../shared/api';
import { get, HttpStatusError, readBody } from '../server/net';
import { entryId, ListEntry, parseBookList } from './booklist';
import { freeBytes } from './disk';
import { DownloadError, fetchToFile, toDownloadError, USER_AGENT } from './fetchfile';
import { archivePdfNames, fileNameFromUrl, resolveLink, scrapeFolder, scrapeLinks } from './links';
import { loadState, STATE_FILE, updateState } from './state';
import { isValidFile } from './validate';

export interface BooksJob {
  /** The library folder the books go into (outside the app). */
  library: string;
  /** Book list files, in order (the app's lists, then the library's booklist-local.txt). */
  lists: string[];
  /** Fetched first to tell "no internet" from "this site said no". */
  checkUrl: string;
  /** https://archive.org (a local server in tests). */
  archiveBase: string;
  /** Refuse to start with less free space than this (0 = don't check). */
  minFreeMb: number;
  /** Give up on a site after this long without data. */
  stallMs: number;
}

export interface JobHooks {
  onProgress(p: DownloadProgress): void;
  isCancelled(): boolean;
  log(line: string): void;
}

const MB = 1048576;
const LOW_SPACE_MB = 2500;
/** Failures worth one more try right away (the connection, not the site's answer). */
const RETRY = /^(offline|timeout|http-5\d\d)$/;

export const OFFLINE_NOTICE: Notice = {
  kind: 'info',
  code: 'downloads-offline',
  message: 'This computer seems to be offline, so nothing can be downloaded right now.',
  fix: 'Connect to the internet and try again. Everything already downloaded stays.',
};

export function idleProgress(): DownloadProgress {
  return {
    running: false,
    phase: 'idle',
    done: 0,
    total: 0,
    currentFile: '',
    fileReceived: 0,
    fileTotal: 0,
    bytes: 0,
    speed: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
  };
}

/** Bytes per second over the last 5 seconds. */
export class Speed {
  private samples: [number, number][] = [];
  add(bytes: number): void {
    const now = Date.now();
    this.samples.push([now, bytes]);
    while (this.samples.length && now - this.samples[0][0] > 5000) this.samples.shift();
  }
  rate(): number {
    if (!this.samples.length) return 0;
    const secs = Math.max(1, (Date.now() - this.samples[0][0]) / 1000);
    return Math.round(this.samples.reduce((n, s) => n + s[1], 0) / secs);
  }
}

function exists(p: string): boolean {
  return fs.existsSync(p);
}

function remove(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch (e) {
    // already gone
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}

/** The library folder went away (a USB drive pulled out): stop, and never make it again somewhere else. */
export function libraryGone(library: string): DownloadError | null {
  return isDir(library) ? null : new DownloadError('library-gone', `The library folder can't be found any more: ${library}`);
}

export function libraryGoneNotice(library: string): Notice {
  return {
    kind: 'error',
    code: 'library-missing',
    message: `The library folder can't be found any more: ${library}`,
    fix: 'If it is on a USB drive, plug it in again, then click Download: it continues where it stopped.',
  };
}

function sizeOf(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch (e) {
    return 0;
  }
}

/** Throttled progress reports (at most 4 a second, plus every change of phase). */
export function reporter(h: JobHooks, p: DownloadProgress): (force?: boolean) => void {
  let last = 0;
  return (force = false) => {
    const now = Date.now();
    if (!force && now - last < 250) return;
    last = now;
    h.onProgress(Object.assign({}, p));
  };
}

/** Is the internet there? A site answering with an error still means yes. */
export async function checkOnline(url: string, isCancelled?: () => boolean): Promise<Notice | null> {
  try {
    const res = await get(url, { 'User-Agent': USER_AGENT }, 20000, { isCancelled });
    res.resume();
    return null;
  } catch (e) {
    if (e instanceof HttpStatusError) return null;
    if (toDownloadError(e).code === 'tls') {
      return {
        kind: 'error',
        code: 'downloads-tls',
        message: 'The secure connection to the download sites failed.',
        fix: "Check that the computer's date and time are right, then try again.",
      };
    }
    return OFFLINE_NOTICE;
  }
}

export async function downloadBooks(o: BooksJob, h: JobHooks): Promise<DownloadProgress> {
  const p: DownloadProgress = Object.assign(idleProgress(), { running: true, phase: 'checking' as const, startedAt: Date.now() });
  const emit = reporter(h, p);
  const stop = (phase: DownloadProgress['phase'], notice?: Notice): DownloadProgress => {
    p.running = false;
    p.phase = phase;
    p.finishedAt = Date.now();
    p.currentFile = '';
    if (notice) p.notice = notice;
    emit(true);
    return Object.assign({}, p);
  };
  emit(true);

  // 1. Internet, 2. space, 3. the lists.
  const offline = await checkOnline(o.checkUrl, () => h.isCancelled());
  if (offline) return stop('failed', offline);
  if (h.isCancelled()) return stop('cancelled');
  // 0 = don't check at all (no df: QEMU, where the i386 test runs, can't start other programs from Electron's Node).
  const free = o.minFreeMb > 0 ? freeBytes(o.library) : undefined;
  if (free !== undefined && o.minFreeMb > 0 && free < o.minFreeMb * MB) {
    return stop('failed', {
      kind: 'error',
      code: 'downloads-disk-full',
      message: `Only ${Math.floor(free / MB)} MB are free in ${o.library}. Downloading books needs at least ${o.minFreeMb} MB.`,
      fix: 'Free some space, or choose a library folder on a bigger disk.',
    });
  }
  if (free !== undefined && free < LOW_SPACE_MB * MB) {
    p.notice = {
      kind: 'warning',
      code: 'downloads-low-space',
      message: `Only ${Math.floor(free / MB)} MB are free; all the books on the lists need about 2000 MB.`,
      fix: 'The downloads may stop part way. Free some space if you can.',
    };
  }
  const entries: ListEntry[] = [];
  const problems: string[] = [];
  for (const l of o.lists) {
    let text: string;
    try {
      text = fs.readFileSync(l, 'utf8');
    } catch (e) {
      continue; // booklist-linux.txt / booklist-local.txt are optional
    }
    const r = parseBookList(text, path.basename(l));
    entries.push(...r.entries);
    problems.push(...r.problems);
  }
  for (const pr of problems) h.log(`skipped list line ${pr}`);
  if (problems.length && !p.notice) {
    p.notice = {
      kind: 'warning',
      code: 'downloads-list-problems',
      message: `${problems.length} ${problems.length === 1 ? 'line' : 'lines'} of the book lists can't be used: ${problems[0]}`,
      fix: 'Correct that line (the folder must be a topic like "01 Medicine").',
    };
  }

  const done = new Set(loadState(o.library).books.done);
  const failures: DownloadFailure[] = [];
  const attempted = new Set<string>();
  const collections: Record<string, string[]> = {};
  const speed = new Speed();
  p.phase = 'downloading';
  p.total = entries.length;
  emit(true);

  const fail = (id: string, folder: string, file: string, url: string, err: DownloadError) => {
    failures.push({ id, folder, file, url, code: err.code, reason: err.message, at: Date.now() });
    p.failed++;
    h.log(`FAILED ${folder}/${file} ${url}: ${err.message}`);
  };

  const fetchOne = async (folder: string, name: string, url: string): Promise<void> => {
    const id = `${folder}|${name}`;
    attempted.add(id);
    const dir = path.join(o.library, folder);
    const out = path.join(dir, name);
    const part = out + '.part';
    const bad = out + '.bad';
    p.currentFile = `${folder}/${name}`;
    p.fileReceived = 0;
    p.fileTotal = 0;
    const gone = libraryGone(o.library);
    if (gone) throw gone;
    if (path.relative(o.library, out).split(path.sep)[0] === '..') {
      fail(id, folder, name, url, new DownloadError('failed', `"${folder}/${name}" would be outside the library folder, so it was skipped.`));
      return;
    }
    if (exists(out) && !isFile(out)) {
      fail(id, folder, name, url, new DownloadError('failed', `"${folder}/${name}" is a folder, not a book file, so it was left alone.`));
      return;
    }
    if (done.has(id) || (exists(out) && isValidFile(out))) {
      if (exists(out)) remove(part); // a leftover from an earlier try: the book is here
      p.skipped++;
      return;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (exists(out)) fs.renameSync(out, bad); // an earlier web page or empty answer: set it aside
    } catch (e) {
      fail(id, folder, name, url, toDownloadError(e));
      return;
    }
    let err: DownloadError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let prev = -1;
      try {
        await fetchToFile(url, out, {
          stallMs: o.stallMs,
          isCancelled: () => h.isCancelled(),
          onBytes: (have, total) => {
            if (prev >= 0 && have > prev) {
              p.bytes += have - prev;
              speed.add(have - prev);
            }
            prev = have;
            p.fileReceived = have;
            p.fileTotal = total;
            p.speed = speed.rate();
            emit();
          },
        });
        err = null;
        break;
      } catch (e) {
        err = toDownloadError(e);
        if (err.code === 'cancelled' || err.code === 'disk-full' || !RETRY.test(err.code)) break;
        h.log(`trying ${url} again after: ${err.message}`);
      }
    }
    // Pulled out while downloading: what arrived is with the drive; stop here.
    const goneNow = libraryGone(o.library);
    if (goneNow) throw goneNow;
    if (err && (err.code === 'cancelled' || err.code === 'disk-full')) throw err;
    if (!err) {
      if (isValidFile(part)) {
        fs.renameSync(part, out);
        remove(bad);
        p.downloaded++;
        h.log(`ok ${folder}/${name}`);
        return;
      }
      err = new DownloadError(sizeOf(part) === 0 ? 'empty' : 'not-a-book');
    }
    // A cut connection can continue from the .part next time; anything else starts again.
    if (err.code !== 'timeout' && err.code !== 'offline') remove(part);
    remove(bad);
    fail(id, folder, name, url, err);
  };

  const failWhole = (e: ListEntry, url: string, err: unknown) => {
    const d = toDownloadError(err);
    if (d.code === 'cancelled') throw d;
    attempted.add(entryId(e));
    fail(entryId(e), e.folder, '(page)', url, d);
  };

  const fetchAll = async (e: ListEntry, files: { folder: string; name: string; url: string }[]) => {
    p.total += files.length - 1;
    collections[entryId(e)] = files.map((f) => `${f.folder}/${f.name}`).sort();
    for (const f of files) {
      await fetchOne(f.folder, f.name, f.url);
      p.done++;
      emit();
    }
  };

  const scrape = async (e: ListEntry) => {
    const page = e.a;
    p.currentFile = page;
    let html: string;
    try {
      html = await readBody(await get(page, { 'User-Agent': USER_AGENT }, o.stallMs, { isCancelled: () => h.isCancelled() }), 5 * MB);
    } catch (err) {
      failWhole(e, page, err);
      p.done++;
      return;
    }
    const links = scrapeLinks(html, e.b);
    if (!links.length) {
      failWhole(e, page, new DownloadError('no-links'));
      p.done++;
      return;
    }
    await fetchAll(
      e,
      links.map((l) => {
        const url = resolveLink(page, l);
        return { folder: scrapeFolder(e.folder, page, url), name: fileNameFromUrl(url), url };
      })
    );
  };

  const archive = async (e: ListEntry) => {
    const details = `${o.archiveBase}/details/${e.a}`;
    p.currentFile = details;
    let names: string[];
    try {
      names = archivePdfNames(
        await readBody(await get(`${o.archiveBase}/metadata/${e.a}`, { 'User-Agent': USER_AGENT }, o.stallMs, { isCancelled: () => h.isCancelled() }), 50 * MB)
      );
    } catch (err) {
      failWhole(e, details, err);
      p.done++;
      return;
    }
    if (!names.length) {
      failWhole(e, details, new DownloadError('no-links'));
      p.done++;
      return;
    }
    await fetchAll(
      e,
      names.map((n) => ({ folder: e.folder, name: path.posix.basename(n), url: `${o.archiveBase}/download/${e.a}/${n.replace(/ /g, '%20')}` }))
    );
  };

  const save = (complete: boolean) => {
    try {
      updateState(o.library, (s) => {
        // A full run replaces the failure list; a stopped one only updates what it tried.
        const kept = complete ? [] : s.books.failures.filter((f) => !attempted.has(f.id));
        s.books.failures = kept.concat(failures);
        Object.assign(s.books.collections, collections);
        if (complete) {
          s.books.lastRun = { startedAt: p.startedAt || 0, finishedAt: Date.now(), downloaded: p.downloaded, skipped: p.skipped, failed: p.failed };
        }
      });
    } catch (e) {
      h.log(`could not save ${STATE_FILE}: ${(e as Error).message}`);
      if (!p.notice) {
        p.notice = {
          kind: 'warning',
          code: 'downloads-notes',
          message: 'The list of failed downloads could not be saved in the library folder.',
          fix: 'Check that the library folder can be written to.',
        };
      }
    }
  };

  try {
    for (const e of entries) {
      if (h.isCancelled()) throw new DownloadError('cancelled');
      if (e.type === 'F') {
        await fetchOne(e.folder, e.a, e.b);
        p.done++;
      } else if (e.type === 'S') {
        await scrape(e);
      } else {
        await archive(e);
      }
      emit();
    }
  } catch (err) {
    const d = toDownloadError(err);
    save(false);
    if (d.code === 'cancelled') return stop('cancelled');
    if (d.code === 'library-gone') return stop('failed', libraryGoneNotice(o.library));
    if (d.code === 'disk-full') {
      return stop('failed', { kind: 'error', code: 'downloads-disk-full', message: 'The disk became full, so the downloads stopped.', fix: 'Free some space, then click Download again: it continues where it stopped.' });
    }
    h.log(`stopped: ${d.message}`);
    return stop('failed', { kind: 'error', code: 'downloads-failed', message: d.message, fix: 'Try again. Books already downloaded stay.' });
  }
  save(true);
  return stop('done');
}
