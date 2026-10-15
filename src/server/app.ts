// HTTP API + static UI + kiwix-serve reverse proxy. One instance per server process.
import { ChildProcess, fork } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { URL } from 'url';
import { BuildProgress, IndexStatus, Notice, OpenRequest, Settings, Status } from '../shared/api';
import { checkLibraryFolder, Config, effectiveRoots, expandHome } from './config';
import { DB, breakStaleLock, isBusyError, openDb, readIndexerPid, removeStaleLock, withRetry } from './db';
import { Kiwix } from './kiwix';
import { openDocument, readEpubEntry } from './opener';
import { FileStamp, IndexStats, indexStats, indexedFileStamps, listCategories, listDocs, listProblems, resolveDocFile, searchBooks } from './search';
import { loadSettings, saveSettings } from './settings';
import { hasCommand } from './tools';
import { findLibraryFiles, fingerprint } from '../indexer/walk';

declare const __APP_VERSION__: string;

const IDLE_BUILD: BuildProgress = {
  running: false,
  phase: 'idle',
  done: 0,
  total: 0,
  currentFile: '',
  added: 0,
  updated: 0,
  removed: 0,
  failed: 0,
};

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly notice?: Notice) {
    super(message);
  }
}

const UI_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

export class App {
  readonly kiwix: Kiwix;
  private db: DB | null = null;
  private indexer: ChildProcess | null = null;
  private build: BuildProgress = { ...IDLE_BUILD };
  private indexerStderr = '';
  private stats: { at: number; value: IndexStats } | null = null;
  private pending: { at: number; value: number } | null = null;
  private port = 0;

  constructor(readonly cfg: Config, readonly token: string) {
    this.kiwix = new Kiwix(cfg);
  }

  setPort(port: number): void {
    this.port = port;
  }

  // ---------- database ----------

  private getDb(): DB | null {
    if (this.db) return this.db;
    if (!fs.existsSync(this.cfg.indexPath)) return null;
    // A crashed indexer may have left a lock; it is safe to clear when no indexer is alive.
    if (!readIndexerPid(this.cfg.indexPath)) breakStaleLock(this.cfg.indexPath, 0);
    try {
      this.db = openDb(this.cfg.indexPath, { cacheMb: 8 });
    } catch (e) {
      return null;
    }
    return this.db;
  }

  private async withDb<T>(fn: (db: DB) => T, fallback: T, timeoutMs = 3000): Promise<T> {
    const db = this.getDb();
    if (!db) return fallback;
    try {
      return await withRetry(() => fn(db), timeoutMs, this.cfg.indexPath);
    } catch (e) {
      if (isBusyError(e)) {
        throw new HttpError(503, 'index busy', {
          kind: 'warning',
          code: 'index-busy',
          message: 'The book index is being updated right now.',
          fix: 'Try again in a few seconds.',
        });
      }
      if (/no such table/i.test((e as Error).message)) return fallback;
      throw e;
    }
  }

  private async indexStatsCached(): Promise<IndexStats | null> {
    if (this.stats && Date.now() - this.stats.at < 2000) return this.stats.value;
    try {
      const v = await this.withDb((db) => indexStats(db), null as IndexStats | null, 800);
      if (v) this.stats = { at: Date.now(), value: v };
      return v;
    } catch (e) {
      return this.stats ? this.stats.value : null; // busy while building: show the last numbers
    }
  }

  /** Cheap check for books added/changed/removed on disk since the last build. */
  private async pendingChanges(force = false): Promise<number | undefined> {
    if (!force && this.pending && Date.now() - this.pending.at < 60000) return this.pending.value;
    try {
      const files = findLibraryFiles(this.cfg.roots);
      const stamps = await this.withDb((db) => indexedFileStamps(db), new Map<string, FileStamp>(), 1500);
      let n = 0;
      const seen = new Set<string>();
      for (const f of files) {
        seen.add(f.relpath);
        const s = stamps.get(f.relpath);
        if (!s || s.size !== f.size) n++;
        else if (s.mtime !== f.mtime && !this.sameContent(f.abs, f.size, f.mtime, s.fp)) n++;
      }
      stamps.forEach((_s, rel) => {
        const folder = rel.split('/')[0];
        if (!seen.has(rel) && this.cfg.roots.some((r) => fs.existsSync(path.join(r, folder)))) n++;
      });
      this.pending = { at: Date.now(), value: n };
      return n;
    } catch (e) {
      return this.pending ? this.pending.value : undefined;
    }
  }

  private fpCache = new Map<string, string>();

  /** Same check the indexer makes: a new date alone (copied files) is not a change. */
  private sameContent(abs: string, size: number, mtime: number, fp: string | null): boolean {
    if (!fp) return false;
    const key = `${abs}|${size}|${mtime}`;
    let cur = this.fpCache.get(key);
    if (cur === undefined) {
      try {
        cur = fingerprint(abs, size);
      } catch (e) {
        cur = '';
      }
      this.fpCache.set(key, cur);
    }
    return cur === fp;
  }

  // ---------- library folders ----------

  /** Plain-language reason a folder can't be a library root, or null when it is fine. */
  private folderProblem(p: string): Notice | null {
    const err = (message: string, fix: string): Notice => ({ kind: 'error', code: 'bad-folder', message, fix });
    if (!path.isAbsolute(p)) return err(`"${p}" is not a full path.`, 'Type the whole path, starting with / (for example /home/me/Library).');
    const c = checkLibraryFolder(p);
    if (!c.exists) return err(`The folder "${p}" doesn't exist.`, 'Check the spelling, or plug in the drive that holds it.');
    if (!c.categories && !c.zims) {
      return err(
        `"${p}" has no topic folders (like "01 Medicine") and no encyclopedia files.`,
        'Choose the folder that contains the numbered topic folders.'
      );
    }
    return null;
  }

  /** Switches to new library folders without a restart. */
  applyRoots(saved: string[]): void {
    const next = effectiveRoots(this.cfg, saved);
    const changed = next.roots.join('\n') !== this.cfg.roots.join('\n');
    this.cfg.roots = next.roots;
    this.cfg.rootsSource = next.source;
    if (!changed) return;
    this.pending = null;
    // The encyclopedias may have changed too: restart kiwix-serve if we started it, or start it now.
    if (this.kiwix.isStartedByUs()) this.kiwix.stop();
    if (this.cfg.kiwixAutostart) setTimeout(() => void this.kiwix.start(), 1500);
  }

  // ---------- index build ----------

  private indexerPath(): string {
    return path.join(this.cfg.appDir, 'build', 'indexer', 'indexer.js');
  }

  startBuild(full: boolean): BuildProgress {
    if (this.indexer) return this.build;
    const external = readIndexerPid(this.cfg.indexPath);
    if (external) {
      return { ...this.build, running: true, phase: 'indexing', message: `An index update is already running (process ${external}).` };
    }
    const args: string[] = [];
    for (const r of this.cfg.roots) args.push('--library-root', r);
    args.push('--data-dir', this.cfg.dataDir);
    if (full) args.push('--full');
    this.indexerStderr = '';
    this.build = { ...IDLE_BUILD, running: true, phase: 'scanning', startedAt: Date.now() };
    const child = fork(this.indexerPath(), args, {
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
      execArgv: [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.indexer = child;
    child.stderr!.on('data', (d: Buffer) => {
      this.indexerStderr = (this.indexerStderr + d.toString()).slice(-4000);
    });
    child.on('message', (m: { type?: string; progress?: BuildProgress }) => {
      if (m && m.type === 'progress' && m.progress) this.build = m.progress;
    });
    child.on('exit', (code, signal) => {
      this.indexer = null;
      // The indexer is gone and this process holds no statement right now: any lock left is stale.
      removeStaleLock(this.cfg.indexPath);
      if (this.build.running) {
        const tail = this.indexerStderr.trim().split('\n').slice(-1)[0] || '';
        this.build = {
          ...this.build,
          running: false,
          phase: code === 3 ? 'cancelled' : 'failed',
          finishedAt: Date.now(),
          message: code === 3 ? 'Stopped. Run the update again to continue.' : tail || `Index update stopped (${signal || 'exit ' + code}).`,
        };
      }
      this.stats = null;
      this.pending = null;
      // Reopen so a rebuilt schema is picked up cleanly.
      if (this.db) {
        try {
          this.db.close();
        } catch (e) {
          // ignore
        }
        this.db = null;
      }
      void this.pendingChanges(true);
    });
    return this.build;
  }

  cancelBuild(): BuildProgress {
    if (this.indexer) this.indexer.kill('SIGTERM');
    return this.build;
  }

  // ---------- status ----------

  async status(rescan = false): Promise<Status> {
    const stats = await this.indexStatsCached();
    const externalPid = this.indexer ? null : readIndexerPid(this.cfg.indexPath);
    const build: BuildProgress = externalPid
      ? { ...IDLE_BUILD, running: true, phase: 'indexing', message: 'An index update is running in a terminal window.' }
      : this.build;
    const index: IndexStatus = {
      exists: !!stats && stats.docs + stats.errors > 0,
      docs: stats ? stats.docs : 0,
      pages: stats ? stats.pages : 0,
      scanned: stats ? stats.scanned : 0,
      errors: stats ? stats.errors : 0,
      lastBuiltAt: stats ? stats.lastBuiltAt : undefined,
      pendingChanges: build.running ? undefined : await this.pendingChanges(rescan),
      build,
    };
    const tools = {
      pdftotext: hasCommand('pdftotext'),
      pdfinfo: hasCommand('pdfinfo'),
      evince: hasCommand('evince'),
      firefox: hasCommand('firefox'),
    };
    const notices: Notice[] = [];
    const rootInfo = this.cfg.roots.map((r) => checkLibraryFolder(r));
    if (!this.cfg.roots.length) {
      notices.push({
        kind: 'error',
        code: 'no-library',
        message: 'No library folder has been chosen yet.',
        fix: 'Open Library and choose the folder that holds your books (the one with folders like "01 Medicine").',
      });
    } else if (rootInfo.every((r) => !r.exists)) {
      notices.push({
        kind: 'error',
        code: 'library-missing',
        message: `The library folder can't be found: ${this.cfg.roots.join(', ')}`,
        fix: 'If the books are on a USB drive, plug it in. Otherwise open Library and choose the folder again.',
      });
    } else if (!index.exists && !build.running) {
      notices.push({
        kind: 'info',
        code: 'no-index',
        message: 'The book search index has not been built yet.',
        fix: 'Open Library and click "Build index". It takes about an hour on this laptop.',
      });
    }
    if (!tools.pdftotext && this.cfg.roots.length) {
      notices.push({
        kind: 'error',
        code: 'no-pdftotext',
        message: 'The program that reads PDF text (pdftotext) is missing.',
        fix: 'Open a terminal and run:  sudo apt-get install poppler-utils',
      });
    }
    if (process.platform === 'linux' && !tools.evince) {
      notices.push({
        kind: 'warning',
        code: 'no-evince',
        message: 'The document viewer (Evince) is missing, so books open without jumping to the page.',
        fix: 'Open a terminal and run:  sudo apt-get install evince',
      });
    }
    return {
      version: __APP_VERSION__,
      mode: this.cfg.mode,
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      roots: this.cfg.roots,
      rootsSource: this.cfg.rootsSource,
      rootInfo,
      dataDir: this.cfg.dataDir,
      index,
      kiwix: await this.kiwix.status(),
      tools,
      notices,
    };
  }

  // ---------- HTTP ----------

  private send(res: http.ServerResponse, status: number, body: unknown): void {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  }

  private readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let s = '';
      req.on('data', (d: Buffer) => {
        s += d.toString();
        if (s.length > 64 * 1024) reject(new HttpError(413, 'body too large'));
      });
      req.on('end', () => {
        if (!s) return resolve({});
        try {
          resolve(JSON.parse(s));
        } catch (e) {
          reject(new HttpError(400, 'invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  private serveUi(res: http.ServerResponse, rel: string): boolean {
    const uiDir = path.join(this.cfg.appDir, 'build', 'ui');
    const file = path.normalize(path.join(uiDir, rel === '/' ? 'index.html' : rel));
    if (!file.startsWith(uiDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    let body: Buffer = fs.readFileSync(file);
    if (ext === '.html') {
      const theme = loadSettings(this.cfg.dataDir).theme;
      const meta =
        `<meta name="ls-token" content="${this.token}">` +
        `<meta name="ls-mode" content="${this.cfg.mode}">` +
        `<meta name="ls-version" content="${__APP_VERSION__}">` +
        `<meta name="ls-theme" content="${theme}">`;
      let html = body.toString('utf8').replace('<!--ls-meta-->', meta);
      // Stamp an explicit theme on <html> so the first paint already has the right colors.
      if (theme !== 'system') html = html.replace(/<html\b/i, `<html data-theme="${theme}"`);
      body = Buffer.from(html, 'utf8');
    }
    res.writeHead(200, {
      'Content-Type': UI_TYPES[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
    return true;
  }

  private proxyToKiwix(req: http.IncomingMessage, res: http.ServerResponse): void {
    const kport = this.kiwix.port;
    const headers = Object.assign({}, req.headers, { host: `127.0.0.1:${kport}` });
    delete headers['x-token'];
    const preq = http.request({ host: '127.0.0.1', port: kport, path: req.url, method: req.method, headers }, (pres) => {
      const h = Object.assign({}, pres.headers);
      const loc = h.location;
      if (typeof loc === 'string') h.location = loc.replace(/^https?:\/\/(127\.0\.0\.1|localhost):\d+/i, '');
      res.writeHead(pres.statusCode || 502, h);
      pres.pipe(res);
    });
    preq.on('error', () => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const html =
        '<!doctype html><meta charset="utf-8"><body style="font:18px/1.5 sans-serif;padding:32px;color:#111">' +
        '<h1 style="font-size:24px">The encyclopedia server is not running</h1>' +
        '<p>Go back and open the <b>Library</b> page, then click <b>Start encyclopedias</b>.</p></body>';
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    req.pipe(preq);
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // DNS-rebinding guard: only answer requests addressed to this machine.
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (host && !/^(127\.0\.0\.1|localhost|\[::1\])$/i.test(host)) throw new HttpError(403, 'forbidden host');

      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const p = url.pathname;

      if (p.startsWith('/api/')) {
        if (req.headers['x-token'] !== this.token) throw new HttpError(401, 'missing or wrong token');
        return await this.api(req, res, p, url.searchParams);
      }
      if (p.startsWith('/epub/')) return this.epub(res, p);
      if (req.method === 'GET' && (p === '/' || /^\/[\w.-]+\.(js|css|svg|png|ico|map|html)$/.test(p))) {
        if (this.serveUi(res, p)) return;
      }
      return this.proxyToKiwix(req, res);
    } catch (e) {
      const he = e instanceof HttpError ? e : new HttpError(500, (e as Error).message);
      if (he.status === 500) process.stderr.write(`[server] ${req.method} ${req.url}: ${(e as Error).stack || e}\n`);
      if (!res.headersSent) {
        this.send(res, he.status, {
          error: he.notice || { kind: 'error', code: `http-${he.status}`, message: he.message },
        });
      } else res.end();
    }
  }

  private epub(res: http.ServerResponse, p: string): void {
    const m = p.match(/^\/epub\/(\d+)\/(.+)$/);
    if (!m) throw new HttpError(404, 'not found');
    const entry = m[2]
      .split('/')
      .map((s) => decodeURIComponent(s))
      .join('/');
    if (entry.split('/').indexOf('..') >= 0) throw new HttpError(400, 'bad path');
    const db = this.getDb();
    const doc = db ? resolveDocFile(db, this.cfg.roots, Number(m[1])) : null;
    if (!doc || doc.kind !== 'epub') throw new HttpError(404, 'book not found');
    const r = readEpubEntry(doc.abs, entry);
    if (!r) throw new HttpError(404, 'not found in book');
    res.writeHead(200, { 'Content-Type': r.type, 'Content-Length': r.body.length, 'Cache-Control': 'no-cache' });
    res.end(r.body);
  }

  private async api(req: http.IncomingMessage, res: http.ServerResponse, p: string, q: URLSearchParams): Promise<void> {
    const method = req.method || 'GET';
    const route = `${method} ${p}`;
    switch (route) {
      case 'GET /api/status':
        return this.send(res, 200, await this.status(q.get('rescan') === '1'));

      case 'GET /api/search': {
        const text = q.get('q') || '';
        const category = q.get('category') || undefined;
        const limit = Number(q.get('limit') || 30);
        const db = this.getDb();
        if (!db) {
          return this.send(res, 200, {
            query: text,
            matchMode: 'none',
            terms: [],
            results: [],
            totalBooks: 0,
            tookMs: 0,
            notice: {
              kind: 'info',
              code: 'no-index',
              message: 'Book search is not ready yet: the index has not been built.',
              fix: 'Open Library and click "Build index" (about an hour on this laptop).',
            },
          });
        }
        try {
          const r = await this.withDb((d) => searchBooks(d, text, { category, limit }), null as ReturnType<typeof searchBooks> | null);
          if (!r) {
            return this.send(res, 200, {
              query: text,
              matchMode: 'none',
              terms: [],
              results: [],
              totalBooks: 0,
              tookMs: 0,
              notice: { kind: 'info', code: 'no-index', message: 'The book index is empty.', fix: 'Open Library and click "Build index".' },
            });
          }
          return this.send(res, 200, r);
        } catch (e) {
          if (e instanceof HttpError && e.notice) {
            return this.send(res, 200, { query: text, matchMode: 'none', terms: [], results: [], totalBooks: 0, tookMs: 0, notice: e.notice });
          }
          throw e;
        }
      }

      case 'GET /api/settings':
        return this.send(res, 200, loadSettings(this.cfg.dataDir));

      case 'POST /api/settings': {
        const body = (await this.readBody(req)) as Partial<Settings>;
        if (body.libraryRoots !== undefined) {
          if (!Array.isArray(body.libraryRoots)) throw new HttpError(400, 'libraryRoots must be a list');
          body.libraryRoots = body.libraryRoots.map((r) => expandHome(String(r)));
          for (const r of body.libraryRoots) {
            const bad = this.folderProblem(r);
            if (bad) throw new HttpError(400, bad.message, bad);
          }
        }
        const saved = saveSettings(this.cfg.dataDir, body);
        if (body.libraryRoots !== undefined) this.applyRoots(saved.libraryRoots);
        return this.send(res, 200, saved);
      }

      case 'GET /api/browse':
        return this.send(res, 200, await this.withDb((db) => listCategories(db), []));

      case 'GET /api/browse/docs':
        return this.send(res, 200, await this.withDb((db) => listDocs(db, q.get('category') || ''), []));

      case 'GET /api/index/problems':
        return this.send(res, 200, await this.withDb((db) => listProblems(db), []));

      case 'POST /api/index/build': {
        const body = await this.readBody(req);
        return this.send(res, 200, this.startBuild(!!body.full));
      }

      case 'POST /api/index/cancel':
        return this.send(res, 200, this.cancelBuild());

      case 'GET /api/kiwix/books':
        return this.send(res, 200, await this.kiwix.books());

      case 'GET /api/kiwix/search': {
        const book = q.get('book') || '';
        const text = (q.get('q') || '').trim();
        if (!book || !text) throw new HttpError(400, 'book and q are required');
        return this.send(res, 200, await this.kiwix.search(book, text, Number(q.get('limit') || 5)));
      }

      case 'POST /api/kiwix/start':
        return this.send(res, 200, await this.kiwix.start());

      case 'POST /api/open': {
        const body = (await this.readBody(req)) as OpenRequest;
        const id = Number(body.docId);
        const doc = await this.withDb((db) => resolveDocFile(db, this.cfg.roots, id), null);
        if (!doc) {
          return this.send(res, 200, {
            ok: false,
            how: 'xdg-open',
            error: {
              kind: 'error',
              code: 'file-missing',
              message: 'This book file could not be found.',
              fix: 'It may have been moved or deleted. Open Library and click "Update index".',
            },
          });
        }
        return this.send(res, 200, await openDocument(doc, body.page, body.q));
      }
    }
    throw new HttpError(404, `unknown API route ${route}`);
  }

  shutdown(): void {
    if (this.indexer) {
      try {
        this.indexer.kill('SIGTERM');
      } catch (e) {
        // ignore
      }
    }
    this.kiwix.stop();
    if (this.db) {
      try {
        this.db.close();
      } catch (e) {
        // ignore
      }
      this.db = null;
    }
  }
}
