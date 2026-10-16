<!-- Text added to the kit's 0-README-start-here.md (run-order rows + section). Keep both in sync. -->

Run-order table rows (after step 5):

| 6 | `bash 6-install-or-update-search-app.sh` | Installs or updates the **Library Search** app (downloads it, or takes a `.tar.gz` from a USB stick) | ~80 MB | once, then to update |
| 6 | `bash 6-search-the-library.sh` | **One search box for everything**: all the books plus Wikipedia, Khan Academy and the Q&A sites | - | every time you want to look something up |

Section:

## 6. Search the library (one search box for everything)
Type a question - "boil water", "splint", "fractions", "chmod" - and get results from every book (with the
page number), offline Wikipedia, WikiMed, Khan Academy and the Q&A sites. Tap a result to open it: books open
in the Document Viewer at the right page, articles open inside the app.

1. Install the app (once):

       bash 6-install-or-update-search-app.sh

   - With internet it downloads the newest version from GitHub. Without internet, copy the
     `library-search-linux-ia32-vX.Y.Z.tar.gz` file (and `6-install-or-update-search-app.sh`) from a USB stick
     into this folder and run:  `bash 6-install-or-update-search-app.sh library-search-linux-ia32-vX.Y.Z.tar.gz`
   - Later versions install themselves: when the computer is online, the app downloads a new version in the
     background and installs it when you close the app (switch it off under **Settings -> Updates**). Without
     internet, update from a USB stick with the same command. Don't use sudo.
   - The installer adds **Library Search** to the app menu and asks whether to put its icon in the sidebar
     (answer Y). Later: `bash 6-install-or-update-search-app.sh --launcher` re-creates it, `--remove-launcher` removes it.
   - The app doesn't have to live in this folder: `--dir <folder>` installs it anywhere. If it can't find the
     books next to itself, it asks for the library folder on first start (also under **Library -> Library folders**,
     where a USB drive or a second folder can be added).
   - **Settings** (the gear button at the top) has light or dark mode - with a choice of dark colors and how dark -
     updates, the app's version, and a **Guide** (Settings -> Help -> Open the guide) that explains how the app works,
     how the library folder must look, and what to do when something goes wrong. It works without internet.
2. Start it: click **Library Search** in the sidebar (or search for it in the Dash), double-click
   **6 · Search the library** here (first time: right-click -> Properties -> Permissions -> "Allow executing file
   as program"), or run  `bash 6-search-the-library.sh`.
   It starts the offline Wikipedia reader by itself if step 3 or 4 was done - no need to run step 5 first.
3. The first time, the app offers to **build the book index**: it reads every PDF once (30-90 minutes on the
   CF-30; the computer stays usable). You can stop it any time and it continues later. After adding new books,
   open **Library** in the app and click **Update index** (or run  `bash 6-build-search-index.sh`).

- Needs `pdftotext` (part of Ubuntu; if missing:  `sudo apt-get install poppler-utils`).
- Old scanned books without a text layer can't be searched inside - the app lists them under **Library**;
  you can still find them by title.
- If the app window won't open, use the simple version in Firefox (same search):
  `bash 6-search-the-library.sh --firefox`. Problems are logged in the app folder under `logs/launcher.log`.
