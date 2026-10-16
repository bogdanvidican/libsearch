// Light / dark theme, and the dark mode's colors (a tint + how dark, see src/shared/darkPalette.ts).
// Saved on the server (settings.json) because the app's port - and with it browser storage - changes on every
// launch. The server also stamps data-theme and the dark colors into index.html, so the first paint is right.
import type { ThemeSetting } from '../shared/api';
import { cleanDarkLevel, darkCss, DarkTint, DEFAULT_DARK_LEVEL, DEFAULT_DARK_TINT, isDarkTint, readerDarkCss } from '../shared/darkPalette';
import { api, INITIAL_DARK, INITIAL_THEME } from './api';

const EVENT = 'ls-theme-change';
let setting: ThemeSetting = INITIAL_THEME === 'light' || INITIAL_THEME === 'dark' ? INITIAL_THEME : 'system';

export interface DarkColors {
  tint: DarkTint;
  level: number;
}

/** "warm:2" from <meta name="ls-dark">. */
export function parseDark(v: string): DarkColors {
  const parts = (v || '').split(':');
  return { tint: isDarkTint(parts[0]) ? parts[0] : DEFAULT_DARK_TINT, level: parts[1] ? cleanDarkLevel(parts[1]) : DEFAULT_DARK_LEVEL };
}

let dark: DarkColors = parseDark(INITIAL_DARK);

function systemPrefersDark(): boolean {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export function themeSetting(): ThemeSetting {
  return setting;
}

export function darkColors(): DarkColors {
  return dark;
}

export function effectiveTheme(s: ThemeSetting = setting, prefersDark = systemPrefersDark()): 'light' | 'dark' {
  return s === 'system' ? (prefersDark ? 'dark' : 'light') : s;
}

function changed(): void {
  window.dispatchEvent(new Event(EVENT));
}

function apply(): void {
  const root = document.documentElement;
  if (setting === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', setting);
  changed();
}

/** Writes the dark tokens into <style id="ls-dark"> (the server's copy, or a new one when there is none). */
function applyDark(): void {
  let el = document.getElementById('ls-dark');
  if (!el) {
    el = document.createElement('style');
    el.id = 'ls-dark';
    document.head.appendChild(el); // after app.css, so these win
  }
  el.textContent = darkCss(dark.tint, dark.level);
}

export function setTheme(next: ThemeSetting): void {
  setting = next;
  apply();
  api.saveSettings({ theme: next }).catch(() => {
    /* still applied for this session; it just won't be remembered */
  });
}

let saveTimer = 0;

/** New dark colors: shown at once, saved a moment later (the darkness slider fires on every step). */
export function setDarkColors(next: Partial<DarkColors>): void {
  dark = {
    tint: next.tint && isDarkTint(next.tint) ? next.tint : dark.tint,
    level: next.level !== undefined ? cleanDarkLevel(next.level) : dark.level,
  };
  applyDark();
  changed();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    api.saveSettings({ darkTint: dark.tint, darkLevel: dark.level }).catch(() => {
      /* applied for this session */
    });
  }, 400);
}

/** Calls cb whenever the effective theme or the dark colors may have changed. Returns unsubscribe. */
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
export function readerDarkStyles(): string {
  return readerDarkCss(dark.tint, dark.level);
}

if (typeof document !== 'undefined') applyDark();
