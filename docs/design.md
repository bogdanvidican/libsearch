# Library Search — design record

Source brief: `HANDOFF.md`. This file records what we decided and where we deviated from it.
Status: v0.1 being implemented; the UI is refined iteratively on the running app.

## Decisions (and deviations from HANDOFF.md)

| Topic | Decision | Why |
| --- | --- | --- |
| Language | All TypeScript/JavaScript (no Python) | Owner preference; one language |
| Book index | SQLite **FTS5** via `node-sqlite3-wasm` (SQLite 3.53 compiled to WASM, file-backed VFS) | No native Node modules, runs on ia32, DB stays on disk (not in RAM), bm25 + snippet built in. Verified on Node 16.13 (= Electron 17). |
| Processes | Electron main is a thin shell; it forks `server.js` with `ELECTRON_RUN_AS_NODE=1`. The server serves the React UI + JSON API on 127.0.0.1. Index builds run in a third process (`indexer.js`, lowest CPU priority). | WASM SQLite calls are synchronous; keeping them out of Electron main keeps the window responsive. The Firefox fallback is literally the same server. |
| Fallback | First: older Electron (13 / 11) builds. Last resort: `6-search-the-library.sh --firefox` runs the server on Electron's embedded Node and opens Firefox. | Ubuntu 16.04's own `nodejs` is v4 (too old); Python is no longer used. |
| UI | React 18, plain CSS with design tokens, `lucide-react` icons bundled (no CDN/fonts). Hash routing so browser Back works. | Owner preference; crisp + offline. |
| Results | Grouped sections: Books, Wikipedia & reference, Khan Academy, Q&A sites. Books collapse to best page per book. | Scores across sources are not comparable; streaming Kiwix results never shift rows already shown. |
| ZIM articles + EPUB chapters | Shown **inside the app** (reader view with an iframe). The server reverse-proxies kiwix-serve paths (`/content/…`, `/skin/…` …) so articles are same-origin. EPUB files are served from inside the zip at `/epub/<docId>/<path>`. | One window is easier for children/non-technical users; avoids X-Frame/CSP issues; EPUB has no reliable viewer on 16.04. |
| PDFs | Opened in Evince at the page (`--page-index`, `--find`), fallback `xdg-open`; macOS `open`. Never loaded into Electron. | Memory. |
| kiwix-serve | The server checks `127.0.0.1:8080`; if not running and binary + ZIMs exist it starts it, and stops it on exit only if it started it. | Single place for the lifecycle; works in Electron and Firefox modes. |
| Release asset | `library-search-linux-ia32-vX.Y.Z.tar.gz` (not zip) | `tar` is always on Ubuntu and keeps exec bits; `unzip` may be missing. |
| Repo | Repo root = `library-search-app/` (owner choice). The download kit lives in `kit/` and ships inside the app. | |
| Download kit | Scripts 1-5, the kit guide and the book lists (`kit/booklists/`) live in the app and arrive with every update; there is no separate kit folder and the installer copies nothing out of the app (`--kit` is accepted and ignored). Scripts 2-5 work on the library folder (first argument, else the current folder when it holds `NN Name` folders; `kit/library-folder.sh`). The user's own list is `<library>/booklist-local.txt` (created from `booklist-local-template.txt`; updates never touch it). **Downloaded resources never live inside the app home**: books, ZIMs, kiwix-tools, the user's list and logs stay in the library folder, so deleting or reinstalling the app keeps them; the scripts refuse a library inside the app home. | Owner decision (2026-10-18): an old hand-copied kit with a stale list said "nothing new to download"; the app folder is replaced on every update and may be deleted. |
| Updates | The app updates itself from the GitHub releases of the (public) repo: on by default, switch on Settings → Updates. Only the **server** process goes online, only to GitHub; the window stays zero-network. Download → sha256 check → installed by `6-install-or-update-search-app.sh` when the app closes, or at once on "Restart now". | Owner request (2026-10-16), reversing HANDOFF's "no update checks". Offline nothing happens. Reusing the install script keeps one tested swap path (keep `.old` until the new version is in). |

| Downloads in the app (K2-K5, 2026-10-18) | Library -> **Get books** (`#/books`, tabs Books on the lists / Save by hand / Encyclopedias). One downloader program (`build/downloader/downloader.js`) runs as a child process of the server, like the indexer, with two jobs that may run side by side: `books` (the F/S/A lists, the same rules as `2-download-pdf-books.sh`; a parity test runs both on one fake site) and `zims` (Kiwix .zim files and kiwix-tools; resume across dropped connections, renamed only when whole, FAT32 and free-space checks). The library's bookkeeping is `<library>/library-search-downloads.json` (failures with plain reasons, books saved by hand, the files each page / archive.org item produced, the encyclopedia choice and a "continue at next start" mark), so it travels with the books. Firefox is started by the server for web pages (`/api/open-url`, http(s) only). New lists come from GitHub between releases (`src/server/lists.ts`). | Owner request (handoff K2-K5); the window stays zero-network, Electron's own CA store makes HTTPS work on 16.04 (checked in the i386 container). |

## Layout

```
library-search-app/
  src/shared/        shared by server, Electron main + UI: API types (api.ts), dark-mode palette (darkPalette.ts)
  src/server/        HTTP server, search, kiwix, opener, config, db
  src/indexer/       walk + pdftotext/pdfinfo + EPUB reader + writer
  src/downloader/    book lists, link rules, validation, one-file download (resume), books + encyclopedia jobs, overviews
  src/main/          Electron main + preload
  src/ui/            React app (index.html, main.tsx, components, styles.css)
  kit/               download scripts 1-5, 6-* launchers, kit guide, booklists/ (all ship inside the app)
  scripts/           build, package, docker ia32 test, m0-check
  tests/             vitest unit/integration tests + fixtures
  index/             library.sqlite (gitignored)
  dist/              packaged app (gitignored)
```

Build output: `build/{main,server,indexer,ui}` via esbuild. Server/indexer target `node12` syntax (so Electron 11/13 fallbacks still work); UI targets `es2017` (old Firefox) — avoid Node APIs newer than 12 (`fs.rm`, `AbortController`, global `fetch`, `.at()`, `Object.hasOwn`, `replaceAll`).

## Library roots and paths

The app may be installed anywhere; it does not have to sit inside the library.
- App home = the folder holding `dist/` (packaged: `<home>/dist/library-search-<os>-<arch>/resources/app`), or the repo in dev.
- Roots: `--library-root <dir>` (repeatable) → `LIBRARY_ROOTS` env → folders chosen in the app (`settings.json`
  `libraryRoots`, set on Library → Library folders; native folder picker in Electron, typed path in Firefox mode;
  validated: must hold `NN Name` topic folders or a Kiwix folder with ZIMs) → auto-detect: ancestors of the app home
  (≤ 5 levels) holding a `NN Name` folder. Changing folders in the app applies live (kiwix-serve restarts) and the
  next index update drops books of a previous library (`meta.roots` differs → strict purge).
- Data dir (index, logs, settings): `--data-dir` → app home if writable → `~/.local/share/library-search`.
- Launchers don't pass roots; they find the app via (1) their own location inside the package, (2) a git checkout,
  (3) `~/.config/library-search/app-home` written by the installer, (4) `<kit>/library-search-app`.
- Index stores `relpath` relative to its root, so an index built on the Mac works on the CF-30.
- Category = first path segment with the leading number stripped (`01 Medicine` → `Medicine`). Subfolder (e.g. `Hesperian (chapters)/en_wtnd_2025`) is shown as a series label.
- Kiwix folder: a root-level directory whose name contains `Kiwix` (`15 Offline Encyclopedias (Kiwix)`), `*.zim` inside; binary `kiwix-tools/kiwix-serve` there, else `--kiwix-serve`, else `kiwix-serve` on PATH. Numbered folders containing "Kiwix" are not book categories.

## Entry points and flags

Packaged app: `dist/library-search-linux-ia32/library-search` (Electron); app files in `resources/app/`
(`package.json`, `build/…`, `node_modules/node-sqlite3-wasm`, `kit/`). No asar.

| Entry | Run as | Flags |
| --- | --- | --- |
| `build/main/main.js` | `library-search [flags]` (Electron) | `--library-root <dir>` (repeatable), `--data-dir <dir>`, `--kiwix-port 8080`, `--kiwix-serve <path>`, `--no-update`, `--self-test` (implies `--no-update`) (load UI, check `/api/status`, print JSON report, exit 0/1), Chromium flags like `--disable-gpu`, `--no-sandbox` |
| `build/server/server.js` | `ELECTRON_RUN_AS_NODE=1 library-search resources/app/build/server/server.js [flags]` (or `node` on the Mac) | same root/data/kiwix flags, `--port <n>` (default 0 = random in Electron mode, 8090 in browser mode), `--mode electron\|browser`, `--open-browser`, `--no-kiwix-autostart`, `--no-update` (or `LIBRARY_SEARCH_NO_UPDATE=1`). Ready: `process.send({type:'ready', url, port, token})` when forked, and prints `LIBRARY_SEARCH_READY <url>` on stdout. |
| `build/downloader/downloader.js` | same as server, started by the server | `--job books --library <dir> --list <file>… [--check-url] [--archive-base] [--min-free-mb 500] [--stall-seconds 60]`, or `--job zims --library <dir> --kiwix-dir <dir> --list encyclopedias.txt --zim <prefix>… [--mirror] [--retries 200] [--retry-seconds 20] [--stall-seconds 120]`; `--log <file>`, `--json`. IPC `{type:'progress'}` and `{type:'zim-done', file}`; exit 0 done / 1 failed / 3 stopped |
| `build/indexer/indexer.js` | same as server | root/data flags, `--full` (re-index everything), `--json` (JSON-lines progress on stdout: `{"type":"progress",…BuildProgress}`), exit 0 ok / 1 failed / 3 cancelled (SIGTERM) |

## Index schema (SQLite FTS5)

```sql
meta(key TEXT PRIMARY KEY, value TEXT)                 -- schema_version, last_build_started/finished
docs(id INTEGER PRIMARY KEY, relpath TEXT UNIQUE, root TEXT, title TEXT, category TEXT, folder TEXT,
     subfolder TEXT, kind TEXT, pages INTEGER, chars INTEGER, size INTEGER, mtime INTEGER,
     status TEXT /* ok | scanned | error */, error TEXT, indexed_at INTEGER)
pages  USING fts5(text, tokenize='porter unicode61 remove_diacritics 2')   -- rowid = doc_id*100000 + page
titles USING fts5(title, category, tokenize='porter unicode61 remove_diacritics 2') -- rowid = doc_id
```

- Titles: a good PDF metadata title (junk like `ES-prelims.pmd`, `Subject:`, `Chapter 1` is rejected) → Hesperian
  chapter PDFs (`en_<code>_<year>_<part>.pdf`): heading from page 1 + series label "Book (year) · Chapter N" →
  code-like names in a subfolder: "Ship Captains Medical Guide — Chapter 8" → humanized file name.
- Copied libraries: `docs.fp` = sha1(size + first/last 64 KB). Same size + new mtime + same fp = unchanged
  (only the date is updated), so a Mac-built index survives `cp -r` / USB copies to the CF-30.
- Notice codes are kebab-case (`no-index`, `index-busy`, `no-pdftotext`, `file-missing`, …).
- Incremental: skip when `(size, mtime)` unchanged (or only mtime changed with the same fingerprint). Each document is one transaction (delete rowid range, insert pages, upsert doc). Deleted files are purged only if the walk found at least one file.
- `scanned` = average < 25 non-space chars per page (listed in the UI as not searchable).
- Text cleanup: join `word-\nword` hyphenation, collapse whitespace.
- Locking: node-sqlite3-wasm uses a `library.sqlite.lock` directory (mkdir lock), so server and indexer can't corrupt each other but can't overlap. Server retries on `SQLITE_BUSY` (≤ 3 s). On server start, a stale lock is removed if no indexer pid (from `index/indexer.pid`) is alive.

## Search

- Query parsing: `"quoted phrases"`, `prefix*`, plain words. Every token is quoted for FTS5 (no syntax errors possible). English stop-words are dropped unless everything is a stop-word or inside quotes. AND first; if 0 hits, OR ("Showing pages that match some of your words").
- Ranking: `bm25(pages)` top 400 page hits → grouped per doc in JS (best page + hit count bonus + title-match bonus from `titles`). Title-only matches (e.g. scanned books) are included. Snippets computed only for the pages shown (second query with `rowid IN (…)`). Highlight markers `…` (UI renders as `<mark>`).

## API (server, 127.0.0.1)

All `/api/*` calls carry header `X-Token` (token is injected into index.html as `<meta name="ls-token">`). Types in `src/shared/api.ts`.

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/status` | `Status` (version, mode, roots, index stats + build progress, kiwix state, tools) |
| GET | `/api/search?q=&category=&limit=` | `BookSearchResponse` |
| GET | `/api/kiwix/books` | `KiwixBook[]` |
| GET | `/api/kiwix/search?book=&q=&limit=` | `KiwixSearchResponse` |
| POST | `/api/kiwix/start` | `KiwixStatus` |
| GET | `/api/browse` | `Category[]` |
| GET | `/api/browse/docs?category=` | `DocSummary[]` |
| GET | `/api/index/problems` | `DocSummary[]` (scanned + errors) |
| POST | `/api/index/build` / `/api/index/cancel` | `IndexStatus` |
| POST | `/api/open` `{docId, page?, q?}` | `OpenResult` (`how: evince|xdg-open|open|reader`, `readerUrl?`) |
| GET / POST | `/api/settings` (POST takes any subset) | `Settings` (`theme`, `libraryRoots`, `autoUpdate`, `darkTint`, `darkLevel`); bad values are ignored or clamped |
| GET | `/api/update` (also `Status.update`) | `UpdateStatus` |
| POST | `/api/update/check` / `/api/update/download` | `UpdateStatus` (check waits for GitHub; a download runs in the background) |
| POST | `/api/update/install` | `UpdateStatus` `installing`, then the app closes ("Restart now") |
| GET | `/api/books` | `BooksOverview` (per topic: on the list / here / failed; destination or the problem with it; offline-safe) |
| POST | `/api/books/download` / `/api/books/cancel` | `DownloadProgress` (also `Status.downloads.books`); 409 with the problem when the library folder can't be used |
| POST | `/api/books/done` `{id, done}` | `BooksOverview` (book saved by hand) |
| GET / POST | `/api/manual`, `/api/manual/done` `{id, done}` | `ManualItem[]` (books to save by hand, ticks) |
| GET | `/api/zims` | `EncyclopediasOverview` |
| POST | `/api/zims/download` `{ids}` / `/api/zims/cancel` | `DownloadProgress` (also `Status.downloads.zims`) |
| POST | `/api/lists/check` | `ListsStatus` (also `Status.lists`) |
| POST | `/api/open-url` `{url}` | `OpenResult` (`firefox`; http(s) only) |
| GET | `/epub/<docId>/<path in zip>` | file from inside an EPUB |
| GET | `/content/…`, `/skin/…`, `/catalog/…`, `/search…`, `/random…`, `/raw/…`, `/catch/…`, `/viewer…` | proxied to kiwix-serve |

## UI (1024×768, touch)

Guidelines: WCAG 2.2 AA (text contrast ≥ 4.5:1, visible focus ring, targets ≥ 44 px, `prefers-reduced-motion`), Nielsen heuristics (system status always visible, plain-language errors with the fix, undo/back everywhere), semantic landmarks + ARIA live region for result counts. Base font 16 px; result titles 18 px.

Get books (`#/books`, `#/books/manual`, `#/books/encyclopedias`; the header keeps Library highlighted): a download card (where the books go, free space, Download missing books (N), progress with Stop -> "Stopping…", Update index afterwards), where the lists come from with **Check for new lists**, books per topic, and the failures with Open in Firefox / Mark as done; Save by hand: the 38 items grouped by topic with tick boxes; Encyclopedias: tick boxes with sizes and state, FAT32 / reader notices, try number and "continues after a restart".

Screens (hash routes): `#/` home (big search, example chips, category tiles) · `#/search?q=&f=` results (filter chips: All · Books · Wikipedia & reference · Khan Academy · Q&A; category select for books) · `#/read?u=` reader (toolbar: Back to results, ‹ ›, Find, Open in Firefox) · `#/browse[/<category>]` · `#/library` (library folders, then two columns of about equal height: book index + "books that can't be searched" | Kiwix status/start + helper programs) · `#/settings` (app settings, not about the library: Appearance with the dark colors, Help, Updates, About) · `#/docs[/<section>]` the guide, opened from Settings → Help (and "How should the library folder look?" in the folder chooser): table of contents + one section at a time with Previous/Next; sections Getting started, Searching, Opening books and articles, Setting up your library folder, The book index, Encyclopedias, Helper programs, Appearance and updates, When something goes wrong, Where things are kept. Content is data in `src/ui/docs.ts` (`**bold**` = a button/page name, `` `code` `` = a command), offline like everything else; two blocks are live (installed helper programs, this computer's folders) and commands have a Copy button. `tests/ui/docs.test.tsx` checks every quoted button name still matches `strings.ts`, links resolve, and each section renders.

Header: logo (= Home) · search bar (the magnifier is only the Search button, on the right; no icon inside the field)
· Home · Browse · Library · Settings (dot on Library for problems, on Settings when an update is ready or failed). No
theme button: light/dark is chosen on Settings → Appearance. Up to 1100 px wide (the CF-30's 1024) the app name next to
the logo is hidden so the search bar stays long; below 940 px the nav shows icons only. On Home the header has no search
bar: the big box's button shows the magnifier and the word "Search". Status bar: one button for books + encyclopedias
(opens Library) and, when an update is downloaded, a second "Update ready" button (opens Settings).

Themes: light (default for sunlight) and dark. The dark colors are chosen on Settings → Appearance: a tint (Navy, Slate,
Charcoal, Warm, Forest, Plum) and a darkness level 1-5 (Softer … Darker; 5 is near black). Default Navy 3 = the original
navy (`#071226` / `#0b1a33`). All dark tokens come from `src/shared/darkPalette.ts` (HSL ramp per tint; text, accent and
status colors are lightened until they meet their contrast target), and `tests/shared/darkPalette.test.ts` checks WCAG
contrast for every tint × level (body text 7:1, muted/links/buttons 4.5:1, focus ring 3:1). styles.css holds only the
light tokens; the server stamps `<style id="ls-dark">` (after app.css) and `<meta name="ls-dark" content="tint:level">`
into index.html, and the UI rewrites that element live (saving is debounced). The Electron start page and EPUB chapters use
the same palette. Settings `theme` (`system | light | dark`), `darkTint`, `darkLevel` and `autoUpdate` live in
`<data dir>/settings.json` (`GET/POST /api/settings`) because the app's port, and so browser storage, changes every launch;
the server stamps `data-theme` on `<html>` so the first paint is right. Settings → Appearance offers Same as computer /
Light / Dark (there is no header toggle any more). Kiwix articles keep their own page styles.

Keyboard: `/` focuses search, Enter searches, ↑/↓ move between results, Enter opens, Esc leaves the reader. Strings live in `src/ui/strings.ts` (Romanian later).

## Updates

`src/server/update.ts` (server process; never the window). Supported only in an installed Linux package
(`<home>/dist/library-search-linux-<arch>/resources/app`, home writable, install script present); a dev checkout, macOS
or `--no-update` shows the reason instead.

1. Check: 30 s after start, then every 6 h while running (only with `autoUpdate`), or on "Check for updates":
   `GET api.github.com/repos/<repo>/releases/latest`. Repo = package.json `repository` (baked in at build time),
   `LIBRARY_SEARCH_REPO` overrides; `GITHUB_TOKEN` is used if set (never sent on to the storage host it redirects to).
   Asset = `library-search-linux-<arch>-v<X.Y.Z><suffix>.tar.gz`; suffix `-e13` etc. comes from `releaseSuffix` in the
   packaged `package.json` (fallback Electron builds stay on their kind). Offline = state `offline`, no alarm.
2. Download into `<home>/dist/.update/` (`.part`, then rename), sha256 against the asset's GitHub `digest` or the
   `.sha256` asset; `ready.json` records it, so a restart keeps it.
3. Install: the server copies the install script to `.update/install.sh` and starts it detached
   (`--wait --no-pin --status-file …`, plus `--relaunch[-firefox]` for "Restart now"), writing `installing.json`
   `{from, to}` first. The script waits for every `<dest>/library-search` process to exit (2 min), swaps the folders
   (old kept until the new is in place), and writes `ok <v>` / `busy` (app reopened: retried at the next close) /
   `failed <reason>`. Output: `<data dir>/logs/update.log`.
4. Next start: `installing.json` + the running version tell "updated from X" (toast + card) or the failure (shown,
   not retried by itself until the user clicks Try again / Check for updates). `ELECTRON_RUN_AS_NODE` is removed
   from the script's environment so the relaunched app starts as the app.

Machines on 0.1.x install 0.2.0 once with the script; from then on the app updates itself.

## Verification

- Unit/integration: vitest on the Mac (query parser, zip/EPUB reader, kiwix XML parsing, indexer on fixtures, search ranking,
  updates against a fake GitHub with the real install script, WCAG contrast of every dark tint × level, the guide's
  button names against the real UI labels).
- `scripts/docker-ia32-test.sh`: packaged linux-ia32 build inside `i386/ubuntu:xenial` → `ldd` missing libs, max GLIBC symbol ≤ 2.23, server + indexer smoke test on fixtures via `ELECTRON_RUN_AS_NODE`, best-effort Electron launch under Xvfb (`--self-test`).
- `scripts/m0-check.sh` on the real CF-30 → report pasted into `NOTES.md`.
