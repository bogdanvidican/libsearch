// Pure state helpers for streaming Kiwix results into grouped sections.
// Rule: rows already shown never move. A book's hits are appended to its group when they arrive.
import type { KiwixBook, KiwixHit, KiwixSearchResponse, SourceGroup } from '../shared/api';

export type KiwixGroup = Exclude<SourceGroup, 'books'>;
export const GROUP_ORDER: KiwixGroup[] = ['reference', 'khan', 'qa'];

export interface KiwixRow extends KiwixHit {
  book: string;
  bookTitle: string;
  key: string;
}

export interface GroupState {
  group: KiwixGroup;
  books: string[];
  pending: number;
  failed: number;
  rows: KiwixRow[];
}

export type KiwixResults = { [G in KiwixGroup]: GroupState };

export function initKiwixResults(books: KiwixBook[]): KiwixResults {
  const res = {} as KiwixResults;
  for (const g of GROUP_ORDER) res[g] = { group: g, books: [], pending: 0, failed: 0, rows: [] };
  for (const b of books) {
    const g = res[b.group] || res.reference;
    g.books.push(b.name);
    g.pending++;
  }
  return res;
}

/** Returns a new state with one book's answer merged in. `resp === null` means the request failed. */
export function applyBookResult(
  state: KiwixResults,
  book: KiwixBook,
  resp: KiwixSearchResponse | null,
): KiwixResults {
  const key = (state[book.group] ? book.group : 'reference') as KiwixGroup;
  const prev = state[key];
  if (prev.books.indexOf(book.name) < 0) return state; // stale answer from an older search
  const failed = !resp || !!resp.error;
  const seen: { [url: string]: boolean } = {};
  for (const r of prev.rows) seen[r.url] = true;
  const newRows: KiwixRow[] = [];
  if (resp && !resp.error) {
    for (const hit of resp.results) {
      if (seen[hit.url]) continue;
      seen[hit.url] = true;
      newRows.push({ ...hit, book: book.name, bookTitle: book.title, key: book.name + '|' + hit.url });
    }
  }
  const next: GroupState = {
    group: prev.group,
    books: prev.books,
    pending: Math.max(0, prev.pending - 1),
    failed: prev.failed + (failed ? 1 : 0),
    rows: newRows.length ? prev.rows.concat(newRows) : prev.rows,
  };
  const out = { ...state };
  out[key] = next;
  return out;
}

export function totalPending(state: KiwixResults): number {
  let n = 0;
  for (const g of GROUP_ORDER) n += state[g].pending;
  return n;
}

export function totalFailed(state: KiwixResults): number {
  let n = 0;
  for (const g of GROUP_ORDER) n += state[g].failed;
  return n;
}

export function totalRows(state: KiwixResults): number {
  let n = 0;
  for (const g of GROUP_ORDER) n += state[g].rows.length;
  return n;
}

/**
 * Rows to show before "Show more": at most `perBook` rows from each book, `max` in total, in arrival
 * order. Later answers only ever append, so rows already on screen keep their place.
 */
export function previewRows(rows: KiwixRow[], perBook: number, max: number): KiwixRow[] {
  const seen: { [book: string]: number } = {};
  const out: KiwixRow[] = [];
  for (const r of rows) {
    const n = seen[r.book] || 0;
    if (n >= perBook) continue;
    seen[r.book] = n + 1;
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}
