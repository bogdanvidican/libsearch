// Downloader entry point, started by the server like the indexer (one process per job: books, or zims =
// encyclopedias, see the zims branch below):
//   ELECTRON_RUN_AS_NODE=1 library-search resources/app/build/downloader/downloader.js --job books --library <dir>
//       [--list <file>]... [--check-url <url>] [--archive-base <url>] [--min-free-mb 500] [--stall-seconds 60]
//       [--log <file>] [--json]
// Progress goes to the server over IPC ({type: 'progress', progress}); --json prints it as JSON lines instead.
// Exit codes: 0 done, 1 failed, 3 stopped (SIGTERM / SIGINT). Safe to stop at any time.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DownloadProgress } from '../shared/api';
import { boolFlag, flag, parseArgs } from '../server/config';
import { downloadBooks, idleProgress, JobHooks } from './books';
import { toDownloadError } from './fetchfile';
import { ensureKiwixTools } from './kiwixtools';
import { parseZimList, ZimEntry } from './zimlist';
import { downloadZims } from './zims';

const args = parseArgs(process.argv.slice(2));
const send = process.send ? process.send.bind(process) : null;
const json = boolFlag(args, 'json');

let cancelled = false;
const onSignal = () => {
  cancelled = true;
};
process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);
process.on('disconnect', onSignal); // the server went away

try {
  os.setPriority(10); // keep the old laptop responsive
} catch (e) {
  // not permitted
}

const logFile = flag(args, 'log');
function log(line: string) {
  if (!logFile) return;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch (e) {
    // logging must never stop a download
  }
}

/** To the server, while it is there: when the app closes, the channel goes and sending would crash this process. */
function tell(message: unknown) {
  if (!send || !process.connected) return;
  try {
    (send as (m: unknown, cb: (e: Error | null) => void) => boolean)(message, () => undefined);
  } catch (e) {
    // the channel just closed
  }
}

function report(p: DownloadProgress) {
  tell({ type: 'progress', progress: p });
  if (json) process.stdout.write(JSON.stringify({ type: 'progress', progress: p }) + '\n');
}

function finish(p: DownloadProgress) {
  log(`${p.phase}: ${p.downloaded} downloaded, ${p.skipped} already there, ${p.failed} failed${p.notice ? ' - ' + p.notice.message : ''}`);
  const code = p.phase === 'done' ? 0 : p.phase === 'cancelled' ? 3 : 1;
  // Give the IPC channel a moment to deliver the last progress message.
  setTimeout(() => process.exit(code), send && process.connected ? 100 : 0);
}

const hooks: JobHooks = { onProgress: report, isCancelled: () => cancelled, log };
const job = flag(args, 'job');
const library = flag(args, 'library');
const num = (name: string, fallback: number) => {
  const v = Number(flag(args, name));
  return isFinite(v) && flag(args, name) !== undefined ? v : fallback;
};

if (!library) {
  process.stderr.write('--library <folder> is required\n');
  process.exit(1);
}
log(`start ${job} library=${library}`);

if (job === 'books') {
  downloadBooks(
    {
      library,
      lists: args.list || [],
      checkUrl: flag(args, 'check-url') || 'https://www.gutenberg.org/',
      archiveBase: (flag(args, 'archive-base') || 'https://archive.org').replace(/\/+$/, ''),
      minFreeMb: num('min-free-mb', 500),
      stallMs: num('stall-seconds', 60) * 1000,
    },
    hooks
  ).then(finish, (e) => {
    log(`crashed: ${(e as Error).stack || e}`);
    process.stderr.write(String((e as Error).message || e) + '\n');
    process.exit(1);
  });
} else if (job === 'zims') {
  // Encyclopedias: --list <encyclopedias.txt> --zim <prefix>... [--kiwix-dir <dir>] [--mirror <url>]
  //   [--retries 200] [--retry-seconds 20] [--stall-seconds 120]. The Kiwix reader comes first when it is missing.
  const listFile = (args.list || [])[0] || '';
  const wanted = args.zim || [];
  const kiwixDir = flag(args, 'kiwix-dir') || path.join(library, '15 Offline Encyclopedias (Kiwix)');
  const mirror = (flag(args, 'mirror') || 'https://download.kiwix.org').replace(/\/+$/, '');
  const stallMs = num('stall-seconds', 120) * 1000;
  let entries: ZimEntry[] = [];
  try {
    entries = parseZimList(fs.readFileSync(listFile, 'utf8'), path.basename(listFile)).entries.filter((e) => wanted.indexOf(e.id) >= 0);
  } catch (e) {
    log(`can't read the encyclopedia list ${listFile}: ${(e as Error).message}`);
  }
  (async () => {
    let reader = 'present';
    try {
      fs.mkdirSync(kiwixDir, { recursive: true });
      reader = await ensureKiwixTools(kiwixDir, { mirror, arch: process.arch, platform: process.platform, stallMs, isCancelled: () => cancelled, log });
      // A new reader: the server can start the encyclopedias now.
      if (reader === 'installed') tell({ type: 'zim-done', file: path.join(kiwixDir, 'kiwix-tools', 'kiwix-serve') });
    } catch (e) {
      if (toDownloadError(e).code === 'cancelled') {
        const p = Object.assign(idleProgress(), { phase: 'cancelled' as const, finishedAt: Date.now() });
        report(p);
        return finish(p);
      }
      reader = 'failed';
      log(`kiwix reader: ${(e as Error).message}`);
    }
    const p = await downloadZims(
      {
        library,
        kiwixDir,
        entries,
        mirror,
        retries: num('retries', 200),
        retryDelayMs: num('retry-seconds', 20) * 1000,
        stallMs,
        minFreeMb: num('min-free-mb', 500),
      },
      Object.assign({}, hooks, { onZimDone: (file: string) => tell({ type: 'zim-done', file }) })
    );
    if (reader === 'failed' && !p.notice) {
      p.notice = {
        kind: 'warning',
        code: 'zims-reader',
        message: 'The Kiwix reader (kiwix-serve) could not be downloaded, so the encyclopedias can’t be opened yet.',
        fix: 'Click Download again later. The encyclopedias already downloaded stay.',
      };
      report(p);
    }
    finish(p);
  })().catch((e) => {
    log(`crashed: ${(e as Error).stack || e}`);
    process.stderr.write(String((e as Error).message || e) + '\n');
    process.exit(1);
  });
} else {
  process.stderr.write(`unknown --job ${job}\n`);
  process.exit(1);
}
