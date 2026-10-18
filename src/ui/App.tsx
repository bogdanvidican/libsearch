import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api, ApiError, MODE } from './api';
import { AppContext, AppCtx, OpenTarget, ToastInput } from './context';
import { useCategories, useKiwixBooks, useRoute, useStatus } from './hooks';
import { navigate, Route } from './router';
import { S } from './strings';
import { Browse } from './components/Browse';
import { GetBooks } from './components/GetBooks';
import { Header } from './components/Header';
import { Home } from './components/Home';
import { Library } from './components/Library';
import { NoticeBox } from './components/NoticeBox';
import { Reader } from './components/Reader';
import { Results } from './components/Results';
import { Settings } from './components/Settings';
import { Docs, findDoc } from './components/Docs';
import { SEARCH_INPUT_ID } from './components/SearchBox';
import { StatusBar } from './components/StatusBar';
import { ToastItem, Toasts } from './components/Toast';

let toastSeq = 0;

function errorToast(e: unknown): ToastInput {
  if (e instanceof ApiError) return { kind: 'error', message: e.notice.message, fix: e.notice.fix };
  return { kind: 'error', message: S.errors.generic };
}

function titleFor(route: Route): string {
  switch (route.name) {
    case 'search':
      return route.q + ' — ' + S.appName;
    case 'read':
      return (route.t || S.reader.loading) + ' — ' + S.appName;
    case 'browse':
      return S.nav.browse + ' — ' + S.appName;
    case 'library':
      return S.nav.library + ' — ' + S.appName;
    case 'books':
      return S.books.title + ' — ' + S.appName;
    case 'settings':
      return S.nav.settings + ' — ' + S.appName;
    case 'docs':
      return findDoc(route.section).title + ' — ' + S.docs.title + ' — ' + S.appName;
    default:
      return S.appName;
  }
}

export function App() {
  const route = useRoute();
  const { status, error: statusError, refresh } = useStatus();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [kiwixStarting, setKiwixStarting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const updateToastShown = useRef(false);
  const lastResults = useRef('');
  const lastQuery = useRef('');
  const getResultsHash = useCallback(() => lastResults.current, []);

  useEffect(() => {
    if (route.name === 'search') {
      lastResults.current = location.hash;
      lastQuery.current = route.q;
    }
    document.title = titleFor(route);
  }, [route]);

  // Reload categories when the index changes; while building, only every ~25 books.
  const ix = status ? status.index : null;
  const catsKey = !ix
    ? 'none'
    : ix.build.running
      ? 'b' + Math.floor(ix.docs / 25)
      : ix.docs + ':' + (ix.lastBuiltAt || 0);
  const categories = useCategories(catsKey);
  const kiwixBooks = useKiwixBooks(!!status && status.kiwix.state === 'running', status ? status.kiwix.books : 0);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: ToastInput) => {
      const id = ++toastSeq;
      setToasts((ts) => ts.slice(-2).concat([{ ...t, id }]));
      if (t.kind !== 'error') window.setTimeout(() => dismiss(id), t.kind === 'info' ? 7000 : 5000);
      return id;
    },
    [dismiss],
  );

  const openReader = useCallback((url: string, title: string) => navigate({ name: 'read', u: url, t: title }), []);

  const openBook = useCallback(
    (doc: OpenTarget, page: number, terms?: string[]) => {
      const opening =
        doc.kind === 'pdf'
          ? toast({ kind: 'info', message: S.open.opening(doc.title, page), detail: S.open.openingHint })
          : 0;
      api.open({ docId: doc.docId, page: page > 0 ? page : undefined, q: terms && terms.length ? terms.join(' ') : undefined }).then(
        (res) => {
          if (!res.ok) {
            if (opening) dismiss(opening);
            const n = res.error;
            toast({ kind: 'error', message: n ? n.message : S.open.failed, fix: n ? n.fix : undefined });
          } else if (res.how === 'reader' && res.readerUrl) {
            if (opening) dismiss(opening);
            openReader(res.readerUrl, doc.title);
          }
        },
        (e) => {
          if (opening) dismiss(opening);
          toast(errorToast(e));
        },
      );
    },
    [toast, dismiss, openReader],
  );

  const startBuild = useCallback(
    (full: boolean) => {
      api.buildIndex(full).then(refresh, (e) => toast(errorToast(e)));
    },
    [refresh, toast],
  );
  const cancelBuild = useCallback(() => {
    api.cancelIndex().then(refresh, (e) => toast(errorToast(e)));
  }, [refresh, toast]);
  const startKiwix = useCallback(() => {
    setKiwixStarting(true);
    api
      .kiwixRestart()
      .then(
        (k) => {
          if (k.state !== 'running' && k.state !== 'starting' && k.message) toast({ kind: 'error', message: k.message });
          else if (k.state === 'running' && k.skipped && k.skipped.length) {
            toast({ kind: 'warning', message: S.kiwix.skippedToast(k.skipped.length), detail: S.kiwix.skippedToastDetail });
          }
        },
        (e) => toast(errorToast(e)),
      )
      .then(() => {
        setKiwixStarting(false);
        refresh();
      });
  }, [refresh, toast]);

  const installUpdate = useCallback(() => {
    setRestarting(true);
    api.updateInstall().then(
      (u) => {
        if (u.state !== 'installing') {
          setRestarting(false);
          toast({ kind: 'error', message: u.error ? u.error.message : S.updates.restartFailed, fix: u.error ? u.error.fix : undefined });
          refresh();
        }
      },
      (e) => {
        setRestarting(false);
        toast(errorToast(e));
      },
    );
  }, [refresh, toast]);

  // First start after an update: say so once.
  useEffect(() => {
    if (status && status.update && status.update.updatedFrom && !updateToastShown.current) {
      updateToastShown.current = true;
      toast({ kind: 'success', message: S.updates.updatedToast(status.update.current) });
    }
  }, [status, toast]);

  const ctx: AppCtx = useMemo(
    () => ({
      status,
      statusError,
      refreshStatus: refresh,
      kiwixBooks,
      categories,
      toast,
      openBook,
      openReader,
      lastResultsHash: getResultsHash,
      startBuild,
      cancelBuild,
      startKiwix,
      kiwixStarting,
      installUpdate,
    }),
    [status, statusError, refresh, kiwixBooks, categories, toast, openBook, openReader, getResultsHash, startBuild, cancelBuild, startKiwix, kiwixStarting, installUpdate],
  );

  const onSearch = useCallback(
    (q: string) =>
      navigate({
        name: 'search',
        q,
        f: route.name === 'search' ? route.f : 'all',
        c: route.name === 'search' ? route.c : '',
      }),
    [route],
  );

  useKeyboard(route, getResultsHash);

  const libraryAlert =
    !!status && ((!status.index.exists && !status.index.build.running) || !status.tools.pdftotext || status.notices.some((n) => n.kind === 'error'));

  const updateState = status && status.update ? status.update.state : '';
  const settingsAlert = updateState === 'ready' || updateState === 'error';

  let screen: JSX.Element;
  switch (route.name) {
    case 'search':
      screen = <Results q={route.q} f={route.f} c={route.c} />;
      break;
    case 'read':
      screen = <Reader url={route.u} title={route.t} findHint={lastQuery.current} />;
      break;
    case 'browse':
      screen = <Browse folder={route.folder} />;
      break;
    case 'library':
      screen = <Library />;
      break;
    case 'books':
      screen = <GetBooks tab={route.tab} />;
      break;
    case 'settings':
      screen = <Settings />;
      break;
    case 'docs':
      screen = <Docs section={route.section} />;
      break;
    default:
      screen = <Home onSearch={onSearch} />;
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); if (m) m.focus(); }}>
          {S.skipToContent}
        </a>
        <Header route={route} onSearch={onSearch} libraryAlert={libraryAlert} settingsAlert={settingsAlert} lastQuery={lastQuery.current} />
        <main id="main" className={'main main--' + route.name} tabIndex={-1}>
          {statusError && status && !restarting ? (
            <div className="main__banner">
              <NoticeBox kind="error" compact title={S.status.offline} fix={S.status.offlineFix} />
            </div>
          ) : null}
          {screen}
        </main>
        <StatusBar status={status} error={statusError} />
        <Toasts items={toasts} onDismiss={dismiss} />
        {restarting ? (
          <div className="restart" role="alertdialog" aria-modal="true" aria-labelledby="restart-title" aria-describedby="restart-body">
            <div className="restart__card">
              <LoaderCircle className="spin restart__icon" size={36} aria-hidden="true" />
              <h2 id="restart-title" className="restart__title">
                {S.updates.restartTitle}
              </h2>
              <p id="restart-body" className="restart__body">
                {MODE === 'browser' ? S.updates.restartBodyBrowser : S.updates.restartBody}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </AppContext.Provider>
  );
}

/** "/" focuses search, ↑/↓ move between results, Esc leaves the reader. */
function useKeyboard(route: Route, resultsHash: () => string) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t ? t.tagName : '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (!!t && t.isContentEditable);
      const search = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;

      if (e.key === '/' && !typing) {
        if (search) {
          e.preventDefault();
          search.focus();
          search.select();
        }
        return;
      }
      if (e.key === 'Escape' && route.name === 'read' && !typing) {
        e.preventDefault();
        const h = resultsHash();
        if (h) location.hash = h;
        else history.back();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const fromSearch = !!t && t.id === SEARCH_INPUT_ID;
        if (typing && !(fromSearch && e.key === 'ArrowDown')) return;
        const items = Array.prototype.slice.call(document.querySelectorAll('[data-nav]')) as HTMLElement[];
        if (items.length === 0) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (i < 0 && !fromSearch) return; // let the page scroll normally
        let next = i < 0 ? 0 : e.key === 'ArrowDown' ? i + 1 : i - 1;
        e.preventDefault();
        if (next < 0) {
          if (search) search.focus();
          return;
        }
        if (next >= items.length) next = items.length - 1;
        items[next].focus();
        items[next].scrollIntoView({ block: 'nearest' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [route, resultsHash]);
}
