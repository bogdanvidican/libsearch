// Free space and file system type. Node 12/16 have no fs.statfs, so ask df / stat (on Ubuntu and macOS).
import { spawnSync } from 'child_process';

/** Bytes free for this user on the disk holding `dir`, or undefined when it can't be told. */
export function freeBytes(dir: string): number | undefined {
  const r = spawnSync('df', ['-Pk', dir], { encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0 || !r.stdout) return undefined;
  const lines = r.stdout.trim().split('\n');
  // "<fs> <1024-blocks> <used> <available> <capacity>% <mounted on>": find the columns around "NN%",
  // so file system and mount names with spaces don't matter.
  const m = /\s(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s/.exec(lines[lines.length - 1] + ' ');
  return m ? Number(m[3]) * 1024 : undefined;
}

/** File system type of the disk holding `dir` ("ext2/ext3", "msdos", "vfat", "fuseblk" …), Linux only. */
export function fsType(dir: string): string | undefined {
  if (process.platform !== 'linux') return undefined;
  const r = spawnSync('stat', ['-f', '-c', '%T', dir], { encoding: 'utf8', timeout: 10000 });
  return r.status === 0 && r.stdout ? r.stdout.trim() : undefined;
}
