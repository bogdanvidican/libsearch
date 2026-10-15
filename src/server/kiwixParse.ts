// Tolerant parsers for kiwix-serve responses (OPDS catalog, OpenSearch RSS, legacy HTML results).
// The API changed across kiwix-tools 3.x releases, so everything here is regex-based and lenient.
import { HL_END, HL_START, KiwixBook, KiwixHit } from '../shared/api';
import { decodeEntities } from '../indexer/text';

export interface CatalogEntry {
  /** Name used in content URLs (/content/<contentName>/...) — what the API calls KiwixBook.name. */
  contentName: string;
  /** Book UUID (for books.id= searches), if the catalog provides it. */
  uuid: string;
  /** OPDS <name> (generic name, e.g. wikipedia_en_100). */
  name: string;
  title: string;
  description: string;
  language: string;
  category: string;
  articleCount?: number;
  homeUrl: string;
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : '';
}

function attr(t: string, name: string): string | undefined {
  const m = t.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] !== undefined ? m[2] : m[3]) : undefined;
}

export function parseCatalog(xml: string): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const entryRe = /<entry\b[\s\S]*?<\/entry>/gi;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml))) {
    const e = m[0];
    let href = '';
    const linkRe = /<link\b[^>]*>/gi;
    let l: RegExpExecArray | null;
    while ((l = linkRe.exec(e))) {
      const type = attr(l[0], 'type') || '';
      const rel = attr(l[0], 'rel') || '';
      if (/text\/html/i.test(type) && !/acquisition|thumbnail|image/i.test(rel)) {
        href = attr(l[0], 'href') || '';
        break;
      }
    }
    const name = tag(e, 'name');
    const idText = tag(e, 'id');
    const uuid = idText.replace(/^urn:uuid:/i, '');
    let contentName = href ? decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() || '') : '';
    if (!contentName) contentName = name;
    if (!contentName) continue;
    const homeUrl = href ? (href.endsWith('/') ? href : href + '/') : `/content/${encodeURIComponent(contentName)}/`;
    const count = Number(tag(e, 'articleCount'));
    out.push({
      contentName,
      uuid,
      name: name || contentName,
      title: tag(e, 'title') || contentName,
      description: tag(e, 'summary') || tag(e, 'content'),
      language: tag(e, 'language'),
      category: tag(e, 'category'),
      articleCount: count > 0 ? count : undefined,
      homeUrl: homeUrl.startsWith('/') ? homeUrl : '/' + homeUrl,
    });
  }
  return out;
}

const QA = /stack_?exchange|stackexchange|askubuntu|superuser|serverfault|stackoverflow|mathoverflow/i;
const KHAN = /khan/i;

export function groupFor(e: { name: string; contentName: string; title: string; category?: string }): KiwixBook['group'] {
  const hay = `${e.name} ${e.contentName} ${e.title} ${e.category || ''}`;
  if (KHAN.test(hay)) return 'khan';
  if (QA.test(hay)) return 'qa';
  return 'reference';
}

export function toKiwixBook(e: CatalogEntry): KiwixBook {
  return {
    name: e.contentName,
    title: e.title,
    description: e.description,
    language: e.language,
    group: groupFor(e),
    homeUrl: e.homeUrl,
    articleCount: e.articleCount,
  };
}

/** Kiwix snippets are HTML with <b> around matches: convert to plain text with HL markers. */
export function snippetFromHtml(html: string): string {
  const marked = html
    .replace(/<b\b[^>]*>/gi, HL_START)
    .replace(/<\/b>/gi, HL_END)
    .replace(/<[^>]+>/g, '');
  return decodeEntities(marked).replace(/\s+/g, ' ').trim();
}

function normalizeUrl(link: string): string {
  let u = link.trim();
  const abs = u.match(/^https?:\/\/[^/]+(\/.*)$/i);
  if (abs) u = abs[1];
  return u.startsWith('/') ? u : '/' + u;
}

export function parseSearchXml(xml: string): { results: KiwixHit[]; total?: number } {
  const results: KiwixHit[] = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const it = m[0];
    const link = tag(it, 'link');
    if (!link) continue;
    // <description> is XML-escaped HTML; tag() unescapes once, snippetFromHtml handles the HTML.
    results.push({ title: tag(it, 'title') || link, url: normalizeUrl(link), snippet: snippetFromHtml(tag(it, 'description')) });
  }
  const total = Number(tag(xml, 'opensearch:totalResults'));
  return { results, total: total >= 0 && /totalResults/.test(xml) ? total : undefined };
}

/** Legacy HTML search page: <li><a href="...">Title</a><cite>snippet</cite>... */
export function parseSearchHtml(html: string): { results: KiwixHit[]; total?: number } {
  const results: KiwixHit[] = [];
  const liRe = /<li\b[\s\S]*?<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html))) {
    const li = m[0];
    const a = li.match(/<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    // Skip external links and the pager links back to /search.
    if (!a || /^(https?:)?\/\/|^#|^javascript:|^\/?search\?/i.test(decodeEntities(a[1]))) continue;
    const cite = li.match(/<cite\b[^>]*>([\s\S]*?)<\/cite>/i);
    results.push({
      title: decodeEntities(a[2].replace(/<[^>]+>/g, '')).trim(),
      url: normalizeUrl(decodeEntities(a[1])),
      snippet: cite ? snippetFromHtml(cite[1]) : '',
    });
  }
  const t = html.match(/of\s+(?:about\s+)?<b>\s*([\d,.\s]+)\s*<\/b>/i);
  return { results, total: t ? Number(t[1].replace(/[^\d]/g, '')) : undefined };
}
