// Dev-only mock of the Library Search API, for working on the UI without an index or kiwix-serve.
//   node scripts/build.mjs && node scripts/mock-server.mjs [port]      (default 8099)
// Switch states:  /__mock?index=ok|none|building&kiwix=running|stopped|no-zims|port-busy&mode=browser|electron
//                 &update=up-to-date|available|downloading|ready|updated|offline|error|unsupported
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = join(root, 'build', 'ui');
const port = Number(process.argv[2] || process.env.PORT || 8099);
const TOKEN = 'mock-token';
const HL = (s) => '' + s + '';

const state = {
  index: 'ok', // ok | none | building
  mode: 'browser', // browser | electron (electron shows the Find button)
  kiwix: 'running',
  build: { done: 0, total: 546, startedAt: 0, phase: 'idle', finishedAt: 0 },
  update: 'up-to-date',
  auto: true,
  darkTint: 'navy',
  darkLevel: 3,
};

const NOTES = 'Library Search updates itself: new versions download in the background and install when the app closes.\n\n- Updates card on the Library page\n- "Update ready" in the status bar';

function updateStatus() {
  const base = { current: '0.2.0', auto: state.auto, checkedAt: Date.now() - 40 * 60000 };
  switch (state.update) {
    case 'available':
      return { ...base, state: 'available', latest: '0.3.0', notes: NOTES };
    case 'downloading':
      return { ...base, state: 'downloading', latest: '0.3.0', notes: NOTES, received: 31 * 1048576, total: 78 * 1048576 };
    case 'ready':
      return { ...base, state: 'ready', latest: '0.3.0', downloaded: '0.3.0', notes: NOTES };
    case 'updated':
      return { ...base, state: 'up-to-date', latest: '0.2.0', updatedFrom: '0.1.1' };
    case 'offline':
      return { ...base, state: 'offline', error: { kind: 'info', code: 'update-offline', message: "Couldn't reach GitHub: this computer seems to be offline.", fix: 'Connect to the internet and click Check for updates. The app also checks by itself each time it starts.' } };
    case 'error':
      return { ...base, state: 'error', latest: '0.3.0', downloaded: '0.3.0', error: { kind: 'error', code: 'update-install-failed', message: 'Version 0.3.0 could not be installed: Unpacking failed (disk full?)', fix: 'Click Try installing again. If it keeps failing, the details are in logs/update.log.' } };
    case 'unsupported':
      return { ...base, state: 'unsupported', reason: 'This is a developer copy: update it with git pull and npm run build.' };
    default:
      return { ...base, state: 'up-to-date', latest: '0.2.0' };
  }
}

const CATEGORIES = [
  ['01 Medicine', 'Medicine', 212, 3],
  ['02 Water & Sanitation', 'Water & Sanitation', 18, 1],
  ['03 Agriculture & Animals', 'Agriculture & Animals', 64, 4],
  ['04 Food Preservation', 'Food Preservation', 22, 0],
  ['05 Survival & Emergency', 'Survival & Emergency', 9, 1],
  ['06 Carpentry & Construction', 'Carpentry & Construction', 8, 2],
  ['07 Metalworking', 'Metalworking', 11, 3],
  ['08 Electrical & Energy', 'Electrical & Energy', 27, 0],
  ['11 Math & Science', 'Math & Science', 31, 0],
  ['12 Computing', 'Computing', 14, 0],
  ['13 Language & Education', 'Language & Education', 19, 2],
  ['14 Community & Governance', 'Community & Governance', 12, 1],
  ['16 Linux & Ubuntu', 'Linux & Ubuntu', 23, 0],
].map(([folder, label, docs, scanned]) => ({ folder, label, docs, scanned }));

const BOOKS = [
  { title: 'Guidelines for Drinking-water Quality', folder: '02 Water & Sanitation', category: 'Water & Sanitation', series: '', pages: 614 },
  { title: 'Where There Is No Doctor', folder: '01 Medicine', category: 'Medicine', series: 'Where There Is No Doctor (2025) · Chapter 11', pages: 22, sub: 'Hesperian (chapters) / en_wtnd_2025' },
  { title: 'Emergency Sanitation: Assessment and Programme Design', folder: '02 Water & Sanitation', category: 'Water & Sanitation', series: '', pages: 358 },
  { title: 'Survival (FM 21-76)', folder: '05 Survival & Emergency', category: 'Survival & Emergency', series: '', pages: 287, scanned: true },
  { title: 'Complete Guide to Home Canning', folder: '04 Food Preservation', category: 'Food Preservation', series: 'USDA Home Canning Guide · Guide 1', pages: 80, sub: 'USDA Home Canning Guide' },
  { title: 'Instructions and Precautions for Injections', folder: '01 Medicine', category: 'Medicine', series: 'Where There Is No Doctor (2025) · Chapter 9', pages: 14, sub: 'Hesperian (chapters) / en_wtnd_2025' },
  { title: 'The Humanure Handbook', folder: '02 Water & Sanitation', category: 'Water & Sanitation', series: 'Humanure Handbook', pages: 302, sub: 'Humanure Handbook' },
  { title: 'Village Technology Handbook', folder: '06 Carpentry & Construction', category: 'Carpentry & Construction', series: '', pages: 400 },
  { title: 'Forge Work', folder: '07 Metalworking', category: 'Metalworking', series: '', pages: 18, kind: 'epub' },
  { title: 'Ship Captain’s Medical Guide', folder: '01 Medicine', category: 'Medicine', series: 'Ship Captain’s Medical Guide · Chapter 4', pages: 40, sub: 'Ship Captains Medical Guide' },
  { title: 'FAO Home Fruit and Vegetable Processing', folder: '04 Food Preservation', category: 'Food Preservation', series: '', pages: 210 },
  { title: 'Special Forces Medical Handbook', folder: '01 Medicine', category: 'Medicine', series: '', pages: 720 },
];

const KIWIX = [
  { name: 'wikipedia_en_medicine_maxi', title: 'WikiMed Medical Encyclopedia', group: 'reference', delay: 500, description: '50,000 medical articles from Wikipedia', articleCount: 73000 },
  { name: 'wikipedia_en_top1m_maxi', title: 'Wikipedia (top 1 million articles)', group: 'reference', delay: 2400, description: 'The most-read million Wikipedia articles with images', articleCount: 1000000 },
  { name: 'appropedia_en_all_maxi', title: 'Appropedia', group: 'reference', delay: 900, description: 'Sustainability, appropriate technology and poverty solutions', articleCount: 9000 },
  { name: 'ifixit_en_all', title: 'iFixit', group: 'reference', delay: 1300, description: 'Repair guides for everything', articleCount: 52000 },
  { name: 'khanacademy_en_all', title: 'Khan Academy', group: 'khan', delay: 3000, description: 'Videos and exercises for every school subject', articleCount: 18000 },
  { name: 'diy.stackexchange.com_en_all', title: 'Home Improvement Stack Exchange', group: 'qa', delay: 700, description: 'Questions and answers about DIY and home repair' },
  { name: 'cooking.stackexchange.com_en_all', title: 'Seasoned Advice (Cooking)', group: 'qa', delay: 1600, description: 'Questions and answers about cooking' },
  { name: 'askubuntu.com_en_all', title: 'Ask Ubuntu', group: 'qa', delay: 1100, description: 'Questions and answers about Ubuntu' },
  { name: 'gardening.stackexchange.com_en_all', title: 'Gardening & Landscaping', group: 'qa', delay: 3500, fail: true, description: 'Gardening questions' },
];

function words(q) {
  return q.toLowerCase().split(/\s+/).filter((w) => w && ['a', 'the', 'to', 'how', 'of', 'in', 'for'].indexOf(w) < 0);
}
function hlText(q, template) {
  const ws = words(q);
  return template.replace(/\{(\d)\}/g, (_, i) => HL(ws[Number(i)] || ws[0] || q));
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function bookSearch(q, category) {
  if (state.index === 'none') {
    return {
      query: q, matchMode: 'none', terms: words(q), results: [], totalBooks: 0, tookMs: 3,
      notice: { kind: 'warning', code: 'no-index', message: 'Book search index not built yet.', fix: 'Click Build index (takes about an hour on this laptop).' },
    };
  }
  let pool = BOOKS.filter((b) => !category || b.folder === category);
  const results = pool.map((b, i) => {
    const docId = 100 + i;
    const page = b.scanned ? 0 : 12 + ((i * 37) % (b.pages - 2 || 1));
    return {
      docId,
      title: b.title,
      series: b.series,
      category: b.category,
      folder: b.folder,
      subfolder: b.series || b.sub || '',
      kind: b.kind || 'pdf',
      page: b.kind === 'epub' ? 3 : page,
      snippet: b.scanned ? '' : hlText(q, i % 2 ? '…the {0} should be brought to a rolling {1} for at least one minute; at altitudes above 2,000 m, three minutes. Let it cool before drinking…' : '…if you cannot {0} the {1}, use a filter and then disinfect it with chlorine. Store treated {1} in a clean, covered container…'),
      morePages: i < 3 ? [
        { page: page + 3, snippet: hlText(q, 'Table 7.2 — methods to make {1} safe: {0}ing, chlorination, solar disinfection (SODIS) and filtration…') },
        { page: page + 11, snippet: hlText(q, '…children with diarrhoea need plenty of safe {1}. Give it boiled and cooled, a little at a time…') },
        { page: page + 40, snippet: hlText(q, '…to {0} the instruments, put them in a pot of {1} for 20 minutes…') },
      ] : [],
      hitPages: i < 3 ? 14 - i * 3 : 1,
      scanned: !!b.scanned,
      score: -10 + i,
    };
  });
  // Pad with extra results so "Show N more books" appears.
  for (let j = 0; !category && j < 12; j++) {
    results.push({
      docId: 300 + j, title: 'Agrodok ' + (j + 1) + ': ' + ['Water harvesting', 'Small-scale fish farming', 'Preservation of foods', 'Storage of tropical produce'][j % 4],
      series: 'Agrodok series · No. ' + (j + 10), category: 'Agriculture & Animals', folder: '03 Agriculture & Animals', subfolder: 'Agrodok series · No. ' + (j + 10),
      kind: 'pdf', page: 5 + j, snippet: hlText(q, '…a simple method is to {0} the {1} in a large pot…'), morePages: [], hitPages: 1, scanned: false, score: j,
    });
  }
  return { query: q, matchMode: words(q).length > 2 ? 'any' : 'all', terms: words(q), results, totalBooks: results.length, tookMs: 640 };
}

function kiwixSearch(book, q) {
  const ws = words(q);
  const t = cap(ws.join(' ') || q);
  const titles = {
    reference: [t, t + ' (disambiguation)', 'Water purification', 'Portable water purification', 'History of ' + ws[0]],
    khan: ['Introduction to ' + t, t + ': worked examples', 'Practice: ' + t],
    qa: ['How long do I need to ' + q + '?', 'Is it safe to ' + q + ' in an aluminium pot?', 'Best way to ' + q + ' without power'],
  }[book.group];
  return titles.map((title, i) => ({
    title,
    url: '/content/' + book.name + '/A/' + encodeURIComponent(title.replace(/ /g, '_')),
    snippet: hlText(q, i % 2 ? '{0}ing is the most reliable way to kill pathogens in {1}. Bring to a full rolling {0}…' : 'Clear {1} that has been brought to a {0} for one minute is safe to drink once cooled…'),
  }));
}

function status() {
  const b = state.build;
  const building = state.index === 'building';
  const docs = state.index === 'none' ? 0 : building ? b.done : 546;
  return {
    version: '0.1.0',
    mode: 'browser',
    platform: 'linux',
    arch: 'ia32',
    nodeVersion: 'v16.13.0',
    electronVersion: '17.4.11',
    roots: ['/home/user/Ubuntu CF-30 Kit'],
    rootsSource: 'auto',
    rootInfo: [{ path: '/home/user/Ubuntu CF-30 Kit', exists: true, categories: 16, zims: 9 }],
    dataDir: '/home/user/Ubuntu CF-30 Kit/library-search-app',
    index: {
      exists: state.index !== 'none' || building,
      docs,
      pages: state.index === 'none' ? 0 : building ? b.done * 180 : 98342,
      scanned: state.index === 'ok' ? 17 : 0,
      errors: state.index === 'ok' ? 2 : 0,
      lastBuiltAt: state.index === 'ok' ? Date.now() - 3 * 86400000 : undefined,
      pendingChanges: state.index === 'ok' ? 3 : undefined,
      build: {
        running: building,
        phase: building ? 'indexing' : b.phase,
        done: b.done,
        total: b.total,
        currentFile: building ? '01 Medicine/Hesperian (chapters)/en_wtnd_2025/en_wtnd_2025_' + String((b.done % 32) + 1).padStart(2, '0') + '.pdf' : '',
        startedAt: b.startedAt || undefined,
        finishedAt: b.finishedAt || undefined,
        added: 3, updated: 1, removed: 0, failed: 0,
      },
    },
    kiwix: {
      state: state.kiwix,
      port: 8080,
      books: state.kiwix === 'running' ? KIWIX.length : 0,
      startedByUs: true,
    },
    tools: { pdftotext: true, pdfinfo: true, evince: true, firefox: true },
    update: updateStatus(),
    downloads: { books: IDLE_DOWNLOAD, zims: IDLE_DOWNLOAD },
    notices: [],
  };
}

const IDLE_DOWNLOAD = { running: false, phase: 'idle', done: 0, total: 0, currentFile: '', fileReceived: 0, fileTotal: 0, bytes: 0, speed: 0, downloaded: 0, skipped: 0, failed: 0 };

function booksOverview() {
  return {
    destination: '/home/you/Community Library',
    topics: CATEGORIES.map((c, i) => ({ folder: c.folder, label: c.label, listed: c.docs + (i % 3), present: c.docs, failed: i % 4 === 0 ? 1 : 0, bytes: c.docs * 4e6 })),
    missing: 7,
    failures: [
      { id: '01 Medicine|Special_Forces_Medical_Handbook_ST31-91B.pdf', folder: '01 Medicine', file: 'Special_Forces_Medical_Handbook_ST31-91B.pdf', url: 'https://irp.fas.org/doddir/milmed/sfhandbook.pdf', code: 'empty', reason: 'The site sent an empty answer (often a check for robots). Open it in Firefox and save it by hand.', at: Date.now() },
    ],
    lists: [{ name: 'booklist-main.txt', source: 'app', entries: 245 }],
    freeBytes: 380e9,
  };
}

function docsFor(category) {
  const out = [];
  let id = 500;
  const cat = CATEGORIES.filter((c) => c.folder === category)[0];
  const label = cat ? cat.label : category;
  for (const b of BOOKS.filter((x) => x.folder === category && !x.sub)) {
    out.push({ docId: id++, title: b.title, category: label, folder: category, subfolder: '', series: '', kind: b.kind || 'pdf', pages: b.pages, status: b.scanned ? 'scanned' : 'ok', relpath: category + '/' + b.title + '.pdf' });
  }
  if (category === '01 Medicine') {
    const ch = ['Home Cures and Popular Beliefs', 'Sicknesses That Are Often Confused', 'How to Examine a Sick Person', 'How to Take Care of a Sick Person', 'Healing Without Medicines', 'Right and Wrong Use of Medicine'];
    ch.forEach((t, i) => out.push({ docId: id++, title: t, series: 'Where There Is No Doctor (2025) · Chapter ' + (i + 1), category: label, folder: category, subfolder: 'Hesperian (chapters) / en_wtnd_2025', kind: 'pdf', pages: 10 + i, status: 'ok', relpath: '' }));
    ['The Ship Captain’s Medical Guide — Contents', 'Chapter 1: General first aid'].forEach((t, i) => out.push({ docId: id++, title: t, series: 'Ship Captain’s Medical Guide · Part ' + (i + 1), category: label, folder: category, subfolder: 'Ship Captains Medical Guide', kind: 'pdf', pages: 20, status: 'ok', relpath: '' }));
  }
  if (out.length === 0) out.push({ docId: id++, title: 'Example book in ' + label, category: label, folder: category, subfolder: '', series: '', kind: 'pdf', pages: 120, status: 'ok', relpath: '' });
  return out;
}

function articleHtml(title, book) {
  const links = ['Water_purification', 'Boiling', 'Chlorine', 'Solar_water_disinfection'].map((a) => `<li><a href="/content/${book}/A/${a}">${a.replace(/_/g, ' ')}</a></li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Georgia,serif;max-width:760px;margin:24px auto;padding:0 24px;line-height:1.6;color:#202122}h1{font-family:sans-serif;border-bottom:1px solid #a2a9b1}</style></head>
<body><h1>${title}</h1><p><b>${title}</b> is described in this offline article from <i>${book}</i>. Boiling water for one minute kills most pathogens. At altitudes above 2,000 metres, boil water for three minutes.</p>
<p>Water purification is the process of removing undesirable chemicals, biological contaminants, suspended solids, and gases from water. The goal is to produce water fit for drinking.</p>
<h2>See also</h2><ul>${links}</ul>${'<p>Lorem ipsum water dolor sit amet, boil consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus.</p>'.repeat(12)}</body></html>`;
}

function epubHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Forge Work — Chapter III: Welding</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:24px auto;padding:0 24px;line-height:1.7}</style></head>
<body><h1>CHAPTER III. WELDING.</h1><p>Welding is the process of joining two pieces of iron or steel by heating them to a white heat and hammering them together.</p>${'<p>The fire must be clean and deep, so that the iron may be heated evenly; a dirty fire will make a poor weld.</p>'.repeat(14)}</body></html>`;
}

function json(res, code, data, delay) {
  setTimeout(() => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }, delay || 0);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

// Advance a fake build.
setInterval(() => {
  const b = state.build;
  if (state.index !== 'building') return;
  b.done = Math.min(b.total, b.done + 2);
  if (b.done >= b.total) {
    state.index = 'ok';
    b.phase = 'done';
    b.finishedAt = Date.now();
  }
}, 1000);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json' };

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;

    if (p === '/__mock') {
      if (u.searchParams.get('index')) {
        state.index = u.searchParams.get('index');
        if (state.index === 'building') Object.assign(state.build, { done: 137, startedAt: Date.now() - 14 * 60000, phase: 'indexing' });
        else state.build.phase = 'idle';
      }
      if (u.searchParams.get('kiwix')) state.kiwix = u.searchParams.get('kiwix');
      if (u.searchParams.get('mode')) state.mode = u.searchParams.get('mode');
      if (u.searchParams.get('update')) state.update = u.searchParams.get('update');
      return json(res, 200, { index: state.index, kiwix: state.kiwix, mode: state.mode, update: state.update });
    }

    if (p.indexOf('/api/') === 0) {
      if (req.headers['x-token'] !== TOKEN) return json(res, 401, { error: { kind: 'error', code: 'bad_token', message: 'Missing or wrong token.' } });
      if (p === '/api/status') return json(res, 200, status(), 40);
      if (p === '/api/update/check') {
        if (state.update === 'offline' || state.update === 'error' || state.update === 'updated') state.update = 'up-to-date';
        return json(res, 200, updateStatus(), 1200);
      }
      if (p === '/api/update/download') {
        state.update = 'downloading';
        return json(res, 200, updateStatus(), 100);
      }
      if (p === '/api/update/install') return json(res, 200, { ...updateStatus(), state: 'installing' }, 100);
      if (p === '/api/settings') {
        const body = req.method === 'POST' ? await readBody(req) : {};
        if (typeof body.autoUpdate === 'boolean') state.auto = body.autoUpdate;
        if (body.darkTint) state.darkTint = body.darkTint;
        if (body.darkLevel) state.darkLevel = body.darkLevel;
        return json(res, 200, { theme: body.theme || 'system', libraryRoots: [], autoUpdate: state.auto, darkTint: state.darkTint, darkLevel: state.darkLevel });
      }
      if (p === '/api/search') return json(res, 200, bookSearch(u.searchParams.get('q') || '', u.searchParams.get('category') || ''), 650);
      if (p === '/api/kiwix/books') {
        if (state.kiwix !== 'running') return json(res, 200, []);
        return json(res, 200, KIWIX.map((b) => ({ name: b.name, title: b.title, description: b.description, language: 'eng', group: b.group, homeUrl: '/content/' + b.name + '/', articleCount: b.articleCount })), 60);
      }
      if (p === '/api/kiwix/search') {
        const b = KIWIX.filter((k) => k.name === u.searchParams.get('book'))[0];
        if (!b) return json(res, 404, { error: { kind: 'error', code: 'no_book', message: 'Unknown book' } });
        if (b.fail) return json(res, 200, { book: b.name, results: [], tookMs: b.delay, error: { kind: 'warning', code: 'timeout', message: 'Timed out' } }, b.delay);
        return json(res, 200, { book: b.name, results: kiwixSearch(b, u.searchParams.get('q') || ''), total: 120, tookMs: b.delay }, b.delay);
      }
      if (p === '/api/kiwix/start') {
        state.kiwix = 'starting';
        setTimeout(() => (state.kiwix = 'running'), 2500);
        return json(res, 200, status().kiwix, 300);
      }
      if (p === '/api/browse') return json(res, 200, state.index === 'none' ? [] : CATEGORIES, 50);
      if (p === '/api/browse/docs') return json(res, 200, docsFor(u.searchParams.get('category') || ''), 120);
      if (p === '/api/index/problems')
        return json(res, 200, [
          { docId: 9001, title: 'Survival (FM 21-76, 1957)', category: 'Survival & Emergency', folder: '05 Survival & Emergency', subfolder: '', kind: 'pdf', pages: 287, status: 'scanned', relpath: '05 Survival & Emergency/FM21-76_Survival_1957.pdf' },
          { docId: 9002, title: 'Practical Forging and Art Smithing', category: 'Metalworking', folder: '07 Metalworking', subfolder: '', kind: 'pdf', pages: 140, status: 'scanned', relpath: '07 Metalworking/Practical_Forging_1915.pdf' },
          { docId: 9003, title: 'Seed saving per crop: Beans', category: 'Agriculture & Animals', folder: '03 Agriculture & Animals', subfolder: 'Seed Saving per crop', kind: 'pdf', pages: 0, status: 'error', error: 'Not a PDF (the download saved a web page instead)', relpath: '03 Agriculture & Animals/Seed Saving per crop/beans.pdf' },
        ], 80);
      if (p === '/api/index/build') {
        await readBody(req);
        state.index = 'building';
        Object.assign(state.build, { done: 0, startedAt: Date.now(), phase: 'indexing' });
        return json(res, 200, status().index, 100);
      }
      if (p === '/api/index/cancel') {
        state.index = state.build.done > 0 ? 'ok' : 'none';
        state.build.phase = 'cancelled';
        return json(res, 200, status().index, 100);
      }
      if (p === '/api/open') {
        const body = await readBody(req);
        if (body.docId === 108 || body.docId === 9002) return json(res, 200, { ok: true, how: 'reader', readerUrl: '/epub/' + body.docId + '/OEBPS/chapter3.xhtml' }, 150);
        if (body.docId === 9003) return json(res, 200, { ok: false, how: 'xdg-open', error: { kind: 'error', code: 'not_pdf', message: 'This file is not a real PDF.', fix: 'Delete it and run 2-download-pdf-books.sh again.' } }, 150);
        return json(res, 200, { ok: true, how: 'evince' }, 200);
      }
      if (p === '/api/books' || p === '/api/books/done') return json(res, 200, booksOverview(), 80);
      if (p === '/api/books/download' || p === '/api/books/cancel') return json(res, 200, IDLE_DOWNLOAD, 80);
      if (p === '/api/open-url') return json(res, 200, { ok: true, how: 'firefox' }, 80);
      return json(res, 404, { error: { kind: 'error', code: 'not_found', message: 'Unknown endpoint ' + p } });
    }

    if (p.indexOf('/content/') === 0) {
      const parts = p.split('/');
      const book = parts[2];
      const title = parts.length > 4 ? decodeURIComponent(parts.slice(4).join('/')).replace(/_/g, ' ') : (KIWIX.filter((k) => k.name === book)[0] || { title: book }).title;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return setTimeout(() => res.end(articleHtml(title, book)), 250);
    }
    if (p.indexOf('/epub/') === 0) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(epubHtml());
    }

    // Static UI
    let file = p === '/' ? '/index.html' : p;
    file = normalize(file).replace(/^(\.\.[/\\])+/, '');
    const full = join(uiDir, file);
    if (full.indexOf(uiDir) !== 0 || !existsSync(full)) {
      res.writeHead(404);
      return res.end('not found');
    }
    let body = readFileSync(full);
    if (file === '/index.html') {
      body = body.toString('utf8').replace('<!--ls-meta-->', `<meta name="ls-token" content="${TOKEN}"><meta name="ls-mode" content="${state.mode}">`);
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  })
  .listen(port, '127.0.0.1', () => console.log('mock server on http://127.0.0.1:' + port + '/'));
