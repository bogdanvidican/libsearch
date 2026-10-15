// Finds every PDF/EPUB under the numbered category folders of each library root.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { categoryLabel, isCategoryDirName } from '../server/config';

export interface FoundFile {
  root: string;
  /** Path relative to the root, always with "/" separators. */
  relpath: string;
  abs: string;
  size: number;
  mtime: number;
  kind: 'pdf' | 'epub';
  folder: string;
  category: string;
  subfolder: string;
}

const EXT = /\.(pdf|epub)$/i;

function walkDir(dir: string, onFile: (abs: string, st: fs.Stats) => void, depth: number): void {
  if (depth > 12) return;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return;
  }
  names.sort();
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch (e) {
      continue;
    }
    if (st.isDirectory()) walkDir(abs, onFile, depth + 1);
    else if (st.isFile() && EXT.test(name)) onFile(abs, st);
  }
}

export function listCategoryDirs(root: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch (e) {
    return [];
  }
  return names
    .filter((n) => {
      if (!isCategoryDirName(n)) return false;
      try {
        return fs.statSync(path.join(root, n)).isDirectory();
      } catch (e) {
        return false;
      }
    })
    .sort();
}

export function findLibraryFiles(roots: string[]): FoundFile[] {
  const seen = new Set<string>();
  const out: FoundFile[] = [];
  for (const root of roots) {
    for (const folder of listCategoryDirs(root)) {
      walkDir(
        path.join(root, folder),
        (abs, st) => {
          const relpath = path.relative(root, abs).split(path.sep).join('/');
          if (seen.has(relpath)) return;
          seen.add(relpath);
          const parts = relpath.split('/');
          out.push({
            root,
            relpath,
            abs,
            size: st.size,
            mtime: Math.floor(st.mtimeMs),
            kind: /\.epub$/i.test(abs) ? 'epub' : 'pdf',
            folder,
            category: categoryLabel(folder),
            subfolder: parts.slice(1, -1).join(' / '),
          });
        },
        0
      );
    }
  }
  return out;
}

/**
 * Cheap content fingerprint (size + first and last 64 KB). Lets a library copied without its file
 * dates (plain `cp -r`, USB sticks) keep using an index built elsewhere instead of re-indexing everything.
 */
export function fingerprint(abs: string, size: number): string {
  const h = crypto.createHash('sha1');
  h.update(String(size));
  const fd = fs.openSync(abs, 'r');
  try {
    const n = Math.min(size, 65536);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, 0);
    h.update(buf);
    if (size > n) {
      const m = Math.min(size - n, 65536);
      const tail = Buffer.alloc(m);
      fs.readSync(fd, tail, 0, m, size - m);
      h.update(tail);
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}
