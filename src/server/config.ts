// Command-line flags + auto-detection of the library roots and the data directory.
// Shared by the server, the indexer and the Electron main process.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadSettings } from './settings';

export type RootsSource = 'flag' | 'env' | 'settings' | 'auto';

export interface Config {
  /** Absolute library roots, in priority order (first match wins for duplicate relpaths). */
  roots: string[];
  /** Where the roots came from: --library-root, LIBRARY_ROOTS, the folders chosen in the app, or auto-detection. */
  rootsSource: RootsSource;
  /** Folder the app is installed in (holds dist/), wherever that is - not necessarily inside the library. */
  appHome: string;
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
  /** Check for and install new versions (off with --no-update or LIBRARY_SEARCH_NO_UPDATE=1). */
  updates: boolean;
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

/** The folder the app is installed in: ".../<home>/dist/library-search-<os>-<arch>/resources/app" -> "<home>". */
export function appHomeOf(appDir: string): string {
  const abs = path.resolve(appDir);
  const m = abs.match(/^(.*?)[\\/]dist[\\/]library-search-[^\\/]+[\\/]/);
  return m ? m[1] : abs;
}

export function userDataDir(): string {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'library-search');
  return path.join(os.homedir(), '.local', 'share', 'library-search');
}

function isWritableDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return fs.statSync(dir).isDirectory();
  } catch (e) {
    return false;
  }
}

/** Index, settings and logs live with the app (wherever it is installed), or in the user's data folder. */
function defaultDataDir(appDir: string): string {
  const home = appHomeOf(appDir);
  return isWritableDir(home) ? home : userDataDir();
}

function dedupe(list: string[]): string[] {
  return list.filter((r, i) => list.indexOf(r) === i);
}

export function expandHome(p: string): string {
  const t = p.trim();
  return t === '~' || t.indexOf('~/') === 0 ? path.join(os.homedir(), t.slice(1)) : t;
}

/**
 * Roots chosen in the app beat auto-detection; --library-root / LIBRARY_ROOTS (explicit start-up choices) beat both.
 */
export function effectiveRoots(cfg: Pick<Config, 'roots' | 'rootsSource' | 'appHome'>, saved: string[]): { roots: string[]; source: RootsSource } {
  if (cfg.rootsSource === 'flag' || cfg.rootsSource === 'env') return { roots: cfg.roots, source: cfg.rootsSource };
  if (saved.length) return { roots: dedupe(saved.map((r) => realpathOr(expandHome(r)))), source: 'settings' };
  return { roots: detectRoots(cfg.appHome), source: 'auto' };
}

export interface FolderCheck {
  path: string;
  exists: boolean;
  /** "NN Name" topic folders found (book categories). */
  categories: number;
  /** .zim files in a "...Kiwix..." folder. */
  zims: number;
}

export function checkLibraryFolder(p: string): FolderCheck {
  const out: FolderCheck = { path: p, exists: false, categories: 0, zims: 0 };
  let names: string[];
  try {
    if (!fs.statSync(p).isDirectory()) return out;
    names = fs.readdirSync(p);
  } catch (e) {
    return out;
  }
  out.exists = true;
  for (const n of names) {
    let isDir = false;
    try {
      isDir = fs.statSync(path.join(p, n)).isDirectory();
    } catch (e) {
      continue;
    }
    if (!isDir) continue;
    if (isKiwixDirName(n)) {
      try {
        out.zims += fs.readdirSync(path.join(p, n)).filter((z) => /\.zim$/i.test(z)).length;
      } catch (e) {
        // unreadable
      }
    } else if (CATEGORY_DIR.test(n)) {
      out.categories++;
    }
  }
  return out;
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

  const home = appHomeOf(app);
  const dataDir = path.resolve(flag(args, 'data-dir') || defaultDataDir(app));

  let rootsSource: RootsSource = 'auto';
  let roots = (args['library-root'] || []).map((r) => realpathOr(expandHome(r)));
  if (roots.length) rootsSource = 'flag';
  else if (process.env.LIBRARY_ROOTS) {
    roots = process.env.LIBRARY_ROOTS.split(path.delimiter).filter(Boolean).map((r) => realpathOr(expandHome(r)));
    if (roots.length) rootsSource = 'env';
  }
  const eff = effectiveRoots({ roots: dedupe(roots), rootsSource, appHome: home }, loadSettings(dataDir).libraryRoots);
  const mode = (flag(args, 'mode') || defaults.mode || 'electron') === 'browser' ? 'browser' : 'electron';
  const portFlag = flag(args, 'port');
  return {
    roots: eff.roots,
    rootsSource: eff.source,
    appHome: home,
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
    updates: !boolFlag(args, 'no-update') && !process.env.LIBRARY_SEARCH_NO_UPDATE,
  };
}

/** Category label for display: "01 Medicine" -> "Medicine". */
export function categoryLabel(folder: string): string {
  return folder.replace(/^\d{1,3}\s+/, '').trim() || folder;
}

export function isCategoryDirName(name: string): boolean {
  return CATEGORY_DIR.test(name) && !isKiwixDirName(name);
}
