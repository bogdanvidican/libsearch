import { useState } from 'react';
import { Check, CircleCheck, Download, ExternalLink, ListChecks, ListOrdered, RefreshCw, Square, TriangleAlert } from 'lucide-react';
import type { BooksOverview, DownloadFailure, DownloadProgress, ManualItem } from '../../shared/api';
import { api, ApiError } from '../api';
import { ToastInput, useApp } from '../context';
import { formatBytes, formatDate, percent } from '../format';
import { useLoad } from '../hooks';
import { BooksTab, navigate, routeToHash } from '../router';
import { formatNumber, S } from '../strings';
import { CardHead } from './CardHead';
import { NoticeBox } from './NoticeBox';

/** The tabs that exist so far, in order. */
const TABS: BooksTab[] = ['lists', 'manual'];

export function errorToast(e: unknown): ToastInput {
  if (e instanceof ApiError) return { kind: 'error', message: e.notice.message, fix: e.notice.fix };
  return { kind: 'error', message: S.errors.generic };
}

/** Library -> Get books: download what the lists hold and this computer doesn't. */
export function GetBooks({ tab }: { tab: BooksTab }) {
  const current = TABS.indexOf(tab) >= 0 ? tab : 'lists';
  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">{S.books.title}</h1>
        <p className="page__sub">{S.books.subtitle}</p>
      </div>
      {TABS.length > 1 ? (
        <nav className="chips books-tabs" aria-label={S.books.tabsLabel}>
          {TABS.map((t) => (
            <a key={t} href={routeToHash({ name: 'books', tab: t })} className={'chip' + (t === current ? ' is-active' : '')} aria-current={t === current ? 'page' : undefined}>
              {S.books.tabs[t]}
            </a>
          ))}
        </nav>
      ) : null}
      {current === 'lists' ? <BookLists /> : null}
      {current === 'manual' ? <ManualList /> : null}
    </div>
  );
}

/** Get books -> Save by hand: sites no program can fetch from, with Open in Firefox and a tick box each. */
function ManualList() {
  const app = useApp();
  const [items, setItems] = useState<ManualItem[] | null>(null);
  const { data, error } = useLoad<ManualItem[]>('manual:' + (app.status ? app.status.roots.join('|') : ''), () => api.manual());
  const list = items || data;
  if (!list) return error ? <NoticeBox kind="error" title={error.message} fix={error.fix} /> : null;
  const fail = (e: unknown) => app.toast(errorToast(e));
  const tick = (id: string, done: boolean) => {
    api.manualDone(id, done).then(setItems, fail);
  };
  const open = (url: string) => {
    api.openUrl(url).then((r) => {
      if (!r.ok) app.toast({ kind: 'error', message: r.error ? r.error.message : S.books.openFailed, fix: r.error ? r.error.fix : undefined });
    }, fail);
  };
  const topics: string[] = [];
  for (const i of list) {
    const t = i.folder.split('/')[0];
    if (topics.indexOf(t) < 0) topics.push(t);
  }
  topics.sort();
  const m = S.books.manual;
  return (
    <section className="card">
      <CardHead icon={<ListChecks size={22} />} title={m.title} />
      <p className="card__text">{m.intro}</p>
      <p className="card__fix">{m.tipPdf}</p>
      <p className="card__fix">{m.tipPrint}</p>
      <p className="card__ok">
        <CircleCheck size={18} aria-hidden="true" />
        {m.count(list.filter((i) => i.done).length, list.length)}
      </p>
      {topics.map((t) => (
        <div key={t} className="manual__topic">
          <h3 className="manual__topic-title">{t.replace(/^\d{1,3}\s+/, '')}</h3>
          <ul className="failures" role="list">
            {list
              .filter((i) => i.folder.split('/')[0] === t)
              .map((i) => (
                <li key={i.id} className={'failure manual' + (i.done ? ' manual--done' : '')}>
                  <label className="manual__check">
                    <input type="checkbox" checked={i.done} onChange={(e) => tick(i.id, e.target.checked)} />
                    <span className="failure__file">{i.title}</span>
                    <span className="visually-hidden">{m.saved}</span>
                  </label>
                  <span className="failure__folder">{S.books.saveInto(i.folder)}</span>
                  <span className="failure__reason">
                    {m.how[i.how]}
                    {i.note ? ' · ' + i.note : ''}
                  </span>
                  {i.auto ? <span className="tag tag--ok">{m.found}</span> : null}
                  <span className="btn-row">
                    <button type="button" className="btn btn--secondary" onClick={() => open(i.url)}>
                      <ExternalLink size={18} aria-hidden="true" />
                      {S.books.openInFirefox}
                    </button>
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function BookLists() {
  const app = useApp();
  const job = app.status && app.status.downloads ? app.status.downloads.books : null;
  const [reload, setReload] = useState(0);
  // Read the overview again when a download ends, the library folders change, or a book is marked as done.
  const runKey = job ? (job.running ? 'running' : String(job.finishedAt || 0)) : '';
  const roots = app.status ? app.status.roots.join('|') : '';
  const { data, error } = useLoad<BooksOverview>(`books:${reload}:${runKey}:${roots}`, () => api.books());
  if (!data) return error ? <NoticeBox kind="error" title={error.message} fix={error.fix} /> : null;

  const fail = (e: unknown) => app.toast(errorToast(e));
  const start = () => {
    api.booksDownload().then(app.refreshStatus, fail);
  };
  const stop = () => {
    api.booksCancel().then(app.refreshStatus, fail);
  };
  const open = (url: string) => {
    api.openUrl(url).then((r) => {
      if (!r.ok) app.toast({ kind: 'error', message: r.error ? r.error.message : S.books.openFailed, fix: r.error ? r.error.fix : undefined });
    }, fail);
  };
  const markDone = (id: string) => {
    api.booksDone(id, true).then(() => setReload((n) => n + 1), fail);
  };
  return (
    <>
      <DownloadCard o={data} job={job} onStart={start} onStop={stop} />
      <TopicsCard o={data} />
      {data.failures.length ? <FailuresCard failures={data.failures} onOpen={open} onDone={markDone} /> : null}
    </>
  );
}

function DownloadCard({ o, job, onStart, onStop }: { o: BooksOverview; job: DownloadProgress | null; onStart: () => void; onStop: () => void }) {
  const app = useApp();
  const running = !!job && job.running;
  const tone = running ? 'busy' : o.problem ? 'bad' : o.missing ? 'warn' : 'ok';
  return (
    <section className="card">
      <CardHead icon={<Download size={22} />} title={S.books.downloadTitle} tone={tone} />
      {o.problem ? (
        <NoticeBox kind="error" title={o.problem.message} fix={o.problem.fix} />
      ) : (
        <p className="card__text">
          <strong>{S.books.destination}</strong> <span className="books__path">{o.destination}</span>
          {o.freeBytes !== undefined ? ' · ' + S.books.free(formatBytes(o.freeBytes)) : ''}
        </p>
      )}
      {running && job ? (
        <JobProgress job={job} onStop={onStop} />
      ) : (
        <>
          {job && job.notice ? <NoticeBox kind={job.notice.kind} compact title={job.notice.message} fix={job.notice.fix} /> : null}
          {job && job.phase === 'done' ? (
            <p className="card__ok">
              <CircleCheck size={18} aria-hidden="true" />
              {S.books.finished(job.downloaded, job.skipped, job.failed)}
            </p>
          ) : null}
          {job && job.phase === 'cancelled' ? <NoticeBox kind="info" compact title={S.books.stopped} /> : null}
          {!o.missing && !o.problem ? <p className="card__text">{S.books.nothingMissing}</p> : null}
          {!o.problem ? (
            <div className="btn-row">
              <button type="button" className="btn btn--primary btn--lg" onClick={onStart}>
                <Download size={20} aria-hidden="true" />
                {S.books.download(o.missing)}
              </button>
              {job && job.phase === 'done' && job.downloaded > 0 ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  title={S.books.updateIndexHint}
                  onClick={() => {
                    app.startBuild(false);
                    navigate({ name: 'library' });
                  }}
                >
                  <RefreshCw size={18} aria-hidden="true" />
                  {S.library.update}
                </button>
              ) : null}
            </div>
          ) : null}
          <p className="card__fix">{S.books.needsInternet}</p>
          {o.lastRun ? <p className="card__text">{S.books.lastRun(formatDate(o.lastRun.finishedAt))}</p> : null}
        </>
      )}
    </section>
  );
}

export function JobProgress({ job, onStop }: { job: DownloadProgress; onStop: () => void }) {
  const pct = percent(job.done, job.total);
  return (
    <div className="build" aria-live="polite">
      <div className="build__row">
        <strong>{job.phase === 'checking' ? S.books.checking : S.books.progress(job.done, job.total)}</strong>
        <span className="build__pct">{pct}%</span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span className="progress__fill" style={{ width: pct + '%' }} />
      </div>
      {job.currentFile ? <p className="build__file">{S.books.file(job.currentFile)}</p> : null}
      {job.fileReceived ? (
        <p className="build__eta">
          {S.books.sizeOf(formatBytes(job.fileReceived), job.fileTotal ? formatBytes(job.fileTotal) : '')}
          {job.speed ? ' · ' + S.books.speed(formatBytes(job.speed)) : ''}
        </p>
      ) : null}
      <p className="build__eta">{S.books.continuesLater}</p>
      <div className="btn-row">
        <button type="button" className="btn btn--secondary" onClick={onStop}>
          <Square size={18} aria-hidden="true" />
          {S.books.stop}
        </button>
      </div>
    </div>
  );
}

function TopicsCard({ o }: { o: BooksOverview }) {
  const t = S.books.table;
  return (
    <section className="card">
      <CardHead icon={<ListOrdered size={22} />} title={S.books.topicsTitle} />
      <table className="topics">
        <thead>
          <tr>
            <th scope="col">{t.topic}</th>
            <th scope="col" className="num">{t.listed}</th>
            <th scope="col" className="num">{t.here}</th>
            <th scope="col" className="num">{t.missing}</th>
            <th scope="col" className="num">{t.failed}</th>
          </tr>
        </thead>
        <tbody>
          {o.topics.map((tp) => {
            const missing = Math.max(0, tp.listed - tp.present);
            return (
              <tr key={tp.folder} title={S.books.onDisk(formatBytes(tp.bytes))}>
                <th scope="row">{tp.label}</th>
                <td className="num">{formatNumber(tp.listed)}</td>
                <td className="num">{formatNumber(tp.present)}</td>
                <td className={'num' + (missing ? ' topics__missing' : '')}>{formatNumber(missing)}</td>
                <td className={'num' + (tp.failed ? ' topics__failed' : '')}>{formatNumber(tp.failed)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function FailuresCard({ failures, onOpen, onDone }: { failures: DownloadFailure[]; onOpen: (url: string) => void; onDone: (id: string) => void }) {
  return (
    <section className="card">
      <CardHead icon={<TriangleAlert size={22} />} title={S.books.failuresTitle(failures.length)} tone="warn" />
      <p className="card__text">{S.books.failuresBody}</p>
      <ul className="failures" role="list">
        {failures.map((f) => (
          <li key={f.id} className="failure">
            <span className="failure__file">{f.file === '(page)' ? S.books.pageItem : f.file}</span>
            <span className="failure__folder">{S.books.saveInto(f.folder)}</span>
            <span className="failure__reason">{f.reason}</span>
            <span className="btn-row">
              <button type="button" className="btn btn--secondary" onClick={() => onOpen(f.url)}>
                <ExternalLink size={18} aria-hidden="true" />
                {S.books.openInFirefox}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => onDone(f.id)}>
                <Check size={18} aria-hidden="true" />
                {S.books.markDone}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
