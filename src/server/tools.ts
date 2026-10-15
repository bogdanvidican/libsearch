// Locating external programs (pdftotext, evince, firefox, kiwix-serve) without spawning a shell.
import * as fs from 'fs';
import * as path from 'path';

const cache = new Map<string, string | null>();

function isExecutable(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch (e) {
    return false;
  }
}

/** Absolute path of a command on PATH (plus Homebrew/system dirs that GUI launches often miss). */
export function which(cmd: string): string | null {
  if (cache.has(cmd)) return cache.get(cmd) as string | null;
  let found: string | null = null;
  if (cmd.indexOf('/') >= 0) {
    found = isExecutable(cmd) ? path.resolve(cmd) : null;
  } else {
    const dirs = (process.env.PATH || '').split(path.delimiter).concat(['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin']);
    for (const d of dirs) {
      if (d && isExecutable(path.join(d, cmd))) {
        found = path.join(d, cmd);
        break;
      }
    }
  }
  cache.set(cmd, found);
  return found;
}

export function hasCommand(cmd: string): boolean {
  return which(cmd) !== null;
}

export function isExecutableFile(p: string): boolean {
  return isExecutable(p);
}
