// A Word, Excel or PowerPoint file becomes Markdown the viewer shows (ADR 0328): headings, lists and tables of a
// document, a workbook's sheets with shared strings, dates and booleans, a deck's slides in the deck's own order; text
// stays literal, limits cut and say so, and a file that is not a readable Office file gives null. Files are built here
// with the app's own ZIP writer, no fixtures on disk.
import { describe, expect, it } from 'vitest';
import { officePreview, OFFICE_FORMATS } from '../../src/main/office-preview';
import { writeZip } from '../../src/main/agents/pack/zip';
import { demoDocx } from '../../src/main/library/demo';

const zip = (files: Record<string, string>) => writeZip(new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])));
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const doc = (body: string) => zip({ 'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>` });

describe('Word', () => {
  it('reads the demo document: its title, a heading, its paragraphs and its table', () => {
    const r = officePreview(demoDocx(), 'docx')!;
    expect(r.cut).toBe(false);
    expect(r.markdown).toContain('# Verbale della riunione di rilascio');
    expect(r.markdown).toContain('\n# Decisioni');
    expect(r.markdown).toContain('| Decisione | Chi | Entro |\n| --- | --- | --- |\n| Togliere le voci doppie dalle impostazioni | Sviluppo | 14 novembre |');
    expect(r.markdown).toContain('Prossima riunione il primo lunedì dopo il rilascio.');
  });

  it('keeps heading levels, one list for adjacent items, line breaks and literal text', () => {
    const p = (inner: string, pr = '') => `<w:p w:rsidR="00A1">${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${inner}</w:p>`;
    const t = (s: string) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
    const r = officePreview(doc([
      p(t('Capitolo'), '<w:pStyle w:val="Heading2"/>'),
      p(t('Sezione'), '<w:pStyle w:val="Titolo3"/>'),
      '<w:p/>',
      p(t('uno'), '<w:numPr><w:ilvl w:val="0"/></w:numPr>'),
      p(t('due'), '<w:numPr><w:ilvl w:val="0"/></w:numPr>'),
      p(`${t('prima')}<w:r><w:br/></w:r>${t('seconda &amp; 5 &lt; 7 &#232; *vero*')}`),
      p(`${t('a')}<w:r><w:tab/></w:r>${t('b')}`),
    ].join('')), 'docx')!;
    expect(r.markdown).toBe('## Capitolo\n\n### Sezione\n\n- uno\n- due\n\nprima  \nseconda & 5 \\< 7 è \\*vero\\*\n\na\tb');
  });

  it('a table cell with a pipe or several paragraphs stays one cell on one line', () => {
    const cell = (...ps: string[]) => `<w:tc>${ps.map(s => `<w:p><w:r><w:t>${s}</w:t></w:r></w:p>`).join('')}</w:tc>`;
    const r = officePreview(doc(`<w:tbl><w:tr>${cell('A|B')}${cell('C')}</w:tr><w:tr>${cell('x')}</w:tr></w:tbl>`), 'docx')!;
    expect(r.markdown).toBe('| A\\|B | C |\n| --- | --- |\n| x |   |');
  });
});

describe('Excel', () => {
  const book = (sheets: Record<string, string>, extra: Record<string, string> = {}) => {
    const names = Object.keys(sheets);
    return zip({
      'xl/workbook.xml': `<workbook><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
      ...Object.fromEntries(names.map((n, i) => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet><sheetData>${sheets[n]}</sheetData></worksheet>`])),
      ...extra,
    });
  };

  it('shows each sheet as a table: shared and inline strings, numbers, booleans, dates, gaps by cell reference', () => {
    const r = officePreview(book({
      'Costi &amp; ricavi': [
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Nota</t></is></c></row>',
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12.5</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" s="1"><v>46345</v></c></row>',
        '<row r="3"><c r="A3" s="2"><v>46345.75</v></c><c r="B3" t="str"><f>A1</f><v>calcolato</v></c><c r="C3" s="0"><v>46345</v></c></row>',
        '<row r="4"><c r="A4"/></row>',
      ].join(''),
      Vuoto: '',
    }, {
      'xl/sharedStrings.xml': '<sst><si><t>Voce</t></si><si><r><t>Im</t></r><r><t>porto</t></r><rPh><t>furigana</t></rPh></si><si><t>Licenze</t></si></sst>',
      'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/><numFmt numFmtId="165" formatCode="0.00&quot; days&quot;"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    }), 'xlsx')!;
    expect(r.cut).toBe(false);
    expect(r.markdown).toBe([
      '## Costi & ricavi',
      '',
      '| Voce | Importo |   | Nota |',
      '| --- | --- | --- | --- |',
      '| Licenze | 12.5 | TRUE | 2026-11-19 |',
      '| 2026-11-19 18:00 | calcolato | 46345 |   |',
      '',
      '## Vuoto',
    ].join('\n'));
  });

  it('cuts rows, columns and sheets past the limits and says so', () => {
    const rows = Array.from({ length: 301 }, (_, i) => `<row><c><v>${i}</v></c></row>`).join('');
    const long = officePreview(book({ A: rows }), 'xlsx')!;
    expect(long.cut).toBe(true);
    expect(long.markdown.split('\n').length).toBe(2 + 301); // the heading and a blank line, 300 rows and the rule under the first
    const wide = officePreview(book({ A: `<row>${Array.from({ length: 41 }, (_, i) => `<c><v>${i}</v></c>`).join('')}</row>` }), 'xlsx')!;
    expect(wide.cut).toBe(true);
    expect(wide.markdown.split('\n')[2]!.split(' | ').length).toBe(40);
    const many = officePreview(book(Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`S${i}`, '']))), 'xlsx')!;
    expect(many.cut).toBe(true);
    expect(many.markdown.match(/^## /gm)!.length).toBe(12);
  });
});

describe('PowerPoint', () => {
  const sp = (text: string[], ph = '') => `<p:sp><p:nvSpPr><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${text.map(s => `<a:p><a:r><a:t>${s}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
  const slide = (inner: string) => `<p:sld><p:cSld><p:spTree>${inner}</p:spTree></p:cSld></p:sld>`;

  it('shows the slides in the deck’s order, each with its title, its points and its tables', () => {
    const r = officePreview(zip({
      'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId1" Type="x" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="x" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': slide(`${sp(['Numeri'], 'title')}${sp(['Costo: 12 $', 'Tempo: 3 h'])}<a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Mese</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Spesa</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Ott</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>40</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>`),
      'ppt/slides/slide2.xml': slide(`${sp(['Piano di rilascio'], 'ctrTitle')}${sp(['Novembre 2026'], 'subTitle')}`),
    }), 'pptx')!;
    expect(r.cut).toBe(false);
    expect(r.markdown).toBe('## 1. Piano di rilascio\n- Novembre 2026\n\n## 2. Numeri\n- Costo: 12 $\n- Tempo: 3 h\n\n| Mese | Spesa |\n| --- | --- |\n| Ott | 40 |\n');
  });

  it('falls back to the slide files’ numbers when the deck’s list is missing', () => {
    const r = officePreview(zip({ 'ppt/slides/slide10.xml': slide(sp(['Dieci'], 'title')), 'ppt/slides/slide2.xml': slide(sp(['Due'], 'title')) }), 'pptx')!;
    expect(r.markdown).toBe('## 1. Due\n\n## 2. Dieci');
  });
});

describe('what is not a readable Office file', () => {
  it('gives null: not a ZIP, a damaged ZIP, a ZIP without the document part, the wrong format', () => {
    expect(officePreview(Buffer.from('plain text, long enough to pass the size floor'), 'docx')).toBeNull();
    expect(officePreview(Buffer.alloc(0), 'docx')).toBeNull();
    const good = demoDocx();
    expect(officePreview(good.subarray(0, good.length - 30), 'docx')).toBeNull();
    // the old binary format and an encrypted file are OLE containers, not ZIPs
    expect(officePreview(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]), 'docx')).toBeNull();
    expect(officePreview(zip({ 'other.xml': '<a/>' }), 'docx')).toBeNull();
    expect(officePreview(good, 'xlsx')).toBeNull();
    expect(officePreview(good, 'pptx')).toBeNull();
  });

  it('a directory that points outside the file is refused, not read', () => {
    const bytes = Buffer.from(demoDocx());
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    bytes.writeUInt32LE(0x7fffffff, end + 16);
    expect(officePreview(bytes, 'docx')).toBeNull();
  });

  it('reads past elements that are never closed (a file made to hurt is scanned once, not once per tag)', () => {
    const open = '<w:tbl><w:tr><w:tc>'.repeat(20_000);
    const r = officePreview(doc(`<w:p><w:r><w:t>prima</w:t></w:r></w:p>${open}<w:p><w:r><w:t>dopo</w:t></w:r></w:p>`), 'docx')!;
    expect(r.markdown).toBe('prima\n\ndopo');
    const cells = officePreview(zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="A" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row><c t="inlineStr"><is><t>ok</t></is></c>${'<c r="'.repeat(20_000)}</row></sheetData></worksheet>`,
    }), 'xlsx')!;
    expect(cells.markdown).toBe('## A\n\n| ok |\n| --- |');
  });

  it('says the preview is cut when a sheet is too big to read', () => {
    const big = Buffer.concat([Buffer.from('<worksheet><sheetData>'), Buffer.alloc(30_000_001, 0x20), Buffer.from('</sheetData></worksheet>')]);
    const bytes = writeZip(new Map([
      ['xl/workbook.xml', Buffer.from('<workbook><sheets><sheet name="Dati" r:id="rId1"/></sheets></workbook>')],
      ['xl/_rels/workbook.xml.rels', Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')],
      ['xl/worksheets/sheet1.xml', big],
    ]), { packed: 40_000_000, unpacked: 80_000_000, entries: 10, file: 40_000_000, ratio: 100_000, depth: 8 });
    expect(officePreview(bytes, 'xlsx')).toEqual({ markdown: '## Dati', cut: true });
  });

  it('knows the three formats by extension', () => {
    expect(OFFICE_FORMATS).toEqual({ '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx' });
  });
});
