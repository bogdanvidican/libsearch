// User settings stored next to the index (<data dir>/settings.json).
import * as fs from 'fs';
import * as path from 'path';
import { Settings, ThemeSetting } from '../shared/api';

const DEFAULTS: Settings = { theme: 'system', libraryRoots: [] };
const THEMES: ThemeSetting[] = ['system', 'light', 'dark'];

export function settingsFile(dataDir: string): string {
  return path.join(dataDir, 'settings.json');
}

export function loadSettings(dataDir: string): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(dataDir), 'utf8')) as Partial<Settings>;
    return {
      theme: THEMES.indexOf(raw.theme as ThemeSetting) >= 0 ? (raw.theme as ThemeSetting) : DEFAULTS.theme,
      libraryRoots: cleanRoots(raw.libraryRoots),
    };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function cleanRoots(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const r of v) if (typeof r === 'string' && r.trim() && out.indexOf(r.trim()) < 0) out.push(r.trim());
  return out.slice(0, 10);
}

/** Merges valid fields from `patch` and writes the file atomically. */
export function saveSettings(dataDir: string, patch: Partial<Settings>): Settings {
  const next = loadSettings(dataDir);
  if (patch.theme && THEMES.indexOf(patch.theme) >= 0) next.theme = patch.theme;
  if (patch.libraryRoots !== undefined) next.libraryRoots = cleanRoots(patch.libraryRoots);
  fs.mkdirSync(dataDir, { recursive: true });
  const file = settingsFile(dataDir);
  fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
  return next;
}
