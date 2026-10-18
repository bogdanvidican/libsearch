// The in-app guide (Settings -> Guide): how the app works and how to set it up with your own books.
// Content only (no React), so it can be translated like strings.ts and checked by tests/ui/docs.test.ts.
// Inline text may use **bold** (names of buttons and pages, exactly as the app shows them) and `code`.
// Keep it true to the app: folder rules are in src/indexer/walk.ts and src/server/config.ts.

export type DocRoute = 'home' | 'browse' | 'library' | 'settings';

export type DocBlock =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'list'; items: string[] }
  /** A terminal command, with a Copy button. */
  | { type: 'cmd'; text: string; label?: string }
  /** A folder diagram. */
  | { type: 'tree'; text: string }
  | { type: 'note'; kind: 'tip' | 'warning'; text: string }
  /** A button to another screen, or to another section of the guide. */
  | { type: 'link'; text: string; route?: DocRoute; section?: string }
  /** A question that opens to show its answer (troubleshooting). */
  | { type: 'qa'; q: string; a: string[] }
  /** Live: which helper programs this computer has. */
  | { type: 'tools' }
  /** Live: where this app keeps the library, index, settings and logs. */
  | { type: 'paths' };

export type DocIcon = 'start' | 'search' | 'open' | 'folder' | 'index' | 'globe' | 'tools' | 'settings' | 'help' | 'files';

export interface DocSection {
  id: string;
  title: string;
  summary: string;
  icon: DocIcon;
  blocks: DocBlock[];
}

export type InlinePart = { kind: 'text' | 'bold' | 'code'; text: string };

/** Splits "Click **Build index** or run `bash x.sh`" into text / bold / code parts. Unclosed markers stay as text. */
export function parseInline(s: string): InlinePart[] {
  const out: InlinePart[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    else out.push({ kind: 'code', text: m[2] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  return out;
}

const RELEASES = 'https://github.com/' + __UPDATE_REPO__ + '/releases';

export const DOCS: DocSection[] = [
  {
    id: 'start',
    title: 'Getting started',
    summary: 'What Library Search is, and the three steps to set it up.',
    icon: 'start',
    blocks: [
      {
        type: 'p',
        text:
          'Library Search finds things in your whole offline library from one search box: every book (PDF and EPUB), ' +
          'offline Wikipedia, Khan Academy and the question-and-answer sites. It works without internet.',
      },
      { type: 'h', text: 'Set it up in three steps' },
      {
        type: 'steps',
        items: [
          '**Tell the app where your books are.** Open **Library** and use **Library folders**. If the books are in a folder next to the app, it finds them by itself.',
          '**Build the book index.** On the **Library** page, click **Build index**. The app reads every book once: about an hour on an older laptop. You can keep using the app while it works.',
          '**Search.** Type a few words, like `boil water` or `fractions`, and press Enter.',
        ],
      },
      {
        type: 'note',
        kind: 'tip',
        text: 'Wikipedia, Khan Academy and the Q&A sites can be searched right away. They don’t need the book index.',
      },
      { type: 'link', text: 'Open the Library page', route: 'library' },
      { type: 'link', text: 'How the library folder must look', section: 'library' },
    ],
  },
  {
    id: 'search',
    title: 'Searching',
    summary: 'How to type a search, and how to read the results.',
    icon: 'search',
    blocks: [
      {
        type: 'p',
        text:
          'Type what you want to know in the search box at the top and press Enter, or click the magnifier. ' +
          'Short searches work best: `splint` finds more than `how do I splint a broken leg`.',
      },
      { type: 'h', text: 'Search tips' },
      {
        type: 'list',
        items: [
          'Every word you type has to be on the page. If no page has them all, the app shows pages that have some of them, and says so.',
          'Small words like “the”, “how” and “to” are left out. Capital letters don’t matter.',
          'In books, other forms of a word are found too: `boiling` also finds “boil” and “boiled”.',
          'Put words in quotes to find them together, in that order: `"solar panel"`.',
          'Put `*` at the end of a word to find every word that starts with it: `purif*` finds purify, purified and purification.',
        ],
      },
      { type: 'h', text: 'Reading the results' },
      {
        type: 'list',
        items: [
          'Results come in groups: **Books**, **Wikipedia & reference**, **Khan Academy** and **Q&A sites**. The buttons above the results show one group at a time; **All** shows them all.',
          '**Topic** shows books from one topic only, for example Medicine.',
          'Each book shows its best page and a short piece of text with your words marked. A link like **3 more pages in this book** shows other good pages.',
          '**Scanned book — only the title is searchable** means an old scan without readable text: it was found by its title.',
        ],
      },
      { type: 'h', text: 'Keyboard' },
      {
        type: 'list',
        items: [
          '`/` jumps to the search box.',
          '`↓` and `↑` move through the results; Enter opens one.',
          '`Esc` leaves an article and goes back to the results.',
          '`Ctrl` and `+` or `-` make the text bigger or smaller; `Ctrl` and `0` go back to normal.',
        ],
      },
      { type: 'link', text: 'Or look through the books by topic', route: 'browse' },
    ],
  },
  {
    id: 'opening',
    title: 'Opening books and articles',
    summary: 'Where books and articles open, and how to find words in them.',
    icon: 'open',
    blocks: [
      {
        type: 'list',
        items: [
          '**PDF books** open in the Document Viewer, at the right page, with your search words marked. On an older laptop it can take a few seconds to appear.',
          '**EPUB books** and **encyclopedia articles** open inside the app.',
        ],
      },
      { type: 'h', text: 'Inside the app' },
      {
        type: 'list',
        items: [
          '**Back to results** goes back to your search.',
          '**‹** and **›** go to the page you looked at before, and forward again.',
          '**Find** looks for a word on the page.',
          '**Open in Firefox** shows the page in the web browser, for example to print it.',
          'In the Firefox version of the app, use the browser’s own `Ctrl` and `F` to find words.',
        ],
      },
      {
        type: 'note',
        kind: 'tip',
        text: 'If PDFs open without jumping to the page, the Document Viewer (Evince) is missing. See **Helper programs**.',
      },
      { type: 'link', text: 'Helper programs', section: 'programs' },
    ],
  },
  {
    id: 'library',
    title: 'Setting up your library folder',
    summary: 'How the books must be arranged, and how to tell the app where they are.',
    icon: 'folder',
    blocks: [
      {
        type: 'p',
        text:
          'The app reads books from a **library folder**: the folder that holds your topic folders. It can be anywhere: ' +
          'in your home folder, next to the app, or on a USB drive.',
      },
      { type: 'h', text: 'How the folder must look' },
      {
        type: 'tree',
        text: [
          'Community Library/                     ← choose this folder',
          '├─ 01 Medicine/',
          '│  ├─ Where_There_Is_No_Doctor.pdf',
          '│  └─ Hesperian (chapters)/           ← folders inside are fine',
          '│     └─ en_wtnd_2025_01.pdf',
          '├─ 02 Water & Sanitation/',
          '│  └─ Water_Treatment_Manual.epub',
          '└─ 15 Offline Encyclopedias (Kiwix)/  ← encyclopedias',
          '   └─ wikipedia_en_medicine_maxi.zim',
        ].join('\n'),
      },
      {
        type: 'list',
        items: [
          'Each topic is a folder whose name starts with a number and a space: `01 Medicine`, `02 Water & Sanitation`. The number sets the order; the app shows the name without it.',
          'Put **PDF** and **EPUB** files in the topic folders. Folders inside a topic folder are fine, as deep as you like.',
          'Files lying directly in the library folder, and folders without a number, are not read.',
          'A book without a good title of its own is named after its file: `Where_There_Is_No_Doctor.pdf` shows as “Where There Is No Doctor”.',
          'Encyclopedias go in a folder whose name contains **Kiwix**. See **Encyclopedias**.',
        ],
      },
      { type: 'h', text: 'Choose the folder in the app' },
      {
        type: 'steps',
        items: [
          'Open **Library**.',
          'Under **Library folders**, click **Choose the library folder…** and pick the folder that holds the topic folders (not one of the topic folders). In the Firefox version, type the full path instead, like `/home/you/Community Library`, and click **Add**.',
          'The app checks the folder and shows how many topic folders and encyclopedia files it found.',
          'Click **Build index** the first time, or **Update index** after changing folders, so the books can be searched.',
        ],
      },
      {
        type: 'list',
        items: [
          '**More than one folder:** click **Add another folder…**, for example for a USB drive with more books.',
          '**On a USB drive:** plug it in before you start the app. While it is unplugged, its folder shows as not found and its books can’t be opened.',
          '**Found by itself:** if the books are in a folder next to the app (or a few folders above it), you don’t need to choose anything. **Forget these and find the library automatically** goes back to that.',
        ],
      },
      {
        type: 'note',
        kind: 'warning',
        text: 'Switching to a different library: the next **Update index** takes the books of the old library out of the search.',
      },
      { type: 'link', text: 'Open the Library page', route: 'library' },
    ],
  },
  {
    id: 'index',
    title: 'The book index',
    summary: 'Why the app reads every book first, and how to keep it up to date.',
    icon: 'index',
    blocks: [
      {
        type: 'p',
        text:
          'To search inside books quickly, the app reads every book once and keeps what it found in an **index**. ' +
          'Encyclopedias don’t need this: they come with their own.',
      },
      { type: 'h', text: 'Building and updating' },
      {
        type: 'list',
        items: [
          '**Build index** (the first time) reads every book. On an older laptop that takes about an hour for 600 books. You can keep using the app, and book results appear as books are read.',
          '**Update index** reads only new and changed books: use it after adding, changing or removing books. The Library page says when books are waiting to be read.',
          '**Stop** pauses the work. Click **Update index** later and it goes on where it stopped.',
          '**Rebuild everything** reads every book again. Only needed if search results seem wrong.',
        ],
      },
      { type: 'cmd', label: 'The same from a terminal in the app’s `kit` folder (add `--full` to read everything again):', text: 'bash 6-build-search-index.sh' },
      { type: 'h', text: 'Books that can’t be searched' },
      {
        type: 'p',
        text: 'The Library page lists the books whose text couldn’t be read, under **Books that can’t be searched**:',
      },
      {
        type: 'list',
        items: [
          '**Scanned, no text**: old books scanned as pictures, without a text layer. They can still be found by their title, and opened from **Browse**.',
          '**Could not read**: damaged files, or web pages saved with a .pdf name by mistake. Download them again.',
        ],
      },
      {
        type: 'note',
        kind: 'tip',
        text:
          'An index made on one computer works on another one with the same books. Copy the `index` folder from the app ' +
          'folder along with the books, and **Update index** only checks for changes.',
      },
    ],
  },
  {
    id: 'encyclopedias',
    title: 'Encyclopedias',
    summary: 'How offline Wikipedia, Khan Academy and the Q&A sites are added and started.',
    icon: 'globe',
    blocks: [
      {
        type: 'p',
        text:
          'Offline Wikipedia, WikiMed, Khan Academy, Stack Exchange and the other collections are **.zim files**, read by ' +
          'a small program called Kiwix. The app starts it by itself.',
      },
      { type: 'h', text: 'What you need' },
      {
        type: 'list',
        items: [
          'A folder in the library folder whose name contains **Kiwix**, for example `15 Offline Encyclopedias (Kiwix)`.',
          'The `.zim` files inside it.',
          'The Kiwix reader: `kiwix-tools/kiwix-serve` inside that folder (or Kiwix installed on the computer).',
        ],
      },
      {
        type: 'p',
        text:
          'In the CF-30 kit, `3-download-offline-wikipedia.sh` and `4-download-khan-academy.sh` download all of this. ' +
          'They need internet and a lot of disk space.',
      },
      { type: 'h', text: 'Starting and checking' },
      {
        type: 'list',
        items: [
          'The **Encyclopedias (Kiwix)** card on the Library page says whether they are running. If they stopped, click **Start**.',
          'Added a .zim file, or a download finished? Close the app and open it again, or click **Check again** if the Library page shows that button.',
          'A file that is still downloading, or damaged, is left out and the Library page says why. The other collections keep working.',
          '**Port is in use by another program**: the “5 · Start offline library” window is probably open. Close it, then click **Start**.',
        ],
      },
      { type: 'link', text: 'Open the Library page', route: 'library' },
    ],
  },
  {
    id: 'programs',
    title: 'Helper programs',
    summary: 'Small programs the app uses to read and open books, and how to add them.',
    icon: 'tools',
    blocks: [
      { type: 'p', text: 'The app uses a few standard Ubuntu programs. This is what this computer has:' },
      { type: 'tools' },
      {
        type: 'p',
        text: 'To add a missing one, open a terminal (`Ctrl` + `Alt` + `T`), type the command, press Enter and type your password.',
      },
      { type: 'cmd', label: 'Text reading (pdftotext, pdfinfo) and the Document Viewer, in one go:', text: 'sudo apt-get install poppler-utils evince' },
      {
        type: 'note',
        kind: 'warning',
        text:
          'Adding programs needs internet. Without them the app still works, with limits: without **pdftotext** books ' +
          'can’t be indexed, and without the Document Viewer PDFs open without jumping to the page.',
      },
    ],
  },
  {
    id: 'settings',
    title: 'Appearance and updates',
    summary: 'Light and dark mode, the dark colors, and how the app updates itself.',
    icon: 'settings',
    blocks: [
      { type: 'h', text: 'Appearance' },
      {
        type: 'list',
        items: [
          '**Light** is easiest to read in bright sunlight. **Dark** is gentler on the eyes at night. **Same as computer** follows the computer’s own setting.',
          '**Dark mode colors**: pick a color and how dark it should be. The preview shows the result, even while the app is light. **Back to the original navy** undoes it.',
        ],
      },
      { type: 'h', text: 'Updates' },
      {
        type: 'list',
        items: [
          'When this computer is online, the app looks for a new version by itself, downloads it in the background and installs it the next time you close the app.',
          '**Restart now and update** installs it right away: the app closes and opens again by itself.',
          '**Check for updates** looks right now. **Update automatically** switches all of this off or on.',
          'Without internet nothing happens; the app looks again the next time it is online.',
        ],
      },
      { type: 'h', text: 'Updating without internet' },
      {
        type: 'steps',
        items: [
          'On a computer with internet, open the releases page below. Download `library-search-linux-ia32-vX.Y.Z.tar.gz`, its `.sha256` file and `6-install-or-update-search-app.sh`, and copy them onto a USB stick.',
          'Copy the three files into one folder on this computer.',
          'Close Library Search, open a terminal in that folder and run the command below (with the real file name).',
        ],
      },
      { type: 'cmd', label: 'Releases page:', text: RELEASES },
      { type: 'cmd', label: 'Install from the USB copy:', text: 'bash 6-install-or-update-search-app.sh library-search-linux-ia32-vX.Y.Z.tar.gz' },
      { type: 'link', text: 'Open Settings', route: 'settings' },
    ],
  },
  {
    id: 'trouble',
    title: 'When something goes wrong',
    summary: 'Common problems and what to do about them.',
    icon: 'help',
    blocks: [
      {
        type: 'qa',
        q: 'The app window doesn’t open',
        a: [
          'Start the simple version in Firefox: it has the same search. In a terminal in the app’s `kit` folder (in the app folder: `dist/library-search-linux-ia32/resources/app/kit`), run `bash 6-search-the-library.sh --firefox`.',
          'Keep the small window that appears open while you use it; closing it stops the library.',
        ],
      },
      {
        type: 'qa',
        q: '“Lost connection to the search service”',
        a: ['Close the app and open it again.'],
      },
      {
        type: 'qa',
        q: 'Nothing is found',
        a: [
          'Check the spelling, use fewer words, or try a more general word (`splint` instead of `how to splint a leg`).',
          'Look at the bar at the bottom of the window: it says how many books can be searched and whether the encyclopedias are running.',
        ],
      },
      {
        type: 'qa',
        q: 'Books are never found, but Wikipedia is',
        a: [
          'The book index isn’t built yet, or the books were added after it. On the Library page, click **Build index** or **Update index**.',
          'Also check that **pdftotext** is installed (see **Helper programs**).',
        ],
      },
      {
        type: 'qa',
        q: 'Wikipedia, Khan Academy or the Q&A sites are missing',
        a: ['On the Library page, look at **Encyclopedias (Kiwix)** and click **Start** or **Check again**. See **Encyclopedias** for what the app needs.'],
      },
      {
        type: 'qa',
        q: '“This book file could not be found”',
        a: ['The file was moved, renamed or deleted, or its USB drive is unplugged. Plug the drive in, or click **Update index** on the Library page.'],
      },
      {
        type: 'qa',
        q: '“No library folder has been chosen yet”',
        a: ['Choose the folder on the Library page. See **Setting up your library folder**.'],
      },
      {
        type: 'qa',
        q: 'An update didn’t work',
        a: [
          '**Settings → Updates** says why. Check that the computer is online and that its date and time are right (a flat clock battery resets them).',
          'You can always update from a USB stick: see **Appearance and updates**.',
        ],
      },
      {
        type: 'qa',
        q: 'Where are the details of a problem?',
        a: ['In the `logs` folder of the app: `launcher.log` (starting the app), `app.log` (the app itself) and `update.log` (updates). See **Where things are kept**.'],
      },
      { type: 'link', text: 'Where things are kept', section: 'files' },
    ],
  },
  {
    id: 'files',
    title: 'Where things are kept',
    summary: 'The folders this app uses on this computer.',
    icon: 'files',
    blocks: [
      { type: 'paths' },
      {
        type: 'list',
        items: [
          'The app keeps its index, settings and logs in its own folder. If it may not write there, it uses `~/.local/share/library-search` instead.',
          'Deleting the `index` folder is safe: the app offers to build it again.',
          'The app’s `kit` folder (in the app folder: `dist/library-search-linux-ia32/resources/app/kit`) holds `6-search-the-library.sh` (starts the app), `6-build-search-index.sh` (builds the index in a terminal), `6-install-or-update-search-app.sh` (installs or updates the app), and the download scripts with their book lists.',
          'Downloaded books and encyclopedias always go in your library folder, never inside the app, so deleting or reinstalling the app keeps them.',
        ],
      },
    ],
  },
];
