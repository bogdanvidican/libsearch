// Server entry point.
//   Forked by Electron main (ELECTRON_RUN_AS_NODE=1), or run directly for the Firefox fallback:
//   ELECTRON_RUN_AS_NODE=1 library-search resources/app/build/server/server.js --mode browser --open-browser
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { App } from './app';
import { resolveConfig } from './config';
import { which } from './tools';

const argv = process.argv.slice(2);
const cfg = resolveConfig(argv, path.resolve(__dirname, '..', '..'));
const token = crypto.randomBytes(16).toString('hex');
const app = new App(cfg, token);

fs.mkdirSync(cfg.logDir, { recursive: true });

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : which('firefox') ? 'firefox' : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    process.stderr.write(`Could not open a browser: ${(e as Error).message}\nOpen ${url} yourself.\n`);
  }
}

function listen(port: number, triesLeft: number): void {
  const server = http.createServer((req, res) => {
    void app.handle(req, res);
  });
  server.keepAliveTimeout = 5000;
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE' && port !== 0 && triesLeft > 0) {
      listen(port + 1, triesLeft - 1);
      return;
    }
    process.stderr.write(`Server error: ${e.message}\n`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    const actual = typeof addr === 'object' && addr ? addr.port : port;
    app.setPort(actual);
    const url = `http://127.0.0.1:${actual}/`;
    if (process.send) process.send({ type: 'ready', url, port: actual, token });
    process.stdout.write(`LIBRARY_SEARCH_READY ${url}\n`);
    if (cfg.mode === 'browser') {
      process.stdout.write(
        `Library Search is running at ${url}\nLibrary folders: ${cfg.roots.join(', ') || '(none found)'}\n` +
          'Keep this window open while you use it. Close it (or press Ctrl+C) to stop.\n'
      );
    }
    if (cfg.openBrowser) openBrowser(url);
    if (cfg.kiwixAutostart) {
      void app.kiwix.start().then((s) => {
        if (s.state !== 'running' && s.message) process.stderr.write(`kiwix: ${s.state}: ${s.message}\n`);
      });
    }
    app.updater.start();
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // A downloaded update goes in now that the app closes (the install script waits until it is gone).
    if (app.updater.installOnExit()) process.stdout.write('Installing the downloaded update after the app closes.\n');
    app.shutdown();
    server.close();
    setTimeout(() => process.exit(0), 300).unref();
  };
  // "Restart now": the install script is running and waits for the whole app to close.
  app.onQuitForUpdate = () => {
    if (cfg.mode === 'electron' && process.send) process.send({ type: 'quit-for-update' });
    else stop();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('SIGHUP', stop);
  // Forked by Electron: stop when the app goes away.
  process.on('disconnect', stop);
}

listen(cfg.port, cfg.mode === 'browser' ? 9 : 0);
