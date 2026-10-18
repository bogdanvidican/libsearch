// Book lists: kit/booklists/booklist-*.txt (and the library's own booklist-local.txt). Same format and same reading
// rules as kit/2-download-pdf-books.sh (`IFS='|' read -r t a b c`: the last field is the rest of the line):
//   F|<folder>|<file name>|<url>            one file, saved as <library>/<folder>/<file name>
//   S|<folder>|<page url>|<regex>           every link on the page matching the (ERE-compatible) regex
//   A|<folder>|<archive.org identifier>     every PDF of an archive.org item
// Comment lines (#) and blank lines are skipped; a byte order mark and CRs are dropped.

export interface ListEntry {
  type: 'F' | 'S' | 'A';
  folder: string;
  /** F: file name · S: page url · A: archive.org identifier */
  a: string;
  /** F: url · S: regex · A: '' */
  b: string;
  source: string;
  line: number;
}

/** Why a folder from a list can't be used (it would land outside the library or outside a topic), or null. */
export function folderProblem(folder: string): string | null {
  if (!folder) return 'no folder';
  if (folder.charAt(0) === '/' || folder.charAt(0) === '\\') return `"${folder}" is not inside the library`;
  if (folder.split(/[\\/]/).indexOf('..') >= 0) return `"${folder}" points outside the library`;
  if (!/^\d\d /.test(folder)) return `"${folder}" doesn't start with a topic number like "01 "`;
  return null;
}

function lineProblem(type: string, folder: string, a: string, b: string): string | null {
  const bad = folderProblem(folder);
  if (bad) return bad;
  if (type === 'F') {
    if (!a || /[\\/]/.test(a) || a === '.' || a === '..') return `bad file name "${a}"`;
    if (!/^https?:\/\//i.test(b)) return `"${b}" is not a web address`;
  } else if (type === 'S') {
    if (!/^https?:\/\//i.test(a)) return `"${a}" is not a web address`;
    try {
      new RegExp(b);
    } catch (e) {
      return `the pattern "${b}" can't be read`;
    }
    if (!b) return 'no pattern';
  } else if (!a || /[\\/]/.test(a) || a === '.' || a === '..') {
    return `bad archive.org name "${a}"`;
  }
  return null;
}

export function parseBookList(text: string, source: string): { entries: ListEntry[]; problems: string[] } {
  const entries: ListEntry[] = [];
  const problems: string[] = [];
  text
    .replace(/^﻿/, '')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.replace(/\r/g, '');
      if (!line.trim() || line.charAt(0) === '#') return;
      const parts = line.split('|');
      const type = parts[0];
      if (type !== 'F' && type !== 'S' && type !== 'A') return; // unknown lines are ignored, as bash does
      const folder = parts[1] || '';
      const a = parts[2] || '';
      const b = type === 'A' ? '' : parts.slice(3).join('|');
      const why = lineProblem(type, folder, a, b);
      if (why) problems.push(`${source}:${i + 1}: ${why}`);
      else entries.push({ type, folder, a, b, source, line: i + 1 });
    });
  return { entries, problems };
}

/** Stable id of an entry: the target file for F, the page or item for S and A. */
export function entryId(e: ListEntry): string {
  if (e.type === 'F') return `${e.folder}|${e.a}`;
  return `${e.type}|${e.folder}|${e.a}`;
}
