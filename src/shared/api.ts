// Types shared by the server (src/server) and the React UI (src/ui).
// Keep this file free of runtime imports so both bundles can use it.

/** Highlight markers used inside snippets:  = start of match,  = end of match. */
export const HL_START = '';
export const HL_END = '';

export type SourceGroup = 'books' | 'reference' | 'khan' | 'qa';

export type DocKind = 'pdf' | 'epub';
export type DocStatus = 'ok' | 'scanned' | 'error';

export interface PageHit {
  page: number;
  /** Plain text with HL_START/HL_END markers around matched terms. */
  snippet: string;
}

export interface BookResult {
  docId: number;
  title: string;
  category: string;
  /** e.g. "Hesperian (chapters) / en_wtnd_2025"; empty when the file sits directly in the category folder. */
  subfolder: string;
  kind: DocKind;
  /** Best page (1-based). For EPUBs this is the chapter number. 0 when it matched on the title only. */
  page: number;
  snippet: string;
  /** Other good pages in the same book (up to 3). */
  morePages: PageHit[];
  /** Number of matching pages in this book (capped by the search window). */
  hitPages: number;
  /** True when this book is a scan with no searchable text (matched by title only). */
  scanned: boolean;
  score: number;
}

export interface BookSearchResponse {
  query: string;
  /** 'all' = every word matched; 'any' = fallback where only some words matched. */
  matchMode: 'all' | 'any' | 'none';
  /** Words actually searched (after dropping stop-words), for highlighting in Evince/reader. */
  terms: string[];
  results: BookResult[];
  totalBooks: number;
  tookMs: number;
  /** Set when the index is missing/empty or busy; the UI shows it as a notice. */
  notice?: Notice;
}

export interface Notice {
  kind: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  /** Plain-language fix, e.g. "Open Library and click Build index". */
  fix?: string;
}

export interface KiwixBook {
  /** kiwix-serve book name, used as `books.name=` and in /content/<name>/ URLs. */
  name: string;
  title: string;
  description: string;
  language: string;
  group: Exclude<SourceGroup, 'books'>;
  /** Same-origin URL of the book's home page, e.g. /content/wikipedia_en_medicine_maxi/ */
  homeUrl: string;
  articleCount?: number;
}

export interface KiwixHit {
  title: string;
  /** Same-origin URL, e.g. /content/wikipedia_en_medicine_maxi/A/Water_purification */
  url: string;
  snippet: string;
}

export interface KiwixSearchResponse {
  book: string;
  results: KiwixHit[];
  /** Estimated total matches reported by kiwix-serve, if any. */
  total?: number;
  tookMs: number;
  error?: Notice;
}

export type KiwixState =
  | 'running' // reachable on the configured port
  | 'starting'
  | 'stopped' // binary + ZIMs exist but not running
  | 'no-binary'
  | 'no-zims'
  | 'port-busy' // something else answers on the port
  | 'error';

export interface KiwixStatus {
  state: KiwixState;
  port: number;
  /** Number of ZIM books the server reports (or files found on disk when stopped). */
  books: number;
  startedByUs: boolean;
  message?: string;
}

export interface BuildProgress {
  running: boolean;
  phase: 'idle' | 'scanning' | 'indexing' | 'cleaning' | 'done' | 'failed' | 'cancelled';
  done: number;
  total: number;
  currentFile: string;
  startedAt?: number;
  finishedAt?: number;
  added: number;
  updated: number;
  removed: number;
  failed: number;
  message?: string;
}

export interface IndexStatus {
  exists: boolean;
  docs: number;
  pages: number;
  scanned: number;
  errors: number;
  lastBuiltAt?: number;
  /** Files on disk that are new/changed since the last build (cheap stat scan), when known. */
  pendingChanges?: number;
  build: BuildProgress;
}

export interface ToolStatus {
  pdftotext: boolean;
  pdfinfo: boolean;
  evince: boolean;
  firefox: boolean;
}

export interface Status {
  version: string;
  mode: 'electron' | 'browser';
  platform: string;
  arch: string;
  electronVersion?: string;
  nodeVersion: string;
  roots: string[];
  dataDir: string;
  index: IndexStatus;
  kiwix: KiwixStatus;
  tools: ToolStatus;
  notices: Notice[];
}

export interface Category {
  /** Folder name, e.g. "01 Medicine" (used as the filter value). */
  folder: string;
  /** Display label, e.g. "Medicine". */
  label: string;
  docs: number;
  scanned: number;
}

export interface DocSummary {
  docId: number;
  title: string;
  category: string;
  folder: string;
  subfolder: string;
  kind: DocKind;
  pages: number;
  status: DocStatus;
  error?: string;
  relpath: string;
}

export interface OpenRequest {
  docId: number;
  page?: number;
  /** Search words, passed to Evince --find. */
  q?: string;
}

export interface OpenResult {
  ok: boolean;
  how: 'evince' | 'xdg-open' | 'open' | 'reader';
  /** For EPUB (and anything shown in-app): same-origin URL for the reader view. */
  readerUrl?: string;
  error?: Notice;
}

/** Bridge exposed by the Electron preload script as window.librarySearch (absent in Firefox mode). */
export interface NativeBridge {
  isElectron: true;
  appVersion: string;
  electronVersion: string;
  findInPage(text: string, forward: boolean): void;
  stopFindInPage(): void;
  openExternal(url: string): void;
  onFoundInPage(cb: (r: { matches: number; activeMatchOrdinal: number }) => void): () => void;
}
