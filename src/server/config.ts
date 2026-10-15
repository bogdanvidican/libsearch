// Command-line flags + auto-detection of the library roots and the data directory.
// Shared by the server, the indexer and the Electron main process.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Config {
  /** Absolute library roots, in priority order (first match wins for duplicate relpaths). */
  roots: string[];
  /** Where index/, logs/ live (normally the library-search-app folder). */
  dataDir: string;
  indexPath: string;
  logDir: string;
  /** Directory containing build/ (the repo checkout or resources/app in the packaged app). */
  appDir: string;
  port: number;
  mode: 'electron' | 'browser';
  openBrowser: boolean;
  kiwixPort: number;
  kiwixServe?: string;
  kiwixAutostart: boolean;
}

export type Args = Record<string, string[]>;

/** Parses `--flag value`, `--flag=value` and bare `--flag` (value "true"). Repeated flags accumulate. */
export function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    let key = a.slice(2);
    let value: string;
    const eq = key.indexOf('=');
    if (eq >= 0) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      value = argv[++i];
    } else {
      value = 'true';
    }
    (out[key] = out[key] || []).push(value);
  }
  return out;
}

export function flag(args: Args, name: string): string | undefined {
  const v = args[name];
  return v && v.length ? v[v.length - 1] : undefined;
}

export function boolFlag(args: Args, name: string): boolean {
  const v = flag(args, name);
  return v !== undefined && v !== 'false' && v !== '0';
}

const CATEGORY_DIR = /^\d{1,3}\s+\S/;

export function isKiwixDirName(name: string): boolean {
  return /kiwix/i.test(name);
}

/** A directory is a library root when it holds at least one "NN Name" folder. */
export function looksLikeLibraryRoot(dir: string): boolean {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return false;
  }
  return names.some((n) => {
    if (!CATEGORY_DIR.test(n)) return false;
    try {
      return fs.statSync(path.join(dir, n)).isDirectory();
    } catch (e) {
      return false;
    }
  });
}

export function detectRoots(startDir: string, maxLevels = 5): string[] {
  const roots: string[] = [];
  let dir = path.resolve(startDir);
  for (let i = 0; i <= maxLevels; i++) {
    if (looksLikeLibraryRoot(dir)) roots.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return roots;
}

function defaultDataDir(appDir: string): string {
  let dir = path.resolve(appDir);
  for (let i = 0; i < 8; i++) {
    if (path.basename(dir) === 'library-search-app') return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'library-search');
  return path.join(os.homedir(), '.local', 'share', 'library-search');
}

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch (e) {
    return path.resolve(p);
  }
}

export function resolveConfig(argv: string[], appDir: string, defaults: Partial<Config> = {}): Config {
  const args = parseArgs(argv);
  const app = realpathOr(appDir);

  let roots = (args['library-root'] || []).map((r) => realpathOr(r));
  if (!roots.length && process.env.LIBRARY_ROOTS) {
    roots = process.env.LIBRARY_ROOTS.split(path.delimiter).filter(Boolean).map((r) => realpathOr(r));
  }
  if (!roots.length) roots = detectRoots(app);
  // Keep order, drop duplicates.
  roots = roots.filter((r, i) => roots.indexOf(r) === i);

  const dataDir = path.resolve(flag(args, 'data-dir') || defaultDataDir(app));
  const mode = (flag(args, 'mode') || defaults.mode || 'electron') === 'browser' ? 'browser' : 'electron';
  const portFlag = flag(args, 'port');
  return {
    roots,
    dataDir,
    indexPath: path.join(dataDir, 'index', 'library.sqlite'),
    logDir: path.join(dataDir, 'logs'),
    appDir: app,
    port: portFlag !== undefined ? Number(portFlag) : mode === 'browser' ? 8090 : 0,
    mode,
    openBrowser: boolFlag(args, 'open-browser'),
    kiwixPort: Number(flag(args, 'kiwix-port') || 8080),
    kiwixServe: flag(args, 'kiwix-serve'),
    kiwixAutostart: !boolFlag(args, 'no-kiwix-autostart'),
  };
}

/** Category label for display: "01 Medicine" -> "Medicine". */
export function categoryLabel(folder: string): string {
  return folder.replace(/^\d{1,3}\s+/, '').trim() || folder;
}

export function isCategoryDirName(name: string): boolean {
  return CATEGORY_DIR.test(name) && !isKiwixDirName(name);
}
