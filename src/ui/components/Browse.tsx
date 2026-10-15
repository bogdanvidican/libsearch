import { ArrowLeft, ChevronRight, ScanText } from 'lucide-react';
import type { DocSummary, KiwixBook } from '../../shared/api';
import { api } from '../api';
import { useApp } from '../context';
import { useLoad } from '../hooks';
import { GROUP_ORDER } from '../kiwix';
import { navigate } from '../router';
import { S } from '../strings';
import { categoryIcon, GROUP_ICONS } from './icons';
import { NoticeBox } from './NoticeBox';

export function Browse({ folder }: { folder: string }) {
  return folder ? <CategoryDocs folder={folder} /> : <BrowseHome />;
}

function BrowseHome() {
  const app = useApp();
  const noIndex = !!app.status && (!app.status.index.exists || app.status.index.docs === 0);
  const byGroup = GROUP_ORDER.map((g) => ({ g, books: app.kiwixBooks.filter((b) => b.group === g) })).filter((x) => x.books.length > 0);

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">{S.browse.title}</h1>
        <p className="page__sub">{S.browse.subtitle}</p>
      </div>

      <section aria-labelledby="browse-books">
        <h2 id="browse-books" className="section-head__title">
          {S.browse.booksTitle}
        </h2>
        {noIndex && app.categories.length === 0 ? <NoticeBox kind="info" title={S.browse.noIndex} /> : null}
        <ul className="tiles tiles--browse" role="list">
          {app.categories.map((c) => {
            const Icon = categoryIcon(c.label);
            return (
              <li key={c.folder}>
                <button type="button" className="tile" onClick={() => navigate({ name: 'browse', folder: c.folder })}>
                  <span className="tile__icon" aria-hidden="true">
                    <Icon size={22} />
                  </span>
                  <span className="tile__text">
                    <span className="tile__label">{c.label}</span>
                    <span className="tile__count">
                      {S.browse.docs(c.docs)}
                      {c.scanned > 0 ? ' · ' + S.browse.scannedCount(c.scanned) : ''}
                    </span>
                  </span>
                  <ChevronRight className="tile__chev" size={20} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="browse-zim" className="page__section">
        <h2 id="browse-zim" className="section-head__title">
          {S.browse.collectionsTitle}
        </h2>
        {byGroup.length === 0 ? <NoticeBox kind="info" title={S.browse.collectionsEmpty} /> : null}
        {byGroup.map(({ g, books }) => (
          <div key={g} className="zimgroup">
            <h3 className="zimgroup__title">
              <span className={'grp-badge grp-badge--sm grp--' + g} aria-hidden="true">
                {(() => {
                  const Icon = GROUP_ICONS[g];
                  return <Icon size={16} />;
                })()}
              </span>
              {S.browse.groups[g]}
            </h3>
            <ul className="zimlist" role="list">
              {books.map((b) => (
                <ZimCard key={b.name} book={b} />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

function ZimCard({ book }: { book: KiwixBook }) {
  const app = useApp();
  return (
    <li>
      <button type="button" className="zimcard" onClick={() => app.openReader(book.homeUrl, book.title)}>
        <span className="zimcard__title">{book.title}</span>
        {book.description ? <span className="zimcard__desc">{book.description}</span> : null}
        {book.articleCount ? <span className="zimcard__meta">{book.articleCount.toLocaleString('en-US')} articles</span> : null}
      </button>
    </li>
  );
}

function CategoryDocs({ folder }: { folder: string }) {
  const app = useApp();
  const cat = app.categories.filter((c) => c.folder === folder)[0];
  const label = cat ? cat.label : folder.replace(/^\d+\s+/, '');
  const Icon = categoryIcon(label);
  const { data, loading, error } = useLoad<DocSummary[]>('docs:' + folder, () => api.browseDocs(folder));

  // Group by subfolder, keeping server order; loose files first.
  const groups: Array<{ name: string; docs: DocSummary[] }> = [];
  const idx: { [k: string]: number } = {};
  for (const d of data || []) {
    const key = d.subfolder || '';
    if (idx[key] === undefined) {
      idx[key] = groups.length;
      groups.push({ name: key, docs: [] });
    }
    groups[idx[key]].docs.push(d);
  }
  groups.sort((a, b) => (a.name === '' ? -1 : b.name === '' ? 1 : a.name.localeCompare(b.name)));

  return (
    <div className="page">
      <div className="page__head page__head--row">
        <button type="button" className="btn btn--secondary" onClick={() => navigate({ name: 'browse', folder: '' })}>
          <ArrowLeft size={20} aria-hidden="true" />
          {S.browse.allTopics}
        </button>
        <span className="tile__icon tile__icon--lg" aria-hidden="true">
          <Icon size={26} />
        </span>
        <div>
          <h1 className="page__title">{label}</h1>
          {data ? <p className="page__sub">{S.browse.docs(data.length)}</p> : null}
        </div>
      </div>
      {error ? <NoticeBox kind="error" title={error.message} fix={error.fix} /> : null}
      {loading && !data ? <p className="quiet-note">{S.results.searching}</p> : null}
      {data && data.length === 0 ? <NoticeBox kind="info" title={S.browse.emptyCategory} /> : null}
      {groups.map((g) => (
        <section key={g.name || '_'} className="docgroup">
          {groups.length > 1 || g.name ? <h2 className="docgroup__title">{groupLabel(g.name, g.docs)}</h2> : null}
          <ul className="doclist" role="list">
            {g.docs.map((d) => (
              <li key={d.docId}>
                <button
                  type="button"
                  className="docrow"
                  data-nav=""
                  onClick={() => app.openBook({ docId: d.docId, title: d.title, kind: d.kind }, 0)}
                >
                  <span className="docrow__text">
                    <span className="docrow__title">{d.title}</span>
                    {d.series && d.series !== groupLabel(g.name, g.docs) ? <span className="docrow__series">{seriesTail(d.series, g)}</span> : null}
                  </span>
                  <span className="docrow__meta">
                    {d.status === 'scanned' ? (
                      <span className="scanned scanned--inline">
                        <ScanText size={16} aria-hidden="true" />
                        {S.library.problemScanned}
                      </span>
                    ) : null}
                    <span className="kind">{d.kind === 'epub' ? S.results.epub : S.results.pdf}</span>
                    {d.pages > 0 ? <span>{d.kind === 'epub' ? S.browse.chapters(d.pages) : S.browse.pages(d.pages)}</span> : null}
                  </span>
                  <ChevronRight className="docrow__chev" size={20} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** "Where There Is No Doctor (2025) · Chapter 9" → "Where There Is No Doctor (2025)" when every doc in the folder shares it. */
function sharedSeries(docs: DocSummary[]): string {
  let common = '';
  for (const d of docs) {
    const s = d.series || '';
    const i = s.lastIndexOf(' · ');
    const head = i > 0 ? s.slice(0, i) : s;
    if (!head) return '';
    if (!common) common = head;
    else if (common !== head) return '';
  }
  return common;
}

function groupLabel(name: string, docs: DocSummary[]): string {
  return sharedSeries(docs) || name || S.browse.looseFiles;
}

/** Inside a group headed by the series name, show only the "Chapter 9" part. */
function seriesTail(series: string, g: { name: string; docs: DocSummary[] }): string {
  const head = sharedSeries(g.docs);
  if (head && series.indexOf(head + ' · ') === 0) return series.slice(head.length + 3);
  return series;
}
