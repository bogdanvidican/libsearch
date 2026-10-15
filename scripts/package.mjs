// Packages the app with @electron/packager.
//   node scripts/package.mjs                          linux ia32 (the CF-30), Electron from devDependencies
//   node scripts/package.mjs --platform darwin --arch arm64
//   node scripts/package.mjs --electron 13.6.9        fallback build for an older Electron (tarball gets -e13)
//   node scripts/package.mjs --no-build               reuse the existing build/ folder
//
// Output: dist/library-search-<platform>-<arch>/  and, for linux,
//         dist/library-search-linux-<arch>-v<version>[-e<major>].tar.gz (+ .sha256)
//         dist/6-install-or-update-search-app.sh   (attach it to the GitHub release next to the tarball)
import { packager } from '@electron/packager';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const platform = arg('platform', 'linux');
const arch = arg('arch', 'ia32');
const installedElectron = JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const electronVersion = arg('electron', installedElectron);
const electronOverride = electronVersion !== installedElectron;
const electronMajor = electronVersion.split('.')[0];

if (platform === 'linux' && arch === 'ia32' && Number(electronMajor) >= 19) {
  console.error(`Electron ${electronVersion} has no linux-ia32 build (last one is 18.x). Use --electron 17.4.11 or older.`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`failed: ${cmd} ${args.join(' ')}`);
    process.exit(r.status || 1);
  }
}

// 1. Build
if (!process.argv.includes('--no-build')) run(process.execPath, [join(root, 'scripts/build.mjs')]);
if (!existsSync(join(root, 'build/server/server.js'))) {
  console.error('build/ is missing - run without --no-build');
  process.exit(1);
}

// 2. Stage a minimal app folder (only what runs on the target)
const dist = join(root, 'dist');
const stage = join(dist, `.stage-${platform}-${arch}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const stagedPkg = {
  name: pkg.name,
  productName: pkg.productName,
  version: pkg.version,
  description: pkg.description,
  author: pkg.author,
  license: pkg.license,
  main: pkg.main,
  dependencies: pkg.dependencies,
};
writeFileSync(join(stage, 'package.json'), JSON.stringify(stagedPkg, null, 2) + '\n');
cpSync(join(root, 'build'), join(stage, 'build'), {
  recursive: true,
  filter: (src) => !src.endsWith('.DS_Store'),
});
for (const dep of Object.keys(pkg.dependencies || {})) {
  cpSync(join(root, 'node_modules', dep), join(stage, 'node_modules', dep), {
    recursive: true,
    filter: (src) => !src.endsWith('.DS_Store'),
  });
}
if (existsSync(join(root, 'kit'))) {
  cpSync(join(root, 'kit'), join(stage, 'kit'), { recursive: true, filter: (src) => !src.endsWith('.DS_Store') });
}
mkdirSync(join(stage, 'scripts'), { recursive: true });
copyFileSync(join(root, 'scripts/m0-check.sh'), join(stage, 'scripts/m0-check.sh'));

// 3. Package
console.log(`packaging ${platform}-${arch} with Electron ${electronVersion}...`);
const [outPath] = await packager({
  dir: stage,
  name: 'library-search',
  executableName: 'library-search',
  appVersion: pkg.version,
  electronVersion,
  platform,
  arch,
  out: dist,
  overwrite: true,
  asar: false,
  prune: false, // node_modules was staged by hand above
  junk: true,
  derefSymlinks: true,
  quiet: true,
});
rmSync(stage, { recursive: true, force: true });

const folderName = `library-search-${platform}-${arch}`;
const appFolder = join(dist, folderName);
if (outPath !== appFolder) {
  rmSync(appFolder, { recursive: true, force: true });
  renameSync(outPath, appFolder);
}

chmodSync(appFolder, 0o755); // packager leaves its temp-dir mode (700)

// Version info read by the shell scripts (no JSON parser on the CF-30). Not "VERSION": Electron ships a
// lowercase "version" file and the Mac's case-insensitive disk would overwrite it.
writeFileSync(join(appFolder, 'app-version.txt'), pkg.version + '\n');
const gitRev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
writeFileSync(
  join(appFolder, 'BUILD-INFO.txt'),
  [
    `Library Search ${pkg.version}`,
    `Electron ${electronVersion} (${platform}-${arch})`,
    `Built ${new Date().toISOString()}`,
    `Commit ${(gitRev.stdout || '').trim() || 'unknown'}`,
    '',
  ].join('\n'),
);

// 4. Linux: exec bits + tarball
if (platform === 'linux') {
  const appRes = join(appFolder, 'resources/app');
  for (const f of ['library-search', 'chrome-sandbox', 'chrome_crashpad_handler']) {
    if (existsSync(join(appFolder, f))) chmodSync(join(appFolder, f), 0o755);
  }
  for (const f of readdirSync(appFolder)) {
    if (/\.so(\.\d+)*$/.test(f)) chmodSync(join(appFolder, f), 0o755);
  }
  for (const dir of [join(appRes, 'kit'), join(appRes, 'scripts')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.sh') || f.endsWith('.desktop')) chmodSync(join(dir, f), 0o755);
    }
  }

  const suffix = electronOverride ? `-e${electronMajor}` : '';
  const tarName = `library-search-${platform}-${arch}-v${pkg.version}${suffix}.tar.gz`;
  const tarPath = join(dist, tarName);
  rmSync(tarPath, { force: true });
  // bsdtar on macOS: ustar format (GNU tar 1.28 on 16.04 reads it without pax/xattr warnings),
  // no AppleDouble ._ files, no extended attributes, root-owned entries.
  const tarArgs = ['-czf', tarPath, '--format', 'ustar', '--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root'];
  const isBsdTar = /bsdtar/.test(spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout || '');
  if (isBsdTar) tarArgs.push('--no-xattrs', '--no-mac-metadata', '--no-acls', '--no-fflags');
  run('tar', [...tarArgs, '-C', dist, folderName], { env: { ...process.env, COPYFILE_DISABLE: '1' } });

  const sha = createHash('sha256').update(readFileSync(tarPath)).digest('hex');
  writeFileSync(`${tarPath}.sha256`, `${sha}  ${tarName}\n`);
  copyFileSync(join(root, 'kit/6-install-or-update-search-app.sh'), join(dist, '6-install-or-update-search-app.sh'));
  chmodSync(join(dist, '6-install-or-update-search-app.sh'), 0o755);

  const mb = (statSync(tarPath).size / 1048576).toFixed(1);
  console.log(`\n${appFolder}\n${tarPath} (${mb} MB)\nsha256 ${sha}`);
} else {
  console.log(`\n${appFolder}`);
}
