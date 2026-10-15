// Light / dark (navy) theme. The setting is saved on the server (settings.json) because the app's
// port - and with it browser storage - changes on every launch. The server also stamps
// data-theme on <html>, so the first paint is already right.
import type { ThemeSetting } from '../shared/api';
import { api, INITIAL_THEME } from './api';

const EVENT = 'ls-theme-change';
let setting: ThemeSetting = INITIAL_THEME === 'light' || INITIAL_THEME === 'dark' ? INITIAL_THEME : 'system';

function systemPrefersDark(): boolean {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export function themeSetting(): ThemeSetting {
  return setting;
}

export function effectiveTheme(s: ThemeSetting = setting, prefersDark = systemPrefersDark()): 'light' | 'dark' {
  return s === 'system' ? (prefersDark ? 'dark' : 'light') : s;
}

function apply(): void {
  const root = document.documentElement;
  if (setting === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', setting);
  window.dispatchEvent(new Event(EVENT));
}

export function setTheme(next: ThemeSetting): void {
  setting = next;
  apply();
  api.saveSettings({ theme: next }).catch(() => {
    /* still applied for this session; it just won't be remembered */
  });
}

/** Calls cb whenever the effective theme may have changed (user choice or OS setting). Returns unsubscribe. */
export function onThemeChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && mq.addListener) mq.addListener(cb); // addEventListener on MediaQueryList needs Chrome 45/Firefox 55+; addListener is everywhere
  return () => {
    window.removeEventListener(EVENT, cb);
    if (mq && mq.removeListener) mq.removeListener(cb);
  };
}

/** Styles injected into same-origin reader pages we control (EPUB chapters) when the app is dark. */
export const READER_DARK_CSS =
  'html{background:#0a1930 !important;color:#e6edf8 !important}body{background:transparent !important;color:inherit !important}' +
  'a{color:#8ab5ff !important}h1,h2,h3,h4,h5,h6{color:#f1f5fb !important}' +
  'img{background:#fff;border-radius:4px}::selection{background:#fbbf24;color:#0f172a}';
