// PDF text extraction through poppler-utils (pdftotext / pdfinfo) child processes.
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';

export interface PdfInfo {
  title?: string;
  pages?: number;
}

export interface ExtractedPdf {
  pages: string[];
  info: PdfInfo;
  truncated: boolean;
}

const MAX_TEXT_BYTES = 64 * 1024 * 1024;

const active = new Set<ChildProcess>();

/** Kills running pdftotext/pdfinfo children (used when a build is cancelled). */
export function killActiveExtractions(): void {
  active.forEach((c) => {
    try {
      c.kill('SIGKILL');
    } catch (e) {
      // already gone
    }
  });
  active.clear();
}

/** True when "%PDF" appears in the first KB (some saved "bot check" pages are HTML named .pdf). */
export function looksLikePdf(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1024);
    const n = fs.readSync(fd, buf, 0, 1024, 0);
    return buf.slice(0, n).indexOf('%PDF') >= 0;
  } finally {
    fs.closeSync(fd);
  }
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
  maxBytes: number
): Promise<{ code: number | null; stdout: Buffer; stderr: string; truncated: boolean; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    active.add(child);
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let stderr = '';
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      if (truncated) return;
      if (bytes + d.length > maxBytes) {
        chunks.push(d.slice(0, maxBytes - bytes));
        bytes = maxBytes;
        truncated = true;
        child.kill('SIGKILL');
        return;
      }
      chunks.push(d);
      bytes += d.length;
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    child.on('error', (e) => {
      active.delete(child);
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      active.delete(child);
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks), stderr, truncated, timedOut });
    });
  });
}

export async function pdfInfo(file: string): Promise<PdfInfo> {
  try {
    const r = await run('pdfinfo', ['-enc', 'UTF-8', file], 60000, 1024 * 1024);
    const text = r.stdout.toString('utf8');
    const title = (text.match(/^Title:\s*(.*)$/m) || [])[1];
    const pages = Number((text.match(/^Pages:\s*(\d+)/m) || [])[1]) || undefined;
    return { title: title ? title.trim() : undefined, pages };
  } catch (e) {
    return {};
  }
}

export async function extractPdf(file: string, opts: { timeoutMs?: number } = {}): Promise<ExtractedPdf> {
  const info = await pdfInfo(file);
  const r = await run('pdftotext', ['-q', '-enc', 'UTF-8', file, '-'], opts.timeoutMs || 15 * 60 * 1000, MAX_TEXT_BYTES);
  if (r.timedOut) throw new Error('pdftotext took too long (over 15 minutes) and was stopped');
  if (r.code !== 0 && !r.truncated && r.stdout.length === 0) {
    throw new Error(`pdftotext failed (exit ${r.code})${r.stderr ? ': ' + r.stderr.trim().split('\n')[0] : ''}`);
  }
  const pages = r.stdout.toString('utf8').split('\f');
  // pdftotext ends every page with \f, so the last element is empty.
  if (pages.length && pages[pages.length - 1].trim() === '') pages.pop();
  if (info.pages && pages.length > info.pages) pages.length = info.pages;
  while (info.pages && !r.truncated && pages.length < info.pages) pages.push('');
  return { pages, info, truncated: r.truncated };
}
