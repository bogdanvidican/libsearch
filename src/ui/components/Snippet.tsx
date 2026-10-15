import { toSegments } from '../snippet';

/** Renders a snippet with <mark> around matches. Always text nodes, never innerHTML. */
export function Snippet({ text, className }: { text: string; className?: string }) {
  const segs = toSegments(text);
  return (
    <p className={className || 'snippet'}>
      {segs.map((s, i) => (s.hl ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </p>
  );
}
