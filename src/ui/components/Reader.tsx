import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, LoaderCircle, Search, X } from 'lucide-react';
import { externalUrl, MODE, native } from '../api';
import { useApp } from '../context';
import { S } from '../strings';

interface Props {
  url: string;
  title: string;
  /** Words to pre-fill the Find box with. */
  findHint: string;
}

export const READER_FRAME_ID = 'reader-frame';

/**
 * In-app reader for ZIM articles and EPUB chapters. The page is same-origin (the server proxies
 * kiwix-serve), so the iframe's title and location can be read. Back/forward use window.history,
 * which includes the iframe's own navigation (joint session history).
 */
export function Reader({ url, title, findHint }: Props) {
  const app = useApp();
  const frame = useRef<HTMLIFrameElement>(null);
  const [docTitle, setDocTitle] = useState(title);
  const [path, setPath] = useState(url);
  const [loading, setLoading] = useState(true);
  const [findOpen, setFindOpen] = useState(false);

  useEffect(() => {
    setDocTitle(title);
    setPath(url);
    setLoading(true);
  }, [url, title]);

  const onLoad = () => {
    setLoading(false);
    const f = frame.current;
    if (!f) return;
    try {
      const w = f.contentWindow;
      if (w && w.document) {
        if (w.document.title) setDocTitle(w.document.title);
        // Make Find matches stand out even while the article frame isn't focused.
        if (w.document.head && !w.document.getElementById('ls-reader-style')) {
          const st = w.document.createElement('style');
          st.id = 'ls-reader-style';
          st.textContent = '::selection{background:#fbbf24;color:#0f172a}';
          w.document.head.appendChild(st);
        }
        setPath(w.location.pathname + w.location.search);
        // Let Esc inside the article leave the reader too.
        w.document.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Escape') backToResults();
        });
      }
    } catch (e) {
      /* cross-origin: keep the title we were given */
    }
  };

  const backToResults = () => {
    const h = app.lastResultsHash();
    if (h) location.hash = h;
    else history.back();
  };

  const firefoxUrl = externalUrl(path, app.status ? app.status.kiwix.port : 8080);
  const canFind = MODE === 'electron';

  return (
    <div className="reader">
      <div className="reader__bar" role="toolbar" aria-label={docTitle}>
        <button type="button" className="btn btn--secondary" onClick={backToResults}>
          <ArrowLeft size={20} aria-hidden="true" />
          <span className="hide-sm">{app.lastResultsHash() ? S.reader.backToResults : S.reader.back}</span>
        </button>
        <div className="reader__hist">
          <button type="button" className="icon-btn" aria-label={S.reader.historyBack} title={S.reader.historyBack} onClick={() => history.back()}>
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <button type="button" className="icon-btn" aria-label={S.reader.historyForward} title={S.reader.historyForward} onClick={() => history.forward()}>
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        </div>
        <h1 className="reader__title" title={docTitle}>
          {loading ? <LoaderCircle className="spin reader__spin" size={18} aria-hidden="true" /> : null}
          {docTitle || S.reader.loading}
        </h1>
        {canFind ? (
          <button
            type="button"
            className={'btn btn--ghost' + (findOpen ? ' is-active' : '')}
            aria-expanded={findOpen}
            onClick={() => setFindOpen(!findOpen)}
          >
            <Search size={20} aria-hidden="true" />
            <span className="hide-sm">{S.reader.find}</span>
          </button>
        ) : null}
        {native ? (
          <button type="button" className="btn btn--ghost" onClick={() => native && native.openExternal(firefoxUrl)}>
            <ExternalLink size={20} aria-hidden="true" />
            <span className="hide-sm">{S.reader.openInFirefox}</span>
          </button>
        ) : (
          <a className="btn btn--ghost" href={firefoxUrl} target="_blank" rel="noopener">
            <ExternalLink size={20} aria-hidden="true" />
            <span className="hide-sm">{S.reader.openInFirefox}</span>
          </a>
        )}
      </div>
      {findOpen ? <FindBar frame={frame} initial={findHint} onClose={() => setFindOpen(false)} /> : null}
      <iframe
        id={READER_FRAME_ID}
        ref={frame}
        className="reader__frame"
        title={S.reader.frameTitle + ': ' + docTitle}
        src={url}
        onLoad={onLoad}
      />
    </div>
  );
}

/** Same-origin find using window.find() in the iframe (doesn't match the find box itself). */
function FindBar({ frame, initial, onClose }: { frame: { current: HTMLIFrameElement | null }; initial: string; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const [count, setCount] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (input.current) {
      input.current.focus();
      input.current.select();
    }
  }, []);

  const countMatches = (w: Window, t: string): number => {
    const body = w.document && w.document.body;
    if (!body || !t) return 0;
    const hay = (body.textContent || '').toLowerCase();
    const needle = t.toLowerCase();
    let n = 0;
    let i = hay.indexOf(needle);
    while (i >= 0 && n < 9999) {
      n++;
      i = hay.indexOf(needle, i + needle.length);
    }
    return n;
  };

  const find = (backwards: boolean) => {
    const t = text.trim();
    if (!t) return;
    const f = frame.current;
    try {
      const w = f && (f.contentWindow as (Window & { find?: (...args: unknown[]) => boolean }) | null);
      if (w && typeof w.find === 'function') {
        setCount(countMatches(w, t));
        w.find(t, false, backwards, true, false, true, false);
        return;
      }
    } catch (e) {
      /* fall through to the Electron bridge */
    }
    if (native) native.findInPage(t, !backwards);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    find(false);
  };

  const close = () => {
    if (native) native.stopFindInPage();
    onClose();
  };

  return (
    <form className="findbar" onSubmit={submit} role="search">
      <label className="visually-hidden" htmlFor="find-input">
        {S.reader.findPlaceholder}
      </label>
      <input
        id="find-input"
        ref={input}
        className="findbar__input"
        type="text"
        placeholder={S.reader.findPlaceholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCount(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          } else if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            find(true);
          }
        }}
      />
      <span className="findbar__count" aria-live="polite">
        {count === null ? '' : S.reader.matches(count)}
      </span>
      <button type="button" className="icon-btn" aria-label={S.reader.findPrev} title={S.reader.findPrev} onClick={() => find(true)}>
        <ChevronUp size={20} aria-hidden="true" />
      </button>
      <button type="submit" className="icon-btn" aria-label={S.reader.findNext} title={S.reader.findNext}>
        <ChevronDown size={20} aria-hidden="true" />
      </button>
      <button type="button" className="icon-btn" aria-label={S.reader.findClose} title={S.reader.findClose} onClick={close}>
        <X size={20} aria-hidden="true" />
      </button>
    </form>
  );
}
