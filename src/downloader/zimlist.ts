// The encyclopedia list (kit/booklists/encyclopedias.txt), shared with 3-download-offline-wikipedia.sh:
//   Z|<mirror folder>|<file name prefix>|<about how many GB>|<yes|no>|<title (rest of the line)>
// "yes" = script 3 downloads it. The newest file starting with the prefix on the Kiwix mirror is the one to get.

export interface ZimEntry {
  /** The prefix: it names the encyclopedia across versions. */
  id: string;
  dir: string;
  prefix: string;
  approxGb: number;
  defaultOn: boolean;
  title: string;
  line: number;
}

export function parseZimList(text: string, source: string): { entries: ZimEntry[]; problems: string[] } {
  const entries: ZimEntry[] = [];
  const problems: string[] = [];
  text
    .replace(/^﻿/, '')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.replace(/\r/g, '');
      if (!line.trim() || line.charAt(0) === '#') return;
      const p = line.split('|');
      if (p[0] !== 'Z') return;
      const [, dir = '', prefix = '', gb = '', on = ''] = p;
      const title = p.slice(5).join('|').trim();
      const approxGb = Number(gb);
      const why =
        (!/^[a-z0-9_.-]+$/.test(dir) || dir.indexOf('..') >= 0 ? `bad mirror folder "${dir}"` : null) ||
        (!/^[A-Za-z0-9_.-]+_$/.test(prefix) ? `bad file name prefix "${prefix}" (it ends with _)` : null) ||
        (!(approxGb > 0) ? `bad size "${gb}"` : null) ||
        (on !== 'yes' && on !== 'no' ? `"${on}" is not yes or no` : null) ||
        (!title ? 'no title' : null);
      if (why) problems.push(`${source}:${i + 1}: ${why}`);
      else entries.push({ id: prefix, dir, prefix, approxGb, defaultOn: on === 'yes', title, line: i + 1 });
    });
  return { entries, problems };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The newest "<prefix><date>.zim" in a mirror folder listing (`grep -oE "$prefix[0-9-]+\.zim" | sort -u | tail -1`). */
export function newestZimFile(listingHtml: string, prefix: string): string | null {
  const found: string[] = listingHtml.match(new RegExp(escapeRe(prefix) + '[0-9-]+\\.zim', 'g')) || [];
  const unique = found.filter((f, i) => found.indexOf(f) === i).sort();
  return unique.length ? unique[unique.length - 1] : null;
}
