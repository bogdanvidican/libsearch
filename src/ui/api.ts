// Thin client for the local server's JSON API. The token and mode come from <meta> tags the
// server injects into index.html. Works the same in Electron and in Firefox (fallback mode).
import type {
  BookSearchResponse,
  BooksOverview,
  BuildProgress,
  DownloadProgress,
  EncyclopediasOverview,
  Category,
  DocSummary,
  IndexStatus,
  KiwixBook,
  KiwixSearchResponse,
  KiwixStatus,
  ManualItem,
  NativeBridge,
  Notice,
  OpenRequest,
  OpenResult,
  Settings,
  Status,
  UpdateStatus,
} from '../shared/api';
import { S } from './strings';

declare global {
  interface Window {
    librarySearch?: NativeBridge;
  }
}

function meta(name: string): string {
  const el = document.querySelector('meta[name="' + name + '"]');
  return (el && el.getAttribute('content')) || '';
}

export const TOKEN = meta('ls-token');
/** Theme saved on the server when the page was served ('system' | 'light' | 'dark'). */
export const INITIAL_THEME = meta('ls-theme');
/** Dark mode colors saved on the server, "<tint>:<level>" (e.g. "navy:3"). */
export const INITIAL_DARK = meta('ls-dark');
export const native: NativeBridge | undefined = window.librarySearch;
export const MODE: 'electron' | 'browser' =
  meta('ls-mode') === 'electron' || native ? 'electron' : 'browser';

export class ApiError extends Error {
  notice: Notice;
  status: number;
  constructor(notice: Notice, status: number) {
    super(notice.message);
    this.notice = notice;
    this.status = status;
  }
}

function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';
}

export { isAbort };

function noticeFrom(data: unknown, status: number): Notice {
  if (data && typeof data === 'object') {
    const d = data as { error?: Notice | string; message?: string };
    if (d.error && typeof d.error === 'object' && d.error.message) return d.error;
    if (typeof d.error === 'string') return { kind: 'error', code: 'http-' + status, message: d.error };
    if (d.message) return { kind: 'error', code: 'http-' + status, message: d.message };
  }
  return { kind: 'error', code: 'http-' + status, message: S.errors.generic };
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: { [k: string]: string } = { 'X-Token': TOKEN };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      cache: 'no-store',
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError({ kind: 'error', code: 'network', message: S.errors.network, fix: S.errors.networkFix }, 0);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = null;
  }
  if (!res.ok) throw new ApiError(noticeFrom(data, res.status), res.status);
  return data as T;
}

function qs(params: { [k: string]: string | number | undefined }): string {
  const p = new URLSearchParams();
  for (const k in params) {
    const v = params[k];
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

export function newAbortController(): AbortController | undefined {
  return typeof AbortController !== 'undefined' ? new AbortController() : undefined;
}

export const api = {
  status: () => request<Status>('GET', '/api/status'),
  search: (q: string, category: string, limit: number, signal?: AbortSignal) =>
    request<BookSearchResponse>('GET', '/api/search' + qs({ q, category, limit }), undefined, signal),
  kiwixBooks: () => request<KiwixBook[]>('GET', '/api/kiwix/books'),
  kiwixSearch: (book: string, q: string, limit: number, signal?: AbortSignal) =>
    request<KiwixSearchResponse>('GET', '/api/kiwix/search' + qs({ book, q, limit }), undefined, signal),
  kiwixStart: () => request<KiwixStatus>('POST', '/api/kiwix/start', {}),
  /** Start, or restart our kiwix-serve so finished downloads / new files are picked up. */
  kiwixRestart: () => request<KiwixStatus>('POST', '/api/kiwix/restart', {}),
  browse: () => request<Category[]>('GET', '/api/browse'),
  browseDocs: (category: string) => request<DocSummary[]>('GET', '/api/browse/docs' + qs({ category })),
  problems: () => request<DocSummary[]>('GET', '/api/index/problems'),
  buildIndex: (full: boolean) => request<IndexStatus | BuildProgress>('POST', '/api/index/build', { full }),
  cancelIndex: () => request<IndexStatus | BuildProgress>('POST', '/api/index/cancel', {}),
  open: (req: OpenRequest) => request<OpenResult>('POST', '/api/open', req),
  saveSettings: (patch: Partial<Settings>) => request<Settings>('POST', '/api/settings', patch),
  updateCheck: () => request<UpdateStatus>('POST', '/api/update/check', {}),
  updateDownload: () => request<UpdateStatus>('POST', '/api/update/download', {}),
  /** Starts the install script and closes the app; it opens again when the update is in. */
  updateInstall: () => request<UpdateStatus>('POST', '/api/update/install', {}),
  /** Library -> Get books. */
  books: () => request<BooksOverview>('GET', '/api/books'),
  booksDownload: () => request<DownloadProgress>('POST', '/api/books/download', {}),
  booksCancel: () => request<DownloadProgress>('POST', '/api/books/cancel', {}),
  /** "Mark as done": the book was saved by hand (or undo it). */
  booksDone: (id: string, done: boolean) => request<BooksOverview>('POST', '/api/books/done', { id, done }),
  /** Library -> Get books -> Encyclopedias. */
  zims: () => request<EncyclopediasOverview>('GET', '/api/zims'),
  zimsDownload: (ids: string[]) => request<DownloadProgress>('POST', '/api/zims/download', { ids }),
  zimsCancel: () => request<DownloadProgress>('POST', '/api/zims/cancel', {}),
  /** Library -> Get books -> Save by hand. */
  manual: () => request<ManualItem[]>('GET', '/api/manual'),
  manualDone: (id: string, done: boolean) => request<ManualItem[]>('POST', '/api/manual/done', { id, done }),
  /** A web page in Firefox (the app window itself never goes online). */
  openUrl: (url: string) => request<OpenResult>('POST', '/api/open-url', { url }),
};

/** URL that opens a reader path in an outside browser (Firefox). ZIM pages go straight to kiwix-serve. */
export function externalUrl(path: string, kiwixPort: number): string {
  if (/^\/(content|skin|viewer|raw|catch|random|search)(\/|\?|$)/.test(path)) {
    return 'http://127.0.0.1:' + kiwixPort + path;
  }
  return location.protocol + '//' + location.host + path;
}
