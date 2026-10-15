// SQLite access through node-sqlite3-wasm (WASM build, file-backed, no native module).
//
// Locking: node-sqlite3-wasm locks a database by creating the directory "<db>.lock". Any lock level
// takes it exclusively, so the server (reader) and the indexer (writer) never overlap, and a killed
// process can leave the directory behind. Callers retry on SQLITE_BUSY and clean stale locks via
// removeStaleLock() when they know no other process is using the database.
import * as fs from 'fs';
import * as path from 'path';
import { Database } from 'node-sqlite3-wasm';

export type DB = InstanceType<typeof Database>;

export const SCHEMA_VERSION = '1';
/** rowid of a page in the FTS table = docId * PAGE_STRIDE + page. */
export const PAGE_STRIDE = 100000;

const TOKENIZE = "tokenize='porter unicode61 remove_diacritics 2'";

export function openDb(file: string, opts: { cacheMb?: number; create?: boolean } = {}): DB {
  if (opts.create) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, { fileMustExist: !opts.create });
  try {
    db.exec(`PRAGMA cache_size = -${(opts.cacheMb || 8) * 1024}`);
  } catch (e) {
    // A BUSY here is harmless; the pragma only tunes memory.
  }
  return db;
}

export function ensureSchema(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS docs (
      id INTEGER PRIMARY KEY,
      relpath TEXT NOT NULL UNIQUE,
      root TEXT NOT NULL,
      title TEXT NOT NULL,
      series TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      folder TEXT NOT NULL,
      subfolder TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      pages INTEGER NOT NULL DEFAULT 0,
      chars INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      meta_title TEXT,
      head TEXT,
      fp TEXT,
      indexed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS docs_folder ON docs(folder);
    CREATE VIRTUAL TABLE IF NOT EXISTS pages USING fts5(text, ${TOKENIZE});
    CREATE VIRTUAL TABLE IF NOT EXISTS titles USING fts5(title, series, category, ${TOKENIZE});
  `);
  const cols = db.all('PRAGMA table_info(docs)') as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'fp')) db.exec('ALTER TABLE docs ADD COLUMN fp TEXT');
  const v = db.get("SELECT value FROM meta WHERE key = 'schema_version'") as { value: string } | null;
  if (!v) db.run("INSERT INTO meta(key, value) VALUES ('schema_version', ?)", [SCHEMA_VERSION]);
}

export function schemaVersion(db: DB): string | null {
  try {
    const v = db.get("SELECT value FROM meta WHERE key = 'schema_version'") as { value: string } | null;
    return v ? v.value : null;
  } catch (e) {
    return null;
  }
}

export function dropAll(db: DB): void {
  db.exec(`
    DROP TABLE IF EXISTS pages;
    DROP TABLE IF EXISTS titles;
    DROP TABLE IF EXISTS docs;
    DROP TABLE IF EXISTS meta;
  `);
}

export function getMeta(db: DB, key: string): string | undefined {
  const r = db.get('SELECT value FROM meta WHERE key = ?', [key]) as { value: string } | null;
  return r ? r.value : undefined;
}

export function setMeta(db: DB, key: string, value: string): void {
  db.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

export function isBusyError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /locked|busy/i.test(msg);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Runs fn, retrying while the database is locked by the other process. */
export async function withRetry<T>(fn: () => T, timeoutMs = 3000, dbFile?: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let delay = 25;
  for (;;) {
    try {
      return fn();
    } catch (e) {
      if (!isBusyError(e) || Date.now() > deadline) throw e;
      if (dbFile) breakStaleLock(dbFile);
      await sleep(delay);
      delay = Math.min(delay * 2, 250);
    }
  }
}

export function lockDirFor(dbFile: string): string {
  return dbFile + '.lock';
}

/**
 * No live operation holds the lock for long (reads are milliseconds, index writes are chunked to a
 * few seconds), so a lock directory older than this was left by a killed process.
 */
export const STALE_LOCK_MS = 30000;

export function breakStaleLock(dbFile: string, maxAgeMs = STALE_LOCK_MS): boolean {
  try {
    const st = fs.statSync(lockDirFor(dbFile));
    if (Date.now() - st.mtimeMs > maxAgeMs) return removeStaleLock(dbFile);
  } catch (e) {
    // no lock
  }
  return false;
}

/** Removes "<db>.lock" left behind by a killed process. Only call when no other process uses the DB. */
export function removeStaleLock(dbFile: string): boolean {
  const dir = lockDirFor(dbFile);
  try {
    fs.rmdirSync(dir);
    return true;
  } catch (e) {
    return false;
  }
}

export function pidFileFor(dbFile: string): string {
  return path.join(path.dirname(dbFile), 'indexer.pid');
}

export function isPidAlive(pid: number): boolean {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readIndexerPid(dbFile: string): number | null {
  try {
    const pid = Number(fs.readFileSync(pidFileFor(dbFile), 'utf8').trim());
    return pid && isPidAlive(pid) ? pid : null;
  } catch (e) {
    return null;
  }
}
