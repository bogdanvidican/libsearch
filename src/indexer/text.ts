// Text cleanup and title derivation for indexed documents.

/** Joins "purifi-\ncation", collapses whitespace inside lines, trims blank runs. */
export function cleanPageText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\uFFFD/g, ' ') // undecodable glyphs from odd PDF font encodings
    .replace(/([A-Za-zÀ-ɏ])-\n\s*([a-zß-ɏ])/g, '$1$2')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countLetters(s: string): number {
  const m = s.match(/[\p{L}\p{N}]/gu);
  return m ? m.length : 0;
}

/** Below this many letters/digits per page on average, a PDF is treated as a scan without text. */
export const SCANNED_CHARS_PER_PAGE = 25;

const BAD_META_TITLE = /^(untitled|microsoft word|title|document|unknown|none|null|slide \d+)\b/i;
// 'Subject:', 'Chapter 1', 'Part Two-1'... say nothing about the book.
const GENERIC_TITLE = /^(subject|chapter|part|section|unit|module|lesson|appendix|index|contents|page|cover)\b[\s\d:.,\-–]*(one|two|three|four|five|[ivxlc]+)?[\s\d:.,\-–]*$/i;
const FILE_EXT_IN_TITLE = /\.(pmd|p65|indd|qxd|qxp|docx?|rtf|pdf|fm|ps|eps|tex|dvi|wpd|odt|pages)\b/i;

export function isGoodMetaTitle(t: string | undefined | null): t is string {
  if (!t) return false;
  const s = t.trim();
  if (s.length < 4 || s.length > 160) return false;
  if (BAD_META_TITLE.test(s) || FILE_EXT_IN_TITLE.test(s) || GENERIC_TITLE.test(s)) return false;
  if (!/\s/.test(s) && /[_.]/.test(s)) return false; // looks like a file name
  if (countLetters(s) < s.length * 0.5) return false;
  return true;
}

export function humanizeFilename(file: string): string {
  return file
    .replace(/\.[^.]+$/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Hesperian publishes books as one PDF per chapter: en_<code>_<year>_<part>.pdf
const HESPERIAN_FILE = /^([a-z]{2})_([a-z]+)_(\d{4})_([a-z0-9]+)$/i;
const HESPERIAN_BOOKS: Record<string, string> = {
  wtnd: 'Where There Is No Doctor',
  nwtnd: 'New Where There Is No Doctor',
  wwhnd: 'Where Women Have No Doctor',
  dent: 'Where There Is No Dentist',
  dvc: 'Disabled Village Children',
  midw: 'A Book for Midwives',
  cgeh: 'A Community Guide to Environmental Health',
  hcwb: 'Helping Children Who Are Blind',
  hcwd: 'Helping Children Who Are Deaf',
  wgthas: "Workers' Guide to Health and Safety",
  haw: 'Health Actions for Women',
  wwd: 'A Health Handbook for Women with Disabilities',
};

const PART_LABELS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^0*(\d{1,3})[a-z]?$/i, (m) => `Chapter ${Number(m[1])}`],
  [/^tocd?$/i, () => 'Contents'],
  [/^gloss/i, () => 'Glossary'],
  [/^indx|^index/i, () => 'Index'],
  [/^gp$/i, () => 'Green Pages (medicines)'],
  [/^fm$/i, () => 'Front matter'],
  [/^bm(\d*)$/i, (m) => `Back matter${m[1] ? ' ' + m[1] : ''}`],
  [/^app([a-z]?)$/i, (m) => `Appendix${m[1] ? ' ' + m[1].toUpperCase() : ''}`],
  [/^intro/i, () => 'Introduction'],
  [/^(ref|res)/i, () => 'Resources'],
];

function partLabel(part: string): string {
  for (const [re, f] of PART_LABELS) {
    const m = part.match(re);
    if (m) return f(m);
  }
  return part.toUpperCase();
}

const FUNCTION_WORD_END = /\b(a|an|the|of|for|to|and|or|with|in|on|at|by|from|your|their)$/i;

/** Picks a chapter heading from the first lines of page 1, skipping running headers and noise. */
export function headingFromHead(head: string, skip: string[] = []): string {
  const skipLower = skip.map((s) => s.toLowerCase()).filter(Boolean);
  const lines = head
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 15);
  const candidates: string[] = [];
  for (let line of lines) {
    line = line.replace(/^\d+(?:[-–]\d+)?\s+(?=\p{L})/u, ''); // "196 Family Planning" -> "Family Planning"
    const lower = line.toLowerCase();
    if (countLetters(line.replace(/\d/g, '')) < 3) continue;
    if (/^chapter\b/i.test(line) && line.length < 16) continue;
    if (/^chapter[\divx]*$/i.test(line.replace(/[\s.:]+/g, ''))) continue; // letter-spaced: C H A P T E R 5
    if (/in this chapter/i.test(line)) continue;
    if (/(\.\s*){4,}/.test(line)) continue; // table-of-contents dot leaders
    if (line.length > 70) continue;
    if (GENERIC_TITLE.test(line)) continue; // "Part Two-1", "Section 3"...
    if (skipLower.some((s) => lower.indexOf(s) >= 0)) continue;
    candidates.push(line);
  }
  if (!candidates.length) return '';
  let title = candidates[0];
  const next = candidates[1];
  if (next && (FUNCTION_WORD_END.test(title) || /^[a-z]/.test(next)) && (title + ' ' + next).length <= 70) {
    title = title + ' ' + next;
  }
  return title.replace(/\s+/g, ' ').replace(/[:;,\-–]+$/, '').trim();
}

export interface TitleInput {
  filename: string;
  metaTitle?: string | null;
  /** First ~600 chars of page 1. */
  head?: string;
  /** Folder the file sits in when it is below the category folder (e.g. "USDA Home Canning Guide"). */
  subfolder?: string;
}

const NUMBERED_PARTS: Array<[RegExp, string]> = [
  [/(?:^|[^a-z])(?:chapter|chap|ch)[ ._-]*0*(\d+(?:\.\d+)?)(?!\d)/i, 'Chapter'],
  [/(?:^|[^a-z])guide[ ._-]*0*(\d+)(?!\d)/i, 'Guide'],
  [/(?:^|[^a-z])module[ ._-]*0*(\d+)(?!\d)/i, 'Module'],
  [/(?:^|[^a-z])part[ ._-]*0*(\d+)(?!\d)/i, 'Part'],
  [/(?:^|[^a-z])vol(?:ume)?[ ._-]*0*(\d+)(?!\d)/i, 'Volume'],
];

/** "mcga-shs_capt_guide_chap8" in "Ship Captains Medical Guide" -> "Ship Captains Medical Guide — Chapter 8". */
function numberedPartTitle(base: string, subfolder: string): string {
  for (const [re, label] of NUMBERED_PARTS) {
    const m = base.match(re);
    if (m) return `${subfolder} — ${label} ${m[1]}`;
  }
  return '';
}

export interface DerivedTitle {
  title: string;
  /** Extra label shown under the title, e.g. "Where There Is No Doctor (2025) · Chapter 9". */
  series: string;
}

export function deriveTitle(input: TitleInput): DerivedTitle {
  const base = input.filename.replace(/\.[^.]+$/, '');
  const hm = base.match(HESPERIAN_FILE);
  if (hm) {
    const code = hm[2].toLowerCase();
    const book = HESPERIAN_BOOKS[code] || '';
    const label = partLabel(hm[4]);
    // Contents/Index/Glossary pages: the label says more than whatever heading is on page 1.
    const heading = !/^Chapter /.test(label)
      ? ''
      : isGoodMetaTitle(input.metaTitle)
      ? input.metaTitle.trim()
      : headingFromHead(input.head || '', book ? [book] : []);
    const bookLabel = book ? `${book} (${hm[3]})` : `Hesperian ${code.toUpperCase()} (${hm[3]})`;
    return { title: heading || `${bookLabel} — ${label}`, series: heading ? `${bookLabel} · ${label}` : '' };
  }
  if (isGoodMetaTitle(input.metaTitle)) return { title: input.metaTitle.trim().replace(/\s+/g, ' '), series: '' };
  // Only for code-like names ("GUIDE02_HomeCan_rev0715"); descriptive file names are better as they are.
  const numbered = input.subfolder && !/\s/.test(base) ? numberedPartTitle(base, input.subfolder) : '';
  return { title: numbered || humanizeFilename(input.filename), series: '' };
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  deg: '°',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  agrave: 'à',
  ouml: 'ö',
  uuml: 'ü',
  auml: 'ä',
  ccedil: 'ç',
  shy: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      try {
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      } catch (e) {
        return '';
      }
    }
    const v = ENTITIES[ent.toLowerCase()];
    return v !== undefined ? v : all;
  });
}

/** Very small HTML/XHTML-to-text conversion for EPUB chapters (no DOM in Node). */
export function htmlToText(html: string): string {
  return cleanPageText(
    decodeEntities(
      html
        .replace(/<head[\s\S]*?<\/head>/gi, ' ')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/?(p|div|h[1-6]|li|ul|ol|tr|table|br|hr|blockquote|section|article|pre|dt|dd)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    )
  );
}
