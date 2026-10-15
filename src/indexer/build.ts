// Incremental, resumable index build.
//
// For each new/changed file: extract text (child process, outside any lock), then write it in
// chunks of CHUNK pages per transaction so the server's searches are never blocked for long.
// A document is marked complete (real size/mtime + final status) only in its last transaction, so a
// build killed half-way re-does that document next time and never leaves a half-indexed "ok" doc.
import * as fs from 'fs';
import * as path from 'path';
import { BuildProgress } from '../shared/api';
import { Config } from '../server/config';
import {
  DB,
  PAGE_STRIDE,
  SCHEMA_VERSION,
  dropAll,
  ensureSchema,
  openDb,
  breakStaleLock,
  schemaVersion,
  setMeta,
  getMeta,
  sleep,
  isBusyError,
} from '../server/db';
import { extractEpub } from './epub';
import { extractPdf, looksLikePdf, killActiveExtractions } from './pdf';
import { FoundFile, findLibraryFiles, fingerprint } from './walk';
import { SCANNED_CHARS_PER_PAGE, cleanPageText, countLetters, deriveTitle } from './text';
import { hasCommand } from '../server/tools';

const CHUNK = 100;

export interface BuildOptions {
  full?: boolean;
  onProgress?: (p: BuildProgress) => void;
  isCancelled?: () => boolean;
  log?: (line: string) => void;
}

interface Extracted {
  file: FoundFile;
  pages: string[];
  title: string;
  series: string;
  metaTitle?: string;
  head: string;
  fp: string;
  chars: number;
  status: 'ok' | 'scanned' | 'error';
  error?: string;
}

interface ExistingDoc {
  id: number;
  relpath: string;
  size: number;
  mtime: number;
  status: string;
  folder: string;
  fp: string | null;
}

export class BuildCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

function lastSegment(subfolder: string): string {
  const parts = subfolder.split(' / ');
  return parts[parts.length - 1] || '';
}

async function extract(file: FoundFile): Promise<Extracted> {
  let fp = '';
  try {
    fp = fingerprint(file.abs, file.size);
  } catch (e) {
    // unreadable: extraction below reports the error
  }
  const base: Extracted = { file, pages: [], title: '', series: '', head: '', fp, chars: 0, status: 'ok' };
  const filename = path.basename(file.abs);
  try {
    let rawPages: string[];
    let metaTitle: string | undefined;
    if (file.size === 0) {
      throw new Error('The file is empty (its download never finished). Download it again.');
    }
    if (file.kind === 'pdf') {
      if (!looksLikePdf(file.abs)) {
        throw new Error('Not a real PDF (probably a web page saved with a .pdf name). Download it again.');
      }
      const r = await extractPdf(file.abs);
      rawPages = r.pages;
      metaTitle = r.info.title;
    } else {
      const r = extractEpub(file.abs);
      rawPages = r.pages;
      metaTitle = r.title;
    }
    const pages = rawPages.map(cleanPageText);
    const chars = pages.reduce((n, p) => n + countLetters(p), 0);
    const head = (pages[0] || '').slice(0, 600);
    const t = deriveTitle({ filename, metaTitle, head, subfolder: lastSegment(file.subfolder) });
    const scanned = file.kind === 'pdf' && (pages.length === 0 || chars / Math.max(1, pages.length) < SCANNED_CHARS_PER_PAGE);
    return { ...base, pages, chars, head, metaTitle, title: t.title, series: t.series, status: scanned ? 'scanned' : 'ok' };
  } catch (e) {
    const t = deriveTitle({ filename, subfolder: lastSegment(file.subfolder) });
    return { ...base, title: t.title, series: t.series, status: 'error', error: (e as Error).message };
  }
}

/** Runs fn inside BEGIN IMMEDIATE ... COMMIT, waiting while the server holds the lock. */
async function tx(db: DB, fn: () => void, isCancelled: () => boolean, dbFile: string): Promise<void> {
  let delay = 20;
  for (;;) {
    try {
      db.exec('BEGIN IMMEDIATE');
      break;
    } catch (e) {
      if (!isBusyError(e)) throw e;
      if (isCancelled()) throw new BuildCancelled();
      breakStaleLock(dbFile);
      await sleep(delay);
      delay = Math.min(delay * 2, 200);
    }
  }
  try {
    fn();
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch (e2) {
      // nothing to roll back
    }
    throw e;
  }
}

function existsInAnyRoot(roots: string[], relpath: string): boolean {
  return roots.some((r) => fs.existsSync(path.join(r, relpath)));
}

function folderExistsInAnyRoot(roots: string[], folder: string): boolean {
  return roots.some((r) => fs.existsSync(path.join(r, folder)));
}

export function deleteDocRows(db: DB, id: number): void {
  db.run('DELETE FROM pages WHERE rowid BETWEEN ? AND ?', [id * PAGE_STRIDE, id * PAGE_STRIDE + PAGE_STRIDE - 1]);
  db.run('DELETE FROM titles WHERE rowid = ?', [id]);
}

export async function buildIndex(cfg: Config, opts: BuildOptions = {}): Promise<BuildProgress> {
  const log = opts.log || (() => undefined);
  const isCancelled = opts.isCancelled || (() => false);
  const progress: BuildProgress = {
    running: true,
    phase: 'scanning',
    done: 0,
    total: 0,
    currentFile: '',
    startedAt: Date.now(),
    added: 0,
    updated: 0,
    removed: 0,
    failed: 0,
  };
  const emit = () => opts.onProgress && opts.onProgress({ ...progress });
  emit();

  if (!cfg.roots.length) {
    throw new Error('No library folder found. Start the app from the kit folder or pass --library-root.');
  }

  const files = findLibraryFiles(cfg.roots);
  log(`found ${files.length} book files in ${cfg.roots.join(', ')}`);
  if (files.some((f) => f.kind === 'pdf') && !hasCommand('pdftotext')) {
    throw new Error('pdftotext is missing. Install it with:  sudo apt-get install poppler-utils');
  }

  fs.mkdirSync(path.dirname(cfg.indexPath), { recursive: true });
  const db = openDb(cfg.indexPath, { create: true, cacheMb: 32 });
  try {
    const ver = schemaVersion(db);
    if (opts.full || (ver !== null && ver !== SCHEMA_VERSION)) {
      log(opts.full ? 'full rebuild requested' : `schema ${ver} -> ${SCHEMA_VERSION}: rebuilding`);
      await tx(db, () => dropAll(db), isCancelled, cfg.indexPath);
    }
    await tx(db, () => ensureSchema(db), isCancelled, cfg.indexPath);
    await tx(db, () => setMeta(db, 'last_build_started', String(progress.startedAt)), isCancelled, cfg.indexPath);
    // A different library than last time: books not found in it are removed even if their topic folder is
    // missing (otherwise the old library's books would linger as broken results).
    const rootsKey = JSON.stringify(cfg.roots.slice().sort());
    const prevRoots = getMeta(db, 'roots');
    const switchedLibrary = prevRoots !== undefined && prevRoots !== rootsKey;
    if (switchedLibrary) log(`library folders changed: ${prevRoots} -> ${rootsKey}`);

    const existing = new Map<string, ExistingDoc>();
    for (const r of db.all('SELECT id, relpath, size, mtime, status, folder, fp FROM docs') as unknown as ExistingDoc[]) {
      existing.set(r.relpath, r);
    }
    const touched: Array<{ id: number; mtime: number }> = [];
    const work = files.filter((f) => {
      const e = existing.get(f.relpath);
      if (!e || e.size !== f.size) return true;
      if (e.mtime === f.mtime) return false;
      // Same size, new date: probably copied without keeping dates. Same content -> just note the date.
      try {
        if (e.fp && e.status !== 'pending' && fingerprint(f.abs, f.size) === e.fp) {
          touched.push({ id: e.id, mtime: f.mtime });
          return false;
        }
      } catch (err) {
        // unreadable now: re-index to report it
      }
      return true;
    });
    if (touched.length) {
      log(`${touched.length} files had new dates but the same content`);
      await tx(
        db,
        () => {
          for (const t of touched) db.run('UPDATE docs SET mtime = ? WHERE id = ?', [t.mtime, t.id]);
        },
        isCancelled,
        cfg.indexPath
      );
    }
    progress.phase = 'indexing';
    progress.total = work.length;
    emit();

    const insertPage = db.prepare('INSERT INTO pages(rowid, text) VALUES (?, ?)');
    try {
      let next: Promise<Extracted> | null = work.length ? extract(work[0]) : null;
      for (let i = 0; i < work.length; i++) {
        if (isCancelled()) throw new BuildCancelled();
        const f = work[i];
        progress.currentFile = f.relpath;
        emit();
        const doc = await (next as Promise<Extracted>);
        // Overlap: extract the next file while this one is written.
        next = i + 1 < work.length ? extract(work[i + 1]) : null;
        if (isCancelled()) throw new BuildCancelled();

        const prev = existing.get(f.relpath);
        let id = prev ? prev.id : 0;
        const now = Date.now();
        // Transaction 1: (re)create the doc row as "pending" (size -1) and clear old pages.
        await tx(
          db,
          () => {
            if (prev) {
              deleteDocRows(db, prev.id);
              db.run("UPDATE docs SET size = -1, status = 'pending' WHERE id = ?", [prev.id]);
            } else {
              const r = db.run(
                `INSERT INTO docs(relpath, root, title, series, category, folder, subfolder, kind, size, mtime, status, indexed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, -1, 0, 'pending', ?)`,
                [f.relpath, f.root, doc.title, doc.series, f.category, f.folder, f.subfolder, f.kind, now]
              );
              id = Number(r.lastInsertRowid);
            }
          },
          isCancelled,
          cfg.indexPath
        );
        // Chunks of pages.
        const pages = doc.status === 'ok' ? doc.pages : [];
        for (let start = 0; start < pages.length; start += CHUNK) {
          if (isCancelled()) throw new BuildCancelled();
          await tx(
            db,
            () => {
              const end = Math.min(pages.length, start + CHUNK, PAGE_STRIDE - 1);
              for (let p = start; p < end; p++) {
                if (pages[p]) insertPage.run([id * PAGE_STRIDE + p + 1, pages[p]]);
              }
            },
            isCancelled,
            cfg.indexPath
          );
        }
        // Final transaction: mark complete.
        await tx(
          db,
          () => {
            db.run(
              `UPDATE docs SET root = ?, title = ?, series = ?, category = ?, folder = ?, subfolder = ?, kind = ?,
                 pages = ?, chars = ?, size = ?, mtime = ?, status = ?, error = ?, meta_title = ?, head = ?, fp = ?, indexed_at = ?
               WHERE id = ?`,
              [
                f.root,
                doc.title,
                doc.series,
                f.category,
                f.folder,
                f.subfolder,
                f.kind,
                doc.pages.length,
                doc.chars,
                f.size,
                f.mtime,
                doc.status,
                doc.error || null,
                doc.metaTitle || null,
                doc.head,
                doc.fp || null,
                Date.now(),
                id,
              ]
            );
            if (doc.status !== 'error') {
              db.run('INSERT INTO titles(rowid, title, series, category) VALUES (?, ?, ?, ?)', [id, doc.title, doc.series, f.category]);
            }
          },
          isCancelled,
          cfg.indexPath
        );
        if (doc.status === 'error') {
          progress.failed++;
          log(`FAILED ${f.relpath}: ${doc.error}`);
        } else if (prev) progress.updated++;
        else progress.added++;
        progress.done = i + 1;
        emit();
      }
    } finally {
      try {
        insertPage.finalize();
      } catch (e) {
        // ignore
      }
    }

    // Remove documents whose file is gone - but only when its category folder is present, so an
    // unplugged drive or an index copied from another computer doesn't wipe everything.
    progress.phase = 'cleaning';
    progress.currentFile = '';
    emit();
    const seen = new Set(files.map((f) => f.relpath));
    const gone = (db.all('SELECT id, relpath, folder FROM docs') as unknown as ExistingDoc[]).filter(
      (d) =>
        !seen.has(d.relpath) &&
        (switchedLibrary ? files.length > 0 : folderExistsInAnyRoot(cfg.roots, d.folder)) &&
        !existsInAnyRoot(cfg.roots, d.relpath)
    );
    for (const d of gone) {
      await tx(
        db,
        () => {
          deleteDocRows(db, d.id);
          db.run('DELETE FROM docs WHERE id = ?', [d.id]);
        },
        isCancelled,
        cfg.indexPath
      );
      progress.removed++;
      log(`removed ${d.relpath}`);
    }

    progress.finishedAt = Date.now();
    await tx(
      db,
      () => {
        setMeta(db, 'last_build_finished', String(progress.finishedAt));
        setMeta(db, 'roots', rootsKey);
      },
      isCancelled,
      cfg.indexPath
    );
    if (progress.added + progress.updated + progress.removed > 50) {
      log('optimizing full-text index');
      await tx(db, () => db.run("INSERT INTO pages(pages) VALUES ('optimize')"), isCancelled, cfg.indexPath);
    }
    progress.phase = 'done';
    progress.running = false;
    progress.message = `${progress.added} added, ${progress.updated} updated, ${progress.removed} removed, ${progress.failed} failed`;
    emit();
    return progress;
  } catch (e) {
    killActiveExtractions();
    progress.running = false;
    progress.finishedAt = Date.now();
    if (e instanceof BuildCancelled) {
      progress.phase = 'cancelled';
      progress.message = 'Stopped. Run the update again to continue where it left off.';
    } else {
      progress.phase = 'failed';
      progress.message = (e as Error).message;
    }
    emit();
    throw e;
  } finally {
    db.close();
  }
}
