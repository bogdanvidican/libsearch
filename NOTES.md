# Verification notes

What has been checked where. HANDOFF.md section 9 (M0) asks for these results before committing to Electron.

## M0 checklist (real CF-30, offline)

Run `bash library-search-app/scripts/m0-check.sh` (also inside the package at
`dist/library-search-linux-ia32/resources/app/scripts/m0-check.sh`) and paste the report below.

- [ ] `uname -m` = i686, Ubuntu 16.04, glibc 2.23
- [ ] CPU has SSE3 (`pni` flag) — Chromium 89+ (Electron 17) needs it; a Core Duo / Core 2 Duo has it
- [ ] `ldd` finds every library of `library-search` (no "not found")
- [ ] Electron runs as Node (`ELECTRON_RUN_AS_NODE=1 library-search -e …`) and the SQLite FTS5 (WASM) test passes
- [ ] `library-search --self-test --disable-gpu` opens and passes (record seconds; target: usable < 15 s)
- [ ] …and whether `--no-sandbox` is needed (the launcher retries with it automatically)
- [ ] `pdftotext`, `pdfinfo` present; `evince --help-all` lists `--page-index` and `--find`
- [ ] kiwix-serve version; `/catalog/v2/entries` answers; `/search?books.name=…&pattern=water&format=xml` returns `<item>`
      (the script starts a temporary kiwix-serve on port 18080 with the smallest ZIM if 8080 isn't running)
- [ ] Decision: Electron 17 / fallback 13 / fallback 11 / Firefox mode

If Electron 17 fails: `node scripts/package.mjs --electron 13.6.9` (then 11.5.0) on the Mac, install with
`LIBRARY_SEARCH_ELECTRON=13 bash 6-install-or-update-search-app.sh` (or the local `-e13` tarball), re-run the check.

## CF-30 results

_(paste m0-report-<date>.txt here)_

## Docker stand-in: i386 Ubuntu 16.04 (2026-10-15)

`npm run test:ia32` on the Mac (Apple Silicon, Docker Desktop 28.4, QEMU user-mode i386), package
`library-search-linux-ia32-v0.1.0.tar.gz` (78 MB), Electron 17.4.11.

| Check | Result |
| --- | --- |
| `ldd` on `library-search` + bundled `.so` | PASS — everything resolves with Electron 17's runtime libs installed (libgtk-3-0, libnss3, libxss1, libasound2, libgbm1, libx11-xcb1, libxtst6, libatk-bridge2.0-0, libdrm2, libxkbcommon0, libxshmfence1, libnotify4, libcups2 …; all part of a default 16.04 desktop) |
| Highest symbol versions needed | **GLIBC_2.17** (xenial has 2.23); **no GLIBCXX** (libc++ bundled) |
| Electron as Node | PASS — `{"electron":"17.4.11","node":"16.13.0","arch":"ia32"}` |
| SQLite FTS5 in WASM (node-sqlite3-wasm, SQLite 3.53.4) | PASS — porter stemming, `snippet()`, `bm25()` |
| Server on ia32 against an index built on the Mac (fixture library) | PASS — `LIBRARY_SEARCH_READY`, token in `index.html`, `/api/status` (8 docs, 13 pages), `/api/search?q=water` hits in ~1 s under emulation. So an index built on the Mac works on the ia32 build. |
| Installer on 16.04 userland | PASS — GNU tar 1.28 unpacks the macOS-made ustar tarball without warnings; exec bits kept; paths with spaces and `&`; sha256 check; launchers copied to the kit root; `old -> new` printed |
| In-app update install step (0.2.0, 2026-10-16; also on CI, native i386) | PASS — `--wait --status-file`: with the app open it waits, then reports `busy` and leaves it alone; closed, it installs and reports `ok 0.2.0` (container check (f)) |
| Download kit script 2 (2026-10-18, QEMU on the Mac) | PASS — `2-download-pdf-books.sh` from the app's `kit/` with xenial's bash 4.3.48 + curl 7.47.0, against a local server on Electron's Node: the app's lists plus the library's `booklist-local.txt` land in a library folder with spaces, `&` and `(…)`, URLs with `%20`, `(`, `?`, `&` (container check (g)) |
| In-app book downloader (2026-10-18, QEMU on the Mac) | PASS — `build/downloader/downloader.js --job books` on Electron's Node: a book lands in the library folder; a bot-check page and a 403 are listed in `library-search-downloads.json` with their reasons (container check (h); `--min-free-mb 0` because QEMU can't start `df`) |
| HTTPS with Electron's own certificates (2026-10-18) | PASS — `https://www.gutenberg.org/` answers 200 from Electron 17's Node inside i386 Ubuntu 16.04, whose own certificate store is outdated: the in-app downloads don't need `1-fix-https-certificates.sh` (container check (i)) |
| Launcher logic | PASS — quick failure → retry with `--no-sandbox` → "could not start, open in Firefox?" message; `--firefox` starts the server (READY) |
| ia32 indexer | not testable under QEMU: any `child_process.spawn` from Electron's Node segfaults in QEMU user-mode (pdftotext can't be started). Same crash for any QEMU CPU model (`QEMU_CPU=coreduo`, `core2duo`, `n270`, `max`). |
| GUI `--self-test` under Xvfb | not testable under QEMU: Chromium can't launch its GPU/renderer child processes (`GPU process isn't usable. Goodbye.`); `--single-process` aborts in Electron's Node platform. |

Also seen only under QEMU: processes segfault when they receive SIGTERM, and `/proc/cpuinfo` shows the host's
ARM CPU (so the SSE3 check is skipped there).

**Still unverified (needs the real CF-30 or a full-system i386 VM, e.g. UTM/qemu-system-i386 with Ubuntu 16.04):**
GUI launch and launch time, sandbox behaviour, GPU flags on the old Intel graphics, ia32 indexer speed with
pdftotext, Evince page jump, kiwix-serve 3.x endpoints, memory use (target: app + kiwix-serve + Evince < 1.5 GB).
