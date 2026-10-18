// Library -> Get books: per topic, how many books the lists hold, how many are on this computer, what failed last
// time. Reads only the disk and the library's notes file, so it works offline. A book counts as present when its
// file exists (a stat, no reading: hundreds of reads are slow on the CF-30's disk; the downloader checks the content).
import * as fs from 'fs';
import * as path from 'path';
import { BookTopic, BooksOverview, Notice } from '../shared/api';
import { categoryLabel, insideAppMessage, isInside } from '../server/config';
import { entryId, parseBookList } from './booklist';
import { freeBytes } from './disk';
import { emptyState, LibraryState, loadState, updateState } from './state';

export interface ListRef {
  name: string;
  path: string;
  source: 'app' | 'github' | 'library';
}

function fileSize(file: string): number {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? st.size : 0;
  } catch (e) {
    return 0;
  }
}

/** Any file below dir (two levels deep: Hesperian chapters sit in sub-folders)? */
function hasFiles(dir: string, depth = 2): boolean {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return false;
  }
  for (const n of names) {
    if (n.charAt(0) === '.') continue;
    const p = path.join(dir, n);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 0) return true;
      if (st.isDirectory() && depth > 0 && hasFiles(p, depth - 1)) return true;
    } catch (e) {
      // unreadable: skip
    }
  }
  return false;
}

function isWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
}

/** Why books can't be downloaded into this folder, or null when they can. */
export function destinationProblem(root: string | undefined, appHome: string): Notice | null {
  if (!root) {
    return {
      kind: 'error',
      code: 'no-library',
      message: 'No library folder has been chosen yet.',
      fix: 'Choose it under Library folders on the Library page.',
    };
  }
  let isDir = false;
  try {
    isDir = fs.statSync(root).isDirectory();
  } catch (e) {
    isDir = false;
  }
  if (!isDir) {
    return {
      kind: 'error',
      code: 'library-missing',
      message: `The library folder can't be found: ${root}`,
      fix: 'If the books are on a USB drive, plug it in. Otherwise choose the folder again under Library folders.',
    };
  }
  if (isInside(root, appHome)) {
    return { kind: 'error', code: 'library-inside-app', message: insideAppMessage(root, appHome), fix: 'Choose a library folder outside the app under Library folders.' };
  }
  if (!isWritable(root)) {
    return {
      kind: 'error',
      code: 'library-read-only',
      message: `The library folder can't be written to: ${root}`,
      fix: 'Choose a folder you can write to, or ask someone to fix its permissions.',
    };
  }
  return null;
}

export function booksOverview(o: { lists: ListRef[]; roots: string[]; appHome: string }): BooksOverview {
  const root = o.roots[0];
  const problem = destinationProblem(root, o.appHome);
  const state: LibraryState = root && fs.existsSync(root) ? loadState(root) : emptyState();
  const done = new Set(state.books.done);
  const topics = new Map<string, BookTopic>();
  const counted = new Set<string>();
  const topicOf = (folder: string): BookTopic => {
    const name = folder.split('/')[0];
    let t = topics.get(name);
    if (!t) {
      t = { folder: name, label: categoryLabel(name), listed: 0, present: 0, failed: 0, bytes: 0 };
      topics.set(name, t);
    }
    return t;
  };
  /** One book file ("<folder>/<file>", relative to a library folder). */
  const book = (rel: string) => {
    if (counted.has(rel)) return;
    counted.add(rel);
    const slash = rel.lastIndexOf('/');
    const folder = rel.slice(0, slash);
    const t = topicOf(folder);
    t.listed++;
    let size = 0;
    for (const r of o.roots) {
      size = fileSize(path.join(r, rel));
      if (size) break;
    }
    if (size || done.has(`${folder}|${rel.slice(slash + 1)}`)) {
      t.present++;
      t.bytes += size;
    }
  };

  const lists: BooksOverview['lists'] = [];
  for (const l of o.lists) {
    let text: string;
    try {
      text = fs.readFileSync(l.path, 'utf8');
    } catch (e) {
      continue;
    }
    const entries = parseBookList(text, l.name).entries;
    lists.push({ name: l.name, source: l.source, entries: entries.length });
    for (const e of entries) {
      if (e.type === 'F') {
        book(`${e.folder}/${e.a}`);
        continue;
      }
      // A page or archive.org item: its files once a download has seen them, else one item for the folder.
      const id = entryId(e);
      const known = state.books.collections[id];
      if (known && known.length) {
        known.forEach(book);
      } else if (!counted.has(id)) {
        counted.add(id);
        const t = topicOf(e.folder);
        t.listed++;
        if (o.roots.some((r) => hasFiles(path.join(r, e.folder)))) t.present++;
      }
    }
  }

  const failures = state.books.failures.filter((f) => !done.has(f.id));
  for (const f of failures) topicOf(f.folder).failed++;
  const all = Array.from(topics.values()).sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
  const out: BooksOverview = {
    destination: problem ? null : root,
    topics: all,
    missing: all.reduce((n, t) => n + Math.max(0, t.listed - t.present), 0),
    failures,
    lists,
  };
  if (problem) out.problem = problem;
  if (state.books.lastRun) {
    const r = state.books.lastRun;
    out.lastRun = { finishedAt: r.finishedAt, downloaded: r.downloaded, skipped: r.skipped, failed: r.failed };
  }
  if (out.destination) {
    const free = freeBytes(out.destination);
    if (free !== undefined) out.freeBytes = free;
  }
  return out;
}

/** "Mark as done" (saved by hand) - or undo it. */
export function markDone(root: string, id: string, isDone: boolean): void {
  updateState(root, (s) => {
    s.books.done = s.books.done.filter((d) => d !== id);
    if (isDone) s.books.done.push(id);
  });
}
