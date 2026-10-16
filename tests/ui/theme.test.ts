// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { effectiveTheme, parseDark } from '../../src/ui/theme';

describe('effectiveTheme', () => {
  it('follows the computer only when set to system', () => {
    expect(effectiveTheme('system', true)).toBe('dark');
    expect(effectiveTheme('system', false)).toBe('light');
    expect(effectiveTheme('dark', false)).toBe('dark');
    expect(effectiveTheme('light', true)).toBe('light');
  });
});

describe('dark colors from the page', () => {
  it('reads "<tint>:<level>" and falls back to navy 3', () => {
    expect(parseDark('warm:2')).toEqual({ tint: 'warm', level: 2 });
    expect(parseDark('')).toEqual({ tint: 'navy', level: 3 });
    expect(parseDark('neon:12')).toEqual({ tint: 'navy', level: 5 });
  });

  it('writes the dark tokens into <style id="ls-dark">', () => {
    const el = document.getElementById('ls-dark');
    expect(el && el.textContent).toContain(":root[data-theme='dark']{--bg:");
  });
});
