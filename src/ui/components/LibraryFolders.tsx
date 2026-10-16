import { FormEvent, useState } from 'react';
import { CircleAlert, Folder, FolderOpen, Plus, X } from 'lucide-react';
import type { Notice, Status } from '../../shared/api';
import { api, ApiError, native } from '../api';
import { useApp } from '../context';
import { navigate } from '../router';
import { S } from '../strings';
import { NoticeBox } from './NoticeBox';

/**
 * Which folders hold the library. The app can be installed anywhere; the folders are chosen here
 * (native picker in the app, a typed path in Firefox mode) and saved in settings.json.
 */
export function LibraryFolders({ st, variant }: { st: Status; variant: 'card' | 'setup' }) {
  const app = useApp();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Notice | null>(null);
  const locked = st.rootsSource === 'flag' || st.rootsSource === 'env';
  const canPick = !!(native && native.pickFolder);

  const save = async (list: string[], added?: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.saveSettings({ libraryRoots: list });
      setDraft('');
      app.refreshStatus();
      app.toast({
        kind: 'success',
        message: added ? S.folders.added(added) : S.folders.saved,
        detail: st.index.exists ? S.folders.updateHint : undefined,
      });
    } catch (e) {
      setError(
        e instanceof ApiError ? e.notice : { kind: 'error', code: 'save-failed', message: S.folders.saveFailed }
      );
    } finally {
      setBusy(false);
    }
  };

  const add = (p: string) => {
    const path = p.trim();
    if (!path) return;
    if (st.roots.indexOf(path) >= 0) return;
    void save(st.roots.concat([path]), path);
  };

  const pick = async () => {
    if (!native || !native.pickFolder) return;
    const p = await native.pickFolder();
    if (p) add(p);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    add(draft);
  };

  const list = (
    <ul className="folders" role="list">
      {st.rootInfo.map((r) => (
        <li key={r.path} className={'folder' + (r.exists ? '' : ' folder--missing')}>
          <span className="folder__icon" aria-hidden="true">
            {r.exists ? <Folder size={20} /> : <CircleAlert size={20} />}
          </span>
          <span className="folder__text">
            <span className="folder__path">{r.path}</span>
            <span className="folder__meta">{r.exists ? S.folders.contents(r.categories, r.zims) : S.folders.missing}</span>
          </span>
          {!locked ? (
            <button
              type="button"
              className="icon-btn"
              aria-label={S.folders.remove(r.path)}
              title={S.folders.remove(r.path)}
              disabled={busy}
              onClick={() => void save(st.roots.filter((x) => x !== r.path))}
            >
              <X size={18} aria-hidden="true" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );

  const controls = locked ? (
    <p className="card__text">{S.folders.locked}</p>
  ) : (
    <>
      {canPick ? (
        <div className="folders__actions">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void pick()}>
            <FolderOpen size={20} aria-hidden="true" />
            {st.roots.length ? S.folders.addAnother : S.folders.choose}
          </button>
        </div>
      ) : null}
      <form className="folders__form" onSubmit={onSubmit}>
        <label className="folders__label" htmlFor={'folder-input-' + variant}>
          {canPick ? S.folders.orType : S.folders.typeLabel}
        </label>
        <div className="folders__row">
          <input
            id={'folder-input-' + variant}
            className="input"
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder={S.folders.placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn btn--secondary" disabled={busy || !draft.trim()}>
            <Plus size={18} aria-hidden="true" />
            {S.folders.add}
          </button>
        </div>
      </form>
      {st.rootsSource === 'settings' ? (
        <button type="button" className="link-btn folders__auto" disabled={busy} onClick={() => void save([])}>
          {S.folders.useAuto}
        </button>
      ) : null}
      <button type="button" className="link-btn folders__help" onClick={() => navigate({ name: 'docs', section: 'library' })}>
        {S.folders.howTo}
      </button>
    </>
  );

  if (variant === 'setup') {
    return (
      <section className="card setup">
        <div className="setup__icon" aria-hidden="true">
          <FolderOpen size={24} />
        </div>
        <div className="setup__body">
          <h2 className="setup__title">{S.folders.setupTitle}</h2>
          <p className="setup__text">{S.folders.setupBody}</p>
          {error ? <NoticeBox kind="error" title={error.message} fix={error.fix} /> : null}
          {controls}
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card__head">
        <span className="card__icon" aria-hidden="true">
          <FolderOpen size={22} />
        </span>
        <h2 className="card__title">{S.folders.title}</h2>
      </div>
      <p className="card__text">
        {st.roots.length ? S.folders.body : S.folders.none} {S.folders.source[st.rootsSource]}
      </p>
      {st.roots.length ? list : null}
      {error ? <NoticeBox kind="error" title={error.message} fix={error.fix} /> : null}
      {controls}
    </section>
  );
}
