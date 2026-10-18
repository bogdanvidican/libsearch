// Types shared by the server (src/server) and the React UI (src/ui).
// Keep this file free of runtime imports so both bundles can use it.
import type { DarkTint } from './darkPalette';

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
  /** Display label under the title, e.g. "Where There Is No Doctor (2025) · Chapter 9" (may be empty). */
  series?: string;
  category: string;
  /** Category folder name, e.g. "01 Medicine" (the value for the category filter). */
  folder?: string;
  /** Series label when there is one, else the folder path below the category, e.g. "Humanure Handbook". */
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

export interface SkippedZim {
  /** File name, e.g. wikipedia_ro_all_maxi_2026-09.zim */
  file: string;
  path: string;
  code: 'incomplete' | 'not-zim' | 'unreadable' | 'rejected';
  reason: string;
  fix: string;
}

export interface KiwixStatus {
  state: KiwixState;
  /** ZIM files left out (still downloading, damaged...). The others still work. */
  skipped?: SkippedZim[];
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

/** A download job (books or encyclopedias, src/downloader), shown on Library -> Get books. */
export interface DownloadProgress {
  running: boolean;
  phase: 'idle' | 'checking' | 'downloading' | 'done' | 'failed' | 'cancelled';
  /** Files handled / known so far (a page or archive.org item adds its files once it has been read). */
  done: number;
  total: number;
  /** "<folder>/<file>" being downloaded. */
  currentFile: string;
  /** Bytes of the current file (counting what an earlier try left) and its full size (0 = unknown). */
  fileReceived: number;
  fileTotal: number;
  /** Bytes received in this run, and the speed over the last few seconds (bytes per second). */
  bytes: number;
  speed: number;
  downloaded: number;
  skipped: number;
  failed: number;
  /** Encyclopedias: which try of the current file (they continue after the connection drops). */
  attempt?: number;
  startedAt?: number;
  finishedAt?: number;
  /** Why it stopped (offline, disk full …), or a warning (little space left, list lines that can't be used). */
  notice?: Notice;
}

export interface DownloadFailure {
  /** "<folder>|<file>" for a book; "S|…" / "A|…" when a whole page or archive.org item couldn't be read. */
  id: string;
  folder: string;
  /** File name, or "(page)" when a page or archive.org item couldn't be read. */
  file: string;
  url: string;
  code: string;
  reason: string;
  at: number;
}

/** One topic folder on Library -> Get books. Pages and archive.org items count by their files once known. */
export interface BookTopic {
  /** "01 Medicine" */
  folder: string;
  /** "Medicine" */
  label: string;
  listed: number;
  present: number;
  /** Failed in the last download (and not saved by hand since). */
  failed: number;
  /** Size of the topic's listed books on this computer. */
  bytes: number;
}

export interface BooksOverview {
  /** The library folder downloads go into, or null when there is none that can be used (see `problem`). */
  destination: string | null;
  /** Why nothing can be downloaded: no library folder, unplugged, read-only, or inside the app's own folder. */
  problem?: Notice;
  topics: BookTopic[];
  missing: number;
  /** Books that failed last time, minus the ones saved by hand since. */
  failures: DownloadFailure[];
  lastRun?: { finishedAt: number; downloaded: number; skipped: number; failed: number };
  lists: { name: string; source: 'app' | 'github' | 'library'; entries: number }[];
  freeBytes?: number;
}

/** New book lists from GitHub between app releases (src/server/lists.ts). */
export interface ListsStatus {
  state: 'idle' | 'checking' | 'up-to-date' | 'updated' | 'offline' | 'error' | 'unsupported';
  /** github = at least one list in use came from GitHub (newer than the app's own). */
  source: 'app' | 'github';
  fetchedAt?: number;
  /** Books on the lists in use that the app's own lists don't have. */
  newBooks: number;
  error?: Notice;
}

/** One encyclopedia on Library -> Get books -> Encyclopedias (kit/booklists/encyclopedias.txt). */
export interface ZimItem {
  /** The file name prefix, e.g. "wikipedia_en_medicine_maxi_". */
  id: string;
  title: string;
  approxGb: number;
  /** Downloaded by 3-download-offline-wikipedia.sh. */
  defaultOn: boolean;
  /** Chosen for the last download. */
  selected: boolean;
  /** ready = a whole .zim is here; partial = a download that was cut off (it continues). */
  state: 'missing' | 'partial' | 'ready';
  /** The .zim (or .zim.part) on this computer. */
  file?: string;
  /** Bytes on this computer. */
  have: number;
  /** Why the last download of it failed. */
  failure?: { code: string; reason: string };
}

export interface EncyclopediasOverview {
  /** The library folder downloads go into (see BooksOverview). */
  destination: string | null;
  problem?: Notice;
  /** Where the .zim files go: the library's Kiwix folder. */
  kiwixDir: string | null;
  /** The drive is FAT32: files of 4 GB and more can't go on it. */
  fat32: boolean;
  freeBytes?: number;
  /** kiwix-serve: found, missing (it is downloaded first), or not available here (macOS). */
  reader: 'ok' | 'missing' | 'unsupported';
  items: ZimItem[];
}

/** How a book to save by hand is saved: a download button, Print to PDF, a form first, or a zip to unpack. */
export type ManualHow = 'button' | 'print-to-pdf' | 'form' | 'zip';

/** One book to save by hand (Library -> Get books -> Save by hand). */
export interface ManualItem {
  /** "M|<folder>|<url>" */
  id: string;
  folder: string;
  title: string;
  url: string;
  how: ManualHow;
  note: string;
  /** Ticked off by the user. */
  done: boolean;
  /** Not ticked, but a file with the title's words is already in the folder. */
  auto: boolean;
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
  /** Where the library folders came from: start-up flag, environment, chosen in the app, or found automatically. */
  rootsSource: RootsSource;
  rootInfo: RootInfo[];
  dataDir: string;
  /** The app's kit folder: the download scripts and the book lists that came with this version. */
  kitDir: string;
  index: IndexStatus;
  kiwix: KiwixStatus;
  tools: ToolStatus;
  update: UpdateStatus;
  /** Library -> Get books: the books job and the encyclopedias job (idle when not running). */
  downloads: { books: DownloadProgress; zims: DownloadProgress };
  /** Book lists from GitHub. */
  lists: ListsStatus;
  notices: Notice[];
}

export type UpdateState =
  | 'unsupported' // a developer copy, macOS, or started with --no-update (see `reason`)
  | 'idle' // not checked yet
  | 'checking'
  | 'up-to-date'
  | 'offline' // GitHub couldn't be reached (no internet)
  | 'available' // a newer version exists; not downloaded yet (automatic updates are off)
  | 'downloading'
  | 'ready' // downloaded and checked: installed when the app closes, or on "Restart now"
  | 'installing' // the install script was started; the app is about to close
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  /** Version running now. */
  current: string;
  /** Newest published version, when known. */
  latest?: string;
  /** Version downloaded and waiting to be installed. */
  downloaded?: string;
  /** Release notes of `latest` (plain text, shortened). */
  notes?: string;
  /** Bytes received / expected while downloading. */
  received?: number;
  total?: number;
  checkedAt?: number;
  /** Check, download and install by itself (Settings.autoUpdate). */
  auto: boolean;
  /** Why the app can't update itself (state 'unsupported'). */
  reason?: string;
  error?: Notice;
  /** Set when this run is the first after an update: the version it replaced. */
  updatedFrom?: string;
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
  /** Display label, e.g. "Where There Is No Doctor (2025) · Chapter 9" (may be empty). */
  series?: string;
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
  how: 'evince' | 'xdg-open' | 'open' | 'reader' | 'firefox';
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
  /** Native "choose folder" dialog; resolves to null when cancelled. */
  pickFolder?(): Promise<string | null>;
}

/** 'system' follows the operating system (prefers-color-scheme). */
export type ThemeSetting = 'system' | 'light' | 'dark';

/** Saved in <data dir>/settings.json, so it survives restarts (the app's port changes every launch). */
export interface Settings {
  theme: ThemeSetting;
  /** Library folders chosen in the app (empty = find them automatically next to the app). */
  libraryRoots: string[];
  /** Look for new versions on GitHub when online, download them, and install them when the app closes. */
  autoUpdate: boolean;
  /** Dark mode colors (src/shared/darkPalette.ts): the tint of the surfaces, and how dark (1 softest - 5 darkest). */
  darkTint: DarkTint;
  darkLevel: number;
}

export type RootsSource = 'flag' | 'env' | 'settings' | 'auto';

export interface RootInfo {
  path: string;
  exists: boolean;
  /** Topic folders like "01 Medicine". */
  categories: number;
  /** Encyclopedia (.zim) files. */
  zims: number;
}
