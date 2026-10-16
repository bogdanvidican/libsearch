// Settings: how the app looks (light/dark and the dark colors), updates, and version details.
// Things about the library itself (folders, index, encyclopedias, helper programs) are on the Library page.
import { CSSProperties, useEffect, useState } from 'react';
import { BookOpenText, Check, ChevronRight, CircleCheck, Download, Info, LifeBuoy, LoaderCircle, Monitor, Moon, Palette, RefreshCw, RotateCcw, RotateCw, Sun } from 'lucide-react';
import type { Status, ThemeSetting } from '../../shared/api';
import { darkPalette, DARK_LEVEL_MAX, DARK_LEVEL_MIN, DARK_TINTS, DEFAULT_DARK_LEVEL, DEFAULT_DARK_TINT } from '../../shared/darkPalette';
import { api, ApiError, MODE } from '../api';
import { useApp } from '../context';
import { DOCS } from '../docs';
import { formatDate, megabytes, percent, updateHeadline, updateTone } from '../format';
import { navigate } from '../router';
import { S } from '../strings';
import { DarkColors, darkColors, onThemeChange, setDarkColors, setTheme, themeSetting } from '../theme';
import { CardHead } from './CardHead';
import { NoticeBox } from './NoticeBox';

export function Settings() {
  const app = useApp();
  const st = app.status;
  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">{S.settings.title}</h1>
        <p className="page__sub">{S.settings.subtitle}</p>
      </div>
      {!st && app.statusError ? <NoticeBox kind="error" title={app.statusError.message} fix={app.statusError.fix} /> : null}
      <div className="page-grid">
        <div className="page-col">
          <AppearanceCard />
        </div>
        <div className="page-col">
          <HelpCard />
          {st ? <UpdatesCard st={st} /> : null}
          {st ? <About st={st} /> : null}
        </div>
      </div>
    </div>
  );
}

/** The way into the guide, with the sections people need most when setting up. */
function HelpCard() {
  const popular = ['library', 'encyclopedias', 'trouble'];
  return (
    <section className="card">
      <CardHead icon={<LifeBuoy size={22} />} title={S.settings.helpTitle} />
      <p className="card__text">{S.settings.helpBody}</p>
      <div className="btn-row">
        <button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'docs', section: '' })}>
          <BookOpenText size={18} aria-hidden="true" />
          {S.settings.openGuide}
        </button>
      </div>
      <ul className="help-links" role="list">
        {DOCS.filter((d) => popular.indexOf(d.id) >= 0).map((d) => (
          <li key={d.id}>
            <button type="button" className="link-btn help-links__item" onClick={() => navigate({ name: 'docs', section: d.id })}>
              {d.title}
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
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
  const [dark, setDark] = useState<DarkColors>(darkColors());
  useEffect(
    () =>
      onThemeChange(() => {
        setCurrent(themeSetting());
        setDark(darkColors());
      }),
    [],
  );
  const options: Array<[ThemeSetting, string, JSX.Element]> = [
    ['system', S.theme.system, <Monitor key="s" size={18} aria-hidden="true" />],
    ['light', S.theme.light, <Sun key="l" size={18} aria-hidden="true" />],
    ['dark', S.theme.dark, <Moon key="d" size={18} aria-hidden="true" />],
  ];
  // The preview always shows the dark colors, so they can be chosen while the app is light too.
  const palette = darkPalette(dark.tint, dark.level);
  const previewVars: Record<string, string> = {};
  for (const k in palette) previewVars['--' + k] = palette[k];
  const isDefault = dark.tint === DEFAULT_DARK_TINT && dark.level === DEFAULT_DARK_LEVEL;

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

      <h3 className="card__subtitle">{S.theme.darkTitle}</h3>
      <p className="card__text">{S.theme.darkBody}</p>

      <p className="field-label" id="dark-tint-label">
        {S.theme.color}
      </p>
      <div className="swatches" role="radiogroup" aria-labelledby="dark-tint-label">
        {DARK_TINTS.map((t) => {
          const p = darkPalette(t, dark.level);
          const selected = dark.tint === t;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={selected}
              className={'swatch' + (selected ? ' is-selected' : '')}
              onClick={() => setDarkColors({ tint: t })}
            >
              <span className="swatch__chip" style={{ background: p.surface, borderColor: p.border }} aria-hidden="true">
                <span className="swatch__dot" style={{ background: p.accent }} />
                {selected ? <Check className="swatch__check" size={18} strokeWidth={3} style={{ color: p.text }} /> : null}
              </span>
              <span className="swatch__name">{S.theme.tints[t]}</span>
            </button>
          );
        })}
      </div>

      <label className="field-label" htmlFor="dark-level">
        {S.theme.darkness}
      </label>
      <div className="range">
        <span className="range__end" aria-hidden="true">
          {S.theme.softer}
        </span>
        <input
          id="dark-level"
          className="range__input"
          type="range"
          min={DARK_LEVEL_MIN}
          max={DARK_LEVEL_MAX}
          step={1}
          value={dark.level}
          aria-valuetext={S.theme.levelText(dark.level)}
          onChange={(e) => setDarkColors({ level: Number(e.target.value) })}
        />
        <span className="range__end" aria-hidden="true">
          {S.theme.darker}
        </span>
      </div>

      <p className="field-label">{S.theme.preview}</p>
      <div className="dark-preview" style={previewVars as CSSProperties} role="img" aria-label={S.theme.previewLabel(S.theme.tints[dark.tint], dark.level)}>
        <div className="dark-preview__card">
          <span className="dark-preview__tag">{S.theme.previewTag}</span>
          <p className="dark-preview__title">{S.theme.previewTitle}</p>
          <p className="dark-preview__meta">{S.theme.previewMeta}</p>
          <p className="dark-preview__text">{S.theme.previewText}</p>
          <div className="dark-preview__row">
            <span className="dark-preview__btn">{S.theme.previewOpen}</span>
            <span className="dark-preview__link">{S.theme.previewMore}</span>
          </div>
        </div>
      </div>
      {!isDefault ? (
        <div className="btn-row">
          <button type="button" className="btn btn--ghost" onClick={() => setDarkColors({ tint: DEFAULT_DARK_TINT, level: DEFAULT_DARK_LEVEL })}>
            <RotateCcw size={18} aria-hidden="true" />
            {S.theme.reset}
          </button>
        </div>
      ) : null}
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
