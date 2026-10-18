// New book lists between app releases: when the computer is online, the four lists in kit/booklists/ are fetched from
// the default branch of the app's GitHub repo into <data dir>/booklists/. A fetched list is used instead of the one
// that came with the app only when it can be read and holds at least half as many entries (a cut-off or garbled
// download never replaces a good list), and only by the app version that fetched it (a newer app brings newer lists).
// Same schedule and switch as app updates (Settings -> Updates); like them, only this server process goes online.
// The kit's bash scripts keep using the lists that came with the app.
import * as fs from 'fs';
import * as path from 'path';
import { ListsStatus } from '../shared/api';
import { entryId, parseBookList } from '../downloader/booklist';
import { parseManualList } from '../downloader/manual';
import { parseZimList } from '../downloader/zimlist';
import { Config } from './config';
import { get, HttpStatusError, isOfflineError, readBody } from './net';
import { loadSettings } from './settings';

declare const __APP_VERSION__: string;
declare const __UPDATE_REPO__: string;

export type ListName = 'booklist-main.txt' | 'booklist-linux.txt' | 'manual-downloads.txt' | 'encyclopedias.txt';
export const LIST_NAMES: ListName[] = ['booklist-main.txt', 'booklist-linux.txt', 'manual-downloads.txt', 'encyclopedias.txt'];

const HOUR = 3600 * 1000;

export interface ListUpdaterOptions {
  /** https://raw.githubusercontent.com (a local server in tests). */
  rawBase?: string;
  /** owner/name; package.json "repository" (or LIBRARY_SEARCH_REPO) unless given. */
  repo?: string;
  version?: string;
}

interface Meta {
  appVersion: string;
  fetchedAt: number;
}

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return null;
  }
}

function remove(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    // not there
  }
}

function writeAtomic(file: string, text: string): void {
  fs.writeFileSync(file + '.tmp', text);
  fs.renameSync(file + '.tmp', file);
}

/** How many usable entries a list holds. */
function entries(name: ListName, text: string): number {
  if (name === 'manual-downloads.txt') return parseManualList(text, name).items.length;
  if (name === 'encyclopedias.txt') return parseZimList(text, name).entries.length;
  return parseBookList(text, name).entries.length;
}

function bookIds(text: string | null): string[] {
  return text ? parseBookList(text, 'list').entries.filter((e) => e.type === 'F').map(entryId) : [];
}

export class ListUpdater {
  private readonly dir: string;
  private readonly bundledDir: string;
  private readonly version: string;
  private readonly repo: string;
  private readonly rawBase: string;
  private st: ListsStatus;
  private checking: Promise<ListsStatus> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly cfg: Config, o: ListUpdaterOptions = {}) {
    this.dir = path.join(cfg.dataDir, 'booklists');
    this.bundledDir = path.join(cfg.appDir, 'kit', 'booklists');
    this.version = o.version || __APP_VERSION__;
    this.repo = o.repo || process.env.LIBRARY_SEARCH_REPO || __UPDATE_REPO__;
    this.rawBase = (o.rawBase || 'https://raw.githubusercontent.com').replace(/\/+$/, '');
    const meta = this.meta();
    this.st = {
      state: this.unsupported() ? 'unsupported' : 'idle',
      source: LIST_NAMES.some((n) => this.effective(n).source === 'github') ? 'github' : 'app',
      newBooks: this.countNew(),
    };
    if (meta && meta.appVersion === this.version && this.st.source === 'github') this.st.fetchedAt = meta.fetchedAt;
  }

  /** Off with --no-update, and in a developer copy (git pull brings the lists there). */
  private unsupported(): boolean {
    return !this.cfg.updates || this.cfg.appHome === this.cfg.appDir;
  }

  private meta(): Meta | null {
    const t = read(path.join(this.dir, 'meta.json'));
    try {
      const m = t ? (JSON.parse(t) as Meta) : null;
      return m && typeof m.appVersion === 'string' && typeof m.fetchedAt === 'number' ? m : null;
    } catch (e) {
      return null;
    }
  }

  private bundled(name: ListName): string {
    return path.join(this.bundledDir, name);
  }

  private cached(name: ListName): string {
    return path.join(this.dir, name);
  }

  /** Can be read, and is not much shorter than the list that came with the app. */
  private sound(name: ListName, text: string): boolean {
    const n = entries(name, text);
    const b = read(this.bundled(name));
    return n > 0 && n >= Math.ceil((b ? entries(name, b) : 0) / 2);
  }

  /** The list in use: the one this app version fetched from GitHub when it is sound, else the one that came with it. */
  effective(name: ListName): { path: string; source: 'app' | 'github' } {
    const meta = this.meta();
    if (meta && meta.appVersion === this.version) {
      const text = read(this.cached(name));
      if (text !== null && this.sound(name, text)) return { path: this.cached(name), source: 'github' };
    }
    return { path: this.bundled(name), source: 'app' };
  }

  /** Books on the lists in use that the app's own lists don't have. */
  private countNew(): number {
    const mine = bookIds(read(this.bundled('booklist-main.txt'))).concat(bookIds(read(this.bundled('booklist-linux.txt'))));
    const now = bookIds(read(this.effective('booklist-main.txt').path)).concat(bookIds(read(this.effective('booklist-linux.txt').path)));
    return now.filter((id, i) => mine.indexOf(id) < 0 && now.indexOf(id) === i).length;
  }

  status(): ListsStatus {
    return Object.assign({}, this.st);
  }

  check(): Promise<ListsStatus> {
    if (this.unsupported()) return Promise.resolve(this.status());
    if (this.checking) return this.checking;
    this.st = Object.assign({}, this.st, { state: 'checking' as const, error: undefined });
    this.checking = this.fetchAll().then(
      (s) => {
        this.checking = null;
        return s;
      },
      (e) => {
        this.checking = null;
        this.st = Object.assign({}, this.st, {
          state: 'error' as const,
          error: { kind: 'warning' as const, code: 'lists-failed', message: `The book lists could not be checked: ${(e as Error).message}`, fix: 'Try again later.' },
        });
        return this.status();
      }
    );
    return this.checking;
  }

  private async fetchAll(): Promise<ListsStatus> {
    const texts: Partial<Record<ListName, string>> = {};
    for (const name of LIST_NAMES) {
      try {
        const res = await get(`${this.rawBase}/${this.repo}/HEAD/kit/booklists/${name}`, { 'User-Agent': 'library-search' }, 20000);
        texts[name] = await readBody(res, 4 * 1048576);
      } catch (e) {
        if (e instanceof HttpStatusError) continue; // not on GitHub (yet): the app's own list stays
        if (isOfflineError(e)) {
          this.st = Object.assign({}, this.st, { state: 'offline' as const });
          return this.status();
        }
        throw e;
      }
    }
    fs.mkdirSync(this.dir, { recursive: true });
    let changed = false;
    for (const name of LIST_NAMES) {
      const t = texts[name];
      // Kept only when sound and different from the app's own; a garbled, cut-off or missing one is dropped.
      if (t !== undefined && this.sound(name, t) && t !== read(this.bundled(name))) {
        writeAtomic(this.cached(name), t);
        changed = true;
      } else {
        remove(this.cached(name));
      }
    }
    const fetchedAt = Date.now();
    writeAtomic(path.join(this.dir, 'meta.json'), JSON.stringify({ appVersion: this.version, fetchedAt }, null, 2) + '\n');
    this.st = { state: changed ? 'updated' : 'up-to-date', source: changed ? 'github' : 'app', fetchedAt, newBooks: this.countNew() };
    return this.status();
  }

  /** Checks shortly after start-up and then every few hours, while "Update automatically" is on. */
  start(firstMs = 35000, intervalMs = 6 * HOUR): void {
    if (this.unsupported()) return;
    this.stop();
    const run = () => {
      this.timer = setTimeout(() => {
        const next = () => run();
        if (loadSettings(this.cfg.dataDir).autoUpdate) void this.check().then(next);
        else next();
      }, this.timer ? intervalMs : firstMs);
    };
    run();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
