// Hash routing: every screen has a URL like #/search?q=water so the browser/Electron Back button
// works and the fallback (Firefox) mode behaves the same way.
import type { SourceGroup } from '../shared/api';

export type Filter = 'all' | SourceGroup;

export type Route =
  | { name: 'home' }
  | { name: 'search'; q: string; f: Filter; c: string }
  | { name: 'read'; u: string; t: string }
  | { name: 'browse'; folder: string }
  | { name: 'library' };

const FILTERS: Filter[] = ['all', 'books', 'reference', 'khan', 'qa'];

function asFilter(v: string | null): Filter {
  return v && (FILTERS as string[]).indexOf(v) >= 0 ? (v as Filter) : 'all';
}

/** Only same-origin absolute paths may be shown in the reader (no javascript:, no other hosts). */
export function isSafeReaderPath(u: string): boolean {
  return /^\/(content|epub|viewer|raw|catch|random|search|skin)(\/|\?|$)/.test(u) && u.indexOf('//') !== 0;
}

export function parseHash(hash: string): Route {
  let h = hash || '';
  if (h.charAt(0) === '#') h = h.slice(1);
  if (h === '' || h === '/') return { name: 'home' };
  const qi = h.indexOf('?');
  const path = qi >= 0 ? h.slice(0, qi) : h;
  const params = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
  const parts = path.split('/').filter((p) => p !== '');
  switch (parts[0]) {
    case 'search': {
      const q = (params.get('q') || '').trim();
      if (!q) return { name: 'home' };
      return { name: 'search', q, f: asFilter(params.get('f')), c: params.get('c') || '' };
    }
    case 'read': {
      const u = params.get('u') || '';
      if (!isSafeReaderPath(u)) return { name: 'home' };
      return { name: 'read', u, t: params.get('t') || '' };
    }
    case 'browse':
      return { name: 'browse', folder: parts.length > 1 ? safeDecode(parts.slice(1).join('/')) : '' };
    case 'library':
      return { name: 'library' };
    default:
      return { name: 'home' };
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'search': {
      const p = new URLSearchParams();
      p.set('q', r.q);
      if (r.f !== 'all') p.set('f', r.f);
      if (r.c) p.set('c', r.c);
      return '#/search?' + p.toString();
    }
    case 'read': {
      const p = new URLSearchParams();
      p.set('u', r.u);
      if (r.t) p.set('t', r.t);
      return '#/read?' + p.toString();
    }
    case 'browse':
      return r.folder ? '#/browse/' + encodeURIComponent(r.folder) : '#/browse';
    case 'library':
      return '#/library';
  }
}

export function navigate(r: Route, replace?: boolean): void {
  const hash = routeToHash(r);
  if (replace) {
    history.replaceState(null, '', hash);
    // replaceState doesn't fire hashchange; tell listeners ourselves.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (location.hash !== hash) {
    location.hash = hash;
  }
}
