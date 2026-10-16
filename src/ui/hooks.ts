import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookSearchResponse, Category, KiwixBook, Notice, Status } from '../shared/api';
import { api, ApiError, isAbort, newAbortController } from './api';
import { applyBookResult, initKiwixResults, KiwixResults } from './kiwix';
import { parseHash, Route } from './router';
import { S } from './strings';

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

function toNotice(e: unknown): Notice {
  if (e instanceof ApiError) return e.notice;
  return { kind: 'error', code: 'unknown', message: S.errors.generic };
}

/** Polls /api/status: every second while something is changing, otherwise every 5 s. */
export function useStatus(): { status: Status | null; error: Notice | null; refresh: () => void } {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<Notice | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const run = async () => {
      try {
        const s = await api.status();
        if (!alive) return;
        setStatus(s);
        setError(null);
        const u = s.update ? s.update.state : '';
        const busy = s.index.build.running || s.kiwix.state === 'starting' || u === 'checking' || u === 'downloading';
        timer = window.setTimeout(run, busy ? 1000 : 5000);
      } catch (e) {
        if (!alive) return;
        setError(toNotice(e));
        timer = window.setTimeout(run, 3000);
      }
    };
    run();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [tick]);
  return { status, error, refresh };
}

/** Generic "load once per key" helper. */
export function useLoad<T>(key: string | null, load: () => Promise<T>): { data: T | null; error: Notice | null; loading: boolean } {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: Notice | null; loading: boolean }>({
    key: null,
    data: null,
    error: null,
    loading: key !== null,
  });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (key === null) {
      setState({ key, data: null, error: null, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ key, data: s.key === key ? s.data : s.data, error: null, loading: true }));
    loadRef.current().then(
      (data) => alive && setState({ key, data, error: null, loading: false }),
      (e) => alive && setState({ key, data: null, error: toNotice(e), loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [key]);
  return { data: state.data, error: state.error, loading: state.loading };
}

export function useCategories(reloadKey: string): Category[] {
  const { data } = useLoad<Category[]>('cats:' + reloadKey, () => api.browse());
  return data || [];
}

/** Kiwix book list, fetched when the server reports kiwix running (and again if that changes). */
export function useKiwixBooks(kiwixRunning: boolean, booksCount: number): KiwixBook[] {
  const { data } = useLoad<KiwixBook[]>(kiwixRunning ? 'kb:' + booksCount : null, () => api.kiwixBooks());
  return kiwixRunning && data ? data : [];
}

export interface BookSearchState {
  data: BookSearchResponse | null;
  loading: boolean;
  error: Notice | null;
}

export function useBookSearch(q: string, category: string, reloadKey: string): BookSearchState {
  const [state, setState] = useState<BookSearchState>({ data: null, loading: !!q, error: null });
  useEffect(() => {
    if (!q) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let alive = true;
    const ctrl = newAbortController();
    setState((s) => ({ data: s.data && s.data.query === q ? s.data : null, loading: true, error: null }));
    api.search(q, category, 30, ctrl && ctrl.signal).then(
      (data) => alive && setState({ data, loading: false, error: null }),
      (e) => {
        if (!alive || isAbort(e)) return;
        setState({ data: null, loading: false, error: toNotice(e) });
      },
    );
    return () => {
      alive = false;
      if (ctrl) ctrl.abort();
    };
  }, [q, category, reloadKey]);
  return state;
}

/** Fires one request per Kiwix book in parallel and merges answers as they arrive. */
export function useKiwixSearch(q: string, books: KiwixBook[]): KiwixResults | null {
  const [state, setState] = useState<KiwixResults | null>(null);
  const booksKey = books.map((b) => b.name).join('|');
  useEffect(() => {
    if (!q || books.length === 0) {
      setState(null);
      return;
    }
    let alive = true;
    const ctrl = newAbortController();
    setState(initKiwixResults(books));
    for (const book of books) {
      api.kiwixSearch(book.name, q, 5, ctrl && ctrl.signal).then(
        (resp) => alive && setState((s) => (s ? applyBookResult(s, book, resp) : s)),
        (e) => {
          if (!alive || isAbort(e)) return;
          setState((s) => (s ? applyBookResult(s, book, null) : s));
        },
      );
    }
    return () => {
      alive = false;
      if (ctrl) ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, booksKey]);
  return state;
}
