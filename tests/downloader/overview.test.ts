// Get books overview: what the lists hold, what the library has, what failed - from the disk alone (works offline).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { booksOverview, ListRef, markDone } from '../../src/downloader/overview';
import { updateState } from '../../src/downloader/state';
import { isInside } from '../../src/server/config';

let tmp: string;
let n = 0;

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-overview-')));
});

afterAll(() => {
  try {
    fs.chmodSync(path.join(tmp, 'ro'), 0o755);
  } catch (e) {
    // not created
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function setup(lines: string[]): { root: string; root2: string; lists: ListRef[]; appHome: string } {
  const dir = path.join(tmp, `c${++n}`);
  const root = path.join(dir, 'Library & Co');
  const root2 = path.join(dir, 'USB Library');
  const appHome = path.join(dir, 'library-search');
  for (const d of [root, root2, appHome]) fs.mkdirSync(d, { recursive: true });
  const list = path.join(dir, 'booklist-main.txt');
  fs.writeFileSync(list, lines.join('\n') + '\n');
  return { root, root2, lists: [{ name: 'booklist-main.txt', path: list, source: 'app' }], appHome };
}

function put(root: string, rel: string, body = '%PDF-1.4 book') {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

describe('booksOverview', () => {
  it('counts listed, present, missing and failed books per topic, across library folders', () => {
    const s = setup([
      'F|01 Medicine|A.pdf|https://ex.invalid/a.pdf',
      'F|01 Medicine/Sub|B.pdf|https://ex.invalid/b.pdf',
      'F|02 Water & Sanitation|C.pdf|https://ex.invalid/c.pdf',
    ]);
    put(s.root, '01 Medicine/A.pdf');
    put(s.root2, '02 Water & Sanitation/C.pdf', '%PDF-1.4 a bigger book');
    updateState(s.root, (st) => {
      st.books.failures.push({ id: '01 Medicine/Sub|B.pdf', folder: '01 Medicine/Sub', file: 'B.pdf', url: 'https://ex.invalid/b.pdf', code: 'http-403', reason: 'refused', at: 1 });
    });
    const o = booksOverview({ lists: s.lists, roots: [s.root, s.root2], appHome: s.appHome });
    expect(o.destination).toBe(s.root);
    expect(o.problem).toBeUndefined();
    expect(o.topics.map((t) => [t.folder, t.label, t.listed, t.present, t.failed])).toEqual([
      ['01 Medicine', 'Medicine', 2, 1, 1],
      ['02 Water & Sanitation', 'Water & Sanitation', 1, 1, 0],
    ]);
    expect(o.topics[1].bytes).toBe('%PDF-1.4 a bigger book'.length);
    expect(o.missing).toBe(1);
    expect(o.failures.map((f) => f.file)).toEqual(['B.pdf']);
    expect(o.lists).toEqual([{ name: 'booklist-main.txt', source: 'app', entries: 3 }]);
  });

  it('counts a page or archive item by the files it produced once known', () => {
    const s = setup(['S|05 Survival|https://ex.invalid/page.html|href="[^"]*\\.pdf"']);
    const count = () => {
      const t = booksOverview({ lists: s.lists, roots: [s.root], appHome: s.appHome }).topics[0];
      return [t.listed, t.present];
    };
    expect(count()).toEqual([1, 0]);
    put(s.root, '05 Survival/x.pdf');
    expect(count()).toEqual([1, 1]);
    updateState(s.root, (st) => {
      st.books.collections['S|05 Survival|https://ex.invalid/page.html'] = ['05 Survival/x.pdf', '05 Survival/y.pdf'];
    });
    expect(count()).toEqual([2, 1]);
  });

  it('a book marked done counts as present and leaves the failure list', () => {
    const s = setup(['F|01 Medicine|B.pdf|https://ex.invalid/b.pdf']);
    updateState(s.root, (st) => {
      st.books.failures.push({ id: '01 Medicine|B.pdf', folder: '01 Medicine', file: 'B.pdf', url: 'https://ex.invalid/b.pdf', code: 'http-403', reason: 'refused', at: 1 });
    });
    markDone(s.root, '01 Medicine|B.pdf', true);
    let o = booksOverview({ lists: s.lists, roots: [s.root], appHome: s.appHome });
    expect([o.topics[0].present, o.missing, o.failures.length]).toEqual([1, 0, 0]);
    markDone(s.root, '01 Medicine|B.pdf', false);
    o = booksOverview({ lists: s.lists, roots: [s.root], appHome: s.appHome });
    expect([o.topics[0].present, o.missing, o.failures.length]).toEqual([0, 1, 1]);
  });

  it("explains why downloads can't go to a missing, read-only or in-app folder", () => {
    const s = setup(['F|01 Medicine|A.pdf|https://ex.invalid/a.pdf']);
    const problem = (roots: string[]) => {
      const o = booksOverview({ lists: s.lists, roots, appHome: s.appHome });
      return [o.destination, o.problem && o.problem.code];
    };
    expect(problem([])).toEqual([null, 'no-library']);
    expect(problem([path.join(tmp, 'unplugged')])).toEqual([null, 'library-missing']);
    const inApp = path.join(s.appHome, 'books');
    fs.mkdirSync(inApp);
    expect(problem([inApp])).toEqual([null, 'library-inside-app']);
    if (process.getuid && process.getuid() !== 0) {
      const ro = path.join(tmp, 'ro');
      fs.mkdirSync(ro);
      fs.chmodSync(ro, 0o555);
      expect(problem([ro])).toEqual([null, 'library-read-only']);
    }
    // The topics still show what the other folders hold.
    expect(booksOverview({ lists: s.lists, roots: [inApp], appHome: s.appHome }).topics[0].listed).toBe(1);
  });

  it('works offline: only the disk and the notes file are read', () => {
    const s = setup(Array.from({ length: 300 }, (_v, i) => `F|01 Medicine|B${i}.pdf|https://unreachable.invalid/b${i}.pdf`));
    const t0 = Date.now();
    const o = booksOverview({ lists: s.lists, roots: [s.root], appHome: s.appHome });
    expect(o.missing).toBe(300);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('isInside', () => {
  it('tells a folder inside another apart from a neighbour with a similar name', () => {
    const p = path.join(tmp, 'inside');
    fs.mkdirSync(path.join(p, 'app', 'books'), { recursive: true });
    fs.mkdirSync(path.join(p, 'app-books'), { recursive: true });
    expect(isInside(path.join(p, 'app', 'books'), path.join(p, 'app'))).toBe(true);
    expect(isInside(path.join(p, 'app'), path.join(p, 'app'))).toBe(true);
    expect(isInside(path.join(p, 'app-books'), path.join(p, 'app'))).toBe(false);
    expect(isInside(p, path.join(p, 'app'))).toBe(false);
  });
});
