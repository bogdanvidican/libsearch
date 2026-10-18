// Books to save by hand (kit/booklists/manual-downloads.txt): sites that need a click, a form or "Print to PDF".
//   M|<folder>|<title>|<web page>|<how: button | print-to-pdf | form | zip>|<note (rest of the line)>
// Library -> Get books -> Save by hand shows them with Open in Firefox and a tick box. Ticks live in the library's
// notes file; an item also counts as found when a file in its folder carries the title's words.
import * as fs from 'fs';
import * as path from 'path';
import { ManualHow, ManualItem } from '../shared/api';
import { folderProblem } from './booklist';
import { LibraryState, updateState } from './state';

const HOWS: ManualHow[] = ['button', 'print-to-pdf', 'form', 'zip'];

export interface ManualEntry {
  id: string;
  folder: string;
  title: string;
  url: string;
  how: ManualHow;
  note: string;
  line: number;
}

export function parseManualList(text: string, source: string): { items: ManualEntry[]; problems: string[] } {
  const items: ManualEntry[] = [];
  const problems: string[] = [];
  text
    .replace(/^﻿/, '')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.replace(/\r/g, '');
      if (!line.trim() || line.charAt(0) === '#') return;
      const p = line.split('|');
      if (p[0] !== 'M') return;
      const [, folder = '', title = '', url = '', how = ''] = p;
      const why =
        folderProblem(folder) ||
        (!title.trim() ? 'no title' : null) ||
        (!/^https?:\/\//i.test(url) ? `"${url}" is not a web address` : null) ||
        (HOWS.indexOf(how as ManualHow) < 0 ? `"${how}" is not one of ${HOWS.join(', ')}` : null);
      if (why) {
        problems.push(`${source}:${i + 1}: ${why}`);
        return;
      }
      items.push({ id: `M|${folder}|${url}`, folder, title: title.trim(), url, how: how as ManualHow, note: p.slice(5).join('|').trim(), line: i + 1 });
    });
  return { items, problems };
}

const COMMON = ['with', 'from', 'into', 'your', 'that', 'this', 'book', 'books', 'about'];

/** Words of a title that a saved file's name would likely carry ("Where There Is No Vet (Oxfam)" -> where, there, oxfam). */
export function titleWords(title: string): string[] {
  const out: string[] = [];
  for (const w of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 4 && COMMON.indexOf(w) < 0 && out.indexOf(w) < 0) out.push(w);
  }
  return out;
}

/** A file in the item's folder (any library folder) whose name has the title's words: probably saved already. */
function foundOnDisk(roots: string[], folder: string, title: string): boolean {
  const words = titleWords(title);
  if (!words.length) return false;
  const need = Math.min(2, words.length);
  for (const r of roots) {
    let names: string[];
    try {
      names = fs.readdirSync(path.join(r, folder));
    } catch (e) {
      continue;
    }
    for (const n of names) {
      const name = n.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      if (words.filter((w) => name.indexOf(w) >= 0).length >= need) return true;
    }
  }
  return false;
}

export function manualItems(listPath: string, roots: string[], state: LibraryState): ManualItem[] {
  let text = '';
  try {
    text = fs.readFileSync(listPath, 'utf8');
  } catch (e) {
    return [];
  }
  const done = new Set(state.manualDone);
  return parseManualList(text, path.basename(listPath)).items.map((e) => {
    const isDone = done.has(e.id);
    return {
      id: e.id,
      folder: e.folder,
      title: e.title,
      url: e.url,
      how: e.how,
      note: e.note,
      done: isDone,
      auto: !isDone && foundOnDisk(roots, e.folder, e.title),
    };
  });
}

/** Tick (or untick) an item. */
export function setManualDone(root: string, id: string, done: boolean): void {
  updateState(root, (s) => {
    s.manualDone = s.manualDone.filter((d) => d !== id);
    if (done) s.manualDone.push(id);
  });
}
