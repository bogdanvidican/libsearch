// Electron main process: a thin shell around the local server (src/server).
// Written defensively for old Electron (11-17) because the CF-30 may need a fallback build.
import { app, BrowserWindow, ipcMain, Menu, screen, session, shell, WebContents } from 'electron';
import { ChildProcess, fork } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { boolFlag, parseArgs, resolveConfig } from '../server/config';

declare const __APP_VERSION__: string;

const APP_DIR = path.resolve(__dirname, '..', '..');
const args = parseArgs(process.argv.slice(1));
const cfg = resolveConfig(process.argv.slice(1), APP_DIR);
const SELF_TEST = boolFlag(args, 'self-test');
const PASS_THROUGH = ['library-root', 'data-dir', 'kiwix-port', 'kiwix-serve', 'no-kiwix-autostart'];

// Old Intel GMA graphics + 32-bit: software rendering is the reliable choice.
if (process.argv.indexOf('--disable-gpu') >= 0 || (process.platform === 'linux' && process.arch === 'ia32')) {
  app.disableHardwareAcceleration();
}

let win: BrowserWindow | null = null;
let server: ChildProcess | null = null;
let serverUrl = '';
let quitting = false;
let restarts = 0;
let logStream: fs.WriteStream | null = null;

function log(line: string): void {
  try {
    if (!logStream) {
      fs.mkdirSync(cfg.logDir, { recursive: true });
      logStream = fs.createWriteStream(path.join(cfg.logDir, 'app.log'), { flags: 'a' });
    }
    logStream.write(`${new Date().toISOString()} ${line.replace(/\s+$/, '')}\n`);
  } catch (e) {
    // never fail because of logging
  }
}

function isLocalUrl(u: string): boolean {
  return /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(u) || /^(data|devtools|chrome|about|blob):/i.test(u);
}

function sameOrigin(u: string): boolean {
  return !!serverUrl && u.indexOf(serverUrl.replace(/\/$/, '')) === 0;
}

function page(title: string, body: string): string {
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><title>Library Search</title><style>' +
    'html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#f6f7f9;' +
    'font:16px/1.5 system-ui,-apple-system,"Ubuntu","DejaVu Sans",sans-serif;color:#0f172a}' +
    '.card{max-width:560px;padding:32px 36px;background:#fff;border:1px solid #d9dee5;border-radius:16px}' +
    'h1{font-size:22px;margin:0 0 8px}p{margin:8px 0;color:#334155}code{background:#eef2f6;padding:2px 6px;border-radius:6px;word-break:break-all}' +
    '.spin{width:28px;height:28px;border:3px solid #cbd5e1;border-top-color:#1d4ed8;border-radius:50%;animation:s 1s linear infinite;margin-bottom:16px}' +
    '@keyframes s{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.spin{animation:none}}' +
    `</style></head><body><div class="card"><h1>${title}</h1>${body}</div></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function showError(message: string): void {
  log(`ERROR ${message}`);
  if (SELF_TEST) finishSelfTest(false, { error: message });
  if (!win) return;
  const logFile = path.join(cfg.logDir, 'app.log');
  void win.loadURL(
    page(
      'Library Search could not start',
      `<p>${message.replace(/</g, '&lt;')}</p>` +
        '<p>Close this window and open it again. If it keeps happening, start the simple version from a terminal:</p>' +
        '<p><code>bash 6-search-the-library.sh --firefox</code></p>' +
        `<p>Details are in <code>${logFile.replace(/</g, '&lt;')}</code></p>`
    )
  );
}

function startServer(): void {
  const serverArgs: string[] = ['--mode', 'electron'];
  for (const k of PASS_THROUGH) for (const v of args[k] || []) serverArgs.push(`--${k}`, v);
  if (!(args['library-root'] || []).length) for (const r of cfg.roots) serverArgs.push('--library-root', r);
  const entry = path.join(APP_DIR, 'build', 'server', 'server.js');
  log(`starting server: ${entry} ${serverArgs.join(' ')}`);
  const child = fork(entry, serverArgs, {
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  server = child;
  child.stdout!.on('data', (d: Buffer) => log(`[server] ${d.toString()}`));
  child.stderr!.on('data', (d: Buffer) => log(`[server:err] ${d.toString()}`));
  const timer = setTimeout(() => showError('The search engine did not start within one minute.'), 60000);
  child.on('message', (m: { type?: string; url?: string }) => {
    if (m && m.type === 'ready' && m.url) {
      clearTimeout(timer);
      serverUrl = m.url;
      log(`server ready at ${serverUrl}`);
      if (win) void win.loadURL(serverUrl);
    }
  });
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    log(`server exited code=${code} signal=${signal}`);
    if (server === child) server = null;
    if (quitting) return;
    if (restarts < 3) {
      restarts++;
      serverUrl = '';
      startServer();
    } else {
      showError('The search engine stopped unexpectedly several times.');
    }
  });
}

function createWindow(): void {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1024, wa.width),
    height: Math.min(768, wa.height),
    minWidth: 760,
    minHeight: 540,
    show: false,
    backgroundColor: '#f6f7f9',
    title: 'Library Search',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (wa.width <= 1100 || wa.height <= 820) win.maximize();
  win.once('ready-to-show', () => win && win.show());
  void win.loadURL(page('Starting Library Search…', '<div class="spin"></div><p>This takes a few seconds on older laptops.</p>'));

  const wc = win.webContents;
  wc.on('found-in-page', (_e, r) => wc.send('ls:found', { matches: r.matches, activeMatchOrdinal: r.activeMatchOrdinal }));
  wc.on('render-process-gone', (_e, details) => {
    log(`renderer gone: ${JSON.stringify(details)}`);
    if (!quitting && serverUrl && win) setTimeout(() => win && void win.loadURL(serverUrl), 500);
  });
  wc.on('before-input-event', (event, input) => {
    const mod = input.control || input.meta;
    if (!mod || input.type !== 'keyDown') return;
    const k = input.key;
    if (k === '=' || k === '+' || k === '-' || k === '0') {
      const z = wc.getZoomLevel();
      wc.setZoomLevel(k === '0' ? 0 : Math.max(-2, Math.min(4, z + (k === '-' ? -0.5 : 0.5))));
      event.preventDefault();
    } else if (k.toLowerCase() === 'r' && !SELF_TEST) {
      wc.reload();
      event.preventDefault();
    }
  });
  if (SELF_TEST) wc.on('did-finish-load', () => void runSelfTest());
  win.on('closed', () => {
    win = null;
  });
}

function guardContents(wc: WebContents): void {
  const openHandler = (url: string) => {
    // Links that want a new window (target=_blank inside articles) open in the reader instead.
    if (sameOrigin(url) && win) {
      const p = url.slice(serverUrl.replace(/\/$/, '').length) || '/';
      win.webContents.send('ls:navigate', '#/read?u=' + encodeURIComponent(p));
    }
  };
  const anyWc = wc as any;
  if (typeof anyWc.setWindowOpenHandler === 'function') {
    anyWc.setWindowOpenHandler((d: { url: string }) => {
      openHandler(d.url);
      return { action: 'deny' };
    });
  } else {
    anyWc.on('new-window', (e: Event, url: string) => {
      e.preventDefault();
      openHandler(url);
    });
  }
  wc.on('will-navigate', (e, url) => {
    if (/^data:/i.test(url)) return;
    if (!sameOrigin(url)) {
      e.preventDefault();
      return;
    }
    // An article link that targets the whole window (target="_top") would replace the app: show it in the reader.
    const p = url.slice(serverUrl.replace(/\/$/, '').length);
    if (win && wc === win.webContents && p && p !== '/' && p.charAt(0) !== '#' && p.indexOf('/#') !== 0) {
      e.preventDefault();
      openHandler(url);
    }
  });
}

// ---------- self test (used by m0-check.sh on the CF-30) ----------

let selfTestDone = false;
function finishSelfTest(ok: boolean, report: Record<string, unknown>): void {
  if (selfTestDone) return;
  selfTestDone = true;
  process.stdout.write(
    JSON.stringify(
      Object.assign(
        { ok, app: __APP_VERSION__, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, arch: process.arch },
        report
      )
    ) + '\n'
  );
  quitting = true;
  if (server) server.kill('SIGTERM');
  setTimeout(() => app.exit(ok ? 0 : 1), 500);
}

async function runSelfTest(): Promise<void> {
  if (!win || !serverUrl || !win.webContents.getURL().startsWith(serverUrl)) return;
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const result = await win.webContents.executeJavaScript(
      `(function(){
        var root = document.getElementById('root');
        var meta = document.querySelector('meta[name="ls-token"]');
        return fetch('/api/status', { headers: { 'X-Token': meta ? meta.content : '' } })
          .then(function(r){ return r.json(); })
          .then(function(s){ return { uiRendered: !!(root && root.children.length), status: s }; });
      })()`
    );
    const s = result.status || {};
    finishSelfTest(!!result.uiRendered && !!s.version, {
      uiRendered: result.uiRendered,
      roots: s.roots,
      index: s.index && { exists: s.index.exists, docs: s.index.docs },
      kiwix: s.kiwix,
      tools: s.tools,
    });
  } catch (e) {
    finishSelfTest(false, { error: (e as Error).message });
  }
}

// ---------- app lifecycle ----------

if (!SELF_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('web-contents-created', (_e, wc) => guardContents(wc));

  ipcMain.on('ls:find', (_e, text: string, forward: boolean) => {
    if (win && text) win.webContents.findInPage(text, { forward: forward !== false, findNext: true });
  });
  ipcMain.on('ls:find-stop', () => {
    if (win) win.webContents.stopFindInPage('keepSelection');
  });
  ipcMain.on('ls:open-external', (_e, url: string) => {
    if (typeof url === 'string' && isLocalUrl(url) && /^https?:/i.test(url)) void shell.openExternal(url);
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
    if (server) server.kill('SIGTERM');
  });

  app.whenReady().then(() => {
    log(`--- Library Search ${__APP_VERSION__} (Electron ${process.versions.electron}, ${process.platform}-${process.arch})`);
    // Zero network: only this computer (the app's server and kiwix-serve) may be contacted.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => cb({ cancel: !isLocalUrl(d.url) }));
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    createWindow();
    startServer();
    if (SELF_TEST) setTimeout(() => finishSelfTest(false, { error: 'self-test timed out after 120 s' }), 120000);
  });
}
