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
| Repo | Repo root = `library-search-app/` (owner choice). Kit-root launchers live in `kit/` and are copied to the kit root by the install script. | |

## Layout

```
library-search-app/
  src/shared/        API types shared by server + UI (api.ts)
  src/server/        HTTP server, search, kiwix, opener, config, db
  src/indexer/       walk + pdftotext/pdfinfo + EPUB reader + writer
  src/main/          Electron main + preload
  src/ui/            React app (index.html, main.tsx, components, styles.css)
  kit/               6-*.sh / .desktop launchers + README section (copied to kit root)
  scripts/           build, package, docker ia32 test, m0-check
  tests/             vitest unit/integration tests + fixtures
  index/             library.sqlite (gitignored)
  dist/              packaged app (gitignored)
```

Build output: `build/{main,server,indexer,ui}` via esbuild. Server/indexer target `node12` syntax (so Electron 11/13 fallbacks still work); UI targets `es2017` (old Firefox) — avoid Node APIs newer than 12 (`fs.rm`, `AbortController`, global `fetch`, `.at()`, `Object.hasOwn`, `replaceAll`).

## Library roots and paths

- Roots: `--library-root <dir>` (repeatable) → `LIBRARY_ROOTS` env (`:`-separated) → auto-detect: walk up from the app dir (≤ 5 levels); every ancestor containing a `NN Name` folder is a root (Mac: `Community Rebuild Library/`; CF-30: the kit).
- Data dir (index, logs, settings): `--data-dir` → nearest ancestor named `library-search-app` → `~/.local/share/library-search`.
- Index stores `relpath` relative to its root, so an index built on the Mac works on the CF-30.
- Category = first path segment with the leading number stripped (`01 Medicine` → `Medicine`). Subfolder (e.g. `Hesperian (chapters)/en_wtnd_2025`) is shown as a series label.
- Kiwix folder: a root-level directory whose name contains `Kiwix` (`15 Offline Encyclopedias (Kiwix)`), `*.zim` inside; binary `kiwix-tools/kiwix-serve` there, else `--kiwix-serve`, else `kiwix-serve` on PATH. Numbered folders containing "Kiwix" are not book categories.

## Entry points and flags

Packaged app: `dist/library-search-linux-ia32/library-search` (Electron); app files in `resources/app/`
(`package.json`, `build/…`, `node_modules/node-sqlite3-wasm`, `kit/`). No asar.

| Entry | Run as | Flags |
| --- | --- | --- |
| `build/main/main.js` | `library-search [flags]` (Electron) | `--library-root <dir>` (repeatable), `--data-dir <dir>`, `--kiwix-port 8080`, `--kiwix-serve <path>`, `--self-test` (load UI, check `/api/status`, print JSON report, exit 0/1), Chromium flags like `--disable-gpu`, `--no-sandbox` |
| `build/server/server.js` | `ELECTRON_RUN_AS_NODE=1 library-search resources/app/build/server/server.js [flags]` (or `node` on the Mac) | same root/data/kiwix flags, `--port <n>` (default 0 = random in Electron mode, 8090 in browser mode), `--mode electron\|browser`, `--open-browser`, `--no-kiwix-autostart`. Ready: `process.send({type:'ready', url, port, token})` when forked, and prints `LIBRARY_SEARCH_READY <url>` on stdout. |
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
| GET | `/epub/<docId>/<path in zip>` | file from inside an EPUB |
| GET | `/content/…`, `/skin/…`, `/catalog/…`, `/search…`, `/random…`, `/raw/…`, `/catch/…`, `/viewer…` | proxied to kiwix-serve |

## UI (1024×768, touch)

Guidelines: WCAG 2.2 AA (text contrast ≥ 4.5:1, visible focus ring, targets ≥ 44 px, `prefers-reduced-motion`), Nielsen heuristics (system status always visible, plain-language errors with the fix, undo/back everywhere), semantic landmarks + ARIA live region for result counts. Base font 16 px; result titles 18 px.

Screens (hash routes): `#/` home (big search, example chips, category tiles) · `#/search?q=&f=` results (filter chips: All · Books · Wikipedia & reference · Khan Academy · Q&A; category select for books) · `#/read?u=` reader (toolbar: Back to results, ‹ ›, Find, Open in Firefox) · `#/browse[/<category>]` · `#/library` (index status + build button + progress, problems list, Kiwix status/start, About).

Themes: light (default for sunlight) and a dark-blue theme (navy `#0a1930` / `#10223f`, never black), both WCAG AA.
Setting `system | light | dark` lives in `<data dir>/settings.json` (`GET/POST /api/settings`) because the app's port,
and so browser storage, changes every launch; the server stamps `data-theme` on `<html>` so the first paint is right.
Header sun/moon button toggles; Library → Appearance offers "Same as computer". EPUB chapters follow the theme;
Kiwix articles keep their own page styles.

Keyboard: `/` focuses search, Enter searches, ↑/↓ move between results, Enter opens, Esc leaves the reader. Strings live in `src/ui/strings.ts` (Romanian later).

## Verification

- Unit/integration: vitest on the Mac (query parser, zip/EPUB reader, kiwix XML parsing, indexer on fixtures, search ranking).
- `scripts/docker-ia32-test.sh`: packaged linux-ia32 build inside `i386/ubuntu:xenial` → `ldd` missing libs, max GLIBC symbol ≤ 2.23, server + indexer smoke test on fixtures via `ELECTRON_RUN_AS_NODE`, best-effort Electron launch under Xvfb (`--self-test`).
- `scripts/m0-check.sh` on the real CF-30 → report pasted into `NOTES.md`.
