# Handoff: "Library Search" desktop app for the Community Rebuild Library

**For:** Claude Code. **Owner:** Bogdan. **Date:** 2026-10-15.
Build a simple, offline desktop app that searches **everything** in this library from one search box:
the PDF/EPUB books and the Kiwix ZIM collections (Wikipedia, WikiMed, Khan Academy, Stack Exchange, etc.).
It must run on an old 32-bit Panasonic Toughbook CF-30 with Ubuntu 16.04 and no internet.

Read the whole doc before starting. Section 2 lists hard constraints that rule out most modern defaults.

---

## 1. Goal and users

- A family/community member types a question ("purify water", "set a broken arm", "fractions grade 4")
  and gets ranked results from all sources, each with a short snippet, and opens the hit in one click.
- Users are non-technical; some may be children. The machine may run on solar/battery, offline for years.
- Simplicity and robustness beat features. If something can fail, it must fail visibly and recoverably.

## 2. Target machine and hard constraints (must hold)

| Item | Value | Consequence |
| --- | --- | --- |
| Hardware | Panasonic Toughbook CF-30, Intel Core (2) Duo ~1.6 GHz, **32-bit** | Slow CPU; keep work off the UI thread |
| OS | **Ubuntu 16.04 LTS i386** (user wrote "16.8"; it's 16.04), glibc 2.23, `uname -m` = i686 | Very old userland |
| RAM / swap | **3.2 GiB** / 7.4 GiB swap | Never load the whole index or large files into memory |
| Disk | HDD now (~443 GB free), likely SATA SSD soon | Sequential I/O OK; avoid random-I/O-heavy designs |
| Screen | 13.3" **1024x768**, touchscreen on some units | Layout must fit 1024x768; large hit targets |
| Network | **None** at runtime | Zero network calls except to `localhost` (kiwix-serve) |
| Browser | Firefox (version as installed; no longer updated on 32-bit) | Fallback UI target (see section 8) |
| Python | `python3` 3.5 from Ubuntu 16.04 (stdlib only) | No f-strings (3.6+), no pip installs |

**Electron on 32-bit Linux:** Electron shipped `linux-ia32` binaries until about v18; Electron 18 notes say it
"will no longer run on 32-bit Linux systems" and v19 removed ia32 binaries (Chromium 102 dropped it).
- Target the **newest version that actually runs on the CF-30**: start with **Electron 17.x linux-ia32**, fall back to
  16.x / 13.x / 11.x if it fails to launch. Verify on the real machine early (milestone 0).
- Expect to need `--disable-gpu` (old Intel GMA graphics) and possibly `--no-sandbox`.
- **No native Node modules** (no better-sqlite3, node-sqlite3, etc.). Rebuilding them for old Electron on ia32 is
  fragile. Use only pure JS in Electron, and do heavy lifting via child processes (Python 3.5 / CLI tools).
- Build/package on the Mac with `electron-packager --platform=linux --arch=ia32` (or electron-builder `--ia32 --dir`).
  Ship an unpacked folder (zipped as a GitHub Release asset); no .deb/AppImage/snap required. See section 2b.

## 2b. Development workflow: Mac -> GitHub -> CF-30

Bogdan develops and tests on his **Mac (Apple Silicon, macOS)**, pushes to **GitHub**, and later pulls it onto the
CF-30. Design for both platforms from day one.

**Repository layout (recommended):** make the repo root = the contents of `Ubuntu CF-30 Kit/`, so one
`git clone` on the CF-30 brings the download scripts, booklists, README and the app together.
- Commit: scripts `0-...` to `6-...`, `booklist-*.txt`, `library-search-app/` source, launchers.
- `.gitignore`: all content folders (`0[0-9] */`, `1[0-9] */`), `*.zim`, `*.pdf`, `*.epub`, `kiwix-tools/`,
  `library-search-app/index/`, `library-search-app/dist/`, `node_modules/`, `2-*.txt`, `2-*.html`, `.DS_Store`.
- Keep the executable bit on `*.sh` (`git update-index --chmod=+x`).

**Testing on the Mac:**
- Electron: use the **same major version** chosen for the CF-30 (start 17.x; it has darwin-arm64 builds) so APIs
  don't drift. Run with `npm start` on the Mac.
- Library root must be **configurable**: on the Mac the books currently live one level above the kit
  (`~/Documents/Community Rebuild Library/01 Medicine/...`), on the CF-30 inside the kit. Support a settings
  file / `--library-root` flag / auto-detect (kit folder, then its parent) and allow several roots.
- Platform-aware "open" step: Linux -> `evince --page-index ...` (fallback `xdg-open`); macOS -> `open <file>`
  (page jump not required on Mac).
- Kiwix on the Mac: get the macOS kiwix-tools build (or `brew install kiwix-tools` if available) and one small
  ZIM (PhET ~0.1 GB or Appropedia ~0.5 GB) to test the ZIM search path. Don't hard-code the kiwix-serve path.
- **Python 3.5 compatibility while developing on a newer Python:** no f-strings, no `dataclasses`,
  no walrus, no `subprocess.run(capture_output=...)`, no dict-order assumptions. Enforce it with
  `pipx run vermin --target=3.5- --no-tips lib/` in a `make check` / npm script, and run the Python tests in a
  Docker container that matches the CF-30 userland:
  `docker run --rm --platform linux/386 -v "$PWD":/w -w /w i386/ubuntu:xenial bash -c "apt-get update && apt-get install -y python3 poppler-utils && python3 -m unittest discover -s tests"`
  (gives Python 3.5, SQLite 3.11, old pdftotext; slow under emulation but faithful).
- Keep a small test corpus in `library-search-app/tests/fixtures/` (a born-digital PDF, a scanned PDF, an EPUB, a fake
  HTML-named-.pdf) so tests don't depend on the full library.

**Releasing to the CF-30:**
- Don't commit packaged builds. Build `linux-ia32` on the Mac (`npm run dist:linux-ia32`) and attach the zip
  (e.g. `library-search-linux-ia32-vX.Y.Z.zip`) to a **GitHub Release**.
- On the CF-30: `git clone` / `git pull` the repo (after `1-fix-https-certificates.sh`; `sudo apt-get install git` if
  missing), then run a helper `6-install-or-update-search-app.sh` that downloads the latest release zip with curl and
  unpacks it into `library-search-app/dist/`. If the repo is **private**, the CF-30 needs a token or the zip is
  carried over on a USB stick: support both (the helper also accepts a local zip path).
- Version shown in the app's About box; the helper prints old -> new version.

## 3. What is in the library (inputs)

Everything lives in one folder, `Ubuntu CF-30 Kit/` (the kit), copied onto the CF-30. Paths are relative to it.

```
Ubuntu CF-30 Kit/
  0-README-start-here.md            user guide; the app adds step 6 to its run-order table
  1-fix-https-certificates.sh       ... 5-start-offline-library-in-firefox.sh   (existing, don't break)
  booklist-main.txt, booklist-linux.txt   source lists: F|folder|filename|url, S|..., A|...
  01 Medicine/ ... 14 Community & Governance/, 16 Linux & Ubuntu/   PDF + EPUB books (~550-650 files, ~2 GB)
      subfolders exist, e.g. "01 Medicine/Hesperian (chapters)/en_wtnd_2025/*.pdf" (one PDF per chapter)
  15 Offline Encyclopedias (Kiwix)/
      *.zim                          Wikipedia top-1M (~46 GB), WikiMed, Wikibooks, iFixit, Appropedia,
                                     Stack Exchange sites, PhET, LibreTexts K-12, Khan Academy (~168 GB)
      kiwix-tools/kiwix-serve        static i586 build (kiwix-tools 3.7.0 or newer)
  library-search-app/                THIS project (put source, build scripts and the packaged app here)
```

Notes on content:
- PDFs: mix of born-digital (good text) and **scanned old books** (1880s-1950s, archive.org). Most scans have an
  OCR text layer; some may have none. A few files may be HTML "bot check" pages wrongly named .pdf: skip
  anything whose first bytes aren't `%PDF`.
- EPUBs: a handful from Project Gutenberg and the Debian Handbook (zip of XHTML).
- Titles: derive from filename (underscores to spaces, strip extension) unless PDF metadata has a good title.
- Folder names are the categories (strip the leading number for display).
- The ZIM files already contain their own full-text indexes; **don't re-index ZIM content**. Query kiwix-serve.
- `5-start-offline-library-in-firefox.sh` starts `kiwix-serve --port=8080 <all .zim>`. Reuse the same port and
  binary; the app may start kiwix-serve itself if it isn't running.

## 4. Recommended architecture

```
Electron (renderer: plain HTML/CSS/JS, no framework needed)
   | IPC
Electron main process (Node, pure JS)
   |-- spawns: python3 lib/search.py --db index/library.sqlite --q "..." --limit 50  -> JSON on stdout
   |-- spawns: python3 lib/build_index.py --root <kit> --db index/library.sqlite     -> progress lines on stdout
   |-- HTTP GET http://127.0.0.1:8080/...  (kiwix-serve search, catalog)            -> merge results
   |-- opens results: evince (PDF at page) / internal window (ZIM article) / xdg-open (fallback)
```

### 4.1 Book index (PDF/EPUB)
- `build_index.py` (**Python 3.5 stdlib only**):
  - Walk the kit's numbered folders; for each PDF run `pdftotext -layout -enc UTF-8 file.pdf -` (poppler-utils;
    check `which pdftotext`, else tell the user to `sudo apt-get install poppler-utils`). Split pages on form feed `\f`.
  - EPUB: `zipfile` + strip tags with `html.parser`; treat each chapter file as a "page".
  - Store in **SQLite FTS4** (Ubuntu 16.04 ships libsqlite3 3.11; FTS5 may be missing, FTS4 is certain).
    Schema suggestion: `docs(id, path, title, category, pages, mtime, size)` + FTS4 table
    `pages(doc_id, page, text)` with `tokenize=unicode61` (check it's available; else `porter`/`simple`).
  - **Incremental**: skip files whose (size, mtime) are unchanged; remove rows for deleted files.
  - Resumable and safe to interrupt (commit per document). Print progress `N/M filename` for the UI.
  - Expect 30-90 min on the CF-30 for ~2 GB of PDFs; run with `nice -n 10`. Must be runnable on the Mac too
    (same script) so the index can be prebuilt and copied over.
  - Flag documents with ~0 extracted text as "scanned, not searchable" (list them in the UI). OCR (tesseract) is
    **out of scope** for v1; mention it as a possible later step.
- `search.py`: FTS4 `MATCH` query, rank (FTS4 has no built-in bm25; use `matchinfo()` with a simple BM25 in Python,
  or order by match count + title boost), return JSON: title, category, path, page, snippet (`snippet()`), score.
  Support plain words, "quoted phrases" and prefix* terms; sanitize user input so FTS syntax errors can't crash it.

### 4.2 ZIM search via kiwix-serve
- Discover books from kiwix-serve's catalog (`/catalog/v2/entries` in kiwix-tools 3.x). Search per book with the
  full-text endpoint (e.g. `/search?books.name=<name>&pattern=<q>`; try `&format=xml` for machine-readable
  OpenSearch results). **Verify the exact endpoints against the installed kiwix-serve with curl first**; the API
  changed across 3.x releases. Parse defensively.
- Query books in parallel with a short timeout (HDD is slow); show book results as they arrive.
- Result click opens `http://127.0.0.1:8080/content/<book>/<path>` in an app window (back/forward/home, find-in-page)
  or in Firefox via a "Open in Firefox" button.

### 4.3 Opening book results
- PDF: `evince --page-index=<n> --find="<terms>" <file>` (Evince is Ubuntu 16.04's default viewer; confirm the
  flags with `evince --help`; fall back to `xdg-open <file>`). EPUB: `xdg-open`.
- Never load PDFs into Electron memory.

## 5. Features

**MVP (v1)**
1. One search box; results grouped or interleaved by source: Books, Wikipedia & reference, Khan Academy, Q&A sites.
2. Filters: source type and category (the numbered folders).
3. Result row: title, category, page number, 1-2 line snippet with highlighted terms.
4. Click to open (section 4.3 / 4.2). Keyboard: Enter searches, arrow keys move, Enter opens.
5. "Browse" view: list of categories, then documents in each (for people who don't know what to search for).
6. Index screen: shows index status (docs indexed, last build, unsearchable scans) and a "Rebuild / update index"
   button with progress. First launch with no index: explain and offer to build it.
7. Status line: whether kiwix-serve is running; button to start it.

**Nice to have (v2, only after MVP is solid)**
- Search-as-you-type with debounce, search history, Romanian UI strings toggle, "large text" mode,
  bookmarks, print helper, OCR of scanned PDFs with tesseract (if installable offline).

## 6. UX requirements
- Fits 1024x768 with no horizontal scroll; base font >= 16px; buttons >= 40px tall (touch/gloves).
- High contrast, works in bright sunlight. No animations needed.
- Plain-language errors with the fix ("Search index not built yet - click Build index (takes about an hour)").
- Everything works with the network cable unplugged. No telemetry, no update checks, no remote fonts/CDNs.

## 7. Deliverables
1. Source in `library-search-app/` (Electron app + `lib/*.py`), with a short `README.md` for developers.
2. A packaged **linux-ia32** app folder (e.g. `library-search-app/dist/library-search-linux-ia32/`).
3. Launchers in the kit root (= repo root), following the existing naming scheme:
   - `6-search-the-library.sh` (starts kiwix-serve if needed, then the app; passes `--disable-gpu`)
   - `6-search-the-library.desktop` (Name "6 · Search the library"; use `Exec=bash -c 'cd "$(dirname "$0")" && bash 6-search-the-library.sh' %k`;
     this pattern handles folder names with spaces)
   - `6-install-or-update-search-app.sh` (downloads/unpacks the release zip, or takes a local zip path)
   - optional `6-build-search-index.sh` for building the index from a terminal.
4. Update `0-README-start-here.md`: add step 6 to the run-order table and a short "Search the library" section.
5. Index file location: `library-search-app/index/library.sqlite` (gitignored; rebuildable).

## 8. Fallback if Electron won't run on the CF-30
If no Electron ia32 build launches on Ubuntu 16.04 i386, ship the **same HTML/JS UI as a local web app**:
a tiny Python 3.5 stdlib HTTP server (`http.server` + JSON endpoints wrapping `search.py`, proxying kiwix-serve)
bound to 127.0.0.1, opened in Firefox by `6-search-the-library.sh`. Design the renderer code so it can talk to
either Electron IPC or `fetch('/api/...')` through one small adapter, so the fallback costs little.

## 9. Milestones and acceptance
- **M0 - Feasibility on the real machine (do first):** set up the repo (section 2b) and a release pipeline with a
  "hello world" app, then on the CF-30: the "hello world" Electron linux-ia32 build launches; `python3 --version`, `which pdftotext evince`, SQLite FTS4 available (`python3 -c "import sqlite3;
  c=sqlite3.connect(':memory:'); c.execute('create virtual table t using fts4(x)')"`), kiwix-serve search endpoint
  confirmed with curl. Record the results in `library-search-app/NOTES.md`. Decide Electron vs fallback here.
- **M1 - Book search:** build_index + search.py working on the real library; CLI test: `python3 lib/search.py --q
  "water purification"` returns sensible hits with page numbers in < 2 s on the CF-30.
- **M2 - App UI:** search, filters, open PDF at page, browse view, index screen.
- **M3 - ZIM search:** merged Kiwix results, open articles, kiwix-serve start/status.
- **M4 - Packaging & docs:** launchers, README update, cold-start test on the CF-30 with network unplugged.

**Acceptance tests (on the CF-30, offline):**
- Queries "boil water", "splint", "fractions", "solar panel wiring", "canning tomatoes", "chmod" each return
  relevant results from books and, where applicable, Wikipedia/Khan/Stack Exchange.
- Opening a PDF result lands on the right page. Opening a ZIM result shows the article.
- App launch to usable < 15 s; typical search < 3 s (books) and results streaming in from ZIMs.
- Memory: app + kiwix-serve + Evince stays under ~1.5 GB RSS.
- Killing the index build halfway and restarting resumes without corruption.
- Missing pieces (no index, kiwix-serve not running, no ZIM files, pdftotext missing) each show a clear message.

## 10. Out of scope (v1)
OCR, editing/annotating documents, syncing between machines, user accounts, downloading new content
(the numbered scripts 2-4 already do that), any cloud/AI features.

## 11. Things to verify rather than assume
- Exact last Electron version that runs on this i386 16.04 install (start at 17.x).
- kiwix-serve 3.x search/catalog endpoints and response formats on the installed version.
- Evince CLI flags for page and find on 16.04's Evince.
- SQLite tokenizer availability (`unicode61`) in libsqlite3 3.11.
- Whether Firefox on the CF-30 handles the fallback UI (it should; keep JS to ES2017 for safety).
