// Generates the small fake library used by tests and the Docker ia32 smoke test.
//   node tests/fixtures/make-fixtures.mjs
// Output: tests/fixtures/library/ (committed, so tests don't need to regenerate it).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const lib = join(dirname(fileURLToPath(import.meta.url)), 'library');
rmSync(lib, { recursive: true, force: true });

function put(rel, data) {
  const p = join(lib, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

// ---------- minimal PDF writer ----------
function pdfString(s) {
  return '(' + s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
}

/** pages: array of { lines: string[] } or { image: true }. */
function makePdf({ title, pages }) {
  const objs = [];
  const add = (body) => {
    objs.push(body);
    return objs.length;
  };
  const catalogId = add(null);
  const pagesId = add(null);
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const pg of pages) {
    let content;
    let resources;
    if (pg.image) {
      const w = 16;
      const h = 16;
      const pixels = Buffer.alloc(w * h);
      for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37) % 256;
      const imgId = add(
        `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n` +
          pixels.toString('latin1') +
          '\nendstream'
      );
      content = 'q 400 0 0 500 100 150 cm /Im1 Do Q';
      resources = `<< /XObject << /Im1 ${imgId} 0 R >> >>`;
    } else {
      const ops = ['BT', '/F1 12 Tf', '72 720 Td', '16 TL'];
      for (const line of pg.lines) ops.push(`${pdfString(line)} Tj T*`);
      ops.push('ET');
      content = ops.join('\n');
      resources = `<< /Font << /F1 ${fontId} 0 R >> >>`;
    }
    const contentId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${contentId} 0 R >>`
      )
    );
  }
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const infoId = add(title ? `<< /Title ${pdfString(title)} /Producer (make-fixtures) >>` : '<< /Producer (make-fixtures) >>');

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += String(o).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------- minimal ZIP writer (for EPUB) ----------
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, store } of entries) {
    const raw = Buffer.from(data);
    const comp = store ? raw : deflateRawSync(raw);
    const method = store ? 0 : 8;
    const crc = crc32(raw);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---------- content ----------
put(
  '02 Water & Sanitation/Safe_Drinking_Water_Guide.pdf',
  makePdf({
    title: 'Safe Drinking Water: A Field Guide',
    pages: [
      { lines: ['Safe Drinking Water', 'A field guide for households and villages.'] },
      {
        lines: [
          'Chapter 2. Boiling',
          'To make water safe, bring water to a rolling boil for one minute.',
          'At altitudes above 2000 metres, boil water for three minutes.',
          'Let the boiled water cool in a clean, covered container.',
        ],
      },
      {
        lines: [
          'Chapter 3. Water purification with chlorine',
          'Purification by chlorination: add two drops of bleach per litre.',
          'Solar disinfection (SODIS) uses clear bottles left in the sun for six hours.',
        ],
      },
    ],
  })
);

put(
  '01 Medicine/First_Aid_Basics.pdf',
  makePdf({
    title: '',
    pages: [
      { lines: ['First Aid Basics'] },
      {
        lines: [
          'Fractures and splints',
          'To set a broken arm, first immobilise it with a splint.',
          'A splint can be made from a rolled newspaper, a board or a stick.',
          'Check circulation in the fingers after splinting.',
        ],
      },
      { lines: ['Burns', 'Cool the burn with clean water for twenty minutes.', 'Do not boil water for a burn.'] },
    ],
  })
);

put(
  '01 Medicine/Hesperian (chapters)/en_test_2025/en_test_2025_01.pdf',
  makePdf({
    title: 'Where There Is No Doctor - Chapter 1: Home Cures',
    pages: [{ lines: ['Home cures and popular beliefs', 'Many home cures are helpful; drink plenty of boiled water.'] }],
  })
);

put(
  '04 Food Preservation/Home_Canning_Tomatoes.pdf',
  makePdf({
    title: 'Home Canning Guide 3: Tomatoes',
    pages: [
      { lines: ['Canning tomatoes', 'Add lemon juice to each jar when canning tomatoes.', 'Process jars in a boiling water canner.'] },
    ],
  })
);

put(
  '11 Math & Science/Fractions_Grade_4.pdf',
  makePdf({
    title: 'Fractions for Grade 4',
    pages: [{ lines: ['Fractions', 'A fraction has a numerator and a denominator, like 3/4.', 'Equivalent fractions: 1/2 = 2/4.'] }],
  })
);

put(
  '16 Linux & Ubuntu/Ubuntu_Command_Line.pdf',
  makePdf({
    title: 'The Ubuntu Command Line',
    pages: [
      { lines: ['File permissions', 'Use chmod to change permissions: chmod +x script.sh makes it executable.'] },
      { lines: ['Solar panel wiring for a laptop', 'Wire the solar panel to the charge controller, never straight to the battery.'] },
    ],
  })
);

put(
  '05 Survival & Emergency/FM21-76_Survival_1957.pdf',
  makePdf({ title: 'Survival FM 21-76 (1957 scan)', pages: [{ image: true }, { image: true }, { image: true }] })
);

// A "bot check" HTML page saved with a .pdf name - must be skipped.
put('02 Water & Sanitation/Blocked_Download.pdf', '<!doctype html><html><body>Please verify you are human</body></html>');

const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><style>p{margin:0}</style></head>` +
  `<body><h1>${title}</h1>${body}<script>var ignored = "scripts are not indexed";</script></body></html>`;

put(
  '07 Metalworking/Forge_Basics.epub',
  makeZip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    {
      name: 'META-INF/container.xml',
      data:
        '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    {
      name: 'OEBPS/content.opf',
      data:
        '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0">' +
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Forge Basics &amp; Smithing</dc:title></metadata>' +
        '<manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="css" href="style.css" media-type="text/css"/></manifest>' +
        '<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    },
    { name: 'OEBPS/style.css', data: 'body { font-family: serif; }' },
    {
      name: 'OEBPS/ch1.xhtml',
      data: xhtml('The Forge', '<p>Light the forge with coke or charcoal.</p><p>Keep the fire clean &amp; hot.</p>'),
    },
    {
      name: 'OEBPS/text/ch2.xhtml',
      data: xhtml('Welding', '<p>Forge welding joins two pieces of iron at a white heat.</p><p>Use borax as a flux.</p>'),
    },
  ])
);

// Kiwix folder exists but holds no ZIMs (tests the "no-zims" state). Not a book category.
put('15 Offline Encyclopedias (Kiwix)/.gitkeep', '');

console.log('fixtures written to', lib);
