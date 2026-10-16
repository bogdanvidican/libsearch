// Every dark tint x level must stay readable (WCAG 2.2 AA; body text 7:1 as in docs/design.md).
import { describe, expect, it } from 'vitest';
import {
  cleanDarkLevel,
  contrast,
  darkCss,
  darkPalette,
  DARK_LEVEL_MAX,
  DARK_LEVEL_MIN,
  DARK_TINTS,
  luminance,
  readerDarkCss,
} from '../../src/shared/darkPalette';

/** [foreground, background, minimum ratio] - the pairs the stylesheet actually uses. */
const PAIRS: Array<[string, string, number]> = [
  ['text', 'bg', 7],
  ['text', 'surface', 7],
  ['text', 'surface-2', 7],
  ['text', 'surface-3', 7],
  ['text-2', 'surface', 4.5],
  ['text-2', 'surface-3', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'surface-3', 4.5],
  ['placeholder', 'surface', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  ['accent', 'accent-soft', 4.5],
  ['accent', 'accent-soft-2', 4.5],
  ['on-accent', 'accent', 4.5],
  ['on-accent', 'accent-hover', 4.5],
  ['ok', 'surface', 4.5],
  ['ok', 'ok-soft', 4.5],
  ['warn', 'warn-soft', 4.5],
  ['warn-text', 'warn-soft', 7],
  ['bad', 'surface', 4.5],
  ['bad', 'bad-soft', 4.5],
  ['text', 'ok-soft', 7],
  ['text', 'warn-soft', 7],
  ['text', 'bad-soft', 7],
  ['g-books', 'g-books-soft', 4.5],
  ['g-books-text', 'g-books-soft', 7],
  ['g-reference', 'g-reference-soft', 4.5],
  ['g-khan', 'g-khan-soft', 4.5],
  ['g-qa', 'g-qa-soft', 4.5],
  ['g-books', 'surface', 4.5],
  ['g-qa', 'surface', 4.5],
  ['toast-text', 'toast-bg', 7],
  ['code-text', 'code-bg', 7],
  ['mark-text', 'mark', 7],
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
];

describe('dark palette', () => {
  for (const tint of DARK_TINTS) {
    for (let level = DARK_LEVEL_MIN; level <= DARK_LEVEL_MAX; level++) {
      it(`${tint} ${level}: every text/background pair is readable`, () => {
        const p = darkPalette(tint, level);
        const failing = PAIRS.filter(([fg, bg, min]) => contrast(p[fg], p[bg]) < min).map(
          ([fg, bg, min]) => `${fg} on ${bg}: ${contrast(p[fg], p[bg]).toFixed(2)} < ${min}`
        );
        expect(failing).toEqual([]);
      });
    }
  }

  it('gets darker with each level, and stays dark even at the softest', () => {
    for (const tint of DARK_TINTS) {
      const bgs = [1, 2, 3, 4, 5].map((l) => luminance(darkPalette(tint, l).bg));
      for (let i = 1; i < bgs.length; i++) expect(bgs[i]).toBeLessThan(bgs[i - 1]);
      expect(bgs[0]).toBeLessThan(0.05);
    }
  });

  it('cleans bad values instead of breaking', () => {
    expect(cleanDarkLevel(0)).toBe(1);
    expect(cleanDarkLevel(9)).toBe(5);
    expect(cleanDarkLevel('x')).toBe(3);
    expect(darkPalette('nope' as never, 3)).toEqual(darkPalette('navy', 3));
  });

  it('writes CSS for the dark setting and for "Same as computer"', () => {
    const css = darkCss('warm', 2);
    expect(css).toContain(":root[data-theme='dark']{--bg:");
    expect(css).toContain("@media (prefers-color-scheme: dark){:root:not([data-theme='light']){--bg:");
    expect(css).not.toMatch(/undefined|NaN/);
    expect(readerDarkCss('forest', 5)).toContain(`background:${darkPalette('forest', 5).bg} !important`);
  });
});
