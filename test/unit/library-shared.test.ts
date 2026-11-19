// Memoria → Artifact (ADR 0328), the shared rules: which files can be artifacts (only what the viewer opens), which
// files are versions of one report, title and summary from a head, the search, related artifacts, a path's artifact.
import { describe, expect, it } from 'vitest';
import { artifactKind, readsText, secretHead, artifactOfPath, searchArtifacts, nameTitle, relatedArtifacts, stemOf, summaryOf, titleOf, versionKey, type Artifact } from '../../src/shared/library';

const art = (o: Partial<Artifact> & { id: string; path: string }): Artifact => ({
  title: o.id, kind: 'markdown', area: 'Brain', summary: '', at: 0, size: 1, missing: false,
  versions: [{ path: o.path, at: o.at ?? 0, size: 1 }], ...o,
});

describe('which files can be artifacts', () => {
  it('takes the formats the app’s viewer opens, and nothing else', () => {
    expect(artifactKind('C:\\b\\reviews\\x.md')).toBe('markdown');
    expect(artifactKind('/home/u/r/report.HTML')).toBe('html');
    expect(artifactKind('/home/u/r/a.pdf')).toBe('pdf');
    expect(artifactKind('/home/u/r/shot.jpeg')).toBe('image');
    expect(artifactKind('/home/u/r/a.gif')).toBe('image');
    expect(artifactKind('C:\\b\\tmp\\ordini.csv')).toBe('data');
    expect(artifactKind('/r/costi.xlsx')).toBe('data');
    expect(artifactKind('/r/verbale.docx')).toBe('document');
    expect(artifactKind('/r/slide.pptx')).toBe('document');
    expect(artifactKind('/r/note.txt')).toBe('document');
    // an agent declares its artifact, so a name is no longer guessed at: a README it was asked to write is one
    expect(artifactKind('/home/u/r/README.md')).toBe('markdown');
    // what the viewer cannot open is never one (ADR 0328: every artifact opens in the app), nor code or a hidden file
    for (const p of ['/r/demo.mp4', '/r/audio.mp3', '/r/pack.zip', '/r/schema.drawio', '/r/old.doc', '/r/old.xls', '/r/disegno.svg', '/r/main.ts', '/r/setup.exe', '/r/x.log', '/r/.note.md']) expect(artifactKind(p)).toBeNull();
    // nor a login's state or a secret named as such
    for (const p of ['/r/storage-state.json', '/r/auth.json', '/r/cookies.json', '/r/token.txt', '/r/client_secret_1.json', '/r/credentials.csv']) expect(artifactKind(p)).toBeNull();
  });
  it('tells a head that holds a credential', () => {
    expect(secretHead('{"refresh_token": "x"}')).toBe(true);
    expect(secretHead(['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' '))).toBe(true);
    expect(secretHead(`${'pass'}word = ${'y'.repeat(12)}`)).toBe(true);
    expect(secretHead('# Analisi\n\nIl token di accesso scade dopo un\'ora.')).toBe(false);
  });
  it('knows which heads are text', () => {
    expect([readsText('/r/a.csv'), readsText('/r/a.txt'), readsText('/r/a.html'), readsText('/r/a.docx'), readsText('/r/a.png')]).toEqual([true, true, true, false, false]);
  });
});

describe('versions of one report', () => {
  it('drops dates, version tokens and copy marks from a name', () => {
    expect(stemOf('2026-10-26-flow-bugfix-v18-notes')).toBe('flow-bugfix-notes');
    expect(stemOf('flow-bugfix-v19-notes')).toBe('flow-bugfix-notes');
    expect(stemOf('2026-10-23-app-devops-adapter-review-2')).toBe('app-devops-adapter-review');
    expect(stemOf('report (1)')).toBe('report');
    expect(stemOf('analisi-final')).toBe('analisi');
    // parts are not copies
    expect(stemOf('piano-part-1')).not.toBe(stemOf('piano-part-2'));
    expect(stemOf('research-2-testplans')).toBe('research-2-testplans');
    expect(stemOf('fix-126308')).toBe('fix-126308');
    expect(stemOf('2026-10-12')).toBe('2026-10-12');
  });
  it('keys a document by kind, folder and stem; an image only by its path', () => {
    const k = (p: string) => versionKey(p, artifactKind(p)!, 'win32');
    expect(k('C:\\b\\reviews\\2026-10-25-flow-bugfix-v15-notes.md')).toBe(k('C:\\b\\Reviews\\2026-10-26-flow-bugfix-notes.md'));
    expect(k('C:\\b\\reviews\\2026-10-12-giornata\\report.html')).toBe(k('C:\\b\\reviews\\2026-10-13-giornata\\report.html'));
    expect(k('C:\\b\\evidence\\fix-126862\\report.md')).not.toBe(k('C:\\b\\evidence\\fix-126308\\report.md'));
    expect(k('C:\\b\\reviews\\a.md')).not.toBe(k('C:\\b\\reviews\\a.html'));
    expect(k('C:\\e\\shot-2026-11-01T10-00-00-000Z.png')).not.toBe(k('C:\\e\\shot-2026-11-02T10-00-00-000Z.png'));
    expect(k('C:\\b\\tmp\\ordini-v2.csv')).toBe(k('C:\\b\\tmp\\ordini.csv'));
    expect(k('C:\\b\\tmp\\ordini.csv')).not.toBe(k('C:\\b\\tmp\\ordini.xlsx'));
    expect(k('C:\\b\\tmp\\verbale.docx')).toBe(k('C:\\b\\tmp\\verbale-final.docx'));
    // a report's name in another case is the same report
    expect(versionKey('/r/A.md', 'markdown', 'linux')).toBe(versionKey('/r/a.md', 'markdown', 'linux'));
    expect(versionKey('/x/r/a.md', 'markdown', 'linux')).not.toBe(versionKey('/X/r/a.md', 'markdown', 'linux'));
  });
});

describe('title and summary', () => {
  it('reads a Markdown heading and first paragraph', () => {
    const md = '---\nowner: x\n---\n# Analisi **costi**\n\n> nota\n\nIn una settimana gli agenti hanno speso 31 $ su [46 compiti](x.md).\n';
    expect(titleOf('markdown', md, '/r/a.md')).toBe('Analisi costi');
    expect(summaryOf('markdown', md)).toBe('In una settimana gli agenti hanno speso 31 $ su 46 compiti.');
  });
  it('reads an HTML title and description, entities decoded', () => {
    const html = '<html><head><title>QA &middot; esito</title><meta name="description" content="Dodici scenari provati sul checkout"></head><body><h1>x</h1></body></html>';
    expect(titleOf('html', html, '/r/report.html')).toBe('QA · esito');
    expect(summaryOf('html', html)).toBe('Dodici scenari provati sul checkout');
    expect(summaryOf('html', '<body><p>short</p><p>Un paragrafo abbastanza lungo da essere un riassunto.</p></body>')).toBe('Un paragrafo abbastanza lungo da essere un riassunto.');
  });
  it('reads a text file’s first paragraph and a table’s columns', () => {
    expect(summaryOf('document', 'Verbale\n\nSi è deciso di spostare il rilascio a lunedì prossimo.\n', '/r/v.txt')).toBe('Si è deciso di spostare il rilascio a lunedì prossimo.');
    expect(summaryOf('data', '\uFEFFordine;cliente;totale\n1;Rossi;12\n', '/r/o.csv')).toBe('ordine · cliente · totale');
    expect(summaryOf('data', 'a\tb\n', '/r/o.tsv')).toBe('a · b');
    expect(summaryOf('data', '{"a":1}', '/r/o.json')).toBe('');
  });
  it('falls back to the file name', () => {
    expect(titleOf('pdf', '', 'C:\\r\\2026-10-26-app-cpu-report.pdf')).toBe('App cpu report');
    expect(nameTitle('/r/shot_1.png')).toBe('Shot 1');
  });
});

describe('the list', () => {
  const now = Date.UTC(2026, 10, 16, 12);
  const list = [
    art({ id: 'b', path: '/r/b.html', kind: 'html', at: now - 10 * 864e5, area: 'Brain', title: 'Confronto motori', versions: [{ path: '/r/b.html', at: 2, size: 1 }, { path: '/r/b-v1.html', at: 1, size: 1, chatId: 'c2' }] }),
    art({ id: 'a', path: '/r/a.md', at: now - 3600e3, area: 'shop', chatId: 'c1', chatTitle: 'Fix totale', title: 'Analisi costi', summary: 'spesa settimanale' }),
    art({ id: 'c', path: '/r/sub/c.png', kind: 'image', at: now - 40 * 864e5, area: 'shop', title: 'Schermata' }),
  ];
  it('is one list, newest first, searched by words in title, summary, area, chat and file name', () => {
    expect(searchArtifacts(list, '').map(a => a.id)).toEqual(['a', 'b', 'c']);
    expect(searchArtifacts(list, 'SPESA fix').map(a => a.id)).toEqual(['a']);
    expect(searchArtifacts(list, 'shop').map(a => a.id)).toEqual(['a', 'c']);
    expect(searchArtifacts(list, 'c.png').map(a => a.id)).toEqual(['c']);
    expect(searchArtifacts(list, 'niente')).toEqual([]);
  });
  it('relates the same chat, then the same folder, then the same area those days', () => {
    const more = [list[1]!, list[0]!, list[2]!, art({ id: 'd', path: '/r/d.md', at: now, chatId: 'c1' }), art({ id: 'e', path: '/x/e.md', at: now - 864e5, area: 'shop' })];
    expect(relatedArtifacts(more[0]!, more).map(a => a.id)).toEqual(['d', 'b', 'e']);
  });
  it('finds the artifact and version of a file, its kept copy too', () => {
    const withCopy = [art({ id: 'x', path: 'C:\\R\\x.md', versions: [{ path: 'C:\\R\\x.md', at: 2, size: 1 }, { path: 'C:\\R\\x.md', at: 1, size: 1, missing: true, copy: 'C:\\u\\library\\versions\\abc.md' }] })];
    expect(artifactOfPath(withCopy, 'c:/r/X.md', 'win32')).toMatchObject({ version: 0 });
    expect(artifactOfPath(withCopy, 'C:\\u\\library\\versions\\abc.md', 'win32')).toMatchObject({ version: 1 });
    expect(artifactOfPath(withCopy, 'C:\\R\\y.md', 'win32')).toBeNull();
  });
});
