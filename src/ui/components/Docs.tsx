// The guide (Settings -> Guide): one section at a time, a table of contents on the left, Previous / Next below.
// Content lives in src/ui/docs.ts; two blocks show live facts about this computer (helper programs, folders).
import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  Database,
  Download,
  Flag,
  FolderOpen,
  Globe,
  HardDrive,
  LifeBuoy,
  Lightbulb,
  Search,
  Settings,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import type { Status } from '../../shared/api';
import { useApp } from '../context';
import { DocBlock, DocIcon, DocRoute, DOCS, DocSection, parseInline } from '../docs';
import { navigate, Route } from '../router';
import { S } from '../strings';

const ICONS: Record<DocIcon, typeof BookOpen> = {
  start: Flag,
  search: Search,
  open: BookOpen,
  folder: FolderOpen,
  index: Database,
  globe: Globe,
  tools: Wrench,
  settings: Settings,
  help: LifeBuoy,
  files: HardDrive,
  download: Download,
};

function routeFor(r: DocRoute): Route {
  switch (r) {
    case 'browse':
      return { name: 'browse', folder: '' };
    case 'library':
      return { name: 'library' };
    case 'settings':
      return { name: 'settings' };
    case 'books':
      return { name: 'books', tab: 'lists' };
    default:
      return { name: 'home' };
  }
}

export function findDoc(id: string): DocSection {
  return DOCS.filter((d) => d.id === id)[0] || DOCS[0];
}

export function Docs({ section }: { section: string }) {
  const app = useApp();
  const doc = findDoc(section);
  const i = DOCS.indexOf(doc);
  const prev = i > 0 ? DOCS[i - 1] : null;
  const next = i < DOCS.length - 1 ? DOCS[i + 1] : null;
  const title = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // A new section starts at the top; keyboard and screen-reader users land on its title.
  useEffect(() => {
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
    if (first.current) first.current = false;
    else if (title.current) title.current.focus();
  }, [doc.id]);

  const go = (id: string) => navigate({ name: 'docs', section: id });

  return (
    <div className="page">
      <nav className="crumbs" aria-label={S.docs.crumbsLabel}>
        <button type="button" className="link-btn" onClick={() => navigate({ name: 'settings' })}>
          {S.nav.settings}
        </button>
        <ChevronRight size={16} aria-hidden="true" />
        <span aria-current="page">{S.docs.title}</span>
      </nav>
      <div className="page__head">
        <h1 className="page__title">{S.docs.title}</h1>
        <p className="page__sub">{S.docs.subtitle}</p>
      </div>
      <div className="docs">
        <nav className="docs__toc" aria-label={S.docs.tocLabel}>
          <ol role="list">
            {DOCS.map((d) => {
              const Icon = ICONS[d.icon];
              const current = d.id === doc.id;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    className={'docs__toc-item' + (current ? ' is-current' : '')}
                    aria-current={current ? 'page' : undefined}
                    onClick={() => go(d.id)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{d.title}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <article className="card docs__body" aria-labelledby="docs-title">
          <h2 id="docs-title" className="docs__title" tabIndex={-1} ref={title}>
            {doc.title}
          </h2>
          <p className="docs__summary">{doc.summary}</p>
          <Blocks blocks={doc.blocks} st={app.status} go={go} />
          <div className="docs__pager">
            {prev ? (
              <button type="button" className="btn btn--secondary docs__pager-btn" onClick={() => go(prev.id)}>
                <ChevronLeft size={18} aria-hidden="true" />
                <span>
                  <span className="docs__pager-dir">{S.docs.previous}</span>
                  {prev.title}
                </span>
              </button>
            ) : (
              <span />
            )}
            {next ? (
              <button type="button" className="btn btn--secondary docs__pager-btn docs__pager-btn--next" onClick={() => go(next.id)}>
                <span>
                  <span className="docs__pager-dir">{S.docs.next}</span>
                  {next.title}
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </article>
      </div>
    </div>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((p, i) =>
        p.kind === 'bold' ? <strong key={i}>{p.text}</strong> : p.kind === 'code' ? <code key={i} className="docs__code">{p.text}</code> : <span key={i}>{p.text}</span>
      )}
    </>
  );
}

/** Renders the blocks; links that follow each other share one row of buttons. */
function Blocks({ blocks, st, go }: { blocks: DocBlock[]; st: Status | null; go: (id: string) => void }) {
  const out: JSX.Element[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'link') {
      const links: DocBlock[] = [];
      while (i < blocks.length && blocks[i].type === 'link') links.push(blocks[i++]);
      i--;
      out.push(
        <div key={i} className="btn-row docs__links">
          {links.map((l, j) =>
            l.type === 'link' ? (
              <button
                key={j}
                type="button"
                className="btn btn--secondary"
                onClick={() => (l.section ? go(l.section) : navigate(routeFor(l.route || 'home')))}
              >
                {l.text}
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ) : null
          )}
        </div>
      );
      continue;
    }
    out.push(<Block key={i} b={b} st={st} />);
  }
  return <>{out}</>;
}

function Block({ b, st }: { b: DocBlock; st: Status | null }) {
  switch (b.type) {
    case 'p':
      return (
        <p className="docs__p">
          <Inline text={b.text} />
        </p>
      );
    case 'h':
      return <h3 className="docs__h">{b.text}</h3>;
    case 'steps':
    case 'list': {
      const items = b.items.map((t, i) => (
        <li key={i}>
          <Inline text={t} />
        </li>
      ));
      return b.type === 'steps' ? <ol className="docs__steps">{items}</ol> : <ul className="docs__list">{items}</ul>;
    }
    case 'cmd':
      return <Command text={b.text} label={b.label} />;
    case 'tree':
      return <pre className="docs__tree">{b.text}</pre>;
    case 'note': {
      const Icon = b.kind === 'tip' ? Lightbulb : TriangleAlert;
      return (
        <div className={'docs__note docs__note--' + b.kind} role="note">
          <Icon className="docs__note-icon" size={20} aria-hidden="true" />
          <p>
            <Inline text={b.text} />
          </p>
        </div>
      );
    }
    case 'qa':
      return (
        <details className="docs__qa">
          <summary>{b.q}</summary>
          <div className="docs__qa-a">
            {b.a.map((t, i) => (
              <p key={i} className="docs__p">
                <Inline text={t} />
              </p>
            ))}
          </div>
        </details>
      );
    case 'tools':
      return <ToolsNow st={st} />;
    case 'paths':
      return <PathsNow st={st} />;
    case 'scripts':
      return <ScriptsNow st={st} />;
    default:
      return null;
  }
}

function copyText(text: string): Promise<void> {
  const nav = navigator as Navigator & { clipboard?: { writeText(t: string): Promise<void> } };
  if (nav.clipboard && nav.clipboard.writeText) return nav.clipboard.writeText(text);
  // Older Firefox: copy through a hidden text box.
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (ok) resolve();
    else reject(new Error('copy failed'));
  });
}

function Command({ text, label }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <div className="cmd">
      {label ? (
        <p className="cmd__label">
          <Inline text={label} />
        </p>
      ) : null}
      <div className="cmd__box">
        <code className="cmd__text">{text}</code>
        <button
          type="button"
          className="cmd__copy"
          onClick={() => copyText(text).then(() => setState('copied'), () => setState('failed'))}
        >
          {state === 'copied' ? <CircleCheck size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
          <span aria-live="polite">{state === 'copied' ? S.docs.copied : S.docs.copy}</span>
        </button>
      </div>
      {state === 'failed' ? <p className="cmd__failed">{S.docs.copyFailed}</p> : null}
    </div>
  );
}

function ToolsNow({ st }: { st: Status | null }) {
  if (!st) return <p className="docs__p">{S.docs.liveLoading}</p>;
  const keys = (['pdftotext', 'pdfinfo', 'evince', 'firefox'] as const).filter((k) => !(k === 'evince' && st.platform === 'darwin'));
  return (
    <ul className="tools docs__live" role="list">
      {keys.map((k) => {
        const ok = st.tools[k];
        const t = S.library.tools[k];
        return (
          <li key={k} className="tool">
            {ok ? (
              <CircleCheck className="tool__ok" size={20} aria-label={S.library.toolOk} />
            ) : (
              <CircleAlert className="tool__bad" size={20} aria-label={S.library.toolMissing} />
            )}
            <span className="tool__text">
              <span className="tool__name">
                {t.name} · {ok ? S.library.toolOk : S.library.toolMissing}
              </span>
              <span className="tool__what">{t.what}</span>
              {!ok ? <code className="tool__fix">{t.fix}</code> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The download scripts' commands with this computer's folders filled in (each with a Copy button). */
function ScriptsNow({ st }: { st: Status | null }) {
  if (!st || !st.kitDir) return <p className="docs__p">{S.docs.liveLoading}</p>;
  const kit = st.kitDir.replace(/[\\/]+$/, '');
  const lib = st.roots[0] || S.docs.scripts.yourLibrary;
  const s = S.docs.scripts;
  const rows: Array<[string, string]> = [
    [s.cert, `sudo bash "${kit}/1-fix-https-certificates.sh"`],
    [s.books, `bash "${kit}/2-download-pdf-books.sh" "${lib}"`],
    [s.wiki, `bash "${kit}/3-download-offline-wikipedia.sh" "${lib}"`],
    [s.khan, `bash "${kit}/4-download-khan-academy.sh" "${lib}"`],
    [s.serve, `bash "${kit}/5-start-offline-library-in-firefox.sh" "${lib}"`],
  ];
  return (
    <div className="docs__live">
      {rows.map(([label, text]) => (
        <Command key={text} label={label} text={text} />
      ))}
    </div>
  );
}

function PathsNow({ st }: { st: Status | null }) {
  if (!st) return <p className="docs__p">{S.docs.liveLoading}</p>;
  const base = st.dataDir.replace(/[\\/]+$/, '');
  const rows: Array<[string, string]> = [
    [S.docs.paths.library, st.roots.length ? st.roots.join('\n') : S.docs.paths.none],
    [S.docs.paths.index, base + '/index/library.sqlite'],
    [S.docs.paths.settings, base + '/settings.json'],
    [S.docs.paths.logs, base + '/logs'],
    [S.docs.paths.version, st.version],
  ];
  return (
    <dl className="about docs__live">
      {rows.map(([k, v]) => (
        <div key={k} className="about__row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
