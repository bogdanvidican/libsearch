// Opening documents: PDFs in Evince at a page (Linux) / the default viewer (macOS);
// EPUB chapters inside the app's reader view (served from inside the zip, see epubServe.ts).
import { spawn } from 'child_process';
import { OpenResult } from '../shared/api';
import { DocFile } from './search';
import { which } from './tools';
import { ZipFile } from '../indexer/zip';
import { readEpubInfo } from '../indexer/epub';

function launch(cmd: string, args: string[]): Promise<{ ok: boolean; code?: number | null; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { ok: boolean; code?: number | null; error?: string }) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child;
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    } catch (e) {
      done({ ok: false, error: (e as Error).message });
      return;
    }
    child.on('error', (e) => done({ ok: false, error: e.message }));
    // Viewers keep running; an early non-zero exit means bad arguments or a broken install.
    child.on('exit', (code) => done({ ok: code === 0, code }));
    setTimeout(() => done({ ok: true }), 1500);
    child.unref();
  });
}

function notFound(how: OpenResult['how'], message: string, fix?: string): OpenResult {
  return { ok: false, how, error: { kind: 'error', code: 'open-failed', message, fix } };
}

export async function openDocument(doc: DocFile, page?: number, q?: string): Promise<OpenResult> {
  if (doc.kind === 'epub') {
    const url = epubReaderUrl(doc, page);
    return url
      ? { ok: true, how: 'reader', readerUrl: url }
      : notFound('reader', `Could not read the book "${doc.title}".`, 'The EPUB file may be damaged. Download it again.');
  }

  if (process.platform === 'darwin') {
    const r = await launch('open', [doc.abs]);
    return r.ok ? { ok: true, how: 'open' } : notFound('open', `Could not open "${doc.title}".`);
  }

  const evince = which('evince');
  if (evince) {
    const args: string[] = [];
    if (page && page > 0) args.push(`--page-index=${page}`);
    const find = (q || '').replace(/\s+/g, ' ').trim();
    if (find) args.push(`--find=${find}`);
    let r = await launch(evince, args.concat([doc.abs]));
    // Older Evince builds may not know --find: retry with the page only.
    if (!r.ok && find) r = await launch(evince, args.filter((a) => !a.startsWith('--find=')).concat([doc.abs]));
    if (r.ok) return { ok: true, how: 'evince' };
  }
  const xdg = which('xdg-open');
  if (xdg) {
    const r = await launch(xdg, [doc.abs]);
    if (r.ok) return { ok: true, how: 'xdg-open' };
  }
  return notFound(
    'xdg-open',
    `No program could open "${doc.title}".`,
    'Install the document viewer:  sudo apt-get install evince'
  );
}

export function epubReaderUrl(doc: DocFile, chapter?: number): string | null {
  try {
    const zip = new ZipFile(doc.abs);
    try {
      const info = readEpubInfo(zip);
      if (!info.spine.length) return null;
      const idx = Math.max(1, Math.min(info.spine.length, chapter || 1)) - 1;
      return `/epub/${doc.id}/${info.spine[idx].split('/').map(encodeURIComponent).join('/')}`;
    } finally {
      zip.close();
    }
  } catch (e) {
    return null;
  }
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'text/html; charset=utf-8', // lenient HTML parsing instead of strict XML
  xml: 'text/xml; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/plain; charset=utf-8', // never execute scripts from books
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

/** Comfortable reading styles added to every EPUB chapter shown in the reader. */
const READER_CSS =
  '<style>html{background:#fff;color:#111}body{max-width:42em;margin:0 auto;padding:24px 28px 64px;' +
  'font:18px/1.6 Georgia,"DejaVu Serif",serif}img{max-width:100%;height:auto}a{color:#1d4ed8}</style>';

export function readEpubEntry(file: string, entry: string): { body: Buffer; type: string } | null {
  const zip = new ZipFile(file);
  try {
    const data = zip.readEntry(entry);
    if (!data) return null;
    const ext = (entry.split('.').pop() || '').toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    if (type.startsWith('text/html')) {
      let html = data.toString('utf8').replace(/<script\b[\s\S]*?<\/script>/gi, '');
      html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (m) => m + READER_CSS) : READER_CSS + html;
      return { body: Buffer.from(html, 'utf8'), type };
    }
    return { body: data, type };
  } finally {
    zip.close();
  }
}
