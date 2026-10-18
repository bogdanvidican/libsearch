// The encyclopedias job: Kiwix .zim files (1-170 GB each) from the Kiwix mirror into the library's Kiwix folder.
// Each file is downloaded to <name>.zim.part and renamed only when it is whole and starts like a ZIM file, so
// kiwix-serve never sees half a file. A dropped connection (or a laptop that went to sleep) is tried again from
// the bytes already on disk, up to `retries` times; stopping keeps the .part for the next start.
import * as fs from 'fs';
import * as path from 'path';
import { DownloadFailure, DownloadProgress, Notice } from '../shared/api';
import { get, readBody } from '../server/net';
import { checkOnline, idleProgress, JobHooks, libraryGone, libraryGoneNotice, reporter, Speed } from './books';
import { freeBytes, fsType } from './disk';
import { DownloadError, fetchToFile, rangeTotal, toDownloadError, USER_AGENT } from './fetchfile';
import { updateState } from './state';
import { newestZimFile, ZimEntry } from './zimlist';

const GB = 1073741824;
/** FAT32 can't hold a file of 4 GB or more. */
const FAT_LIMIT = 4 * GB - 1;
/** Worth another try after a pause: the connection, not the site's answer. */
const TRANSIENT = /^(offline|timeout|dns|http-5\d\d)$/;
const MAGIC = [0x5a, 0x49, 0x4d, 0x04];

export interface DiskInfo {
  type(dir: string): string | undefined;
  free(dir: string): number | undefined;
}

export interface ZimJob {
  /** The library folder (its notes file records what failed). */
  library: string;
  /** The library's Kiwix folder, e.g. "15 Offline Encyclopedias (Kiwix)" (created when missing). */
  kiwixDir: string;
  entries: ZimEntry[];
  /** https://download.kiwix.org (a local server in tests). */
  mirror: string;
  /** Tries per file before giving up for now (script 4 uses 200). */
  retries: number;
  retryDelayMs: number;
  stallMs: number;
  /** 0 = don't check the free space (no df). */
  minFreeMb: number;
  /** File system type and free space; df / stat unless given. */
  disk?: DiskInfo;
}

export interface ZimHooks extends JobHooks {
  /** A file is complete and renamed: kiwix-serve can be restarted to include it. */
  onZimDone?(file: string): void;
}

function exists(p: string): boolean {
  return fs.existsSync(p);
}

function sizeOf(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch (e) {
    return 0;
  }
}

function remove(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch (e) {
    // already gone
  }
}

/** Starts with the bytes 5A 49 4D 04 ("ZIM", version 4/5/6 share them). */
export function looksLikeZim(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(4);
    return fs.readSync(fd, b, 0, 4, 0) === 4 && MAGIC.every((v, i) => b[i] === v);
  } catch (e) {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function gb(bytes: number): string {
  return (bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0) + ' GB';
}

/** Waits, but gives up at once when stopped. */
function pause(ms: number, isCancelled: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const end = Date.now() + ms;
    const tick = () => {
      if (isCancelled()) return reject(new DownloadError('cancelled'));
      if (Date.now() >= end) return resolve();
      setTimeout(tick, Math.min(200, Math.max(1, end - Date.now())));
    };
    tick();
  });
}

/** The full size of a file on the mirror (asks for its first byte only). 0 when the site doesn't say. */
async function remoteSize(url: string, stallMs: number, isCancelled: () => boolean): Promise<number> {
  const res = await get(url, { 'User-Agent': USER_AGENT, Range: 'bytes=0-0' }, stallMs, { isCancelled });
  const total = rangeTotal(res) || Number(res.headers['content-length']) || 0;
  res.destroy();
  return res.statusCode === 206 ? total : Number(res.headers['content-length']) || 0;
}

export async function downloadZims(o: ZimJob, h: ZimHooks): Promise<DownloadProgress> {
  const p: DownloadProgress = Object.assign(idleProgress(), { running: true, phase: 'checking' as const, startedAt: Date.now() });
  const emit = reporter(h, p);
  const disk: DiskInfo = o.disk || { type: fsType, free: freeBytes };
  const mirror = o.mirror.replace(/\/+$/, '');
  const failures: DownloadFailure[] = [];
  const attempted = new Set<string>();
  const speed = new Speed();

  const stop = (phase: DownloadProgress['phase'], notice?: Notice): DownloadProgress => {
    p.running = false;
    p.phase = phase;
    p.finishedAt = Date.now();
    p.currentFile = '';
    p.attempt = undefined;
    if (notice) p.notice = notice;
    emit(true);
    return Object.assign({}, p);
  };
  const save = (complete: boolean) => {
    try {
      updateState(o.library, (s) => {
        const kept = complete ? [] : s.zims.failures.filter((f) => !attempted.has(f.id));
        s.zims.failures = kept.concat(failures);
      });
    } catch (e) {
      h.log(`could not save the notes: ${(e as Error).message}`);
    }
  };
  const fail = (e: ZimEntry, url: string, err: DownloadError) => {
    failures.push({ id: e.id, folder: path.basename(o.kiwixDir), file: e.title, url, code: err.code, reason: err.message, at: Date.now() });
    p.failed++;
    h.log(`FAILED ${e.prefix}: ${err.message}`);
  };

  emit(true);
  const offline = await checkOnline(mirror + '/', () => h.isCancelled());
  if (offline) return stop('failed', offline);
  try {
    fs.mkdirSync(o.kiwixDir, { recursive: true });
  } catch (e) {
    return stop('failed', { kind: 'error', code: 'zims-folder', message: `The encyclopedia folder can't be made: ${o.kiwixDir}`, fix: 'Check that the library folder can be written to.' });
  }
  p.phase = 'downloading';
  p.total = o.entries.length;
  emit(true);

  const one = async (e: ZimEntry): Promise<void> => {
    const folderUrl = `${mirror}/zim/${e.dir}/`;
    p.currentFile = e.title;
    p.fileReceived = 0;
    p.fileTotal = 0;
    p.attempt = undefined;
    emit(true);
    let name: string | null;
    try {
      name = newestZimFile(await readBody(await get(folderUrl, { 'User-Agent': USER_AGENT }, o.stallMs, { isCancelled: () => h.isCancelled() }), 20 * 1048576), e.prefix);
    } catch (err) {
      const d = toDownloadError(err);
      if (d.code === 'cancelled') throw d;
      return fail(e, folderUrl, d);
    }
    if (!name) return fail(e, folderUrl, new DownloadError('not-found', `The Kiwix site has no file starting with ${e.prefix}.`));
    const url = folderUrl + name;
    const target = path.join(o.kiwixDir, name);
    const part = target + '.part';
    p.currentFile = name;
    let total: number;
    try {
      total = await remoteSize(url, o.stallMs, () => h.isCancelled());
    } catch (err) {
      const d = toDownloadError(err);
      if (d.code === 'cancelled') throw d;
      return fail(e, url, d);
    }
    p.fileTotal = total;

    if (exists(target)) {
      const have = sizeOf(target);
      if ((!total || have === total) && looksLikeZim(target)) {
        p.skipped++;
        return;
      }
      if (total && have < total) {
        // Half a file, e.g. from 4-download-khan-academy.sh: continue from it (keep the bigger of the two).
        if (have > sizeOf(part)) {
          remove(part);
          fs.renameSync(target, part);
        } else {
          remove(target);
        }
      } else {
        return fail(e, url, new DownloadError('not-zim', `${name} is there, but it is not a ZIM file. Delete it, then download again.`));
      }
    }
    const fsName = disk.type(o.kiwixDir);
    if ((fsName === 'msdos' || fsName === 'vfat') && total > FAT_LIMIT) {
      return fail(e, url, new DownloadError('fat32', `This drive is FAT32, which can't hold files over 4 GB (${name} is ${gb(total)}). Keep the library on an ext4 or exFAT drive.`));
    }
    if (o.minFreeMb > 0 && total) {
      const free = disk.free(o.kiwixDir);
      const need = total - sizeOf(part);
      if (free !== undefined && free < need + GB) {
        return fail(e, url, new DownloadError('disk-full', `${name} needs ${gb(need + GB)} free on this drive, but only ${gb(free)} is free.`));
      }
    }

    let err: DownloadError | null = null;
    for (let attempt = 1; attempt <= o.retries; attempt++) {
      // A .part that is already whole (the app closed just before renaming it) is not downloaded again.
      if (total && sizeOf(part) >= total) {
        err = null;
        break;
      }
      p.attempt = attempt;
      let prev = -1;
      try {
        await fetchToFile(url, target, {
          stallMs: o.stallMs,
          isCancelled: () => h.isCancelled(),
          onBytes: (have, size) => {
            if (prev >= 0 && have > prev) {
              p.bytes += have - prev;
              speed.add(have - prev);
            }
            prev = have;
            p.fileReceived = have;
            p.fileTotal = size || total;
            p.speed = speed.rate();
            emit();
          },
        });
        err = null;
        break;
      } catch (e2) {
        err = toDownloadError(e2);
        if (err.code === 'cancelled' || err.code === 'disk-full') throw err;
        if (!TRANSIENT.test(err.code)) break;
        h.log(`${name}: ${err.message} - trying again (${attempt} of ${o.retries})`);
        if (attempt < o.retries) await pause(o.retryDelayMs, () => h.isCancelled());
      }
    }
    if (err) {
      // The .part stays: the next download continues from it.
      const reason = TRANSIENT.test(err.code) ? `${err.message} Gave up after ${o.retries} tries; click Download again to continue.` : err.message;
      return fail(e, url, new DownloadError(err.code, reason));
    }
    if (!looksLikeZim(part)) {
      remove(part);
      return fail(e, url, new DownloadError('not-zim', `The download of ${name} is not a ZIM file, so it was deleted.`));
    }
    fs.renameSync(part, target);
    p.downloaded++;
    h.log(`ok ${name}`);
    if (h.onZimDone) h.onZimDone(target);
  };

  try {
    for (const e of o.entries) {
      if (h.isCancelled()) throw new DownloadError('cancelled');
      const gone = libraryGone(o.library);
      if (gone) throw gone;
      attempted.add(e.id);
      await one(e);
      p.done++;
      emit(true);
    }
  } catch (err) {
    const d = toDownloadError(err);
    save(false);
    if (d.code === 'cancelled') return stop('cancelled');
    if (d.code === 'library-gone') return stop('failed', libraryGoneNotice(o.library));
    if (d.code === 'disk-full') {
      return stop('failed', { kind: 'error', code: 'downloads-disk-full', message: 'The disk became full, so the download stopped.', fix: 'Free some space, then click Download again: it continues where it stopped.' });
    }
    return stop('failed', { kind: 'error', code: 'downloads-failed', message: d.message, fix: 'Try again: it continues where it stopped.' });
  }
  save(true);
  return stop('done');
}
