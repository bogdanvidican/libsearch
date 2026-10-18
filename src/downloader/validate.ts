// Is a downloaded file the real thing? Sites with bot checks answer with a web page, or with nothing at all.
// Same rules as valid() in kit/2-download-pdf-books.sh.
import * as fs from 'fs';

const HEAD = 1024;

export function isValidContent(fileName: string, head: Buffer): boolean {
  if (!head.length) return false;
  const start = head.slice(0, HEAD);
  if (/\.(pdf|PDF)(\.part)?$/.test(fileName)) return start.toString('latin1').replace(/\0/g, '').indexOf('%PDF') >= 0;
  if (/\.epub(\.part)?$/.test(fileName)) return start.slice(0, 2).toString('latin1') === 'PK';
  return !/<html/i.test(start.toString('latin1'));
}

export function isValidFile(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD);
    const n = fs.readSync(fd, buf, 0, HEAD, 0);
    return isValidContent(file, buf.slice(0, n));
  } catch (e) {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
