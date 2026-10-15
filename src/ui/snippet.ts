import { HL_START, HL_END } from '../shared/api';

export interface Segment {
  text: string;
  hl: boolean;
}

/**
 * Splits a snippet with HL_START/HL_END markers into plain segments. Tolerates unbalanced or
 * nested markers (the server cuts snippets mid-match sometimes). Rendered as text, never HTML.
 */
export function toSegments(snippet: string): Segment[] {
  const out: Segment[] = [];
  let buf = '';
  let hl = false;
  const flush = () => {
    if (buf) {
      const last = out[out.length - 1];
      if (last && last.hl === hl) last.text += buf;
      else out.push({ text: buf, hl });
      buf = '';
    }
  };
  for (let i = 0; i < snippet.length; i++) {
    const ch = snippet.charAt(i);
    if (ch === HL_START) {
      flush();
      hl = true;
    } else if (ch === HL_END) {
      flush();
      hl = false;
    } else {
      buf += ch;
    }
  }
  flush();
  return out;
}

/** Plain text without markers (for titles/aria labels). */
export function stripMarkers(s: string): string {
  return s.split(HL_START).join('').split(HL_END).join('');
}
