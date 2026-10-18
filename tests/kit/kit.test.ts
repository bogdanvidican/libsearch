// The download kit that ships inside the app: scripts 1-5, the kit guide and the book lists in kit/.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const KIT = path.join(__dirname, '..', '..', 'kit');
const LISTS = path.join(KIT, 'booklists');

interface Entry {
  file: string;
  line: number;
  parts: string[];
}

/** Entry lines of every book list (comments and blank lines skipped, CR stripped - as 2-download-pdf-books.sh reads them).
 *  The other lists in booklists/ (manual downloads, encyclopedias) have their own formats and tests. */
function entries(): Entry[] {
  const out: Entry[] = [];
  for (const file of fs.readdirSync(LISTS).filter((n) => /^booklist-.*\.txt$/.test(n)).sort()) {
    fs.readFileSync(path.join(LISTS, file), 'utf8')
      .split('\n')
      .forEach((raw, i) => {
        const text = raw.replace(/\r/g, '');
        if (text.trim() === '' || text.startsWith('#')) return;
        out.push({ file, line: i + 1, parts: text.split('|') });
      });
  }
  return out;
}

/** What is wrong with one entry line, or '' when it is fine. */
function problem(e: Entry): string {
  const [type, folder] = e.parts;
  if (!/^\d\d [^/]/.test(folder || '') || folder.split('/').indexOf('..') >= 0) return `bad folder "${folder}"`;
  if (type === 'F') {
    const name = e.parts[2] || '';
    const url = e.parts.slice(3).join('|');
    if (e.parts.length < 4) return 'F needs folder|filename|url';
    if (!name || name.indexOf('/') >= 0) return `bad file name "${name}"`;
    if (!/^https?:\/\//.test(url)) return `bad url "${url}"`;
    return '';
  }
  if (type === 'S') {
    if (e.parts.length < 4) return 'S needs folder|page-url|regex';
    if (!/^https?:\/\//.test(e.parts[2])) return `bad page url "${e.parts[2]}"`;
    if (!e.parts.slice(3).join('|')) return 'empty regex';
    return '';
  }
  if (type === 'A') {
    if (e.parts.length !== 3) return 'A needs exactly folder|archive.org-id';
    if (!/^[A-Za-z0-9._-]+$/.test(e.parts[2])) return `bad archive.org id "${e.parts[2]}"`;
    return '';
  }
  return `unknown type "${type}"`;
}

describe('the download kit in kit/', () => {
  it('ships download scripts 1-5, the guide and the book lists', () => {
    const files = [
      '0-README-start-here.md',
      '1-fix-https-certificates.sh',
      '2-download-pdf-books.sh',
      '3-download-offline-wikipedia.sh',
      '4-download-khan-academy.sh',
      '5-start-offline-library-in-firefox.sh',
      'booklists/booklist-main.txt',
      'booklists/booklist-linux.txt',
    ];
    expect(files.filter((f) => !fs.existsSync(path.join(KIT, f)))).toEqual([]);
  });

  it('every script in kit/ is executable bash', () => {
    const scripts = fs.readdirSync(KIT).filter((n) => n.endsWith('.sh'));
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      const p = path.join(KIT, s);
      expect(fs.statSync(p).mode & 0o111, `${s} is not executable`).not.toBe(0);
      expect(fs.readFileSync(p, 'utf8').split('\n')[0], s).toBe('#!/usr/bin/env bash');
    }
  });

  it('book lists use the F/S/A format', () => {
    const all = entries();
    expect(all.length).toBeGreaterThan(0);
    const bad = all.map((e) => ({ e, why: problem(e) })).filter((x) => x.why);
    expect(bad.map((x) => `${x.e.file}:${x.e.line}: ${x.why}`)).toEqual([]);
  });

  it('no two F lines save to the same file', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const e of entries()) {
      if (e.parts[0] !== 'F') continue;
      const target = `${e.parts[1]}|${e.parts[2]}`;
      const at = `${e.file}:${e.line}`;
      if (seen.has(target)) dupes.push(`${target} (${seen.get(target)} and ${at})`);
      else seen.set(target, at);
    }
    expect(dupes).toEqual([]);
  });
});
