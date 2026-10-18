// @vitest-environment jsdom
// The in-app guide: well formed, its links lead somewhere, and the button names it quotes are the app's real ones.
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { AppContext, AppCtx } from '../../src/ui/context';
import { Docs } from '../../src/ui/components/Docs';
import { DOCS, parseInline } from '../../src/ui/docs';
import { parseHash, routeToHash } from '../../src/ui/router';
import { S } from '../../src/ui/strings';

function allText(): string[] {
  const out: string[] = [];
  for (const d of DOCS) {
    for (const b of d.blocks) {
      if (b.type === 'p' || b.type === 'note') out.push(b.text);
      if (b.type === 'steps' || b.type === 'list') out.push(...b.items);
      if (b.type === 'qa') out.push(...b.a);
      if (b.type === 'cmd' && b.label) out.push(b.label);
    }
  }
  return out;
}

describe('guide content', () => {
  it('has unique sections, each with a title, a summary and content', () => {
    const ids = DOCS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of DOCS) {
      expect(d.title && d.summary).toBeTruthy();
      expect(d.blocks.length).toBeGreaterThan(1);
    }
  });

  it('links only to sections and screens that exist', () => {
    for (const d of DOCS) {
      for (const b of d.blocks) {
        if (b.type !== 'link') continue;
        expect(!!b.route !== !!b.section).toBe(true);
        if (b.section) expect(ids()).toContain(b.section);
      }
    }
    function ids() {
      return DOCS.map((d) => d.id);
    }
  });

  it('has no stray ** or ` markers', () => {
    for (const t of allText()) {
      for (const p of parseInline(t)) if (p.kind === 'text') expect(p.text).not.toMatch(/\*\*|`/);
    }
  });

  it('names buttons and pages exactly as the app shows them', () => {
    const bold = new Set<string>();
    for (const t of allText()) for (const p of parseInline(t)) if (p.kind === 'bold') bold.add(p.text);
    const labels = [
      S.nav.library,
      S.folders.title,
      S.folders.choose,
      S.folders.addAnother,
      S.folders.add,
      S.folders.useAuto,
      S.library.build,
      S.library.update,
      S.library.rebuild,
      S.library.cancel,
      S.library.start,
      S.library.kiwixTitle,
      S.library.problemsTitle,
      S.library.problemScanned,
      S.library.problemError,
      S.kiwix.checkAgain,
      S.kiwix['port-busy'],
      S.results.scanned,
      S.reader.backToResults,
      S.reader.find,
      S.reader.openInFirefox,
      S.filters.all,
      S.filters.books,
      S.filters.reference,
      S.filters.khan,
      S.filters.qa,
      S.filters.category,
      S.theme.light,
      S.theme.dark,
      S.theme.system,
      S.theme.darkTitle,
      S.theme.reset,
      S.updates.restart,
      S.updates.check,
      S.updates.autoLabel,
      S.results.morePages(3),
      S.nav.browse,
      S.books.title,
      S.books.stop,
      S.books.markDone,
      S.books.tabs.manual,
      S.books.tabs.zims,
    ];
    expect(labels.filter((l) => !bold.has(l))).toEqual([]);
  });

  it('splits **bold** and `code`, and leaves unclosed markers as text', () => {
    expect(parseInline('Click **Build index** or run `bash x.sh`.')).toEqual([
      { kind: 'text', text: 'Click ' },
      { kind: 'bold', text: 'Build index' },
      { kind: 'text', text: ' or run ' },
      { kind: 'code', text: 'bash x.sh' },
      { kind: 'text', text: '.' },
    ]);
    expect(parseInline('2 ** 3')).toEqual([{ kind: 'text', text: '2 ** 3' }]);
  });

  it('has an address per section', () => {
    expect(parseHash(routeToHash({ name: 'docs', section: 'library' }))).toEqual({ name: 'docs', section: 'library' });
    expect(parseHash('#/docs')).toEqual({ name: 'docs', section: '' });
  });
});

describe('guide screen', () => {
  const ctx = { status: null, statusError: null } as unknown as AppCtx;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  function show(section: string): { el: HTMLElement; done: () => void } {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(
        <AppContext.Provider value={ctx}>
          <Docs section={section} />
        </AppContext.Provider>
      );
    });
    return { el, done: () => act(() => root.unmount()) };
  }

  it('the scripts block shows the real commands for this computer', () => {
    const live = { status: { kitDir: '/opt/libsearch/kit', roots: ['/home/me/Community Library'] }, statusError: null } as unknown as AppCtx;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(
        <AppContext.Provider value={live}>
          <Docs section="scripts" />
        </AppContext.Provider>
      );
    });
    const cmds = Array.from(el.querySelectorAll('.cmd__text')).map((c) => c.textContent);
    expect(cmds).toContain('bash "/opt/libsearch/kit/2-download-pdf-books.sh" "/home/me/Community Library"');
    expect(cmds).toContain('sudo bash "/opt/libsearch/kit/1-fix-https-certificates.sh"');
    expect(cmds).toContain('bash "/opt/libsearch/kit/4-download-khan-academy.sh" "/home/me/Community Library"');
    act(() => root.unmount());
    el.remove();
  });

  it('renders every section (an unknown one shows the first)', () => {
    for (const d of DOCS) {
      const { el, done } = show(d.id);
      expect(el.querySelector('#docs-title')!.textContent).toBe(d.title);
      expect(el.querySelector('[aria-current="page"].docs__toc-item')!.textContent).toBe(d.title);
      done();
    }
    const { el, done } = show('nope');
    expect(el.querySelector('#docs-title')!.textContent).toBe(DOCS[0].title);
    done();
  });
});
