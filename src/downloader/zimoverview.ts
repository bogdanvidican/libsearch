// Library -> Get books -> Encyclopedias: each encyclopedia on the list and what this computer has of it (a whole
// .zim, a cut-off download, or nothing). Reads only the disk and the library's notes, so it works offline.
import * as fs from 'fs';
import * as path from 'path';
import { EncyclopediasOverview, ZimItem } from '../shared/api';
import { isKiwixDirName } from '../server/config';
import { inspectZim } from '../server/kiwix';
import { freeBytes, fsType } from './disk';
import { destinationProblem } from './overview';
import { LibraryState } from './state';
import { parseZimList } from './zimlist';

export const DEFAULT_KIWIX_DIR = '15 Offline Encyclopedias (Kiwix)';

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

function sizeOf(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch (e) {
    return 0;
  }
}

/** The library folder's Kiwix folders ("15 Offline Encyclopedias (Kiwix)" ...). */
function kiwixDirsIn(root: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(root).sort();
  } catch (e) {
    return [];
  }
  return names.filter((n) => isKiwixDirName(n) && isDir(path.join(root, n))).map((n) => path.join(root, n));
}

/** Where encyclopedias are downloaded to: the Kiwix folder already in the library folder, else the usual name. */
export function kiwixDirFor(root: string): string {
  return kiwixDirsIn(root)[0] || path.join(root, DEFAULT_KIWIX_DIR);
}

function itemFor(prefix: string, dirs: string[]): Pick<ZimItem, 'state' | 'file' | 'have'> {
  const whole = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[0-9-]+\\.zim$');
  let ready: { file: string; have: number } | null = null;
  let partial: { file: string; have: number } | null = null;
  for (const d of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(d).sort();
    } catch (e) {
      continue;
    }
    for (const n of names) {
      if (n.indexOf(prefix) !== 0) continue;
      const file = path.join(d, n);
      const have = sizeOf(file);
      if (whole.test(n) && inspectZim(file).ok) ready = { file, have };
      else if ((whole.test(n) || /\.zim\.part$/.test(n)) && (!partial || have > partial.have)) partial = { file, have };
    }
  }
  if (ready) return { state: 'ready', file: ready.file, have: ready.have };
  if (partial) return { state: 'partial', file: partial.file, have: partial.have };
  return { state: 'missing', have: 0 };
}

export function zimsOverview(o: {
  listPath: string;
  roots: string[];
  appHome: string;
  state: LibraryState;
  /** kiwix-serve was found (in a Kiwix folder, given with --kiwix-serve, or installed). */
  readerFound: boolean;
  platform: string;
}): EncyclopediasOverview {
  const root = o.roots[0];
  const problem = destinationProblem(root, o.appHome);
  let text = '';
  try {
    text = fs.readFileSync(o.listPath, 'utf8');
  } catch (e) {
    text = '';
  }
  const dirs = ([] as string[]).concat(...o.roots.map(kiwixDirsIn));
  const failures = o.state.zims.failures;
  const items: ZimItem[] = parseZimList(text, path.basename(o.listPath)).entries.map((e) => {
    const f = failures.filter((x) => x.id === e.id)[0];
    const item: ZimItem = Object.assign(
      { id: e.id, title: e.title, approxGb: e.approxGb, defaultOn: e.defaultOn, selected: o.state.zims.selected.indexOf(e.id) >= 0 },
      itemFor(e.prefix, dirs)
    );
    if (f && item.state !== 'ready') item.failure = { code: f.code, reason: f.reason };
    return item;
  });
  const kiwixDir = root && !problem ? kiwixDirFor(root) : null;
  const out: EncyclopediasOverview = {
    destination: problem ? null : root,
    kiwixDir,
    fat32: false,
    reader: o.readerFound ? 'ok' : o.platform === 'linux' ? 'missing' : 'unsupported',
    items,
  };
  if (problem) out.problem = problem;
  if (kiwixDir) {
    const t = fsType(isDir(kiwixDir) ? kiwixDir : root);
    out.fat32 = t === 'msdos' || t === 'vfat';
    const free = freeBytes(root);
    if (free !== undefined) out.freeBytes = free;
  }
  return out;
}
