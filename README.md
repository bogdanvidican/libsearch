# Library Search (developer notes)

Offline desktop search for the Community Rebuild Library: PDF/EPUB books (SQLite FTS5 index) plus the Kiwix
ZIM collections (via kiwix-serve). Target: Panasonic CF-30, Ubuntu 16.04 **i386**, Electron 17 linux-ia32.
Background and constraints: `HANDOFF.md`. Decisions, API and layout: `docs/design.md`. Hardware results: `NOTES.md`.

## Setup (Mac)

```bash
npm install                 # uses .npmrc legacy-peer-deps (Node 16 typings on purpose)
brew install poppler        # pdftotext + pdfinfo for the indexer
```

Optional for the ZIM path: a macOS kiwix-tools build (`kiwix-serve` on PATH) and one small ZIM
(e.g. Appropedia or PhET) in `<library root>/15 Offline Encyclopedias (Kiwix)/`.

The books on the Mac live one level above the kit (`~/Documents/Community Rebuild Library/01 Medicine/...`).
Library roots are auto-detected by walking up from the app folder (every ancestor holding an `NN Name` folder),
so `npm start` needs no flags; pass `--library-root <dir>` to override.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm start` | build + run the Electron app (Electron 17, same major as the CF-30) |
| `npm run self-test` | build + start the app, check the UI renders and `/api/status` answers, print JSON, exit |
| `npm run serve` | build + run only the server and open it in the browser (Firefox-mode UI) |
| `npm run index` | build + run the indexer in the terminal (`-- --full` to re-read every book) |
| `npm run build` | esbuild bundles into `build/` (`node scripts/build.mjs --watch` for watch mode) |
| `npm test` / `npm run typecheck` / `npm run check` | vitest / tsc / both |
| `npm run dist:linux-ia32` | package `dist/library-search-linux-ia32/` + `dist/library-search-linux-ia32-vX.Y.Z.tar.gz` |
| `npm run dist:mac` | package a darwin-arm64 app for local testing |
| `npm run test:ia32` | run the packaged ia32 build inside an i386 Ubuntu 16.04 container (see below) |

Fallback builds with an older Electron (if 17 won't start on the CF-30):

```bash
node scripts/package.mjs --electron 13.6.9    # -> dist/library-search-linux-ia32-vX.Y.Z-e13.tar.gz
node scripts/package.mjs --electron 11.5.0    # -> ...-e11.tar.gz
```

Server/indexer code is compiled to `node12` syntax and must not use Node APIs newer than 12
(`fs.rm`, `AbortController`, global `fetch`, `.at()`, `Object.hasOwn`, `replaceAll`) so these builds work.
The UI is compiled to ES2017 so the Firefox fallback runs on the CF-30's old Firefox.

## Running pieces by hand

```bash
node build/server/server.js --mode browser --port 8090 --open-browser     # roots auto-detected
node build/indexer/indexer.js [--library-root DIR] [--full] [--json]
# On Linux with the packaged app, the same files run on Electron's own Node:
ELECTRON_RUN_AS_NODE=1 dist/library-search-linux-ia32/library-search \
  dist/library-search-linux-ia32/resources/app/build/server/server.js --mode browser --port 8090 --library-root ..
```

The user guide is inside the app (Settings → Help → Open the guide, `#/docs`); its text is `src/ui/docs.ts`. When a
button label in `src/ui/strings.ts` changes, `tests/ui/docs.test.tsx` fails until the guide says the same.

Working on the UI without an index or kiwix-serve: `node scripts/build.mjs && node scripts/mock-server.mjs` serves
the built UI on http://127.0.0.1:8099 with fake data; `/__mock?index=building&kiwix=stopped&update=ready` (see the
file's header) switches states.

All flags: `docs/design.md` → "Entry points and flags". The index is `index/library.sqlite` (gitignored,
rebuildable; paths inside are relative to the library root, so an index built on the Mac can be copied to the CF-30).

## Testing on a stand-in CF-30 (Docker, i386 Ubuntu 16.04)

```bash
npm run test:ia32            # packages if needed, builds image library-search-xenial-i386, runs the checks
bash scripts/docker-ia32-test.sh --repackage
```

Checks: (a) `ldd` finds every library, (b) highest required `GLIBC_`/`GLIBCXX_` ≤ xenial's,
(c) `scripts/m0-check.sh` runs, (d) indexer + server smoke test on `tests/fixtures/library`
(`/api/status`, `/api/search?q=water`), (e) GUI `--self-test` under Xvfb — informational only, QEMU is slow and
flaky with Chromium. Logs land in `dist/docker-ia32/`. It is a stand-in: real-hardware results go in `NOTES.md`.

## On the real CF-30 (M0)

Copy or install the app (below), then:

```bash
bash library-search-app/scripts/m0-check.sh          # or resources/app/scripts/m0-check.sh inside the package
```

It writes `library-search-app/m0-report-<date>.txt`; paste it into `NOTES.md`.

## Releasing

The repo root is this folder (`library-search-app/`); the kit scripts (`0-…` to `5-…`) live outside it.
Launchers for the kit root are kept in `kit/` and copied into the kit folder by the install script.

1. Bump `version` in `package.json`, commit.
2. `npm run check && npm run dist:linux-ia32` (optionally `npm run test:ia32`).
3. Create the GitHub release (the owner creates the GitHub repo; nothing here pushes by itself):

   ```bash
   git tag v0.1.0 && git push origin master --tags
   gh release create v0.1.0 \
     dist/library-search-linux-ia32-v0.1.0.tar.gz \
     dist/library-search-linux-ia32-v0.1.0.tar.gz.sha256 \
     dist/6-install-or-update-search-app.sh \
     --title "Library Search 0.1.0" --notes "..."
   ```

   Attach `-e13`/`-e11` fallback tarballs too when they exist.

   Installed apps (0.2.0 and later) find the release by themselves: it must be the repo's **latest** release (not a
   draft or pre-release), keep the asset names above, and include the `.sha256` files. The repo must be public
   (or each machine needs `GITHUB_TOKEN`). They download it in the background and install it when the app closes.

## Installing on the CF-30

- **With git + internet:** in the kit folder:
  `git clone https://github.com/bogdanvidican/libsearch.git library-search-app` (the folder must be named
  `library-search-app`) then
  `bash library-search-app/kit/6-install-or-update-search-app.sh`
  (it finds the repo from `git remote`, downloads the newest release, unpacks it into
  `library-search-app/dist/library-search-linux-ia32/` and copies the `6-*` launchers into the kit folder).
  Later updates: `git pull` (optional) and `bash 6-install-or-update-search-app.sh`.
- **Private repo:** `GITHUB_TOKEN=<token> bash 6-install-or-update-search-app.sh`.
- **No internet (USB stick):** copy the `.tar.gz` (+ `.sha256`) and `6-install-or-update-search-app.sh` from the
  release into the kit folder, then `bash 6-install-or-update-search-app.sh library-search-linux-ia32-vX.Y.Z.tar.gz`.
- **Fallback Electron build:** `LIBRARY_SEARCH_ELECTRON=13 bash 6-install-or-update-search-app.sh` picks the `-e13` asset.

The install script keeps the previous version as `….old` until the new one is in place, refuses to run as root,
and prints `old -> new` versions.

**Updates after that:** from 0.2.0 on, the app updates itself whenever the computer is online: it checks GitHub
shortly after it starts, downloads a new version in the background, and installs it when the app is closed
(Settings → Updates has "Check for updates", "Restart now and update" and an off switch). It runs the same install
script (`--wait --status-file …`); its output is in `logs/update.log`. `--no-update` turns it off for one run.
Copies on 0.1.x need one manual update with the script first.

**The app can live anywhere** (it doesn't have to be inside the library or the kit):
- Install location: `--dir <folder>`, else the git checkout the script is in, else the folder used last time
  (`~/.config/library-search/app-home`), else `<kit>/library-search-app` when run from a kit, else `~/library-search`.
- Index, settings and logs live in that folder (or `~/.local/share/library-search` if it isn't writable).
- Library folders: `--library-root` / `LIBRARY_ROOTS` > folders chosen in the app (Library → Library folders,
  saved in `settings.json`) > auto-detection (ancestors of the app folder holding `NN Name` folders).
  When nothing is found the app asks for the folder on first start.

**Menu entry + sidebar icon (Ubuntu):** the installer writes `~/.local/share/applications/library-search.desktop`
(Exec = the launcher inside the installed app, so it works wherever the app is), installs the icon into
`~/.local/share/icons/hicolor/`, and asks to pin it to the Unity sidebar (`--pin` / `--no-pin`; GNOME dock too).
`--launcher` only redoes this, `--remove-launcher` undoes it. Icons: `assets/icons/library-search.svg` →
`npx electron scripts/make-icons.cjs` renders the PNGs.

## Launchers (kit root)

| File | Purpose |
| --- | --- |
| `6-search-the-library.sh` / `.desktop` | start the app with `--disable-gpu`; retries with `--no-sandbox` if Chromium's sandbox fails; offers Firefox mode if the app can't start. `--firefox` runs the server on port 8090 and opens Firefox. Log: `library-search-app/logs/launcher.log` |
| `6-build-search-index.sh` | index build in a terminal (`--full` to re-read everything), low CPU priority, Ctrl+C safe |
| `6-install-or-update-search-app.sh` | install/update from GitHub, a URL or a local `.tar.gz` |

## Layout

```
src/shared/  API types, dark palette  src/server/  HTTP API, search, kiwix proxy, opener, updates
src/indexer/ PDF/EPUB → FTS5  src/main/    Electron shell + preload
src/ui/      React app        kit/         kit-root launchers + README section
scripts/     build, package, docker ia32 test, m0-check
tests/       vitest + fixtures (tests/fixtures/library is a tiny fake library)
```
