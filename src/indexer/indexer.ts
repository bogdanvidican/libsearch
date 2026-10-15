// Index builder entry point.
//   ELECTRON_RUN_AS_NODE=1 library-search resources/app/build/indexer/indexer.js [--library-root DIR] [--full] [--json]
//   node build/indexer/indexer.js            (on the Mac)
// Exit codes: 0 done, 1 failed, 3 cancelled (SIGTERM/SIGINT). Safe to kill at any time.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BuildProgress } from '../shared/api';
import { boolFlag, parseArgs, resolveConfig } from '../server/config';
import { isPidAlive, pidFileFor } from '../server/db';
import { BuildCancelled, buildIndex } from './build';

const argv = process.argv.slice(2);
const args = parseArgs(argv);
const cfg = resolveConfig(argv, path.resolve(__dirname, '..', '..'));
const json = boolFlag(args, 'json');
const send = process.send ? process.send.bind(process) : null;

let cancelled = false;
const onSignal = () => {
  if (!cancelled) process.stderr.write('\nStopping after the current step... (the next run continues from here)\n');
  cancelled = true;
};
process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);
// When forked by the server and the server goes away, stop too.
process.on('disconnect', onSignal);

try {
  os.setPriority(19); // lowest CPU priority: the laptop stays usable while indexing
} catch (e) {
  // not permitted / not supported
}

fs.mkdirSync(cfg.logDir, { recursive: true });
const logFile = path.join(cfg.logDir, 'index-build.log');
function log(line: string) {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch (e) {
    // logging must never break the build
  }
}

let lastHuman = 0;
function report(p: BuildProgress) {
  if (send) send({ type: 'progress', progress: p });
  if (json) {
    process.stdout.write(JSON.stringify({ type: 'progress', ...p }) + '\n');
  } else if (!send) {
    const now = Date.now();
    if (p.phase === 'indexing' && now - lastHuman < 250 && p.done < p.total) return;
    lastHuman = now;
    if (p.phase === 'indexing' && p.currentFile) {
      const w = String(p.total).length;
      process.stdout.write(`[${String(p.done + (p.done < p.total ? 1 : 0)).padStart(w)}/${p.total}] ${p.currentFile}\n`);
    } else if (p.phase !== 'indexing') {
      process.stdout.write(`${p.phase}${p.message ? ': ' + p.message : ''}\n`);
    }
  }
}

function fail(message: string, code: number): never {
  const p: BuildProgress = {
    running: false,
    phase: code === 3 ? 'cancelled' : 'failed',
    done: 0,
    total: 0,
    currentFile: '',
    added: 0,
    updated: 0,
    removed: 0,
    failed: 0,
    message,
  };
  if (send) send({ type: 'progress', progress: p });
  if (json) process.stdout.write(JSON.stringify({ type: 'progress', ...p }) + '\n');
  process.stderr.write(message + '\n');
  log(`ERROR ${message}`);
  process.exit(code);
}

// Only one indexer at a time (the app and the terminal script could both start one).
const pidFile = pidFileFor(cfg.indexPath);
fs.mkdirSync(path.dirname(pidFile), { recursive: true });
try {
  const other = Number(fs.readFileSync(pidFile, 'utf8').trim());
  if (other && isPidAlive(other)) fail(`Another index build is already running (process ${other}).`, 1);
} catch (e) {
  // no pid file
}
fs.writeFileSync(pidFile, String(process.pid));
const removePid = () => {
  try {
    if (fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(pidFile);
  } catch (e) {
    // gone
  }
};
process.on('exit', removePid);

log(`build start roots=${JSON.stringify(cfg.roots)} index=${cfg.indexPath} full=${boolFlag(args, 'full')}`);
if (!json && !send) {
  process.stdout.write(`Library folders: ${cfg.roots.join(', ') || '(none found)'}\nIndex file: ${cfg.indexPath}\n`);
}

buildIndex(cfg, { full: boolFlag(args, 'full'), onProgress: report, isCancelled: () => cancelled, log })
  .then((p) => {
    log(`build done: ${p.message}`);
    removePid();
    // Give the IPC channel a moment to flush the final progress message.
    setTimeout(() => process.exit(0), send ? 100 : 0);
  })
  .catch((e) => {
    removePid();
    if (e instanceof BuildCancelled) {
      log('build cancelled');
      setTimeout(() => process.exit(3), send ? 100 : 0);
      return;
    }
    fail((e as Error).message, 1);
  });
