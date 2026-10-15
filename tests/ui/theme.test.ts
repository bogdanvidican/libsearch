// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { effectiveTheme } from '../../src/ui/theme';

describe('effectiveTheme', () => {
  it('follows the computer only when set to system', () => {
    expect(effectiveTheme('system', true)).toBe('dark');
    expect(effectiveTheme('system', false)).toBe('light');
    expect(effectiveTheme('dark', false)).toBe('dark');
    expect(effectiveTheme('light', true)).toBe('light');
  });
});
