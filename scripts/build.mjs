// Bundles every part of the app into build/ with esbuild.
//   node scripts/build.mjs           one-off build
//   node scripts/build.mjs --watch   rebuild on change (UI reloads on refresh)
import * as esbuild from 'esbuild';
import { readFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const watch = process.argv.includes('--watch');
const out = join(root, 'build');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'ui'), { recursive: true });

// The GitHub repo the app updates itself from (package.json "repository"; LIBRARY_SEARCH_REPO overrides it at run time).
const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository && pkg.repository.url) || '';
const repoMatch = /github\.com[/:]([^/]+\/[^/]+?)(\.git)?$/.exec(repoUrl);
const define = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __UPDATE_REPO__: JSON.stringify(repoMatch ? repoMatch[1] : 'bogdanvidican/libsearch'),
};

// Server, indexer and Electron main run on the Node inside Electron. Electron 17 ships Node 16,
// but we target node12 syntax so the Electron 11/13 fallback builds still run the same code.
const nodeCommon = {
  bundle: true,
  platform: 'node',
  target: 'node12',
  format: 'cjs',
  sourcemap: 'linked',
  define,
  external: ['electron', 'node-sqlite3-wasm'],
  logLevel: 'warning',
};

const builds = [
  { ...nodeCommon, entryPoints: [join(root, 'src/main/main.ts')], outfile: join(out, 'main/main.js') },
  { ...nodeCommon, entryPoints: [join(root, 'src/main/preload.ts')], outfile: join(out, 'main/preload.js') },
  { ...nodeCommon, entryPoints: [join(root, 'src/server/server.ts')], outfile: join(out, 'server/server.js') },
  { ...nodeCommon, entryPoints: [join(root, 'src/indexer/indexer.ts')], outfile: join(out, 'indexer/indexer.js') },
  {
    // The UI must also run in an old Firefox (fallback mode), so keep it at ES2017.
    entryPoints: [join(root, 'src/ui/main.tsx')],
    outfile: join(out, 'ui/app.js'),
    bundle: true,
    platform: 'browser',
    target: ['es2017', 'chrome87', 'firefox60'],
    format: 'iife',
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    jsx: 'automatic',
    define: { ...define, 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
    loader: { '.svg': 'text' },
    logLevel: 'warning',
  },
];

function copyStatic() {
  copyFileSync(join(root, 'src/ui/index.html'), join(out, 'ui/index.html'));
}

if (watch) {
  const ctxs = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(ctxs.map((c) => c.watch()));
  copyStatic();
  console.log('watching for changes...');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  copyStatic();
  console.log(`built v${pkg.version} -> build/`);
}
