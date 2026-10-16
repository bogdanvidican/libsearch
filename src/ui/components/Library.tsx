import { useState } from 'react';
import { useEffect } from 'react';
import { CircleCheck, CircleAlert, Database, Download, Globe, Info, LoaderCircle, Monitor, Moon, Palette, Play, RefreshCw, RotateCw, Square, Sun, Wrench } from 'lucide-react';
import type { ThemeSetting } from '../../shared/api';
import type { DocSummary, Status } from '../../shared/api';
import { api, ApiError, MODE } from '../api';
import { useApp } from '../context';
import { etaText, formatDate, kiwixFix, kiwixLabel, kiwixTone, megabytes, percent, updateHeadline, updateTone } from '../format';
import { useLoad } from '../hooks';
import { formatNumber, S } from '../strings';
import { NoticeBox } from './NoticeBox';
import { LibraryFolders } from './LibraryFolders';
import { onThemeChange, setTheme, themeSetting } from '../theme';

export function Library() {
  const app = useApp();
  const st = app.status;
  if (!st) {
    return (
      <div className="page">
        <h1 className="page__title">{S.library.title}</h1>
        {app.statusError ? <NoticeBox kind="error" title={app.statusError.message} fix={app.statusError.fix} /> : null}
      </div>
    );
  }
  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">{S.library.title}</h1>
        <p className="page__sub">{S.library.subtitle}</p>
      </div>
      {st.notices.map((n) => (
        <NoticeBox key={n.code} kind={n.kind} title={n.message} fix={n.fix} />
      ))}
      <LibraryFolders st={st} variant="card" />
      <div className="lib-grid">
        <IndexCard st={st} />
        <div className="lib-col">
          <KiwixCard st={st} />
          <ToolsCard st={st} />
          <UpdatesCard st={st} />
          <AppearanceCard />
        </div>
      </div>
      <Problems st={st} />
      <About st={st} />
    </div>
  );
}

function CardHead({ icon, title, tone }: { icon: JSX.Element; title: string; tone?: 'ok' | 'busy' | 'warn' | 'bad' }) {
  return (
    <div className="card__head">
      <span className={'card__icon' + (tone ? ' card__icon--' + tone : '')} aria-hidden="true">
        {icon}
      </span>
      <h2 className="card__title">{title}</h2>
    </div>
  );
}

function IndexCard({ st }: { st: Status }) {
  const app = useApp();
  const ix = st.index;
  const b = ix.build;
  const pct = percent(b.done, b.total);
  const eta = etaText(b, Date.now());
  const hasIndex = ix.exists && ix.docs > 0;
  const toolsMissing = !st.tools.pdftotext;

  return (
    <section className="card">
      <CardHead icon={<Database size={22} />} title={S.library.indexTitle} tone={b.running ? 'busy' : hasIndex ? 'ok' : 'warn'} />
      <dl className="stats">
        <div className="stat">
          <dt>{S.library.statBooks}</dt>
          <dd>{formatNumber(ix.docs)}</dd>
        </div>
        <div className="stat">
          <dt>{S.library.statPages}</dt>
          <dd>{formatNumber(ix.pages)}</dd>
        </div>
        <div className="stat">
          <dt>{S.library.statScanned}</dt>
          <dd>{formatNumber(ix.scanned + ix.errors)}</dd>
        </div>
        <div className="stat stat--wide">
          <dt>{S.library.statUpdated}</dt>
          <dd className="stat__date">{formatDate(ix.lastBuiltAt)}</dd>
        </div>
      </dl>

      {b.running ? (
        <div className="build" aria-live="polite">
          <div className="build__row">
            <strong>
              {b.phase === 'scanning' ? S.library.scanning : b.phase === 'cleaning' ? S.library.cleaning : S.library.progress(b.done, b.total)}
            </strong>
            <span className="build__pct">{pct}%</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span className="progress__fill" style={{ width: pct + '%' }} />
          </div>
          {b.currentFile ? <p className="build__file">{S.library.current(b.currentFile)}</p> : null}
          <p className="build__eta">{eta ? eta + ' · ' : ''}{S.library.canKeepUsing}</p>
          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={app.cancelBuild}>
              <Square size={18} aria-hidden="true" />
              {S.library.cancel}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="card__text">{S.library.indexBody}</p>
          {b.phase === 'done' && b.finishedAt ? (
            <p className="card__ok">
              <CircleCheck size={18} aria-hidden="true" />
              {S.library.finished(b.added, b.updated, b.removed)}
            </p>
          ) : null}
          {b.phase === 'failed' ? <NoticeBox kind="error" compact title={b.message || S.library.failedBuild} /> : null}
          {b.phase === 'cancelled' ? <NoticeBox kind="info" compact title={S.library.cancelled} /> : null}
          {ix.pendingChanges ? <NoticeBox kind="warning" compact title={S.library.pending(ix.pendingChanges)} /> : null}
          {toolsMissing ? (
            <NoticeBox kind="error" compact title={S.library.tools.pdftotext.what + ': ' + S.library.toolMissing} fix={S.library.tools.pdftotext.fix} />
          ) : null}
          <div className="btn-row">
            <button type="button" className="btn btn--primary btn--lg" disabled={toolsMissing} onClick={() => app.startBuild(false)}>
              <RefreshCw size={20} aria-hidden="true" />
              {hasIndex ? S.library.update : S.library.build}
            </button>
            {hasIndex ? (
              <button type="button" className="btn btn--ghost" disabled={toolsMissing} onClick={() => app.startBuild(true)} title={S.library.rebuildHint}>
                {S.library.rebuild}
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function KiwixCard({ st }: { st: Status }) {
  const app = useApp();
  const k = st.kiwix;
  const tone = kiwixTone(k);
  const skipped = k.skipped || [];
  const canStart = k.state === 'stopped' || k.state === 'error' || k.state === 'port-busy' || skipped.length > 0;
  return (
    <section className="card">
      <CardHead icon={<Globe size={22} />} title={S.library.kiwixTitle} tone={tone} />
      <p className="kstate">
        <span className={'dot dot--' + tone} aria-hidden="true" />
        <strong>{kiwixLabel(k)}</strong>
        {k.state === 'running' ? <span className="kstate__port">127.0.0.1:{k.port}</span> : null}
      </p>
      {k.message ? <p className="card__text">{k.message}</p> : null}
      {kiwixFix(k) && k.state !== 'running' ? (
        <p className="card__fix">
          <strong>{S.library.fixLabel}</strong> {kiwixFix(k)}
        </p>
      ) : (
        <p className="card__text">{S.library.kiwixBody}</p>
      )}
      {skipped.length ? (
        <div className="skipped" role="note">
          <p className="skipped__title">{S.kiwix.skippedTitle(skipped.length)}</p>
          <ul className="skipped__list" role="list">
            {skipped.map((z) => (
              <li key={z.path} className="skipped__item">
                <span className="skipped__file">{z.file}</span>
                <span className="skipped__reason">{z.reason}</span>
                <span className="skipped__fix">
                  <strong>{S.library.fixLabel}</strong> {z.fix}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {canStart || k.state === 'starting' ? (
        <div className="btn-row">
          <button type="button" className="btn btn--primary" disabled={app.kiwixStarting || k.state === 'starting'} onClick={app.startKiwix}>
            {app.kiwixStarting || k.state === 'starting' ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
            {k.state === 'stopped' ? S.library.start : skipped.length && k.state === 'running' ? S.kiwix.checkAgain : S.library.retry}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ToolsCard({ st }: { st: Status }) {
  const keys = ['pdftotext', 'pdfinfo', 'evince', 'firefox'] as const;
  const relevant = keys.filter((k) => !(k === 'evince' && st.platform === 'darwin'));
  return (
    <section className="card">
      <CardHead icon={<Wrench size={22} />} title={S.library.toolsTitle} />
      <ul className="tools" role="list">
        {relevant.map((k) => {
          const ok = st.tools[k];
          const t = S.library.tools[k];
          return (
            <li key={k} className="tool">
              {ok ? (
                <CircleCheck className="tool__ok" size={20} aria-label={S.library.toolOk} />
              ) : (
                <CircleAlert className="tool__bad" size={20} aria-label={S.library.toolMissing} />
              )}
              <span className="tool__text">
                <span className="tool__name">{t.name}</span>
                <span className="tool__what">{t.what}</span>
                {!ok ? <code className="tool__fix">{t.fix}</code> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function UpdatesCard({ st }: { st: Status }) {
  const app = useApp();
  const u = st.update;
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(u.auto);
  useEffect(() => setAuto(u.auto), [u.auto]);

  const fail = (e: unknown) =>
    app.toast(e instanceof ApiError ? { kind: 'error', message: e.notice.message, fix: e.notice.fix } : { kind: 'error', message: S.errors.generic });
  const run = (call: () => Promise<unknown>) => {
    setBusy(true);
    call()
      .catch(fail)
      .then(() => {
        setBusy(false);
        app.refreshStatus();
      });
  };
  const toggleAuto = (on: boolean) => {
    setAuto(on);
    api.saveSettings({ autoUpdate: on }).then(app.refreshStatus, () => {
      setAuto(!on);
      app.toast({ kind: 'error', message: S.updates.autoSaveFailed });
    });
  };

  const tone = updateTone(u);
  const unsupported = u.state === 'unsupported';
  const pct = percent(u.received || 0, u.total || 0);
  const v = u.downloaded || u.latest || '';

  let text: string | null = null;
  if (unsupported) text = u.reason || null;
  else if (u.state === 'ready') text = u.auto ? S.updates.readyAuto : S.updates.readyManual;
  else if (u.state === 'installing') text = MODE === 'browser' ? S.updates.restartBodyBrowser : S.updates.restartBody;
  else if (u.state !== 'downloading') {
    text = S.updates.version(u.current) + (u.checkedAt && u.state !== 'checking' ? ' ' + S.updates.lastChecked(formatDate(u.checkedAt)) : '');
  }

  let action: JSX.Element | null = null;
  if (u.state === 'available') {
    action = (
      <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(api.updateDownload)}>
        <Download size={18} aria-hidden="true" />
        {S.updates.download}
      </button>
    );
  } else if (u.state === 'ready' || (u.state === 'error' && u.downloaded)) {
    action = (
      <button type="button" className="btn btn--primary" onClick={app.installUpdate}>
        <RotateCw size={18} aria-hidden="true" />
        {u.state === 'ready' ? S.updates.restart : S.updates.retryInstall}
      </button>
    );
  } else if (!unsupported && u.state !== 'downloading' && u.state !== 'installing') {
    const checking = busy || u.state === 'checking';
    action = (
      <button type="button" className="btn btn--secondary" disabled={checking} onClick={() => run(api.updateCheck)}>
        {checking ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
        {S.updates.check}
      </button>
    );
  }

  return (
    <section className="card">
      <CardHead icon={<Download size={22} />} title={S.updates.title} tone={tone} />
      {u.updatedFrom ? (
        <p className="card__ok card__ok--top">
          <CircleCheck size={18} aria-hidden="true" />
          {S.updates.updated(u.updatedFrom, u.current)}
        </p>
      ) : null}
      <p className="kstate">
        {tone ? <span className={'dot dot--' + tone} aria-hidden="true" /> : null}
        <strong>{updateHeadline(u)}</strong>
      </p>
      {text ? <p className="card__text">{text}</p> : null}
      {u.state === 'downloading' ? (
        <div className="build" aria-live="polite">
          <div className="build__row">
            <span>{u.total ? S.updates.received(megabytes(u.received || 0), megabytes(u.total)) : ''}</span>
            <span className="build__pct">{pct}%</span>
          </div>
          <div className="progress" role="progressbar" aria-label={updateHeadline(u)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span className="progress__fill" style={{ width: pct + '%' }} />
          </div>
          <p className="build__eta">{S.updates.keepUsing}</p>
        </div>
      ) : null}
      {u.error && (u.state === 'error' || u.state === 'offline') ? (
        <NoticeBox kind={u.error.kind} compact title={u.error.message} fix={u.error.fix} />
      ) : null}
      {u.notes && v && (u.state === 'available' || u.state === 'downloading' || u.state === 'ready') ? (
        <details className="notes">
          <summary>{S.updates.whatsNew(v)}</summary>
          <p className="notes__body">{u.notes}</p>
        </details>
      ) : null}
      {action ? <div className="btn-row">{action}</div> : null}
      {!unsupported ? (
        <label className="toggle">
          <input type="checkbox" className="toggle__input" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} />
          <span className="toggle__text">
            <span className="toggle__label">{S.updates.autoLabel}</span>
            <span className="toggle__hint">{S.updates.autoHint}</span>
          </span>
        </label>
      ) : null}
    </section>
  );
}

function AppearanceCard() {
  const [current, setCurrent] = useState<ThemeSetting>(themeSetting());
  useEffect(() => onThemeChange(() => setCurrent(themeSetting())), []);
  const options: Array<[ThemeSetting, string, JSX.Element]> = [
    ['system', S.theme.system, <Monitor key="s" size={18} aria-hidden="true" />],
    ['light', S.theme.light, <Sun key="l" size={18} aria-hidden="true" />],
    ['dark', S.theme.dark, <Moon key="d" size={18} aria-hidden="true" />],
  ];
  return (
    <section className="card">
      <CardHead icon={<Palette size={22} />} title={S.theme.title} />
      <p className="card__text">{S.theme.body}</p>
      <div className="segmented" role="radiogroup" aria-label={S.theme.title}>
        {options.map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={current === value}
            className={'segmented__item' + (current === value ? ' is-selected' : '')}
            onClick={() => setTheme(value)}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Problems({ st }: { st: Status }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const n = st.index.scanned + st.index.errors;
  const key = open ? 'problems:' + (st.index.lastBuiltAt || 0) + ':' + n : null;
  const { data } = useLoad<DocSummary[]>(key, () => api.problems());
  if (!st.index.exists) return null;
  return (
    <section className="card">
      <CardHead icon={<Info size={22} />} title={S.library.problemsTitle} />
      {n === 0 ? (
        <p className="card__text">{S.library.problemsNone}</p>
      ) : (
        <>
          <p className="card__text">{S.library.problemsBody}</p>
          <button type="button" className="btn btn--secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? S.library.hideProblems : S.library.showProblems(n)}
          </button>
          {open && data ? (
            <ul className="problems" role="list">
              {data.map((d) => (
                <li key={d.docId}>
                  <button
                    type="button"
                    className="problem"
                    onClick={() => app.openBook({ docId: d.docId, title: d.title, kind: d.kind }, 0)}
                  >
                    <span className={'tag ' + (d.status === 'error' ? 'tag--bad' : 'tag--warn')}>
                      {d.status === 'error' ? S.library.problemError : S.library.problemScanned}
                    </span>
                    <span className="problem__text">
                      <span className="problem__title">{d.title}</span>
                      <span className="problem__path">{d.error ? d.error : d.relpath}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

function About({ st }: { st: Status }) {
  const rows: Array<[string, string]> = [
    [S.library.version, st.version],
    [S.library.mode, MODE === 'electron' || st.mode === 'electron' ? S.library.modeElectron : S.library.modeBrowser],
  ];
  if (st.electronVersion) rows.push([S.library.electron, st.electronVersion]);
  rows.push([S.library.node, st.nodeVersion]);
  rows.push([S.library.platform, st.platform + ' / ' + st.arch]);
  rows.push([S.library.roots, st.roots.join('\n')]);
  rows.push([S.library.dataDir, st.dataDir]);
  return (
    <section className="card">
      <CardHead icon={<Info size={22} />} title={S.library.aboutTitle} />
      <dl className="about">
        {rows.map(([k, v]) => (
          <div key={k} className="about__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
