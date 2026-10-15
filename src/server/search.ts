// Book search over the FTS5 index, plus browse/problem listings and index statistics.
import * as fs from 'fs';
import * as path from 'path';
import { BookResult, BookSearchResponse, Category, DocSummary, HL_END, HL_START, PageHit } from '../shared/api';
import { DB, PAGE_STRIDE, getMeta } from './db';
import { parseQuery } from './query';

const PAGE_WINDOW = 400;
const TITLE_WINDOW = 60;
const MORE_PAGES = 3;
const TITLE_WEIGHT = 1.2;

interface DocRow {
  id: number;
  title: string;
  series: string;
  category: string;
  folder: string;
  subfolder: string;
  kind: 'pdf' | 'epub';
  pages: number;
  status: string;
  error: string | null;
  relpath: string;
}

interface Candidate {
  id: number;
  pages: Array<{ page: number; s: number }>;
  hits: number;
  best: number; // bm25: more negative = better
  title: number; // positive title score, 0 when the title didn't match
}

function docsByIds(db: DB, ids: number[]): Map<number, DocRow> {
  const out = new Map<number, DocRow>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db.all(
      `SELECT id, title, series, category, folder, subfolder, kind, pages, status, error, relpath
       FROM docs WHERE id IN (${chunk.map(() => '?').join(',')})`,
      chunk
    ) as unknown as DocRow[];
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

function runSearch(db: DB, expr: string, category: string | undefined, limit: number) {
  const pageRows = db.all(`SELECT rowid AS r, bm25(pages) AS s FROM pages WHERE pages MATCH ? ORDER BY s LIMIT ${PAGE_WINDOW}`, [
    expr,
  ]) as Array<{ r: number; s: number }>;
  const titleRows = db.all(
    `SELECT rowid AS id, bm25(titles) AS s FROM titles WHERE titles MATCH ? ORDER BY s LIMIT ${TITLE_WINDOW}`,
    [expr]
  ) as Array<{ id: number; s: number }>;

  const cands = new Map<number, Candidate>();
  const get = (id: number) => {
    let c = cands.get(id);
    if (!c) {
      c = { id, pages: [], hits: 0, best: 0, title: 0 };
      cands.set(id, c);
    }
    return c;
  };
  for (const row of pageRows) {
    const r = Number(row.r);
    const c = get(Math.floor(r / PAGE_STRIDE));
    c.pages.push({ page: r % PAGE_STRIDE, s: row.s });
    c.hits++;
    if (row.s < c.best) c.best = row.s;
  }
  for (const row of titleRows) get(Number(row.id)).title = -row.s;

  const docs = docsByIds(db, Array.from(cands.keys()));
  const scored: Array<{ c: Candidate; d: DocRow; score: number }> = [];
  cands.forEach((c) => {
    const d = docs.get(c.id);
    if (!d || (d.status !== 'ok' && d.status !== 'scanned')) return;
    if (category && d.folder !== category) return;
    const pageScore = -c.best * (1 + 0.15 * Math.log(Math.max(1, c.hits)));
    scored.push({ c, d, score: pageScore + TITLE_WEIGHT * c.title });
  });
  scored.sort((a, b) => b.score - a.score);
  return { total: scored.length, top: scored.slice(0, limit) };
}

function snippets(db: DB, expr: string, rowids: number[]): Map<number, string> {
  const out = new Map<number, string>();
  if (!rowids.length) return out;
  const rows = db.all(
    `SELECT rowid AS r, snippet(pages, 0, ?, ?, '…', 24) AS sn FROM pages
     WHERE pages MATCH ? AND rowid IN (${rowids.map(() => '?').join(',')})`,
    [HL_START, HL_END, expr, ...rowids]
  ) as Array<{ r: number; sn: string }>;
  for (const r of rows) out.set(Number(r.r), String(r.sn).replace(/\s+/g, ' ').trim());
  return out;
}

export function searchBooks(db: DB, q: string, opts: { category?: string; limit?: number } = {}): BookSearchResponse {
  const t0 = Date.now();
  const limit = Math.max(1, Math.min(100, opts.limit || 30));
  const parsed = parseQuery(q);
  const empty: BookSearchResponse = { query: q, matchMode: 'none', terms: parsed.terms, results: [], totalBooks: 0, tookMs: 0 };
  if (!parsed.all) return { ...empty, tookMs: Date.now() - t0 };

  let matchMode: 'all' | 'any' = 'all';
  let expr = parsed.all;
  let res = runSearch(db, expr, opts.category, limit);
  if (!res.total && parsed.any) {
    matchMode = 'any';
    expr = parsed.any;
    res = runSearch(db, expr, opts.category, limit);
  }
  if (!res.total) return { ...empty, tookMs: Date.now() - t0 };

  const wanted: number[] = [];
  for (const { c } of res.top) {
    c.pages.sort((a, b) => a.s - b.s);
    for (const p of c.pages.slice(0, 1 + MORE_PAGES)) wanted.push(c.id * PAGE_STRIDE + p.page);
  }
  const sn = snippets(db, expr, wanted);

  const results: BookResult[] = res.top.map(({ c, d, score }) => {
    const pageHits: PageHit[] = c.pages
      .slice(0, 1 + MORE_PAGES)
      .map((p) => ({ page: p.page, snippet: sn.get(c.id * PAGE_STRIDE + p.page) || '' }));
    const best = pageHits[0];
    return {
      docId: d.id,
      title: d.title,
      series: d.series || '',
      category: d.category,
      folder: d.folder,
      subfolder: d.series || d.subfolder,
      kind: d.kind,
      page: best ? best.page : 0,
      snippet: best ? best.snippet : '',
      morePages: pageHits.slice(1),
      hitPages: c.hits,
      scanned: d.status === 'scanned',
      score: Math.round(score * 1000) / 1000,
    };
  });
  return { query: q, matchMode, terms: parsed.terms, results, totalBooks: res.total, tookMs: Date.now() - t0 };
}

export function listCategories(db: DB): Category[] {
  const rows = db.all(
    `SELECT folder, category, COUNT(*) AS docs, SUM(CASE WHEN status = 'scanned' THEN 1 ELSE 0 END) AS scanned
     FROM docs WHERE status IN ('ok', 'scanned') GROUP BY folder ORDER BY folder`
  ) as Array<{ folder: string; category: string; docs: number; scanned: number }>;
  return rows.map((r) => ({ folder: r.folder, label: r.category, docs: Number(r.docs), scanned: Number(r.scanned) }));
}

function toSummary(r: DocRow): DocSummary {
  return {
    docId: r.id,
    title: r.title,
    series: r.series || '',
    category: r.category,
    folder: r.folder,
    subfolder: r.subfolder,
    kind: r.kind,
    pages: r.pages,
    status: r.status as DocSummary['status'],
    error: r.error || undefined,
    relpath: r.relpath,
  };
}

export function listDocs(db: DB, folder: string): DocSummary[] {
  const rows = db.all(
    `SELECT id, title, series, category, folder, subfolder, kind, pages, status, error, relpath
     FROM docs WHERE folder = ? AND status IN ('ok', 'scanned') ORDER BY subfolder, relpath`,
    [folder]
  ) as unknown as DocRow[];
  return rows.map(toSummary);
}

export function listProblems(db: DB): DocSummary[] {
  const rows = db.all(
    `SELECT id, title, series, category, folder, subfolder, kind, pages, status, error, relpath
     FROM docs WHERE status IN ('scanned', 'error') ORDER BY status DESC, folder, relpath`
  ) as unknown as DocRow[];
  return rows.map(toSummary);
}

export interface IndexStats {
  docs: number;
  pages: number;
  scanned: number;
  errors: number;
  lastBuiltAt?: number;
}

export function indexStats(db: DB): IndexStats {
  const r = db.get(
    `SELECT COUNT(*) AS docs,
            SUM(CASE WHEN status = 'ok' THEN pages ELSE 0 END) AS pages,
            SUM(CASE WHEN status = 'scanned' THEN 1 ELSE 0 END) AS scanned,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
     FROM docs WHERE status != 'pending'`
  ) as { docs: number; pages: number | null; scanned: number | null; errors: number | null };
  const last = getMeta(db, 'last_build_finished');
  return {
    docs: Number(r.docs) - Number(r.errors || 0),
    pages: Number(r.pages || 0),
    scanned: Number(r.scanned || 0),
    errors: Number(r.errors || 0),
    lastBuiltAt: last ? Number(last) : undefined,
  };
}

export interface DocFile {
  id: number;
  title: string;
  kind: 'pdf' | 'epub';
  abs: string;
}

/** Finds the file of an indexed document in the current library roots (relpaths are portable). */
export function resolveDocFile(db: DB, roots: string[], id: number): DocFile | null {
  const r = db.get('SELECT id, title, kind, relpath FROM docs WHERE id = ?', [id]) as
    | { id: number; title: string; kind: 'pdf' | 'epub'; relpath: string }
    | null;
  if (!r) return null;
  for (const root of roots) {
    const abs = path.join(root, ...r.relpath.split('/'));
    // Never escape the root, whatever is stored in the index.
    if (path.relative(root, abs).startsWith('..')) continue;
    if (fs.existsSync(abs)) return { id: r.id, title: r.title, kind: r.kind, abs };
  }
  return null;
}

/** relpath + size + mtime of every indexed doc, for the cheap "anything new on disk?" check. */
export interface FileStamp {
  size: number;
  mtime: number;
  fp: string | null;
}

export function indexedFileStamps(db: DB): Map<string, FileStamp> {
  const out = new Map<string, FileStamp>();
  for (const r of db.all("SELECT relpath, size, mtime, fp FROM docs WHERE status != 'pending'") as Array<{
    relpath: string;
    size: number;
    mtime: number;
    fp: string | null;
  }>) {
    out.set(r.relpath, { size: Number(r.size), mtime: Number(r.mtime), fp: r.fp });
  }
  return out;
}
