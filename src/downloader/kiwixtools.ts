// The Kiwix reader (kiwix-tools, a static build that runs on old Ubuntu): downloaded into
// <Kiwix folder>/kiwix-tools/ when it is missing, as scripts 3 and 4 do. Linux only.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { get, readBody } from '../server/net';
import { compareVersions } from '../server/update';
import { DownloadError, fetchToFile, toDownloadError, USER_AGENT } from './fetchfile';

/** The newest kiwix-tools with a 32-bit (i586) build. */
const FALLBACK = '3.7.0';

/** Node's process.arch -> the name in kiwix-tools file names. */
export function kiwixArch(arch: string): string | null {
  const names: Record<string, string> = { ia32: 'i586', x64: 'x86_64', arm64: 'aarch64', arm: 'armhf' };
  return names[arch] || null;
}

/** The highest version of kiwix-tools_linux-<arch>-<version>.tar.gz in a release listing. */
export function newestToolsFile(listing: string, arch: string): string | null {
  const re = new RegExp('kiwix-tools_linux-' + arch + '-([0-9.]+[0-9])\\.tar\\.gz', 'g');
  let best: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(listing))) {
    if (!best || compareVersions(m[1], best) > 0) best = m[1];
  }
  return best ? `kiwix-tools_linux-${arch}-${best}.tar.gz` : null;
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch (e) {
    return false;
  }
}

function untar(archive: string, into: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archive, '-C', into, '--strip-components=1'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr!.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => reject(new DownloadError('failed', `The Kiwix reader could not be unpacked: ${e.message}`)));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new DownloadError('failed', `The Kiwix reader could not be unpacked: ${err.trim() || 'tar exit ' + code}`))));
  });
}

export async function ensureKiwixTools(
  kiwixDir: string,
  o: { mirror: string; arch: string; platform: string; stallMs: number; isCancelled: () => boolean; log: (line: string) => void }
): Promise<'present' | 'installed' | 'unsupported'> {
  const toolsDir = path.join(kiwixDir, 'kiwix-tools');
  if (isExecutable(path.join(toolsDir, 'kiwix-serve'))) return 'present';
  const arch = kiwixArch(o.arch);
  if (o.platform !== 'linux' || !arch) return 'unsupported';
  const releases = o.mirror.replace(/\/+$/, '') + '/release/kiwix-tools/';
  let name: string | null = null;
  try {
    name = newestToolsFile(await readBody(await get(releases, { 'User-Agent': USER_AGENT }, o.stallMs, { isCancelled: o.isCancelled }), 5 * 1048576), arch);
  } catch (e) {
    const d = toDownloadError(e);
    if (d.code === 'cancelled') throw d;
    o.log(`kiwix-tools listing: ${d.message}`);
  }
  name = name || `kiwix-tools_linux-${arch}-${FALLBACK}.tar.gz`;
  o.log(`kiwix reader: ${name}`);
  const archive = path.join(kiwixDir, 'kiwix-tools.tar.gz');
  await fetchToFile(releases + name, archive, { stallMs: o.stallMs, isCancelled: o.isCancelled, onBytes: () => undefined });
  fs.renameSync(archive + '.part', archive);
  fs.mkdirSync(toolsDir, { recursive: true });
  try {
    await untar(archive, toolsDir);
  } finally {
    try {
      fs.unlinkSync(archive);
    } catch (e) {
      // gone
    }
  }
  const serve = path.join(toolsDir, 'kiwix-serve');
  if (!fs.existsSync(serve)) throw new DownloadError('failed', `${name} has no kiwix-serve in it.`);
  fs.chmodSync(serve, 0o755);
  return 'installed';
}
