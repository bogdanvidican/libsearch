// The library's download notes: <library folder>/library-search-downloads.json. They live with the books, not with
// the app, so deleting or reinstalling the app keeps them: which downloads failed last time and why, which books were
// saved by hand, which files each scraped page / archive.org item produced, and which encyclopedias were chosen.
import * as fs from 'fs';
import * as path from 'path';
import { DownloadFailure } from '../shared/api';

export const STATE_FILE = 'library-search-downloads.json';

export interface LastRun {
  startedAt: number;
  finishedAt: number;
  downloaded: number;
  skipped: number;
  failed: number;
}

export interface LibraryState {
  version: 1;
  books: {
    lastRun?: LastRun;
    failures: DownloadFailure[];
    /** Page / archive.org item id -> the files it produced ("<folder>/<file>", relative to the library). */
    collections: Record<string, string[]>;
    /** Books saved by hand ("Mark as done"). */
    done: string[];
  };
  /** Items of the manual downloads list ticked off. */
  manualDone: string[];
  zims: {
    selected: string[];
    /** A download was running when the app closed: continue it at the next start. */
    resume: boolean;
    /** Encyclopedias (by prefix) that failed in the last download, and why. */
    failures: DownloadFailure[];
  };
}

export function emptyState(): LibraryState {
  return { version: 1, books: { failures: [], collections: {}, done: [] }, manualDone: [], zims: { selected: [], resume: false, failures: [] } };
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

function failures(v: unknown): DownloadFailure[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (f): f is DownloadFailure =>
      !!f && typeof f === 'object' && typeof f.id === 'string' && typeof f.folder === 'string' && typeof f.file === 'string' && typeof f.url === 'string'
  );
}

export function loadState(root: string): LibraryState {
  const s = emptyState();
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8'));
  } catch (e) {
    return s;
  }
  if (!raw || typeof raw !== 'object') return s;
  const b = raw.books || {};
  s.books.failures = failures(b.failures);
  s.books.done = strings(b.done);
  if (b.collections && typeof b.collections === 'object') {
    for (const k of Object.keys(b.collections)) s.books.collections[k] = strings(b.collections[k]);
  }
  if (b.lastRun && typeof b.lastRun === 'object' && typeof b.lastRun.finishedAt === 'number') s.books.lastRun = b.lastRun;
  s.manualDone = strings(raw.manualDone);
  if (raw.zims && typeof raw.zims === 'object') {
    s.zims.selected = strings(raw.zims.selected);
    s.zims.resume = raw.zims.resume === true;
    s.zims.failures = failures(raw.zims.failures);
  }
  return s;
}

/** Changes the notes and writes them atomically. Throws when the library folder can't be written. */
export function updateState(root: string, fn: (s: LibraryState) => void): LibraryState {
  const s = loadState(root);
  fn(s);
  const file = path.join(root, STATE_FILE);
  fs.writeFileSync(file + '.tmp', JSON.stringify(s, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
  return s;
}
