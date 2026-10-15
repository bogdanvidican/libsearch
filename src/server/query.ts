// Turns what a person types into a safe FTS5 query. Every term is quoted, so FTS5 syntax
// characters in user input can never cause a syntax error.

export interface ParsedQuery {
  /** Words/phrases searched, for display and for Evince --find. */
  terms: string[];
  /** FTS5 expression requiring every term, or null when nothing searchable was typed. */
  all: string | null;
  /** FTS5 expression matching any term (fallback), or null when there is only one term. */
  any: string | null;
}

const STOP_WORDS = new Set(
  (
    'a an and are as at be but by can do does for from had has have how i if in into is it its me my no not of on or ' +
    'our so than that the their them then there these they this to too was we were what when where which who why ' +
    'will with you your'
  ).split(' ')
);

const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

function quote(s: string): string {
  return '"' + s.replace(/"/g, '""') + '"';
}

export function parseQuery(input: string): ParsedQuery {
  const text = (input || '').normalize('NFC').slice(0, 300);
  const phrases: string[] = [];
  const rest = text.replace(/"([^"]*)"?/g, (_m, p: string) => {
    const t = p.trim();
    if (t && HAS_WORD_CHAR.test(t)) phrases.push(t);
    return ' ';
  });

  interface Part {
    expr: string;
    term: string;
    stop: boolean;
  }
  const parts: Part[] = phrases.map((p) => ({ expr: quote(p), term: p, stop: false }));
  for (const raw of rest.split(/\s+/)) {
    if (!raw) continue;
    const prefix = /\*+$/.test(raw);
    // Strip punctuation at the edges but keep inner characters (3/4, o'clock, e-mail).
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!word || !HAS_WORD_CHAR.test(word)) continue;
    parts.push({
      expr: quote(word) + (prefix ? '*' : ''),
      term: word,
      stop: !prefix && STOP_WORDS.has(word.toLowerCase()),
    });
  }

  let used = parts.filter((p) => !p.stop);
  if (!used.length) used = parts;
  // De-duplicate (case-insensitive) and cap the number of terms.
  const seen = new Set<string>();
  used = used.filter((p) => {
    const k = p.expr.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  used = used.slice(0, 12);

  if (!used.length) return { terms: [], all: null, any: null };
  return {
    terms: used.map((p) => p.term),
    all: used.map((p) => p.expr).join(' AND '),
    any: used.length > 1 ? used.map((p) => p.expr).join(' OR ') : null,
  };
}
