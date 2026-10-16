// Dark-mode colors from two choices: a tint (the hue of the dark surfaces) and a level (how dark, 1-5).
// One generator feeds the app's CSS tokens (stamped into index.html by the server, updated live by the UI),
// the Electron start-up page and EPUB chapters, so they always match.
// tests/shared/darkPalette.test.ts checks WCAG contrast for every tint x level.
// No imports: used by the server (node12), Electron main and the UI (es2017).

export type DarkTint = 'navy' | 'slate' | 'charcoal' | 'warm' | 'forest' | 'plum';

export const DARK_TINTS: DarkTint[] = ['navy', 'slate', 'charcoal', 'warm', 'forest', 'plum'];
export const DARK_LEVEL_MIN = 1;
export const DARK_LEVEL_MAX = 5;
export const DEFAULT_DARK_TINT: DarkTint = 'navy';
export const DEFAULT_DARK_LEVEL = 3;

interface TintSpec {
  /** Hue and saturation (HSL) of the dark surfaces. */
  h: number;
  s: number;
  /** Links, buttons, focus ring: hue, saturation, lightness. */
  accent: [number, number, number];
}

const TINTS: Record<DarkTint, TintSpec> = {
  navy: { h: 218, s: 68, accent: [218, 100, 72] },
  slate: { h: 215, s: 20, accent: [214, 95, 72] },
  charcoal: { h: 220, s: 4, accent: [214, 95, 72] },
  warm: { h: 30, s: 24, accent: [36, 95, 64] },
  forest: { h: 152, s: 26, accent: [166, 62, 56] },
  plum: { h: 268, s: 28, accent: [264, 100, 79] },
};

/** Lightness (HSL %) of the page background per level: 1 = softest ... 5 = almost black. */
const BG_L = [17, 12.5, 8.8, 5.6, 2.8];

export function isDarkTint(v: unknown): v is DarkTint {
  return typeof v === 'string' && DARK_TINTS.indexOf(v as DarkTint) >= 0;
}

export function cleanDarkLevel(v: unknown): number {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return DEFAULT_DARK_LEVEL;
  return Math.max(DARK_LEVEL_MIN, Math.min(DARK_LEVEL_MAX, n));
}

// ---------- color math (sRGB, WCAG 2.x relative luminance) ----------

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function toHex(c: number[]): string {
  return '#' + c.map((v) => ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2)).join('');
}

function rgbOf(hex: string): number[] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
}

export function hsl(h: number, s: number, l: number): string {
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** `t` parts of a, (1 - t) parts of b. */
export function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return toHex(x.map((v, i) => v * t + y[i] * (1 - t)));
}

function rgba(hex: string, alpha: number): string {
  const c = rgbOf(hex);
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

export function luminance(hex: string): number {
  const c = rgbOf(hex).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Lightens `color` towards white just enough to reach `ratio` against every background (as is when it already does). */
function atLeast(color: string, bg: string | string[], ratio: number): string {
  const bgs = typeof bg === 'string' ? [bg] : bg;
  const ok = (c: string) => bgs.every((b) => contrast(c, b) >= ratio);
  if (ok(color)) return color;
  for (let t = 0.04; t <= 1; t += 0.04) {
    const c = mix('#ffffff', color, t);
    if (ok(c)) return c;
  }
  return '#ffffff';
}

// ---------- the palette ----------

/** CSS custom properties (without the leading --) for the dark theme. */
export function darkPalette(tint: DarkTint, level: number): Record<string, string> {
  const t = TINTS[isDarkTint(tint) ? tint : DEFAULT_DARK_TINT];
  const L = BG_L[cleanDarkLevel(level) - 1];
  const n = (dl: number, sat = 1) => hsl(t.h, t.s * sat, L + dl);
  const ts = Math.min(56, t.s * 0.85); // text keeps a hint of the tint

  const bg = n(0);
  const surface = n(3.4);
  const surface2 = n(1.6);
  const surface3 = n(9);
  const soft = (c: string, a = 0.16) => mix(c, surface, a);
  const okSoft = soft('#4ade80');
  const warnSoft = soft('#fbbf24', 0.14);
  const badSoft = soft('#f87171');
  // The lightest backgrounds text sits on: surface-3 (chips, icon tiles) and the tinted notice boxes.
  const text = atLeast(hsl(t.h, ts, 94), [surface3, okSoft, warnSoft, badSoft], 7);
  const text2 = atLeast(hsl(t.h, ts * 0.8, 84), surface3, 4.5);
  const muted = atLeast(hsl(t.h, ts * 0.6, 71), surface3, 4.5);
  const placeholder = atLeast(hsl(t.h, ts * 0.45, 61), surface, 4.5);

  const accentBase = hsl(t.accent[0], t.accent[1], t.accent[2]);
  const accentSoft = mix(accentBase, surface, 0.13);
  const accentSoft2 = mix(accentBase, surface, 0.2);
  const accent = atLeast(accentBase, accentSoft2, 4.5);
  const accentHover = mix('#ffffff', accent, 0.2);
  const accentPress = mix('#ffffff', accent, 0.38);
  const onAccent = hsl(t.accent[0], 70, 9);

  const ok = atLeast('#4ade80', okSoft, 4.5);
  const warn = atLeast('#fbbf24', warnSoft, 4.5);
  const bad = atLeast('#f87171', badSoft, 4.5);

  const gBooksSoft = soft('#f0a64b');
  const gReferenceSoft = soft('#7aa7ff', 0.13);
  const gKhanSoft = soft('#4ade80');
  const gQaSoft = soft('#b794ff');

  const toastBg = hsl(t.h, t.s * 0.85, Math.min(L + 15, 26)); // lighter than the page, never washed out

  return {
    bg,
    surface,
    'surface-2': surface2,
    'surface-3': surface3,
    border: n(15, 0.9),
    'border-strong': n(25, 0.8),
    text,
    'text-2': text2,
    muted,
    accent,
    'accent-hover': accentHover,
    'accent-press': accentPress,
    'accent-soft': accentSoft,
    'accent-soft-2': accentSoft2,
    focus: accentHover,
    ok,
    'ok-soft': okSoft,
    warn,
    'warn-soft': warnSoft,
    bad,
    'bad-soft': badSoft,
    mark: '#fde68a',

    'g-books': atLeast('#f0a64b', gBooksSoft, 4.5),
    'g-books-soft': gBooksSoft,
    'g-reference': atLeast('#7aa7ff', gReferenceSoft, 4.5),
    'g-reference-soft': gReferenceSoft,
    'g-khan': atLeast('#4ade80', gKhanSoft, 4.5),
    'g-khan-soft': gKhanSoft,
    'g-qa': atLeast('#b794ff', gQaSoft, 4.5),
    'g-qa-soft': gQaSoft,

    'mark-text': '#0f172a',
    'on-accent': onAccent,
    inverse: text,
    'on-inverse': bg,
    'inverse-soft': rgba(bg, 0.14),
    placeholder,
    'focus-glow': rgba(accent, 0.28),
    'setup-top': n(6),
    'ok-border': mix(ok, surface, 0.38),
    'warn-border': mix(warn, surface, 0.38),
    'warn-text': atLeast('#fcd34d', warnSoft, 7),
    'bad-border': mix(bad, surface, 0.38),
    'filters-bg': rgba(bg, 0.96),
    'hover-border': n(33, 0.75),
    'g-books-text': atLeast('#f6c27e', gBooksSoft, 7),
    skeleton: n(7.5),
    'frame-bg': '#ffffff',
    track: accentSoft2,
    'code-bg': n(-3),
    'code-text': text,
    'dot-warn': warn,
    'toast-bg': toastBg,
    'toast-text': '#f8fafc',
    'toast-shadow': 'rgba(0, 0, 0, 0.5)',
    'shadow-1': '0 1px 2px rgba(0, 0, 0, 0.4), 0 1px 1px rgba(0, 0, 0, 0.3)',
    'shadow-2': '0 6px 18px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4)',
  };
}

/**
 * The dark theme as CSS: for <html data-theme="dark"> and for "Same as computer" when the computer is dark.
 * Goes after app.css (same selectors, so it wins).
 */
export function darkCss(tint: DarkTint, level: number): string {
  const p = darkPalette(tint, level);
  const vars = Object.keys(p)
    .map((k) => `--${k}:${p[k]};`)
    .join('') + 'color-scheme:dark;';
  const page = `background:${p.bg};color:${p.text}`;
  return (
    `:root[data-theme='dark']{${vars}}` +
    `html[data-theme=dark],html[data-theme=dark] body{${page}}` +
    `@media (prefers-color-scheme: dark){:root:not([data-theme='light']){${vars}}` +
    `html:not([data-theme=light]),html:not([data-theme=light]) body{${page}}}`
  );
}

/** Styles injected into EPUB chapters (same-origin pages we control) when the app is dark. */
export function readerDarkCss(tint: DarkTint, level: number): string {
  const p = darkPalette(tint, level);
  return (
    `html{background:${p.bg} !important;color:${p.text} !important}body{background:transparent !important;color:inherit !important}` +
    `a{color:${p['accent-hover']} !important}h1,h2,h3,h4,h5,h6{color:${p.text} !important}` +
    'img{background:#fff;border-radius:4px}::selection{background:#fbbf24;color:#0f172a}'
  );
}
