// Link rules of kit/2-download-pdf-books.sh, ported exactly so the app and the script save the same files.

/** resolve(): page link -> absolute url (no normalization of "../", as the script does it with sed). */
export function resolveLink(page: string, link: string): string {
  const l = link.replace(/&amp;/g, '&').replace(/ /g, '%20');
  const origin = page.replace(/^(https?:\/\/[^/]+).*$/, '$1');
  const base = page.replace(/[^/]*$/, '');
  if (l.indexOf('http') === 0) return l;
  if (l.indexOf('//') === 0) return 'https:' + l;
  if (l.charAt(0) === '/') return origin + l;
  return base + l;
}

/** `grep -oE "$re" | sed 's/^href="//; s/"$//' | sort -u` - matched line by line, like grep. */
export function scrapeLinks(html: string, regex: string): string[] {
  const out: string[] = [];
  for (const line of html.split('\n')) {
    const re = new RegExp(regex, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      const l = m[0].replace(/^href="/, '').replace(/"$/, '');
      if (out.indexOf(l) < 0) out.push(l);
    }
  }
  return out.sort();
}

function stripQuery(u: string): string {
  return u.replace(/[?#].*$/, '');
}

/** File name for a scraped link: last path segment, no query, %20 -> _, ".pdf" added when missing. */
export function fileNameFromUrl(url: string): string {
  const n = stripQuery(url).replace(/^.*\//, '').replace(/%20/g, '_');
  return /\.(pdf|PDF)$/.test(n) ? n : n + '.pdf';
}

/** Hesperian chapters go into <folder>/<the folder they sit in on the site>; everything else into <folder>. */
export function scrapeFolder(folder: string, page: string, url: string): string {
  if (page.indexOf('hesperian') < 0) return folder;
  const parent = stripQuery(url).replace(/\/[^/]*$/, '').replace(/^.*\//, '');
  return `${folder}/${parent}`;
}

/** PDFs of an archive.org item (from https://archive.org/metadata/<id>), without the "_text.pdf" copies. */
export function archivePdfNames(metadataJson: string): string[] {
  let data: { files?: { name?: unknown }[] };
  try {
    data = JSON.parse(metadataJson);
  } catch (e) {
    return [];
  }
  const files = data && Array.isArray(data.files) ? data.files : [];
  return files
    .map((f) => (f && typeof f.name === 'string' ? f.name : ''))
    .filter((n) => /\.pdf$/.test(n) && !/_text\.pdf$/.test(n));
}
