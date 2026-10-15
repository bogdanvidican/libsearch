import { describe, expect, it } from 'vitest';
import { groupFor, parseCatalog, parseSearchHtml, parseSearchXml, toKiwixBook } from '../../src/server/kiwixParse';
import { HL_END, HL_START } from '../../src/shared/api';

const CATALOG_V2 = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="https://specs.opds.io/opds-1.2">
  <id>abc</id>
  <entry>
    <id>urn:uuid:1111-2222</id>
    <title>Wikipedia Medicine &amp; Health</title>
    <summary>Medical articles</summary>
    <language>eng</language>
    <name>wikipedia_en_medicine_maxi</name>
    <category>wikipedia</category>
    <articleCount>71200</articleCount>
    <link rel="http://opds-spec.org/image/thumbnail" href="/catalog/v2/illustration/1111/?size=48" type="image/png;width=48;height=48;scale=1"/>
    <link type="text/html" href="/content/wikipedia_en_medicine_maxi_2026-01" />
  </entry>
  <entry>
    <id>urn:uuid:3333</id>
    <title>Ask Ubuntu</title>
    <name>askubuntu.com_en_all</name>
    <link type="text/html" href="/content/askubuntu.com_en_all_2026-02" />
  </entry>
  <entry>
    <id>urn:uuid:4444</id>
    <title>Khan Academy</title>
    <name>khanacademy_en_all</name>
    <link type="text/html" href="/content/khanacademy_en_all_2023-03"/>
  </entry>
</feed>`;

describe('parseCatalog', () => {
  it('reads books from an OPDS v2 feed', () => {
    const e = parseCatalog(CATALOG_V2);
    expect(e).toHaveLength(3);
    expect(e[0]).toMatchObject({
      contentName: 'wikipedia_en_medicine_maxi_2026-01',
      uuid: '1111-2222',
      name: 'wikipedia_en_medicine_maxi',
      title: 'Wikipedia Medicine & Health',
      language: 'eng',
      articleCount: 71200,
      homeUrl: '/content/wikipedia_en_medicine_maxi_2026-01/',
    });
    expect(e.map(groupFor)).toEqual(['reference', 'qa', 'khan']);
    expect(toKiwixBook(e[1]).group).toBe('qa');
  });

  it('handles legacy root links without /content/', () => {
    const e = parseCatalog('<feed><entry><title>PhET</title><link type="text/html" href="/phet_en"/></entry></feed>');
    expect(e[0].contentName).toBe('phet_en');
    expect(e[0].homeUrl).toBe('/phet_en/');
  });
});

describe('parseSearchXml', () => {
  it('reads OpenSearch RSS results with escaped HTML snippets', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><channel>
      <opensearch:totalResults>42</opensearch:totalResults>
      <item><title>Water purification</title><link>/content/wikimed/A/Water_purification</link>
        <description>...bring &lt;b&gt;water&lt;/b&gt; to a &lt;b&gt;boil&lt;/b&gt; &amp;amp; wait...</description>
        <book><title>WikiMed</title></book><wordCount>1234</wordCount></item>
      <item><title>Boiling</title><link>http://127.0.0.1:8080/content/wikimed/A/Boiling</link><description></description></item>
    </channel></rss>`;
    const r = parseSearchXml(xml);
    expect(r.total).toBe(42);
    expect(r.results[0]).toEqual({
      title: 'Water purification',
      url: '/content/wikimed/A/Water_purification',
      snippet: `...bring ${HL_START}water${HL_END} to a ${HL_START}boil${HL_END} & wait...`,
    });
    expect(r.results[1].url).toBe('/content/wikimed/A/Boiling');
  });
});

describe('parseSearchHtml', () => {
  it('reads the legacy HTML results page', () => {
    const html = `<div class="header">Results 1-2 of <b>17</b> for <b>water</b></div>
      <div class="results"><ul>
        <li><a href="/wikimed/A/Water">Water</a><cite>clean <b>water</b> saves lives</cite><div class="informations">10 words</div></li>
        <li><a href="/search?content=wikimed&amp;pattern=water&amp;start=25">Next</a></li>
      </ul></div>`;
    const r = parseSearchHtml(html);
    expect(r.results).toEqual([{ title: 'Water', url: '/wikimed/A/Water', snippet: `clean ${HL_START}water${HL_END} saves lives` }]);
    expect(r.total).toBe(17);
  });
});
