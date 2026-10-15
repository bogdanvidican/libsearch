import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, LoaderCircle, Play, ScanText } from 'lucide-react';
import type { BookResult, BookSearchResponse, Notice, SourceGroup } from '../../shared/api';
import { useApp } from '../context';
import { kiwixFix } from '../format';
import { useBookSearch, useKiwixSearch } from '../hooks';
import { GROUP_ORDER, GroupState, KiwixGroup, KiwixResults, previewRows, totalFailed, totalPending, totalRows } from '../kiwix';
import { Filter, navigate } from '../router';
import { S } from '../strings';
import { GROUP_ICONS } from './icons';
import { NoticeBox } from './NoticeBox';
import { Snippet } from './Snippet';

interface Props {
  q: string;
  f: Filter;
  c: string;
}

/** Rows per section in the All view (the 1024x768 screen fits about four result cards). */
const PREVIEW_BOOKS = 3;
const PREVIEW_PER_BOOK = 2;
const PREVIEW_KIWIX = 4;

const GROUP_LABEL: { [G in SourceGroup]: string } = {
  books: S.filters.books,
  reference: S.filters.reference,
  khan: S.filters.khan,
  qa: S.filters.qa,
};

export function Results({ q, f, c }: Props) {
  const app = useApp();
  const st = app.status;
  const reloadKey = st ? st.index.docs + ':' + (st.index.lastBuiltAt || 0) : '';
  const books = useBookSearch(q, c, reloadKey);
  const kiwix = useKiwixSearch(q, app.kiwixBooks);
  const [expanded, setExpanded] = useState<{ [k: string]: boolean }>({});

  useEffect(() => setExpanded({}), [q, c]);

  const kiwixRunning = !!st && st.kiwix.state === 'running';
  const groupsInstalled = GROUP_ORDER.filter((g) => kiwix && kiwix[g].books.length > 0);
  const showBooks = f === 'all' || f === 'books';
  const go = (nf: Filter, nc?: string) => navigate({ name: 'search', q, f: nf, c: nc === undefined ? c : nc });

  const booksDone = !books.loading;
  const kiwixDone = !kiwix || totalPending(kiwix) === 0;
  // Only say "nothing found" when something could actually be searched (an index or running Kiwix).
  const searchedBooks = !!books.data && !books.data.notice;
  const searchedKiwix = !!kiwix && groupsInstalled.length > 0;
  const nothing =
    booksDone &&
    kiwixDone &&
    (searchedBooks || searchedKiwix) &&
    (!books.data || books.data.results.length === 0) &&
    (!kiwix || totalRows(kiwix) === 0);

  return (
    <div className="results">
      <div className="filters" role="toolbar" aria-label={S.filters.label}>
        <div className="chips">
          <FilterChip label={S.filters.all} active={f === 'all'} onClick={() => go('all')} />
          <FilterChip
            label={S.filters.books}
            active={f === 'books'}
            count={books.data ? books.data.totalBooks : undefined}
            pending={books.loading}
            onClick={() => go('books')}
          />
          {(kiwix ? groupsInstalled : []).map((g) => (
            <FilterChip
              key={g}
              label={GROUP_LABEL[g]}
              active={f === g}
              count={kiwix ? kiwix[g].rows.length : undefined}
              pending={!!kiwix && kiwix[g].pending > 0}
              onClick={() => go(g)}
            />
          ))}
        </div>
        {showBooks && app.categories.length > 0 ? (
          <label className="select">
            <span className="select__label">{S.filters.category}</span>
            <select value={c} onChange={(e) => go(f, e.target.value)}>
              <option value="">{S.filters.allCategories}</option>
              {app.categories.map((cat) => (
                <option key={cat.folder} value={cat.folder}>
                  {cat.label}
                </option>
              ))}
            </select>
            <ChevronDown className="select__chevron" size={18} aria-hidden="true" />
          </label>
        ) : null}
      </div>

      <div className="results__body">
        <h1 className="visually-hidden">{S.results.resultsFor(q)}</h1>
        <p className="visually-hidden" aria-live="polite">
          {booksDone && books.data ? S.results.books(books.data.totalBooks) : ''}
          {kiwix && kiwixDone ? ', ' + S.results.hits(totalRows(kiwix)) : ''}
        </p>

        {nothing ? (
          <NoticeBox kind="info" title={S.results.nothingAnywhere(q)}>
            <p>{S.results.tips}</p>
          </NoticeBox>
        ) : null}

        {showBooks ? (
          <BooksSection
            state={books}
            q={q}
            expanded={f === 'books' || !!expanded.books}
            onExpand={() => setExpanded({ ...expanded, books: !expanded.books })}
            filtered={f === 'books'}
          />
        ) : null}

        {f !== 'books' && !kiwixRunning && st ? (
          <NoticeBox
            kind="warning"
            title={S.results.kiwixOff}
            fix={kiwixFix(st.kiwix)}
            action={
              st.kiwix.state === 'stopped' || st.kiwix.state === 'error' || st.kiwix.state === 'starting' ? (
                <button type="button" className="btn btn--primary" disabled={app.kiwixStarting} onClick={app.startKiwix}>
                  {app.kiwixStarting ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                  {S.library.start}
                </button>
              ) : undefined
            }
          />
        ) : null}

        {kiwix
          ? GROUP_ORDER.filter((g) => f === 'all' || f === g).map((g) =>
              kiwix[g].books.length > 0 ? (
                <KiwixSection
                  key={g}
                  group={g}
                  state={kiwix[g]}
                  expanded={f === g || !!expanded[g]}
                  filtered={f === g}
                  onExpand={() => setExpanded({ ...expanded, [g]: !expanded[g] })}
                />
              ) : f === g ? (
                <NoticeBox key={g} kind="info" title={S.results.noCollections} />
              ) : null,
            )
          : null}

        {kiwix && kiwixDone && totalFailed(kiwix) > 0 ? (
          <p className="quiet-note">{S.results.collectionsFailed(totalFailed(kiwix))}</p>
        ) : null}
      </div>
    </div>
  );
}

function FilterChip(props: { label: string; active: boolean; count?: number; pending?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={'chip' + (props.active ? ' is-active' : '')} aria-pressed={props.active} onClick={props.onClick}>
      <span>{props.label}</span>
      {props.pending ? (
        <LoaderCircle className="chip__spin spin" size={16} aria-hidden="true" />
      ) : props.count !== undefined ? (
        <span className="chip__count">{props.count}</span>
      ) : null}
    </button>
  );
}

function SectionHead(props: { group: SourceGroup; title: string; count?: string; busy?: string }) {
  const Icon = GROUP_ICONS[props.group];
  return (
    <div className="rsec__head">
      <span className={'grp-badge grp--' + props.group} aria-hidden="true">
        <Icon size={20} />
      </span>
      <h2 className="rsec__title">{props.title}</h2>
      {props.count ? <span className="rsec__count">{props.count}</span> : null}
      {props.busy ? (
        <span className="rsec__busy">
          <LoaderCircle className="spin" size={16} aria-hidden="true" />
          {props.busy}
        </span>
      ) : null}
    </div>
  );
}

function BooksSection(props: {
  state: { data: BookSearchResponse | null; loading: boolean; error: Notice | null };
  q: string;
  expanded: boolean;
  filtered: boolean;
  onExpand: () => void;
}) {
  const app = useApp();
  const { data, loading, error } = props.state;
  const results = data ? data.results : [];
  const visible = props.expanded ? results : results.slice(0, PREVIEW_BOOKS);
  const hidden = results.length - visible.length;

  return (
    <section className="rsec" aria-label={S.filters.books}>
      <SectionHead
        group="books"
        title={S.filters.books}
        count={data && !loading && !data.notice ? S.results.books(data.totalBooks) : undefined}
        busy={loading ? S.results.searching : undefined}
      />
      {error ? <NoticeBox kind="error" title={error.message} fix={error.fix} /> : null}
      {data && data.notice ? (
        <NoticeBox
          kind={data.notice.kind}
          title={data.notice.message}
          fix={data.notice.fix}
          action={
            data.notice.code === 'no-index' && app.status && !app.status.index.build.running ? (
              <button type="button" className="btn btn--primary" onClick={() => app.startBuild(false)}>
                {S.library.build}
              </button>
            ) : undefined
          }
        />
      ) : null}
      {data && data.matchMode === 'any' && results.length > 0 ? <p className="rsec__note">{S.results.anyMode}</p> : null}
      {loading && !data ? <Skeleton rows={3} /> : null}
      {data && !loading && results.length === 0 && !data.notice ? <p className="rsec__empty">{S.results.noBooks}</p> : null}
      {visible.length > 0 ? (
        <ul className="rlist" role="list">
          {visible.map((r) => (
            <BookItem key={r.docId} r={r} terms={data ? data.terms : []} />
          ))}
        </ul>
      ) : null}
      {!props.filtered && (hidden > 0 || (props.expanded && results.length > PREVIEW_BOOKS)) ? (
        <button type="button" className="more-btn" aria-expanded={props.expanded} onClick={props.onExpand}>
          {props.expanded ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
          {props.expanded ? S.results.showLess : S.results.showMoreBooks(hidden)}
        </button>
      ) : null}
    </section>
  );
}

function pageLabel(r: { kind: string }, page: number): string {
  if (page <= 0) return S.results.titleOnly;
  return r.kind === 'epub' ? S.results.chapter(page) : S.results.page(page);
}

function BookItem({ r, terms }: { r: BookResult; terms: string[] }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const target = { docId: r.docId, title: r.title, kind: r.kind };
  // The series line ("Where There Is No Doctor (2025) · Chapter 9") gives chapter titles their context.
  const where = r.series ? r.category : r.subfolder ? r.category + ' · ' + r.subfolder : r.category;

  return (
    <li className="result">
      <button type="button" className="result__main" data-nav="" onClick={() => app.openBook(target, r.page, terms)}>
        <span className="result__top">
          <span className="result__title">{r.title}</span>
          <span className={'pagepill' + (r.page <= 0 ? ' pagepill--muted' : '')}>{pageLabel(r, r.page)}</span>
        </span>
        {r.series ? <span className="result__series">{r.series}</span> : null}
        <span className="result__meta">
          <span className="kind">{r.kind === 'epub' ? S.results.epub : S.results.pdf}</span>
          <span className="result__where">{where}</span>
          {r.hitPages > 1 ? <span className="result__hits">· {S.results.matchingPages(r.hitPages)}</span> : null}
        </span>
        {r.scanned ? (
          <span className="scanned">
            <ScanText size={16} aria-hidden="true" />
            {S.results.scanned}
          </span>
        ) : r.snippet ? (
          <Snippet text={r.snippet} />
        ) : null}
      </button>
      {r.morePages.length > 0 ? (
        <button type="button" className="result__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
          {open ? S.results.hidePages : S.results.morePages(r.morePages.length)}
        </button>
      ) : null}
      {open ? (
        <ul className="pagehits" role="list">
          {r.morePages.map((p) => (
            <li key={p.page}>
              <button type="button" className="pagehit" data-nav="" onClick={() => app.openBook(target, p.page, terms)}>
                <span className="pagepill">{pageLabel(r, p.page)}</span>
                <Snippet text={p.snippet} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function KiwixSection(props: { group: KiwixGroup; state: GroupState; expanded: boolean; filtered: boolean; onExpand: () => void }) {
  const app = useApp();
  const { state } = props;
  const visible = props.expanded ? state.rows : previewRows(state.rows, PREVIEW_PER_BOOK, PREVIEW_KIWIX);
  const hidden = state.rows.length - visible.length;
  const done = state.pending === 0;

  return (
    <section className="rsec" aria-label={GROUP_LABEL[props.group]}>
      <SectionHead
        group={props.group}
        title={GROUP_LABEL[props.group]}
        count={done ? S.results.hits(state.rows.length) : undefined}
        busy={!done ? S.results.searching : undefined}
      />
      {!done && state.rows.length === 0 ? <Skeleton rows={2} /> : null}
      {done && state.rows.length === 0 ? <p className="rsec__empty">{S.results.noHits}</p> : null}
      {visible.length > 0 ? (
        <ul className="rlist" role="list">
          {visible.map((row) => (
            <li key={row.key} className="result">
              <button type="button" className="result__main" data-nav="" onClick={() => app.openReader(row.url, row.title)}>
                <span className="result__top">
                  <span className="result__title">{row.title}</span>
                </span>
                <span className="result__meta">
                  <span className={'source source--' + props.group}>
                    <span className="source__dot" aria-hidden="true" />
                    {row.bookTitle}
                  </span>
                </span>
                {row.snippet ? <Snippet text={row.snippet} /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!props.filtered && (hidden > 0 || (props.expanded && state.rows.length > PREVIEW_KIWIX)) ? (
        <button type="button" className="more-btn" aria-expanded={props.expanded} onClick={props.onExpand}>
          {props.expanded ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
          {props.expanded ? S.results.showLess : S.results.showMore(hidden)}
        </button>
      ) : null}
    </section>
  );
}

function Skeleton({ rows }: { rows: number }) {
  const items = [];
  for (let i = 0; i < rows; i++) {
    items.push(
      <li key={i} className="skeleton">
        <span className="skeleton__line skeleton__line--title" />
        <span className="skeleton__line" />
        <span className="skeleton__line skeleton__line--short" />
      </li>,
    );
  }
  return (
    <ul className="rlist" aria-hidden="true">
      {items}
    </ul>
  );
}

export type { KiwixResults };
