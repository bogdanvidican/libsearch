# Handoff: bring the download kit (scripts, book lists, instructions) into Library Search

**For:** Claude Code, working in this repo (`bogdanvidican/libsearch`). **Owner:** Bogdan. **Date:** 2026-10-18.
Read `HANDOFF.md` (constraints: CF-30, Ubuntu 16.04 i386, Electron 17, 3.2 GiB RAM, offline) and
`docs/design.md` first. Everything there still applies.

## 1. Goal

Today the library is filled by a separate "Ubuntu CF-30 Kit" folder of bash scripts plus a README, copied to the CF-30
by hand (USB/zip). That caused real problems: the CF-30 ran an **old zip with an old book list** and reported "nothing
new to download", and every list update needs another manual copy.

Make the app the one place that holds and ships all of it:
1. The scripts, book lists and instructions live **in this repo** and travel with every app release / update.
2. The app can **download missing books itself** ("Get books"), with progress, resume, and a clear list of failures.
3. The README's instructions and the **manual-download checklist** become part of the in-app **Guide** / Library pages.
4. The bash scripts keep working on their own (no app needed), from the same book lists.

## 2. Source material (import exactly; these are the current versions)

Location on Bogdan's Mac: `~/Documents/Community Rebuild Library/Ubuntu CF-30 Kit/` (sibling of this repo):

| File | What it is |
| --- | --- |
| `0-README-start-here.md` | User guide: run order table, CF-30 notes (32-bit, HDD, swap), Khan Academy steps, **manual downloads checklist** (sections "Manual downloads in Firefox", "Construction & metalwork", "Engines, vehicles & motors", FAO web-only manuals), Linux manuals, reading/printing tips |
| `1-fix-https-certificates.sh` (+ `.desktop`) | `sudo`: updates ca-certificates, disables expired DST Root CA X3 (needed for curl on 16.04) |
| `2-download-pdf-books.sh` (+ `.desktop`) | The PDF/EPUB downloader (details in section 4) |
| `3-download-offline-wikipedia.sh` (+ `.desktop`) | Kiwix ZIMs (newest file per prefix from download.kiwix.org) + kiwix-tools i586/x86_64; FAT32 check |
| `4-download-khan-academy.sh` (+ `.desktop`) | 168 GB Khan ZIM: resume loop, stall restart, free-space check, ZIM magic check |
| `5-start-offline-library-in-firefox.sh` (+ `.desktop`) | kiwix-serve on :8080 + Firefox |
| `booklist-main.txt` | **229 entries**, categories `01`-`14`, `17 Engines & Vehicles`, `18 Electric Motors & E-Vehicles` (with subfolders) |
| `booklist-linux.txt` | Linux/Ubuntu manuals -> `16 Linux & Ubuntu` |

`15 Offline Encyclopedias (Kiwix)` is the ZIM folder. The repo already has `kit/6-*` (install/search/index launchers)
and `kit/README-section.md`; the installer (`kit/6-install-or-update-search-app.sh`) already copies launchers into
the kit root.

## 3. Repository layout (target)

```
kit/
  0-README-start-here.md        (moved here; becomes the canonical copy; keep the 6-* rows/section from README-section.md merged in)
  1-fix-https-certificates.sh / .desktop
  2-download-pdf-books.sh / .desktop
  3-download-offline-wikipedia.sh / .desktop
  4-download-khan-academy.sh / .desktop
  5-start-offline-library-in-firefox.sh / .desktop
  6-...                         (existing)
  booklists/
    booklist-main.txt           (canonical)
    booklist-linux.txt
    manual-downloads.txt        (NEW, structured - see 4.4)
```
- The release tarball must include `kit/` (check `scripts/package.mjs` staging).
- `6-install-or-update-search-app.sh` copies kit files to the **kit root** on install/update:
  scripts + `.desktop` + README always overwritten; booklists overwritten **except** a user file
  `booklist-local.txt` that is never touched (document it: "add your own books here").
  Keep exec bits; keep paths-with-spaces/`&` safe (folder is "Community Rebuild Library").
- Bash scripts must read `booklist-main.txt`, `booklist-linux.txt` **and** `booklist-local.txt` if present.

## 4. Behaviour to preserve (from `2-download-pdf-books.sh`) - the in-app downloader must match it

### 4.1 Book list format (do NOT change it; both bash and TS must parse it)
```
# comment lines and blank lines ignored; CR stripped
F|<folder>|<filename>|<url>          single file  -> <root>/<folder>/<filename>
S|<folder>|<page url>|<regex>        scrape: every link on the page matching the ERE regex (strip href="..."),
                                     resolve relative URLs (http*, //, /, relative to page dir), &amp;->&, spaces->%20;
                                     filename = last path segment w/o query, %20->_, add .pdf if missing;
                                     if page URL contains "hesperian": put in <folder>/<parent dir of the link>
A|<folder>|<archive.org identifier>  every *.pdf in https://archive.org/metadata/<id> except *_text.pdf,
                                     download from https://archive.org/download/<id>/<name>
```
Folders may contain spaces, `&`, commas and `/` (subfolders). URLs may contain `(`, `)`, `&`, `%20`, `?`.
The `<url>` field is the rest of the line after the 3rd `|` (bash `read -r t a b c`), so never add extra fields.

### 4.2 Download rules
- Browser-like User-Agent (Firefox UA string as in the script); follow redirects (archive.org 302s; sourceforge `/download`).
- Skip a file when it exists, has no `.part`, and **passes validation**; a file that exists but fails validation is
  set aside and re-downloaded.
- Download to `<file>.part`, resume with HTTP Range when the server supports it, rename on success.
- **Validation:** `.pdf` must contain `%PDF` in the first 1024 bytes; `.epub` must start with `PK`; other types
  must not be HTML. This catches bot-check pages (irp.fas.org returns 202 + empty body; others return HTML).
- Every failure is recorded (folder, filename, url, reason). The bash script writes `2-failed-downloads.txt` and
  `2-failed-downloads-open-in-firefox.html` (clickable list; hides Hesperian `_bm.pdf` 404s).
- Known real-world failures seen on 2026-10-15 from Romania: irp.fas.org (bot check), media.defense.gov and
  marines.mil (403), armypubs.army.mil and twdb.texas.gov (DNS fail), archive.org `iaNNNNNN.us.archive.org`
  storage-node links (timeouts; use `archive.org/download/...` instead), JS-only pages (scrapes find no links).

### 4.3 Network/TLS on the CF-30
Electron's Node uses its **own bundled CA store**, so the in-app downloader does not depend on Ubuntu 16.04's
outdated certificates (curl does - that's why script 1 exists). Verify this on the Docker i386 stand-in.
Server code must stay **Node 12 compatible** (no global fetch, AbortController, fs.rm ...); reuse the
HTTPS/redirect/sha256 helpers already in `src/server/update.ts` (factor them into a shared module).
Only the server process goes online, never the renderer (keep the existing rule in `src/main/main.ts`).

### 4.4 Manual downloads -> structured list
Create `kit/booklists/manual-downloads.txt` from the README checklists:
```
M|<folder>|<title>|<url>|<how: button | print-to-pdf | form | zip>|<note>
```
(~35 items today: OpenStax books, CAWST, WEDC, ECHO notes, Agrodok, SKAT, Oxfam vet book, FAO web-only manuals,
Practical Action open-access books, MOT manual, e-bike battery guide, Core Knowledge, Eureka Math, CD3WD, Survivor
Library, RACHEL Practical Action zip.) The README section can be generated from this file or kept in sync by a test.

## 5. In-app features

### 5.1 Library -> "Get books" (MVP)
- Reads the book lists (bundled copy; plus `booklist-local.txt` from the kit root/library root).
- Per category: books listed / present / missing / failed last time; total size when known.
- **Download missing books** button: runs the TS downloader in the server (child process or worker so the UI stays
  responsive on the Core Duo), streams progress via the existing status/poll pattern (like the index build):
  current file, n/m, MB, speed; **Cancel**; resumes next time.
- Destination: the first configured library root (settings / auto-detect), creating category folders.
- Free-space check before starting; refuse to start below a margin; show plain-language errors.
- Failures list with reason + **Open in Firefox** (via the existing opener) + "Mark as done" once saved by hand.
- When downloads finish: offer **Update index** (existing button/flow).
- Offline: the page still works (shows what's missing) and says downloads need internet.

### 5.2 Manual downloads checklist
- A page (or tab under Library) built from `manual-downloads.txt`: title, target folder, how-to, **Open in Firefox**,
  checkbox. Auto-tick when a file matching the expected folder appears (best effort), else manual tick stored in
  settings (extend `src/server/settings.ts` with a `manualDone: string[]` of item ids).

### 5.3 Guide (src/ui/docs.ts)
Move the README's user instructions into Guide sections (keep `tests/ui/docs.test.tsx` passing):
- "Setting up a new library": the run order (1-6) and what the app now does for you (Get books replaces step 2;
  certificates only needed for the bash scripts).
- CF-30 notes: 32-bit, Kiwix i586 reader fallback 3.7.0, HDD + `vm.swappiness=10`, disk/FAT32 rules,
  keep a backup copy of the PDFs, test order (PhET -> WikiMed -> Khan).
- Khan Academy via Kiwix steps; reading EPUBs (`fbreader`); what to print on paper.
- Linux manuals note (folder 16) and `man <command>`.

### 5.4 Later (not MVP; separate milestones)
- **Encyclopedias & Khan downloads in-app** (port scripts 3-4: pick ZIMs with sizes from the mirror listing,
  FAT32 check, resume loop with stall restart, ZIM magic `5A 49 4D 04` check, kiwix-tools download incl. i586 3.7.0
  fallback). These are 2-170 GB; must survive app restarts and sleep.
- **Book-list updates without an app release:** when online, fetch the latest `kit/booklists/*` from GitHub
  (raw file of the default branch or a release asset) and show "N new books available".

## 6. Constraints recap
- Electron 17 linux-ia32; server/indexer compiled to node12; UI ES2017; 1024x768; large touch targets.
- No native modules. Bash scripts must stay POSIX-ish bash 4.3 + GNU coreutils/curl 7.47 (Ubuntu 16.04).
- Python is not used anymore in this repo (the app is TypeScript); don't reintroduce it.
- Never ship copyrighted PDFs in the repo or releases - only the lists. Some listed items are free to download but
  "personal use only" (NIMI/NCERT/PSSCIVE, MAVCC, Grin, Swedish Wood); fine for the user's own library.

## 7. Tests / acceptance
- Unit: booklist parser (F/S/A, comments, CRLF, spaces/&/()/% in folders and URLs), URL resolver, filename rules,
  validation (real PDF, HTML-as-.pdf, empty, EPUB), manual list parser. Port the bash script's fixture test
  (file:// sources: good PDF, bot-check HTML, empty file, scrape page, EPUB) to the TS downloader using a local
  HTTP test server (no internet in tests): redirects, Range resume, 403, 202-empty, slow/stalled server, cancel.
- Bash parity: a test runs `kit/2-download-pdf-books.sh` against the same local server and checks it produces the same
  files and failure list as the TS downloader.
- Installer: kit files land in the kit root, `booklist-local.txt` preserved, exec bits kept (extend
  `scripts/docker/in-container-test.sh`).
- Docker i386 stand-in: in-app downloader fetches from the local test server; TLS to a real HTTPS host works with
  Electron's CA store (note results in NOTES.md).
- Acceptance on the CF-30 (offline + online): Get books downloads the missing books into the right folders,
  shows failures with working Firefox links, survives Cancel/restart, then Update index finds the new books.

## 8. Milestones
- **K1** Import kit into `kit/` + `kit/booklists/`, package it, installer copies to kit root, `booklist-local.txt`,
  bash scripts read all lists. Release as v0.4.0.
- **K2** TS downloader + Library -> Get books (5.1) + tests. v0.5.0.
- **K3** Manual checklist (5.2) + Guide sections (5.3). v0.5.x.
- **K4** (optional) Encyclopedias/Khan in-app; **K5** (optional) book-list updates from GitHub.
Commit in small steps; update README.md, docs/design.md, NOTES.md and the kit README as you go.
