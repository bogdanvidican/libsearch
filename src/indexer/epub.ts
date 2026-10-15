// EPUB reading: container.xml -> OPF -> spine. Each spine item is one "page" (chapter).
import * as path from 'path';
import { ZipFile } from './zip';
import { decodeEntities, htmlToText } from './text';

export interface EpubInfo {
  title: string;
  /** Zip paths of the spine items (chapters), in reading order. */
  spine: string[];
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] !== undefined ? m[2] : m[3]) : undefined;
}

function resolveHref(baseDir: string, href: string): string {
  let h = href.split('#')[0];
  try {
    h = decodeURIComponent(h);
  } catch (e) {
    // keep raw
  }
  return path.posix.normalize(path.posix.join(baseDir, h)).replace(/^\.\//, '');
}

export function readEpubInfo(zip: ZipFile): EpubInfo {
  const container = zip.readText('META-INF/container.xml');
  let opfPath: string | undefined;
  if (container) {
    const m = container.match(/<rootfile\b[^>]*>/i);
    if (m) opfPath = attr(m[0], 'full-path');
  }
  if (!opfPath) {
    // Some broken EPUBs lack container.xml; fall back to the first .opf.
    zip.entries.forEach((_e, name) => {
      if (!opfPath && /\.opf$/i.test(name)) opfPath = name;
    });
  }
  if (!opfPath) throw new Error('EPUB has no package (.opf) file');
  const opf = zip.readText(opfPath);
  if (!opf) throw new Error(`EPUB package file missing: ${opfPath}`);
  const baseDir = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath);

  const titleM = opf.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i);
  const title = titleM ? decodeEntities(titleM[1].replace(/<[^>]+>/g, '')).trim() : '';

  const manifest = new Map<string, { href: string; type: string }>();
  const itemRe = /<item\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(opf))) {
    const id = attr(m[0], 'id');
    const href = attr(m[0], 'href');
    if (id && href) manifest.set(id, { href: resolveHref(baseDir, decodeEntities(href)), type: attr(m[0], 'media-type') || '' });
  }
  const spine: string[] = [];
  const refRe = /<itemref\b[^>]*>/gi;
  while ((m = refRe.exec(opf))) {
    const idref = attr(m[0], 'idref');
    const item = idref ? manifest.get(idref) : undefined;
    if (item && /html|xml/i.test(item.type || item.href) && zip.has(item.href)) spine.push(item.href);
  }
  if (!spine.length) {
    manifest.forEach((item) => {
      if (/x?html?$/i.test(item.href) && zip.has(item.href)) spine.push(item.href);
    });
  }
  return { title, spine };
}

export interface ExtractedEpub {
  title: string;
  pages: string[];
}

export function extractEpub(file: string): ExtractedEpub {
  const zip = new ZipFile(file);
  try {
    const info = readEpubInfo(zip);
    const pages = info.spine.map((p) => htmlToText(zip.readText(p) || ''));
    return { title: info.title, pages };
  } finally {
    zip.close();
  }
}
