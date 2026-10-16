// Every user-visible string in the UI. Keep the wording plain: many readers are children or
// non-technical. A Romanian table can be added later with the same keys.

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export const S = {
  appName: 'Library Search',
  appTagline: 'Community Rebuild Library',
  skipToContent: 'Skip to content',

  nav: {
    home: 'Home',
    search: 'Search',
    browse: 'Browse',
    library: 'Library',
    settings: 'Settings',
    main: 'Main',
  },

  folders: {
    title: 'Library folders',
    body: 'Books and encyclopedia files are read from these folders.',
    none: 'No library folder has been chosen yet.',
    source: {
      flag: 'They were set when the app was started (--library-root).',
      env: 'They were set when the app was started (LIBRARY_ROOTS).',
      settings: '',
      auto: 'They were found automatically next to the app.',
    } as Record<'flag' | 'env' | 'settings' | 'auto', string>,
    contents: (topics: number, zims: number) =>
      [
        topics ? `${formatNumber(topics)} ${plural(topics, 'topic folder', 'topic folders')}` : '',
        zims ? `${formatNumber(zims)} ${plural(zims, 'encyclopedia file', 'encyclopedia files')}` : '',
      ]
        .filter(Boolean)
        .join(' · ') || 'Nothing to read in this folder yet',
    missing: 'Not found. If it is on a USB drive, plug it in.',
    remove: (p: string) => `Stop using ${p}`,
    choose: 'Choose the library folder…',
    addAnother: 'Add another folder…',
    orType: 'Or type the full path:',
    typeLabel: 'Type the full path of the library folder:',
    placeholder: '/home/you/Community Rebuild Library',
    add: 'Add',
    useAuto: 'Forget these and find the library automatically',
    added: (p: string) => `Library folder added: ${p}`,
    saved: 'Library folders saved.',
    updateHint: 'Open Library and click Update index so new books can be searched.',
    saveFailed: 'The folder could not be saved.',
    locked: 'To change them, start the app without --library-root.',
    howTo: 'How should the library folder look?',
    setupTitle: 'Where is your library?',
    setupBody:
      'Choose the folder that holds the books - the one with topic folders like "01 Medicine" ' +
      '(and "15 Offline Encyclopedias (Kiwix)" if you have it). It can be anywhere, also on a USB drive.',
  },

  theme: {
    title: 'Appearance',
    body: 'Light is easiest to read in bright sunlight. Dark is gentler on the eyes at night.',
    system: 'Same as computer',
    light: 'Light',
    dark: 'Dark',
    darkTitle: 'Dark mode colors',
    darkBody: 'Used whenever the app is dark. Every choice stays easy to read.',
    color: 'Color',
    darkness: 'Darkness',
    softer: 'Softer',
    darker: 'Darker',
    levelText: (n: number) => `${n} of 5`,
    preview: 'Preview',
    previewLabel: (tint: string, n: number) => `Preview of dark mode: ${tint}, darkness ${n} of 5`,
    previewTag: 'Books',
    previewTitle: 'Where There Is No Doctor',
    previewMeta: 'Medicine · Page 112',
    previewText: 'Boil the water for one full minute to make it safe to drink.',
    previewOpen: 'Open',
    previewMore: '3 more pages',
    reset: 'Back to the original navy',
    tints: {
      navy: 'Navy',
      slate: 'Slate',
      charcoal: 'Charcoal',
      warm: 'Warm',
      forest: 'Forest',
      plum: 'Plum',
    } as Record<string, string>,
  },

  settings: {
    title: 'Settings',
    subtitle: 'How the app looks, updates, help, and version details.',
    helpTitle: 'Help',
    helpBody: 'How the app works, how to set it up with your own books, and what to do when something goes wrong.',
    openGuide: 'Open the guide',
  },

  docs: {
    title: 'Guide',
    subtitle: 'How Library Search works, and how to set it up with your own books.',
    crumbsLabel: 'You are here',
    tocLabel: 'Guide sections',
    previous: 'Previous',
    next: 'Next',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Couldn’t copy. Select the text and press Ctrl+C.',
    liveLoading: 'Loading…',
    paths: {
      library: 'Library folders',
      none: 'None chosen yet',
      index: 'Book index',
      settings: 'Settings',
      logs: 'Logs',
      version: 'Version',
    },
  },

  search: {
    placeholder: 'Search books, Wikipedia, Khan Academy…',
    heroPlaceholder: 'What do you want to learn about?',
    label: 'Search the library',
    submit: 'Search',
    clear: 'Clear search',
    tryLabel: 'Try:',
    examples: ['boil water', 'set a broken arm', 'fractions', 'solar panel wiring', 'canning tomatoes', 'chmod'],
  },

  home: {
    title: 'What do you want to learn?',
    subtitle: (books: number) =>
      books > 0
        ? `Search ${formatNumber(books)} books, Wikipedia, Khan Academy and Q&A sites. Everything works without internet.`
        : 'Search books, Wikipedia, Khan Academy and Q&A sites. Everything works without internet.',
    browseTitle: 'Browse by topic',
    browseAll: 'See all topics',
    firstRunTitle: 'Book search isn’t set up yet',
    firstRunBody:
      'Before books can be searched, the app reads every book once and makes an index. ' +
      'You can keep using the app while it works. Wikipedia and the other encyclopedias can be searched right away.',
    firstRunButton: 'Build index (takes about an hour on this laptop)',
    buildingTitle: 'Building the book index…',
    buildingBody: 'Book results will appear as books are added. Encyclopedias can be searched now.',
  },

  filters: {
    label: 'Show results from',
    all: 'All',
    books: 'Books',
    reference: 'Wikipedia & reference',
    khan: 'Khan Academy',
    qa: 'Q&A sites',
    category: 'Topic',
    allCategories: 'All topics',
  },

  results: {
    searching: 'Searching…',
    resultsFor: (q: string) => `Results for “${q}”`,
    books: (n: number) => `${formatNumber(n)} ${plural(n, 'book', 'books')}`,
    hits: (n: number) => `${formatNumber(n)} ${plural(n, 'result', 'results')}`,
    page: (n: number) => `Page ${formatNumber(n)}`,
    chapter: (n: number) => `Chapter ${n}`,
    titleOnly: 'Matched the title',
    scanned: 'Scanned book — only the title is searchable',
    pdf: 'PDF',
    epub: 'EPUB',
    morePages: (n: number) => `${n} more ${plural(n, 'page', 'pages')} in this book`,
    hidePages: 'Hide pages',
    matchingPages: (n: number) => `${formatNumber(n)} matching ${plural(n, 'page', 'pages')}`,
    showMoreBooks: (n: number) => `Show ${formatNumber(n)} more ${plural(n, 'book', 'books')}`,
    showMore: (n: number) => `Show ${formatNumber(n)} more`,
    showLess: 'Show less',
    noBooks: 'No books match these words.',
    noHits: 'Nothing found here.',
    anyMode: 'No page has all of your words, so these pages match some of them.',
    collectionsFailed: (n: number) =>
      `${n} ${plural(n, 'collection', 'collections')} didn’t answer in time.`,
    nothingAnywhere: (q: string) => `Nothing found for “${q}”.`,
    tips: 'Tips: check the spelling, use fewer words, or try a more general word (for example “splint” instead of “how to splint a leg”).',
    kiwixOff: 'Wikipedia, Khan Academy and Q&A sites are not available right now.',
    noCollections: 'No encyclopedias are installed in this group.',
    tookMs: (ms: number) => `${(ms / 1000).toFixed(1)} s`,
    from: (book: string) => `from ${book}`,
  },

  open: {
    opening: (title: string, page: number) =>
      page > 0 ? `Opening “${title}” at page ${page}…` : `Opening “${title}”…`,
    openingHint: 'The book viewer can take a few seconds to appear.',
    failed: 'Could not open this book.',
  },

  reader: {
    backToResults: 'Back to results',
    back: 'Back',
    historyBack: 'Previous page',
    historyForward: 'Next page',
    find: 'Find',
    findPlaceholder: 'Find on this page',
    findNext: 'Next match',
    findPrev: 'Previous match',
    findClose: 'Close find',
    matches: (n: number) => (n === 0 ? 'No matches' : `${formatNumber(n)} ${plural(n, 'match', 'matches')}`),
    openInFirefox: 'Open in Firefox',
    loading: 'Loading…',
    frameTitle: 'Article',
  },

  browse: {
    title: 'Browse the library',
    subtitle: 'Pick a topic to see every book in it.',
    booksTitle: 'Books by topic',
    collectionsTitle: 'Encyclopedias and courses',
    collectionsEmpty: 'No encyclopedias are running right now.',
    docs: (n: number) => `${formatNumber(n)} ${plural(n, 'book', 'books')}`,
    scannedCount: (n: number) => `${formatNumber(n)} scanned`,
    pages: (n: number) => `${formatNumber(n)} ${plural(n, 'page', 'pages')}`,
    chapters: (n: number) => `${formatNumber(n)} ${plural(n, 'chapter', 'chapters')}`,
    allTopics: 'All topics',
    emptyCategory: 'No books in this topic yet.',
    noIndex: 'Books appear here after the book index is built.',
    looseFiles: 'Books',
    open: 'Open',
    groups: { reference: 'Wikipedia & reference', khan: 'Khan Academy', qa: 'Q&A sites' } as Record<string, string>,
  },

  library: {
    title: 'Library status',
    subtitle: 'Check that everything works, and update the book index after adding books.',
    indexTitle: 'Book index',
    indexBody:
      'The index lets you search inside books. After adding or removing books, click Update index. ' +
      'Only new and changed books are read again.',
    statBooks: 'Books',
    statPages: 'Pages',
    statScanned: 'No text',
    statUpdated: 'Last updated',
    never: 'Never',
    build: 'Build index',
    update: 'Update index',
    rebuild: 'Rebuild everything',
    rebuildHint: 'Reads every book again. Only needed if search seems wrong.',
    cancel: 'Stop',
    progress: (done: number, total: number) => `${formatNumber(done)} of ${formatNumber(total)} books`,
    scanning: 'Looking for books…',
    cleaning: 'Finishing up…',
    current: (file: string) => `Reading: ${file}`,
    eta: (min: number) => (min < 1 ? 'Almost done' : min === 1 ? 'About 1 minute left' : `About ${min} minutes left`),
    etaHours: (h: number, m: number) => `About ${h} h ${m} min left`,
    canKeepUsing: 'You can keep using the app while this runs.',
    finished: (added: number, updated: number, removed: number) =>
      `Finished: ${added} added, ${updated} updated, ${removed} removed.`,
    failedBuild: 'The index build stopped with an error.',
    cancelled: 'The index build was stopped. Click Update index to continue where it left off.',
    pending: (n: number) => `${formatNumber(n)} new or changed ${plural(n, 'book', 'books')} not indexed yet.`,
    problemsTitle: 'Books that can’t be searched',
    problemsBody:
      'These are scans without a text layer (only their titles can be found) or files that could not be read. ' +
      'You can still open them from Browse.',
    problemsNone: 'Every book can be searched.',
    problemScanned: 'Scanned, no text',
    problemError: 'Could not read',
    showProblems: (n: number) => `Show ${formatNumber(n)} ${plural(n, 'book', 'books')}`,
    hideProblems: 'Hide list',
    kiwixTitle: 'Encyclopedias (Kiwix)',
    kiwixBody: 'Wikipedia, Khan Academy, Q&A sites and the other .zim collections are served by Kiwix on this computer.',
    start: 'Start',
    retry: 'Try again',
    toolsTitle: 'Helper programs',
    toolOk: 'Installed',
    toolMissing: 'Missing',
    tools: {
      pdftotext: { name: 'pdftotext', what: 'Reads text from PDF books', fix: 'sudo apt-get install poppler-utils' },
      pdfinfo: { name: 'pdfinfo', what: 'Reads book titles and page counts', fix: 'sudo apt-get install poppler-utils' },
      evince: { name: 'Document Viewer (Evince)', what: 'Opens PDF books at the right page', fix: 'sudo apt-get install evince' },
      firefox: { name: 'Firefox', what: 'Optional: open articles in a browser', fix: 'sudo apt-get install firefox' },
    } as Record<string, { name: string; what: string; fix: string }>,
    fixLabel: 'To fix:',
    aboutTitle: 'About',
    version: 'Version',
    mode: 'Running in',
    modeElectron: 'App window',
    modeBrowser: 'Firefox (fallback mode)',
    electron: 'Electron',
    node: 'Node',
    platform: 'System',
    roots: 'Library folders',
    dataDir: 'Index folder',
  },

  kiwix: {
    running: (n: number) => `Running · ${formatNumber(n)} ${plural(n, 'collection', 'collections')}`,
    starting: 'Starting…',
    stopped: 'Stopped',
    'no-binary': 'Kiwix reader not found',
    'no-zims': 'No encyclopedia files found',
    'port-busy': 'Port is in use by another program',
    error: 'Not working',
    skippedTitle: (n: number) =>
      n === 1 ? 'One encyclopedia file was left out:' : `${formatNumber(n)} encyclopedia files were left out:`,
    skippedToast: (n: number) =>
      n === 1 ? 'Encyclopedias started, but one file was left out.' : `Encyclopedias started, but ${formatNumber(n)} files were left out.`,
    skippedToastDetail: 'The Library page says which ones and how to fix them.',
    checkAgain: 'Check again',
    fix: {
      stopped: 'Click Start. It takes a few seconds.',
      'no-binary': 'Run 3-download-offline-wikipedia.sh once while connected to the internet; it downloads the Kiwix reader.',
      'no-zims': 'Run 3-download-offline-wikipedia.sh or 4-download-khan-academy.sh to download encyclopedias.',
      'port-busy': (port: number) =>
        `Another program is using port ${port}. Close the “5 · Start offline library” window if it is open, then click Start.`,
    },
  },

  updates: {
    title: 'Updates',
    notChecked: 'Not checked yet',
    checking: 'Checking for updates…',
    upToDate: 'Up to date',
    offline: 'No internet connection right now',
    available: (v: string) => `Version ${v} is available`,
    downloading: (v: string) => `Downloading version ${v}…`,
    ready: (v: string) => `Version ${v} is ready to install`,
    installing: 'Installing the update…',
    failed: 'The update didn’t work',
    unsupported: 'This copy doesn’t update itself',
    version: (v: string) => `You have version ${v}.`,
    lastChecked: (when: string) => `Last checked: ${when}.`,
    readyAuto: 'It is installed when you close Library Search. Or restart now to get it right away.',
    readyManual: 'Restart Library Search to install it.',
    received: (got: string, total: string) => `${got} of ${total} MB`,
    keepUsing: 'You can keep using the app while it downloads.',
    whatsNew: (v: string) => `What’s new in version ${v}`,
    check: 'Check for updates',
    download: 'Download and install',
    restart: 'Restart now and update',
    retryInstall: 'Try installing again',
    autoLabel: 'Update automatically',
    autoHint: 'When this computer is online, new versions download in the background and are installed when you close the app.',
    autoSaveFailed: 'The setting could not be saved.',
    updated: (from: string, to: string) => `Updated from version ${from} to ${to}.`,
    updatedToast: (v: string) => `Library Search was updated to version ${v}.`,
    restartTitle: 'Installing the update…',
    restartBody: 'Library Search closes now and opens again by itself in a minute or two.',
    restartBodyBrowser: 'The search service stops now. In a minute or two Firefox opens the new version, and you can close this tab.',
    restartFailed: 'The update could not be started.',
    statusReady: 'Update ready',
  },

  status: {
    booksReady: (n: number) => `${formatNumber(n)} books searchable`,
    booksNone: 'Book index not built',
    booksIndexing: (done: number, total: number) =>
      total > 0 ? `Indexing books · ${formatNumber(done)}/${formatNumber(total)}` : 'Indexing books…',
    encyclopedias: 'Encyclopedias',
    details: 'Library status',
    offline: 'Lost connection to the search service.',
    offlineFix: 'Close the app and start it again with “6 · Search the library”.',
  },

  errors: {
    network: 'The search service is not responding.',
    networkFix: 'Wait a moment and try again. If it keeps happening, restart the app.',
    generic: 'Something went wrong.',
    dismiss: 'Dismiss',
  },

  categoryAll: 'All topics',
};
