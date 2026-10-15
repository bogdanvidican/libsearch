// Minimal read-only ZIP reader (stored + deflate), reading only the parts it needs from disk.
// Enough for EPUB files; no ZIP64, no encryption.
import * as fs from 'fs';
import * as zlib from 'zlib';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

export class ZipFile {
  readonly entries: Map<string, ZipEntry> = new Map();
  private fd: number;

  constructor(readonly file: string) {
    this.fd = fs.openSync(file, 'r');
    try {
      this.readCentralDirectory();
    } catch (e) {
      this.close();
      throw e;
    }
  }

  private read(position: number, length: number): Buffer {
    const buf = Buffer.alloc(length);
    let off = 0;
    while (off < length) {
      const n = fs.readSync(this.fd, buf, off, length - off, position + off);
      if (n <= 0) break;
      off += n;
    }
    return off === length ? buf : buf.slice(0, off);
  }

  private readCentralDirectory(): void {
    const size = fs.fstatSync(this.fd).size;
    const tailLen = Math.min(size, 65536 + 22);
    const tail = this.read(size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Not a zip file (no end of central directory)');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported');
    const cd = this.read(cdOffset, cdSize);
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory');
      const method = cd.readUInt16LE(p + 10);
      const compressedSize = cd.readUInt32LE(p + 20);
      const sz = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localHeaderOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      this.entries.set(name, { name, method, compressedSize, size: sz, localHeaderOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Returns the uncompressed bytes, or null when the entry does not exist. Max 64 MB per entry. */
  readEntry(name: string): Buffer | null {
    const e = this.entries.get(name);
    if (!e) return null;
    if (e.size > 64 * 1024 * 1024) throw new Error(`Zip entry too large: ${name}`);
    const lh = this.read(e.localHeaderOffset, 30);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('Corrupt zip local header');
    const dataStart = e.localHeaderOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const data = this.read(dataStart, e.compressedSize);
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data);
    throw new Error(`Unsupported zip compression method ${e.method}`);
  }

  readText(name: string): string | null {
    const b = this.readEntry(name);
    return b ? b.toString('utf8') : null;
  }

  close(): void {
    try {
      fs.closeSync(this.fd);
    } catch (e) {
      // already closed
    }
  }
}
