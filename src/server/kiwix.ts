// kiwix-serve integration: find the binary and ZIM files, start/stop it, list books, search.
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { KiwixBook, KiwixSearchResponse, KiwixStatus } from '../shared/api';
import { Config, isKiwixDirName } from './config';
import { CatalogEntry, parseCatalog, parseSearchHtml, parseSearchXml, toKiwixBook } from './kiwixParse';
import { isExecutableFile, which } from './tools';

export interface HttpResult {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

export function httpGet(port: number, urlPath: string, timeoutMs: number, maxBytes = 4 * 1024 * 1024): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'GET', headers: { 'Accept-Encoding': 'identity', Connection: 'close' } },
      (res) => {
        const chunks: Buffer[] = [];
        let n = 0;
        res.on('data', (d: Buffer) => {
          n += d.length;
          if (n <= maxBytes) chunks.push(d);
          else req.destroy(new Error('response too large'));
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
        res.on('error', reject);
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** Limits concurrent requests to kiwix-serve: on a hard disk, parallel searches just thrash. */
class Limiter {
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

type SearchApi = 'books.id' | 'content-xml' | 'content-html';

export class Kiwix {
  private child: ChildProcess | null = null;
  private startedByUs = false;
  private starting: Promise<KiwixStatus> | null = null;
  private lastError = '';
  private stderrTail = '';
  private probeCache: { at: number; result: 'running' | 'port-busy' | 'down' } | null = null;
  private catalog: { at: number; entries: CatalogEntry[] } | null = null;
  private searchApi: SearchApi | null = null;
  private limiter = new Limiter(3);

  constructor(private cfg: Config) {}

  get port(): number {
    return this.cfg.kiwixPort;
  }

  kiwixDirs(): string[] {
    const dirs: string[] = [];
    for (const root of this.cfg.roots) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(root);
      } catch (e) {
        continue;
      }
      for (const n of names) {
        const p = path.join(root, n);
        try {
          if (isKiwixDirName(n) && fs.statSync(p).isDirectory()) dirs.push(p);
        } catch (e) {
          // ignore
        }
      }
    }
    return dirs;
  }

  findZims(): string[] {
    const out: string[] = [];
    for (const d of this.kiwixDirs()) {
      try {
        for (const n of fs.readdirSync(d).sort()) if (/\.zim$/i.test(n) && !n.startsWith('.')) out.push(path.join(d, n));
      } catch (e) {
        // ignore
      }
    }
    return out;
  }

  findBinary(): string | null {
    if (this.cfg.kiwixServe) return isExecutableFile(this.cfg.kiwixServe) ? path.resolve(this.cfg.kiwixServe) : null;
    for (const d of this.kiwixDirs()) {
      const p = path.join(d, 'kiwix-tools', 'kiwix-serve');
      if (isExecutableFile(p)) return p;
    }
    return which('kiwix-serve');
  }

  async probe(force = false): Promise<'running' | 'port-busy' | 'down'> {
    if (!force && this.probeCache && Date.now() - this.probeCache.at < 3000) return this.probeCache.result;
    let result: 'running' | 'port-busy' | 'down';
    try {
      const r = await httpGet(this.port, '/catalog/v2/entries?count=1', 2000, 256 * 1024);
      if (r.status === 200 && /<feed\b/.test(r.body)) result = 'running';
      else {
        const old = await httpGet(this.port, '/catalog/root.xml', 2000, 256 * 1024).catch(() => null);
        result = old && old.status === 200 && /<feed\b/.test(old.body) ? 'running' : 'port-busy';
      }
    } catch (e) {
      result = 'down';
    }
    this.probeCache = { at: Date.now(), result };
    return result;
  }

  async status(): Promise<KiwixStatus> {
    const base = { port: this.port, startedByUs: this.startedByUs };
    if (this.starting) return { ...base, state: 'starting', books: this.findZims().length, message: 'Starting the encyclopedia server…' };
    const p = await this.probe();
    if (p === 'running') {
      const books = this.catalog ? this.catalog.entries.length : (await this.entries().catch(() => [])).length;
      return { ...base, state: 'running', books };
    }
    if (p === 'port-busy') {
      return { ...base, state: 'port-busy', books: 0, message: `Port ${this.port} is used by another program.` };
    }
    const zims = this.findZims();
    if (!zims.length) return { ...base, state: 'no-zims', books: 0 };
    if (!this.findBinary()) return { ...base, state: 'no-binary', books: zims.length };
    if (this.lastError) return { ...base, state: 'error', books: zims.length, message: this.lastError };
    return { ...base, state: 'stopped', books: zims.length };
  }

  /** Starts kiwix-serve with every ZIM found, unless something already serves the port. */
  start(): Promise<KiwixStatus> {
    if (this.starting) return this.starting;
    this.starting = this.doStart().then(
      (s) => {
        this.starting = null;
        return s;
      },
      (e) => {
        this.starting = null;
        this.lastError = (e as Error).message;
        return this.status();
      }
    );
    return this.starting;
  }

  private async doStart(): Promise<KiwixStatus> {
    this.lastError = '';
    if ((await this.probe(true)) !== 'down') {
      this.starting = null;
      return this.status();
    }
    const bin = this.findBinary();
    const zims = this.findZims();
    if (!bin || !zims.length) {
      this.starting = null;
      return this.status();
    }
    this.stderrTail = '';
    const child = spawn(bin, [`--port=${this.port}`].concat(zims), { stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child;
    this.startedByUs = true;
    this.catalog = null;
    child.stderr!.on('data', (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-2000);
    });
    let exited: number | null | undefined;
    child.on('exit', (code) => {
      exited = code;
      if (this.child === child) {
        this.child = null;
        this.startedByUs = false;
        this.probeCache = null;
      }
    });
    child.on('error', (e) => {
      this.lastError = `Could not start kiwix-serve: ${e.message}`;
    });
    // Loading many large ZIMs from a hard disk can take a while.
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 700));
      if (exited !== undefined) {
        const tail = this.stderrTail.trim().split('\n').slice(-2).join(' ');
        throw new Error(`kiwix-serve stopped (exit ${exited})${tail ? ': ' + tail : ''}`);
      }
      if ((await this.probe(true)) === 'running') {
        this.starting = null;
        return this.status();
      }
    }
    throw new Error('kiwix-serve did not answer within 2 minutes');
  }

  stop(): void {
    if (this.child && this.startedByUs) {
      try {
        this.child.kill('SIGTERM');
      } catch (e) {
        // already gone
      }
    }
    this.child = null;
    this.startedByUs = false;
  }

  private async entries(): Promise<CatalogEntry[]> {
    if (this.catalog && Date.now() - this.catalog.at < 60000) return this.catalog.entries;
    let r = await httpGet(this.port, '/catalog/v2/entries?count=-1', 10000).catch(() => null);
    if (!r || r.status !== 200 || !/<feed\b/.test(r.body)) r = await httpGet(this.port, '/catalog/root.xml', 10000);
    const entries = r.status === 200 ? parseCatalog(r.body) : [];
    this.catalog = { at: Date.now(), entries };
    return entries;
  }

  async books(): Promise<KiwixBook[]> {
    if ((await this.probe()) !== 'running') return [];
    const order: Record<string, number> = { reference: 0, khan: 1, qa: 2 };
    return (await this.entries())
      .map(toKiwixBook)
      .sort((a, b) => order[a.group] - order[b.group] || a.title.localeCompare(b.title));
  }

  private searchPaths(e: CatalogEntry, q: string, limit: number): Array<[SearchApi, string]> {
    const pattern = encodeURIComponent(q);
    const out: Array<[SearchApi, string]> = [];
    if (e.uuid) out.push(['books.id', `/search?books.id=${encodeURIComponent(e.uuid)}&pattern=${pattern}&format=xml&pageLength=${limit}`]);
    out.push(['content-xml', `/search?content=${encodeURIComponent(e.contentName)}&pattern=${pattern}&format=xml&pageLength=${limit}`]);
    out.push(['content-html', `/search?content=${encodeURIComponent(e.contentName)}&pattern=${pattern}&pageLength=${limit}`]);
    // Once one API style works, try it first.
    if (this.searchApi) out.sort((a, b) => (a[0] === this.searchApi ? -1 : b[0] === this.searchApi ? 1 : 0));
    return out;
  }

  async search(bookName: string, q: string, limit = 5): Promise<KiwixSearchResponse> {
    const t0 = Date.now();
    const fail = (code: string, message: string, fix?: string): KiwixSearchResponse => ({
      book: bookName,
      results: [],
      tookMs: Date.now() - t0,
      error: { kind: 'warning', code, message, fix },
    });
    if ((await this.probe()) !== 'running') return fail('kiwix-down', 'The encyclopedia server is not running.', 'Start it from the Library page.');
    const entry = (await this.entries()).find((e) => e.contentName === bookName);
    if (!entry) return fail('unknown-book', `Unknown collection: ${bookName}`);
    const n = Math.max(1, Math.min(50, limit));
    return this.limiter.run(async () => {
      let lastErr = '';
      for (const [api, p] of this.searchPaths(entry, q, n)) {
        try {
          const r = await httpGet(this.port, p, 12000);
          if (r.status === 404 && /no (result|match)|not found/i.test(r.body) && api !== 'content-html') {
            // Some versions answer 404 for "no results".
            this.searchApi = this.searchApi || api;
            return { book: bookName, results: [], total: 0, tookMs: Date.now() - t0 };
          }
          if (r.status !== 200) {
            lastErr = `HTTP ${r.status}`;
            continue;
          }
          const parsed = /<rss\b/.test(r.body) ? parseSearchXml(r.body) : api === 'content-html' ? parseSearchHtml(r.body) : null;
          if (!parsed) {
            lastErr = 'unexpected response';
            continue;
          }
          this.searchApi = api;
          return { book: bookName, results: parsed.results.slice(0, n), total: parsed.total, tookMs: Date.now() - t0 };
        } catch (e) {
          lastErr = (e as Error).message;
          if (lastErr === 'timeout') break;
        }
      }
      return fail('kiwix-search-failed', `Search in ${entry.title} failed (${lastErr}).`);
    });
  }
}
