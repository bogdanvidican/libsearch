// @vitest-environment jsdom
// Library -> Get books: the topics, the download progress, failures with Open in Firefox / Mark as done.
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BooksOverview, DownloadProgress, Status } from '../../src/shared/api';
import { api } from '../../src/ui/api';
import { AppContext, AppCtx } from '../../src/ui/context';
import { GetBooks } from '../../src/ui/components/GetBooks';
import { parseHash, routeToHash } from '../../src/ui/router';
import { S } from '../../src/ui/strings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function progress(p: Partial<DownloadProgress> = {}): DownloadProgress {
  return { running: false, phase: 'idle', done: 0, total: 0, currentFile: '', fileReceived: 0, fileTotal: 0, bytes: 0, speed: 0, downloaded: 0, skipped: 0, failed: 0, ...p };
}

function overview(o: Partial<BooksOverview> = {}): BooksOverview {
  return {
    destination: '/home/me/Library',
    topics: [
      { folder: '01 Medicine', label: 'Medicine', listed: 10, present: 8, failed: 1, bytes: 50e6 },
      { folder: '02 Water & Sanitation', label: 'Water & Sanitation', listed: 4, present: 3, failed: 0, bytes: 9e6 },
    ],
    missing: 3,
    failures: [
      { id: '01 Medicine|Field_Manual.pdf', folder: '01 Medicine', file: 'Field_Manual.pdf', url: 'https://example.org/fm.pdf', code: 'http-403', reason: 'The site refused the download (403).', at: 1 },
    ],
    lists: [{ name: 'booklist-main.txt', source: 'app', entries: 14 }],
    freeBytes: 20e9,
    ...o,
  };
}

function ctxWith(books: DownloadProgress, extra: Partial<AppCtx> = {}): AppCtx {
  const status = { downloads: { books, zims: progress() }, roots: ['/home/me/Library'] } as unknown as Status;
  return {
    status,
    statusError: null,
    refreshStatus: vi.fn(),
    toast: vi.fn(),
    startBuild: vi.fn(),
    ...extra,
  } as unknown as AppCtx;
}

async function show(ctx: AppCtx, data: BooksOverview): Promise<{ el: HTMLElement; done: () => void }> {
  vi.spyOn(api, 'books').mockResolvedValue(data);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <AppContext.Provider value={ctx}>
        <GetBooks tab="lists" />
      </AppContext.Provider>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return {
    el,
    done: () => {
      act(() => root.unmount());
      el.remove();
    },
  };
}

function button(el: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').indexOf(label) >= 0);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Get books page', () => {
  it('shows the topics with their counts and the missing total', async () => {
    const { el, done } = await show(ctxWith(progress()), overview());
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((r) => Array.from(r.querySelectorAll('th,td')).map((c) => c.textContent));
    expect(rows).toEqual([
      ['Medicine', '10', '8', '2', '1'],
      ['Water & Sanitation', '4', '3', '1', '0'],
    ]);
    expect(button(el, S.books.download(3))).toBeTruthy();
    expect(el.textContent).toContain('/home/me/Library');
    expect(el.textContent).toContain(S.books.needsInternet);
    done();
  });

  it('shows progress with Stop while downloading', async () => {
    const cancel = vi.spyOn(api, 'booksCancel').mockResolvedValue(progress());
    const running = progress({ running: true, phase: 'downloading', done: 2, total: 5, currentFile: '01 Medicine/Big.pdf', fileReceived: 2 * 1048576, fileTotal: 4 * 1048576, speed: 300 * 1024 });
    const { el, done } = await show(ctxWith(running), overview());
    expect(el.textContent).toContain(S.books.file('01 Medicine/Big.pdf'));
    expect(el.textContent).toContain(S.books.progress(2, 5));
    expect(el.querySelector('[role="progressbar"]')).toBeTruthy();
    expect(button(el, S.books.download(3))).toBeUndefined();
    await act(async () => {
      button(el, S.books.stop)!.click();
    });
    expect(cancel).toHaveBeenCalled();
    done();
  });

  it('offers Update index after books were downloaded', async () => {
    const ctx = ctxWith(progress({ phase: 'done', downloaded: 2, skipped: 10, failed: 1, finishedAt: 5 }));
    const { el, done } = await show(ctx, overview());
    expect(el.textContent).toContain(S.books.finished(2, 10, 1));
    await act(async () => {
      button(el, S.library.update)!.click();
    });
    expect(ctx.startBuild).toHaveBeenCalledWith(false);
    done();
  });

  it('lists failures with Open in Firefox and Mark as done', async () => {
    const open = vi.spyOn(api, 'openUrl').mockResolvedValue({ ok: true, how: 'firefox' });
    const mark = vi.spyOn(api, 'booksDone').mockResolvedValue(overview({ failures: [], missing: 2 }));
    const { el, done } = await show(ctxWith(progress()), overview());
    expect(el.textContent).toContain('Field_Manual.pdf');
    expect(el.textContent).toContain('The site refused the download (403).');
    expect(el.textContent).toContain(S.books.saveInto('01 Medicine'));
    await act(async () => {
      button(el, S.books.openInFirefox)!.click();
    });
    expect(open).toHaveBeenCalledWith('https://example.org/fm.pdf');
    await act(async () => {
      button(el, S.books.markDone)!.click();
    });
    expect(mark).toHaveBeenCalledWith('01 Medicine|Field_Manual.pdf', true);
    done();
  });

  it("shows the problem instead of the button when the library folder can't be used", async () => {
    const problem = { kind: 'error' as const, code: 'library-inside-app', message: 'The folder is inside the app.', fix: 'Choose another one.' };
    const { el, done } = await show(ctxWith(progress()), overview({ destination: null, problem }));
    expect(el.textContent).toContain('The folder is inside the app.');
    expect(button(el, S.books.download(3))).toBeUndefined();
    done();
  });
});

describe('Get books addresses', () => {
  it('has one per tab', () => {
    expect(parseHash('#/books')).toEqual({ name: 'books', tab: 'lists' });
    expect(parseHash('#/books/manual')).toEqual({ name: 'books', tab: 'manual' });
    expect(parseHash('#/books/encyclopedias')).toEqual({ name: 'books', tab: 'zims' });
    for (const tab of ['lists', 'manual', 'zims'] as const) expect(parseHash(routeToHash({ name: 'books', tab }))).toEqual({ name: 'books', tab });
  });
});
