// In-app updates. With automatic updates on (the default) and the computer online, the server asks GitHub for the
// newest release, downloads the tarball for this computer into <app home>/dist/.update/, checks its sha256, and
// hands it to the install script (kit/6-install-or-update-search-app.sh) when the app closes - or right away on
// "Restart now", after which the script starts the app again.
// Only this server process goes online, only to GitHub, and only for this: the app window itself stays blocked
// from the internet (src/main/main.ts). Offline nothing happens - the check fails quietly and runs again next start.
//
// Files in dist/.update/:
//   <asset>.tar.gz + .sha256   the verified download          ready.json         which version it is
//   install.sh                 copy of the install script     installing.json    {from, to, at, pid} of the running script
//   install-status.txt         the script's result: "ok <version>" | "busy" | "failed <reason>"
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { URL } from 'url';
import { Notice, UpdateStatus } from '../shared/api';
import { Config } from './config';
import { loadSettings } from './settings';

declare const __APP_VERSION__: string;
declare const __UPDATE_REPO__: string;

const HOUR = 3600 * 1000;

export interface ReleaseAsset {
  name: string;
  /** API address of the file (with Accept: application/octet-stream); used when a token is set. */
  url: string;
  browser_download_url: string;
  size: number;
  /** "sha256:<hex>" on newer GitHub releases. */
  digest?: string | null;
}

export interface Release {
  tag_name: string;
  body?: string | null;
  assets: ReleaseAsset[];
}

export interface Candidate {
  version: string;
  asset: ReleaseAsset;
  checksum?: ReleaseAsset;
  notes: string;
}

interface ReadyFile {
  version: string;
  /** File name inside dist/.update/ */
  file: string;
  notes: string;
}

export interface UpdaterOptions {
  /** Defaults: the running version, package.json "repository", https://api.github.com, $GITHUB_TOKEN, process.arch/platform. */
  version?: string;
  repo?: string;
  apiBase?: string;
  token?: string;
  arch?: string;
  platform?: string;
  /** Environment for the install script. */
  env?: NodeJS.ProcessEnv;
  /** First automatic check after start-up (late enough not to slow the start on old laptops), then every `intervalMs`. */
  firstCheckMs?: number;
  intervalMs?: number;
}

/** "0.10.2" -> [0, 10, 2]; null when it isn't a plain dotted version. A leading "v" is fine. */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)$/.exec(String(v).trim());
  return m ? m[1].split('.').map(Number) : null;
}

/** -1 / 0 / 1. Missing parts count as 0 ("1.2" = "1.2.0"); a version that can't be read counts as 0. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) || [0];
  const y = parseVersion(b) || [0];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The release file for this computer: library-search-linux-<arch>-v<version><suffix>.tar.gz (suffix "-e13" etc.). */
export function pickAsset(release: Release, arch: string, suffix: string): Candidate | null {
  const re = new RegExp('^library-search-linux-' + escapeRe(arch) + '-v(\\d+(?:\\.\\d+)*)' + escapeRe(suffix) + '\\.tar\\.gz$');
  const assets = Array.isArray(release.assets) ? release.assets : [];
  for (const a of assets) {
    const m = re.exec(a.name || '');
    if (!m) continue;
    const checksum = assets.filter((c) => c.name === a.name + '.sha256')[0];
    return { version: m[1], asset: a, checksum, notes: cleanNotes(release.body) };
  }
  return null;
}

function cleanNotes(body: string | null | undefined): string {
  const t = String(body || '').replace(/\r\n/g, '\n').trim();
  return t.length > 1500 ? t.slice(0, 1500).replace(/\s+\S*$/, '') + ' …' : t;
}

/** "-e13" for packages built with an older Electron (scripts/package.mjs writes it into package.json). */
export function releaseSuffix(appDir: string): string {
  const pkg = readJson<{ releaseSuffix?: unknown }>(path.join(appDir, 'package.json'));
  const s = pkg && typeof pkg.releaseSuffix === 'string' ? pkg.releaseSuffix : '';
  return /^(-e\d+)?$/.test(s) ? s : '';
}

// ---------- HTTP (Node 12 has no fetch) ----------

class HttpStatusError extends Error {
  constructor(readonly status: number, host: string) {
    super(`HTTP ${status} from ${host}`);
  }
}

class NoticeError extends Error {
  constructor(readonly notice: Notice) {
    super(notice.message);
  }
}

function codeError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

/** GET with redirects (GitHub sends downloads to a storage server). The token never leaves the host it was meant for. */
function get(url: string, headers: Record<string, string>, timeoutMs: number, redirects = 5): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }
    const mod = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!mod) {
      reject(new Error(`unsupported address ${url}`));
      return;
    }
    const req = mod.get(u, { headers }, (res) => {
      const status = res.statusCode || 0;
      const loc = res.headers.location;
      if (status >= 300 && status < 400 && loc) {
        res.resume();
        if (redirects <= 0) {
          reject(new Error('too many redirects'));
          return;
        }
        const next = new URL(loc, u);
        const h = Object.assign({}, headers);
        if (next.host !== u.host) delete h.Authorization;
        get(next.toString(), h, timeoutMs, redirects - 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new HttpStatusError(status, u.host));
        return;
      }
      resolve(res);
    });
    req.setTimeout(timeoutMs, () => req.destroy(codeError('ETIMEDOUT', 'timed out')));
    req.on('error', reject);
  });
}

function readBody(res: http.IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    res.on('data', (d: Buffer) => {
      n += d.length;
      if (n > max) res.destroy(new Error('answer too large'));
      else chunks.push(d);
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

const OFFLINE_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'ECONNABORTED', 'EPIPE'];

/** Plain-language notice for a failed check or download; `offline` = no internet, nothing to worry about. */
export function describeError(e: unknown, what: 'check' | 'download'): { offline: boolean; notice: Notice } {
  if (e instanceof NoticeError) return { offline: false, notice: e.notice };
  const code = String((e as NodeJS.ErrnoException | null)?.code || '');
  if (OFFLINE_CODES.indexOf(code) >= 0) {
    return {
      offline: true,
      notice: {
        kind: 'info',
        code: 'update-offline',
        message: what === 'download' ? 'The download stopped: the internet connection was lost.' : "Couldn't reach GitHub: this computer seems to be offline.",
        fix: 'Connect to the internet and click Check for updates. The app also checks by itself each time it starts.',
      },
    };
  }
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code)) {
    return {
      offline: false,
      notice: {
        kind: 'error',
        code: 'update-tls',
        message: 'The secure connection to GitHub failed.',
        fix: "Check that the computer's date and time are right (a flat clock battery resets them), then try again.",
      },
    };
  }
  if (code === 'ENOSPC') {
    return {
      offline: false,
      notice: { kind: 'error', code: 'update-disk-full', message: 'The disk is full, so the update could not be downloaded.', fix: 'Free some space (about 300 MB), then try again.' },
    };
  }
  if (e instanceof HttpStatusError) {
    if (e.status === 404) {
      return {
        offline: false,
        notice: {
          kind: 'error',
          code: 'update-not-found',
          message: 'No published version of Library Search was found on GitHub.',
          fix: 'The download page may be private or moved. A new version can still be installed from a USB stick with 6-install-or-update-search-app.sh.',
        },
      };
    }
    if (e.status === 403 || e.status === 429) {
      return {
        offline: false,
        notice: { kind: 'warning', code: 'update-rate-limited', message: 'GitHub is limiting requests from this network right now.', fix: 'Try again in an hour.' },
      };
    }
  }
  const msg = (e as Error | null)?.message || String(e);
  return {
    offline: false,
    notice: {
      kind: 'error',
      code: 'update-failed',
      message: what === 'download' ? `The download failed: ${msg}` : `The update check failed: ${msg}`,
      fix: 'Try again later.',
    },
  };
}

// ---------- small file helpers ----------

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (e) {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (e) {
    return '';
  }
}

function removeFile(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    // already gone
  }
}

/** dist/.update holds files only. */
function clearDir(dir: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return;
  }
  for (const n of names) removeFile(path.join(dir, n));
}

function isWritableDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return fs.statSync(dir).isDirectory();
  } catch (e) {
    return false;
  }
}

function isAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface InstallMarker {
  from: string;
  to: string;
  at: number;
  pid?: number;
}

/** The install script started at an earlier close, if it is still running (waiting for the app to close). */
function runningInstaller(m: InstallMarker | null): number {
  return m && isAlive(m.pid) && Date.now() - (m.at || 0) < HOUR ? (m.pid as number) : 0;
}

/** Keeps logs/update.log small. */
function trimLog(file: string): void {
  try {
    if (fs.statSync(file).size > 1000000) {
      const buf = fs.readFileSync(file);
      fs.writeFileSync(file, buf.slice(buf.length - 200000));
    }
  } catch (e) {
    // no log yet
  }
}

// ---------- the updater ----------

export class Updater {
  /** <app home>/dist/.update */
  readonly dir: string;
  private readonly current: string;
  private readonly repo: string;
  private readonly apiBase: string;
  private readonly token: string;
  private readonly arch: string;
  private readonly suffix: string;
  private readonly installer: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly firstCheckMs: number;
  private readonly intervalMs: number;
  private st: UpdateStatus;
  private ready: ReadyFile | null = null;
  /** Newest release seen, for "Download and install" when automatic updates are off. */
  private candidate: Candidate | null = null;
  /** A version whose install failed: not tried again by itself (the user can click Try again). */
  private failed = '';
  private failNotice: Notice | undefined;
  private timer: NodeJS.Timeout | null = null;
  private checking: Promise<void> | null = null;
  private downloading = false;
  private installStarted = false;

  constructor(private readonly cfg: Config, opts: UpdaterOptions = {}) {
    this.current = opts.version || __APP_VERSION__;
    this.repo = opts.repo || process.env.LIBRARY_SEARCH_REPO || __UPDATE_REPO__;
    this.apiBase = (opts.apiBase || 'https://api.github.com').replace(/\/+$/, '');
    this.token = opts.token !== undefined ? opts.token : process.env.GITHUB_TOKEN || '';
    this.arch = opts.arch || process.arch;
    this.suffix = releaseSuffix(cfg.appDir);
    this.installer = path.join(cfg.appDir, 'kit', '6-install-or-update-search-app.sh');
    this.dir = path.join(cfg.appHome, 'dist', '.update');
    this.env = opts.env || process.env;
    this.firstCheckMs = opts.firstCheckMs !== undefined ? opts.firstCheckMs : 30000;
    this.intervalMs = opts.intervalMs || 6 * HOUR;
    this.st = { state: 'idle', current: this.current, auto: loadSettings(cfg.dataDir).autoUpdate };
    const reason = this.unsupportedReason(opts.platform || process.platform);
    if (reason) {
      this.st.state = 'unsupported';
      this.st.reason = reason;
      return;
    }
    this.reconcile();
  }

  private unsupportedReason(platform: string): string {
    if (!this.cfg.updates) return 'Updates are turned off for this run (--no-update).';
    if (platform !== 'linux') return 'The app updates itself on Linux only. Install new versions with 6-install-or-update-search-app.sh.';
    if (this.cfg.appHome === this.cfg.appDir) return 'This is a developer copy: update it with git pull and npm run build.';
    if (!fs.existsSync(this.installer)) return 'The install script is missing from this copy. Install the app again with 6-install-or-update-search-app.sh.';
    if (!isWritableDir(path.join(this.cfg.appHome, 'dist'))) {
      return `This user can't change the app folder (${this.cfg.appHome}). Install the app again, without sudo.`;
    }
    return '';
  }

  /** After a restart: did an update just go in, did it fail, or is a download waiting? */
  private reconcile(): void {
    const marker = readJson<InstallMarker>(path.join(this.dir, 'installing.json'));
    const result = readText(path.join(this.dir, 'install-status.txt'));
    const done = !!marker && compareVersions(this.current, marker.to) >= 0;
    // Opened again while the script from the last close still waits: it goes ahead (or is replaced) at this close.
    const waiting = !!marker && !done && !result && runningInstaller(marker) > 0;
    if (marker && marker.to && !waiting) {
      removeFile(path.join(this.dir, 'installing.json'));
      removeFile(path.join(this.dir, 'install-status.txt'));
      if (done) {
        this.st.updatedFrom = marker.from;
      } else if (result.indexOf('failed') === 0) {
        this.failed = marker.to;
        this.failNotice = {
          kind: 'error',
          code: 'update-install-failed',
          message: `Version ${marker.to} could not be installed: ${result.slice(6).trim() || 'unknown error'}`,
          fix: 'Click Try installing again. If it keeps failing, the details are in logs/update.log.',
        };
      }
      // "busy" or nothing: the app was opened again before the update went in. It goes in the next time it closes.
    }
    const r = readJson<ReadyFile>(path.join(this.dir, 'ready.json'));
    const file = r && r.file ? path.join(this.dir, path.basename(r.file)) : '';
    if (r && compareVersions(r.version, this.current) > 0 && fs.existsSync(file) && fs.existsSync(file + '.sha256')) {
      this.ready = { version: r.version, file: path.basename(r.file), notes: r.notes || '' };
      this.st.latest = r.version;
      this.st.downloaded = r.version;
      this.st.notes = this.ready.notes;
      this.showReady();
    } else {
      clearDir(this.dir); // installed already, older than this version, or half downloaded
      if (this.failNotice) this.set({ state: 'error', error: this.failNotice });
    }
  }

  status(): UpdateStatus {
    return Object.assign({}, this.st);
  }

  private set(patch: Partial<UpdateStatus>): void {
    Object.assign(this.st, patch);
  }

  private showReady(): void {
    if (this.ready && this.ready.version === this.failed) this.set({ state: 'error', error: this.failNotice });
    else this.set({ state: 'ready', error: undefined });
  }

  /** Starts the automatic checks. */
  start(): void {
    if (this.st.state !== 'unsupported' && this.st.auto) this.schedule(this.firstCheckMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    this.stop();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.st.auto) return;
      void this.check(false).then(() => {
        if (this.st.auto && !this.timer) this.schedule(this.intervalMs);
      });
    }, ms);
    if (this.timer.unref) this.timer.unref();
  }

  /** Automatic updates switched on or off on the Library page. */
  setAuto(on: boolean): void {
    this.st.auto = on;
    if (this.st.state === 'unsupported') return;
    if (!on) this.stop();
    else if (this.st.state === 'available' && this.candidate) this.download(this.candidate);
    else this.schedule(1000);
  }

  /** Asks GitHub for the newest release. Resolves when the check is done; a download it starts goes on in the background. */
  check(manual: boolean): Promise<UpdateStatus> {
    const s = this.st.state;
    if (s === 'unsupported' || s === 'installing' || this.downloading) return Promise.resolve(this.status());
    if (manual) this.failed = ''; // the user asked: a version that failed before may be tried again
    if (!this.checking) {
      // A download waiting to be installed stays visible ("Restart now") while the check runs.
      if (!this.ready) this.set({ state: 'checking', error: undefined });
      this.checking = this.fetchLatest()
        .then(
          (c) => this.afterCheck(c),
          (e) => this.afterError(e, 'check'),
        )
        .then(() => {
          this.checking = null;
        });
    }
    return this.checking.then(() => this.status());
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {
      'User-Agent': `library-search/${this.current}`,
      Accept: json ? 'application/vnd.github+json' : 'application/octet-stream',
    };
    if (this.token) h.Authorization = 'token ' + this.token;
    return h;
  }

  private assetUrl(a: ReleaseAsset): string {
    return this.token && a.url ? a.url : a.browser_download_url;
  }

  private async fetchLatest(): Promise<Candidate> {
    const res = await get(`${this.apiBase}/repos/${this.repo}/releases/latest`, this.headers(true), 20000);
    const rel = JSON.parse(await readBody(res, 4 * 1048576)) as Release;
    const c = pickAsset(rel, this.arch, this.suffix);
    if (!c) {
      throw new NoticeError({
        kind: 'warning',
        code: 'update-no-file',
        message: `The newest release (${rel.tag_name || '?'}) has no file for this computer.`,
        fix: `It needs library-search-linux-${this.arch}-v<version>${this.suffix}.tar.gz. Ask the person who publishes the app.`,
      });
    }
    return c;
  }

  private afterCheck(c: Candidate): void {
    this.set({ checkedAt: Date.now(), latest: c.version, notes: c.notes, error: undefined });
    if (compareVersions(c.version, this.current) <= 0) {
      if (this.ready) {
        this.ready = null;
        clearDir(this.dir);
      }
      this.set({ state: 'up-to-date', downloaded: undefined });
      return;
    }
    if (this.ready && this.ready.version === c.version) {
      this.showReady();
      return;
    }
    this.candidate = c;
    if (this.st.auto && c.version !== this.failed) this.download(c);
    else if (c.version === this.failed) this.set({ state: 'error', error: this.failNotice });
    else this.set({ state: 'available' });
  }

  private afterError(e: unknown, what: 'check' | 'download'): void {
    const d = describeError(e, what);
    if (what === 'check') this.set({ checkedAt: Date.now() });
    // A failed check doesn't hide a download that is ready to install.
    if (this.ready) this.showReady();
    else this.set({ state: d.offline ? 'offline' : 'error', error: d.notice });
  }

  /** "Download and install" (automatic updates off), or "Try again" after a failed download. */
  downloadNow(): UpdateStatus {
    if (this.candidate && !this.ready && !this.downloading && this.st.state !== 'installing') {
      this.failed = '';
      this.download(this.candidate);
    }
    return this.status();
  }

  private download(c: Candidate): void {
    if (this.downloading) return;
    this.downloading = true;
    this.ready = null;
    this.set({ state: 'downloading', received: 0, total: c.asset.size || 0, downloaded: undefined, error: undefined });
    this.fetchAsset(c)
      .then(
        (r) => {
          this.ready = r;
          this.set({ downloaded: r.version });
          this.showReady();
        },
        (e) => {
          clearDir(this.dir);
          this.afterError(e, 'download');
        },
      )
      .then(() => {
        this.downloading = false;
        this.set({ received: undefined, total: undefined });
      });
  }

  private async expectedSha(c: Candidate): Promise<string> {
    const d = c.asset.digest;
    if (d && /^sha256:[0-9a-f]{64}$/i.test(d)) return d.slice(7).toLowerCase();
    if (!c.checksum) return '';
    const res = await get(this.assetUrl(c.checksum), this.headers(false), 20000);
    const m = /^[0-9a-f]{64}/i.exec((await readBody(res, 4096)).trim());
    return m ? m[0].toLowerCase() : '';
  }

  private async fetchAsset(c: Candidate): Promise<ReadyFile> {
    clearDir(this.dir);
    fs.mkdirSync(this.dir, { recursive: true });
    const expected = await this.expectedSha(c);
    const name = path.basename(c.asset.name);
    const file = path.join(this.dir, name);
    const part = file + '.part';
    const res = await get(this.assetUrl(c.asset), this.headers(false), 60000);
    const total = Number(res.headers['content-length']) || c.asset.size || 0;
    this.set({ total, received: 0 });
    const hash = crypto.createHash('sha256');
    let received = 0;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(part);
      let settled = false;
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        out.destroy();
        res.destroy();
        reject(e);
      };
      res.on('data', (d: Buffer) => {
        hash.update(d);
        received += d.length;
        this.st.received = received;
      });
      res.on('aborted', () => fail(codeError('ECONNRESET', 'connection lost')));
      res.on('error', fail);
      out.on('error', fail);
      out.on('finish', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      res.pipe(out);
    });
    if (total && received !== total) throw codeError('ECONNRESET', `only ${received} of ${total} bytes arrived`);
    const sha = hash.digest('hex');
    if (expected && sha !== expected) {
      throw new NoticeError({
        kind: 'error',
        code: 'update-damaged',
        message: 'The downloaded file was damaged (its checksum is wrong), so it was deleted.',
        fix: 'Click Check for updates to download it again.',
      });
    }
    fs.renameSync(part, file);
    // The install script checks the file against this once more before it unpacks it.
    fs.writeFileSync(file + '.sha256', `${sha}  ${name}\n`);
    const r: ReadyFile = { version: c.version, file: name, notes: c.notes };
    writeJson(path.join(this.dir, 'ready.json'), r);
    return r;
  }

  /** "Restart now": install the downloaded version, then start the app again. The caller closes the app. */
  installNow(): UpdateStatus {
    if (this.ready && !this.installStarted && this.st.state !== 'unsupported') {
      this.failed = '';
      this.spawnInstaller(this.cfg.mode === 'browser' ? 'firefox' : 'app');
    }
    return this.status();
  }

  /** The app is closing: install a waiting update (automatic updates only). True when the install script was started. */
  installOnExit(): boolean {
    if (!this.ready || this.installStarted || !this.st.auto || this.st.state === 'unsupported') return false;
    if (this.ready.version === this.failed) return false;
    this.spawnInstaller(null);
    return this.installStarted;
  }

  private spawnInstaller(relaunch: 'app' | 'firefox' | null): void {
    const r = this.ready!;
    const script = path.join(this.dir, 'install.sh');
    const statusFile = path.join(this.dir, 'install-status.txt');
    const markerFile = path.join(this.dir, 'installing.json');
    try {
      // Never two at once: a script from an earlier close that still waits is replaced by this one.
      const earlier = runningInstaller(readJson<InstallMarker>(markerFile));
      if (earlier) {
        try {
          process.kill(earlier, 'SIGTERM');
        } catch (e) {
          // it just finished
        }
      }
      // Run a copy: the script inside the app is in the folder it replaces.
      fs.copyFileSync(this.installer, script);
      removeFile(statusFile);
      fs.mkdirSync(this.cfg.logDir, { recursive: true });
      const logFile = path.join(this.cfg.logDir, 'update.log');
      trimLog(logFile);
      const fd = fs.openSync(logFile, 'a');
      fs.writeSync(fd, `\n=== ${new Date().toISOString()} installing ${r.version} over ${this.current}${relaunch ? ', then starting it' : ''}\n`);
      const args = [script, path.join(this.dir, r.file), '--dir', this.cfg.appHome, '--wait', '--no-pin', '--status-file', statusFile];
      if (relaunch) args.push(relaunch === 'firefox' ? '--relaunch-firefox' : '--relaunch');
      const env = Object.assign({}, this.env);
      delete env.ELECTRON_RUN_AS_NODE; // the restarted app must start as the app, not as Node
      // Electron overrides XDG_CURRENT_DESKTOP for its own process; the restarted app gets the real one.
      if (env.ORIGINAL_XDG_CURRENT_DESKTOP) {
        env.XDG_CURRENT_DESKTOP = env.ORIGINAL_XDG_CURRENT_DESKTOP;
        delete env.ORIGINAL_XDG_CURRENT_DESKTOP;
      }
      // Detached: it outlives this process, waits for the whole app to close, then swaps the folders.
      const child = spawn('bash', args, { cwd: this.cfg.appHome, detached: true, stdio: ['ignore', fd, fd], env });
      child.on('error', (e) => process.stderr.write(`update: could not start the install script: ${e.message}\n`));
      child.unref();
      fs.closeSync(fd);
      const marker: InstallMarker = { from: this.current, to: r.version, at: Date.now(), pid: child.pid };
      writeJson(markerFile, marker);
      this.installStarted = true;
      this.set({ state: 'installing', error: undefined });
    } catch (e) {
      this.set({
        state: 'error',
        error: {
          kind: 'error',
          code: 'update-install-failed',
          message: `The update could not be started: ${(e as Error).message}`,
          fix: 'Close the app and run 6-install-or-update-search-app.sh instead.',
        },
      });
    }
  }
}
