import { BookOpen, ChevronRight, Download, Globe } from 'lucide-react';
import type { Notice, Status } from '../../shared/api';
import { kiwixLabel, kiwixTone, percent } from '../format';
import { navigate } from '../router';
import { S } from '../strings';

/** Always-visible system status (Nielsen #1). Tapping it opens the Library screen. */
export function StatusBar({ status, error }: { status: Status | null; error: Notice | null }) {
  if (error && !status) {
    return (
      <footer className="statusbar statusbar--error" role="status">
        <span className="statusbar__item">
          <span className="dot dot--bad" aria-hidden="true" />
          {S.status.offline}
        </span>
      </footer>
    );
  }
  if (!status) return <footer className="statusbar" aria-hidden="true" />;

  const b = status.index.build;
  let books: JSX.Element;
  if (b.running) {
    const pct = percent(b.done, b.total);
    books = (
      <>
        <span className="dot dot--busy" aria-hidden="true" />
        <span>{S.status.booksIndexing(b.done, b.total)}</span>
        <span className="minibar" aria-hidden="true">
          <span className="minibar__fill" style={{ width: pct + '%' }} />
        </span>
      </>
    );
  } else if (!status.index.exists || status.index.docs === 0) {
    books = (
      <>
        <span className="dot dot--warn" aria-hidden="true" />
        <span>{S.status.booksNone}</span>
      </>
    );
  } else {
    books = (
      <>
        <span className="dot dot--ok" aria-hidden="true" />
        <span>{S.status.booksReady(status.index.docs)}</span>
      </>
    );
  }

  const tone = kiwixTone(status.kiwix);
  return (
    <footer className="statusbar">
      <button type="button" className="statusbar__button" onClick={() => navigate({ name: 'library' })}>
        <span className="statusbar__item">
          <BookOpen size={18} aria-hidden="true" className="statusbar__icon" />
          {books}
        </span>
        <span className="statusbar__sep" aria-hidden="true" />
        <span className="statusbar__item">
          <Globe size={18} aria-hidden="true" className="statusbar__icon" />
          <span className={'dot dot--' + tone} aria-hidden="true" />
          <span>
            {S.status.encyclopedias}: {kiwixLabel(status.kiwix)}
          </span>
        </span>
        {status.update && status.update.state === 'ready' ? (
          <>
            <span className="statusbar__sep" aria-hidden="true" />
            <span className="statusbar__item">
              <Download size={18} aria-hidden="true" className="statusbar__icon" />
              <span className="dot dot--busy" aria-hidden="true" />
              <span>{S.updates.statusReady}</span>
            </span>
          </>
        ) : null}
        <span className="statusbar__more">
          {S.status.details}
          <ChevronRight size={18} aria-hidden="true" />
        </span>
      </button>
    </footer>
  );
}
