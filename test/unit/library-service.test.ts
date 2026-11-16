// Memoria → Artifact (ADR 0319), the index in main: a scan of the brain's reviews/tmp/evidence and the chats' evidence
// folders, a chat's turn links, the one-time backfill, versions (a rewritten file keeps its old text as a copy, a -v2
// joins its report), a file that went shown as missing (never dropped), the brain's own folders left out, areas, the
// index kept across a restart, a card's picture. Temp folders only; no timers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';
import { LibraryService, answerTexts, type LibraryChat, type LibraryPorts } from '../../src/main/library/service';
import { tinyPdf } from '../../src/main/library/demo';
import { walk } from '../../src/main/library/walk';

const temporary: string[] = [];
afterEach(() => { for (const d of temporary.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function setup(chats: LibraryChat[] = [], history: Record<string, ChatItem[]> = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-library-'));
  temporary.push(base);
  const brain = path.join(base, 'brain'), userData = path.join(base, 'user');
  fs.mkdirSync(brain, { recursive: true }); fs.mkdirSync(userData, { recursive: true });
  let changed = 0;
  const ports: LibraryPorts = { userData, brainRoot: () => brain, chats: () => chats, history: id => history[id] ?? [], changed: () => { changed++; }, now: () => 1_000 };
  const write = (rel: string, body: string | Buffer, mtime?: number, root = brain) => {
    const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body);
    if (mtime) fs.utimesSync(f, new Date(mtime), new Date(mtime));
    return f;
  };
  return { base, brain, userData, ports, write, changed: () => changed, make: (p: Partial<LibraryPorts> = {}) => new LibraryService({ ...ports, ...p }) };
}
const chat = (id: string, cwd: string, title = id, extra: Partial<LibraryChat> = {}): LibraryChat => ({ id, title, cwd, updatedAt: 1, isOrchestrator: false, ...extra });
const said = (text: string, at = 1): ChatItem => ({ kind: 'assistant', id: `a${at}`, at, text });

describe('the scan', () => {
  it('indexes reports, documents, PDFs and images in the work folders; the brain’s own folders stay out', async () => {
    const t = setup();
    t.write('reviews/2026-11-10-analisi.md', '# Analisi dei costi\n\nIn una settimana gli agenti hanno speso 31 dollari.\n', Date.UTC(2026, 10, 10));
    t.write('reviews/qa/report.html', '<title>QA rimborsi</title><p>Dodici scenari provati sul checkout di prova.</p>');
    t.write('tmp/audit.pdf', tinyPdf('Audit', ['ok']));
    t.write('evidence/fix-1/before.png', Buffer.from('not really a png'));
    t.write('journal/2026-11-10.md', '# Diario');
    t.write('memory/fatto.md', '# Fatto');
    t.write('reviews/README.md', '# Leggimi');
    t.write('tmp/node_modules/x/doc.md', '# doc');
    const lib = t.make();
    await lib.scan();
    const list = lib.list();
    expect(list.artifacts.map(a => a.title).sort()).toEqual(['Analisi dei costi', 'Audit', 'Before', 'QA rimborsi']);
    expect(list.artifacts.find(a => a.kind === 'markdown')).toMatchObject({ summary: 'In una settimana gli agenti hanno speso 31 dollari.', area: 'Brain', origin: 'scan', missing: false });
    expect(list.scannedAt).toBe(1_000);
    expect(t.changed()).toBeGreaterThan(0);
  });

  it('makes a -v2 and a rewritten file versions of one artifact, the old text kept as a copy', async () => {
    const t = setup();
    t.write('reviews/costi.md', '# Costi\n\nPrima versione del documento sui costi.\n', Date.UTC(2026, 10, 1));
    const lib = t.make();
    await lib.scan();
    t.write('reviews/costi-v2.md', '# Costi\n\nSeconda versione del documento sui costi.\n', Date.UTC(2026, 10, 5));
    await lib.refresh();
    let a = lib.list().artifacts;
    expect(a).toHaveLength(1);
    expect(a[0]!.versions.map(v => path.basename(v.path))).toEqual(['costi-v2.md', 'costi.md']);
    // the newest file rewritten: a third version, the second one's text kept as a copy that still reads as it was
    t.write('reviews/costi-v2.md', '# Costi\n\nTerza versione del documento sui costi.\n', Date.UTC(2026, 10, 9));
    await lib.refresh();
    a = lib.list().artifacts;
    expect(a[0]!.versions).toHaveLength(3);
    expect(a[0]!.summary).toContain('Terza');
    const old = a[0]!.versions[1]!;
    expect(old).toMatchObject({ missing: true });
    expect(fs.readFileSync(old.copy!, 'utf8')).toContain('Seconda');
  });

  it('keeps a file that went, marked missing, and unmarks it when it is back', async () => {
    const t = setup();
    const f = t.write('tmp/bozza.md', '# Bozza\n\nUna bozza che poi viene cancellata dal disco.\n');
    const lib = t.make();
    await lib.scan();
    fs.rmSync(f);
    await lib.refresh();
    expect(lib.list().artifacts[0]).toMatchObject({ title: 'Bozza', missing: true });
    expect(lib.list().artifacts[0]!.versions[0]!.copy).toBeTruthy();
    // the card's picture of a missing HTML or Markdown is not read from the gone file
    expect(await lib.thumb(lib.list().artifacts[0]!.id)).toBeNull();
    t.write('tmp/bozza.md', '# Bozza\n\nUna bozza che poi viene cancellata dal disco.\n');
    await lib.refresh();
    expect(lib.list().artifacts[0]!.missing).toBe(false);
  });

  it('gives a chat’s evidence folder to that chat, with its project as area', async () => {
    const t = setup([chat('c_7', path.join(os.tmpdir(), 'alfa-shop'), 'Fix totale')]);
    t.write('chat-c_7/shot.png', Buffer.from('x'), undefined, path.join(t.userData, 'evidence'));
    const lib = t.make();
    await lib.scan();
    expect(lib.list().artifacts[0]).toMatchObject({ chatId: 'c_7', chatTitle: 'Fix totale', origin: 'chat', area: 'alfa-shop' });
  });

  it('keeps the index across a restart and starts over from an unreadable one', async () => {
    const t = setup();
    t.write('reviews/a.md', '# A\n');
    await t.make().scan();
    const again = t.make();
    expect(again.list().artifacts.map(a => a.title)).toEqual(['A']);
    fs.writeFileSync(path.join(t.userData, 'library', 'index.json'), '{broken');
    expect(t.make().list().artifacts).toEqual([]);
    expect(fs.readdirSync(path.join(t.userData, 'library')).some(f => f.startsWith('index.json.bad-'))).toBe(true);
  });
});

describe('a chat’s links', () => {
  it('indexes what a turn links (absolute, relative to its folder or the brain), for that chat', async () => {
    const t = setup();
    const proj = path.join(t.base, 'alfa-shop');
    fs.mkdirSync(proj);
    const chats = [chat('c1', proj, 'QA rimborsi', { run: { tags: { app: 'Shop', repo: 'alfa-shop' } } })];
    const t2 = { ...t, ports: { ...t.ports, chats: () => chats } };
    const abs = t.write('reviews/qa.html', '<title>QA</title>');
    t.write('out/esito.md', '# Esito\n', undefined, proj);
    t.write('tmp/mappa.md', '# Mappa\n');
    const lib = new LibraryService(t2.ports);
    const items: ChatItem[] = [
      { kind: 'user', id: 'u0', at: 0, text: 'vecchio C:\\nope.md' }, said('prima'),
      { kind: 'user', id: 'u1', at: 2, text: 'fai il report' },
      said(`Fatto: ${abs}, poi \`out/esito.md\` e tmp/mappa.md; README.md e https://x.y/z.md no.`, 3),
      { kind: 'tool', id: 't1', at: 4, name: 'mcp__app__agent_report', summary: '', input: { output: 'vedi out/esito.md' }, status: 'ok' },
    ];
    await lib.noteTurn('c1', items);
    const list = lib.list().artifacts;
    expect(list.map(a => a.title).sort()).toEqual(['Esito', 'Mappa', 'QA']);
    expect(list.every(a => a.chatId === 'c1' && a.origin === 'chat' && a.area === 'Shop')).toBe(true);
  });

  it('a chat that links a scanned file becomes its source', async () => {
    const t = setup([chat('c2', '/nowhere', 'Analisi')]);
    const f = t.write('reviews/x.md', '# X\n');
    const lib = t.make();
    await lib.scan();
    expect(lib.list().artifacts[0]!.chatId).toBeUndefined();
    await lib.linkFromChat('c2', [`ecco ${f}`]);
    expect(lib.list().artifacts[0]).toMatchObject({ chatId: 'c2', origin: 'chat' });
  });

  it('looks through past chats once (backfill), after the first scan', async () => {
    const t = setup([chat('old', '/nowhere', 'Vecchia chat')]);
    const f = t.write('tmp/vecchio.md', '# Vecchio report\n');
    const lib = t.make({ history: () => [said(`report: ${f}`)] });
    await lib.backfill();
    expect(lib.list()).toMatchObject({ backfilled: true });
    expect(lib.list().artifacts[0]).toMatchObject({ chatId: 'old', title: 'Vecchio report' });
    // once: a second call reads no history
    let asked = 0;
    const again = t.make({ history: () => { asked++; return []; } });
    await again.backfill();
    expect(asked).toBe(0);
  });

  it('reads answer texts and report tools only', () => {
    expect(answerTexts([said('a'), { kind: 'tool', id: 't', at: 1, name: 'Read', summary: '', input: { file_path: '/x.md' }, status: 'ok' }, { kind: 'tool', id: 'r', at: 1, name: 'agent_report', summary: '', input: { output: 'y' }, status: 'ok' }])).toEqual(['a', 'y']);
  });
});

describe('every kind of file', () => {
  it('indexes tables, documents, recordings and other files; a text one gets a summary, its lines and a kept copy', async () => {
    const t = setup();
    const csv = t.write('tmp/ordini.csv', 'ordine;cliente;totale\n1;Rossi;12\n');
    t.write('reviews/verbale.docx', Buffer.from('PK\x03\x04 not really a docx'));
    t.write('evidence/fix-1/demo.mp4', Buffer.from('mp4'));
    t.write('tmp/run.ps1', 'Write-Host x');
    t.write('tmp/package.json', '{}');
    t.write('tmp/storage-state.json', '{"cookies":[]}');
    t.write('tmp/esportazione.json', `{"access_${'token'}": "${'x'.repeat(16)}"}`);
    const lib = t.make();
    await lib.scan();
    // a login's state is never indexed; a json holding a token is, without its text on the card
    const secret = lib.list().artifacts.find(a => a.title === 'Esportazione')!;
    expect(secret.summary).toBe('');
    expect(await lib.thumb(secret.id)).toBeNull();
    await lib.linkFromChat('c9', [`export: ${csv}`]);
    const all = lib.list().artifacts.filter(a => a !== secret && a.id !== secret.id);
    expect(all.map(a => a.kind).sort()).toEqual(['data', 'document', 'media']);
    const table = all.find(a => a.kind === 'data')!;
    expect(table).toMatchObject({ title: 'Ordini', summary: 'ordine · cliente · totale' });
    expect(await lib.thumb(table.id)).toEqual({ kind: 'text', text: expect.stringContaining('1;Rossi;12') });
    expect(await lib.thumb(all.find(a => a.kind === 'document')!.id)).toBeNull();
    fs.rmSync(csv);
    await lib.refresh();
    const gone = lib.list().artifacts.find(a => a.title === 'Ordini')!;
    expect(gone.missing).toBe(true);
    expect(gone.versions[0]!.copy).toMatch(/\.csv$/);
    expect(await lib.thumb(gone.id)).toEqual({ kind: 'text', text: expect.stringContaining('Rossi') });
  });

  it('shows a GIF or an SVG as it is, when it is one', async () => {
    const t = setup();
    t.write('reviews/anim.gif', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]));
    t.write('reviews/fake.gif', Buffer.from('nope'));
    t.write('reviews/flow.svg', '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const lib = t.make();
    await lib.scan();
    const by = (name: string) => lib.list().artifacts.find(a => path.basename(a.path) === name)!;
    expect(await lib.thumb(by('anim.gif').id)).toMatchObject({ kind: 'image', dataUrl: expect.stringMatching(/^data:image\/gif;base64,/) });
    expect(await lib.thumb(by('fake.gif').id)).toBeNull();
    expect(await lib.thumb(by('flow.svg').id)).toMatchObject({ kind: 'image', dataUrl: expect.stringMatching(/^data:image\/svg\+xml;base64,/) });
  });

  it('opens only an indexed file with the system’s app, a gone one by its kept copy', async () => {
    const t = setup();
    const opened: string[] = [];
    const doc = t.write('reviews/verbale.docx', Buffer.from('PK'));
    const md = t.write('reviews/nota.md', '# Nota\n\nUna nota che poi viene cancellata dal disco.\n');
    const lib = t.make({ openPath: async f => { opened.push(f); return ''; } });
    await lib.scan();
    expect(await lib.open(doc)).toEqual({ ok: true });
    expect(await lib.open(path.join(t.brain, 'secret.exe'))).toMatchObject({ ok: false });
    fs.rmSync(md);
    await lib.refresh();
    const copy = lib.list().artifacts.find(a => a.kind === 'markdown')!.versions[0]!.copy!;
    expect(await lib.open(md)).toEqual({ ok: true });
    expect(await lib.open(copy)).toEqual({ ok: true });
    expect(opened).toEqual([doc, copy, copy]);
    expect(await t.make().open(doc)).toMatchObject({ ok: false });
  });
});

describe('card pictures and the walk', () => {
  it('gives an HTML head to draw and an image scaled by the port, cached', async () => {
    const t = setup();
    t.write('reviews/r.html', '<title>R</title><p>x</p>');
    t.write('reviews/s.png', Buffer.from('png'));
    let made = 0;
    const lib = t.make({ thumbnail: async () => { made++; return 'data:image/jpeg;base64,AAAA'; } });
    await lib.scan();
    const [html, img] = ['html', 'image'].map(k => lib.list().artifacts.find(a => a.kind === k)!);
    expect(await lib.thumb(html!.id)).toMatchObject({ kind: 'html', text: expect.stringContaining('<title>R</title>') });
    expect(await lib.thumb(img!.id)).toEqual({ kind: 'image', dataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(await lib.thumb(img!.id)).toEqual({ kind: 'image', dataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(made).toBe(1);
    expect(await lib.thumb('nope')).toBeNull();
  });

  it('never follows a link and skips empty files and tool folders', async () => {
    const t = setup();
    t.write('reviews/ok.md', '# ok');
    t.write('reviews/empty.md', '');
    t.write('reviews/bin/x.md', '# no');
    try { fs.symlinkSync(path.join(t.brain, 'reviews'), path.join(t.brain, 'reviews', 'loop')); } catch { /* no symlinks here */ }
    const found = await walk([{ dir: path.join(t.brain, 'reviews'), depth: 5 }]);
    expect(found.map(f => path.basename(f.path))).toEqual(['ok.md']);
  });
});

describe('what is kept', () => {
  it('copies a report always, a scratch table only when a chat linked it', async () => {
    const t = setup([chat('c1', '/nowhere')]);
    t.write('tmp/a.csv', 'x;y\n1;2\n');
    const linked = t.write('tmp/b.csv', 'x;y\n3;4\n');
    t.write('reviews/r.md', '# R\n');
    const lib = t.make();
    await lib.scan();
    await lib.linkFromChat('c1', [`vedi ${linked}`]);
    const copy = (name: string) => lib.list().artifacts.find(a => path.basename(a.path) === name)!.versions[0]!.copy;
    expect([!!copy('a.csv'), !!copy('b.csv'), !!copy('r.md')]).toEqual([false, true, true]);
  });

  it('takes a relative link outside the brain only for a file written during the turn', async () => {
    const t = setup();
    const proj = path.join(t.base, 'proj');
    t.write('docs/guida.md', '# Guida del progetto\n', Date.UTC(2020, 0, 1), proj);
    t.write('out/esito.md', '# Esito\n', Date.UTC(2026, 10, 16, 10), proj);
    const lib = new LibraryService({ ...t.ports, chats: () => [chat('c1', proj)] });
    await lib.noteTurn('c1', [{ kind: 'user', id: 'u', at: Date.UTC(2026, 10, 16, 9), text: 'fai' }, said('Scritto out/esito.md seguendo docs/guida.md', Date.UTC(2026, 10, 16, 10))]);
    expect(lib.list().artifacts.map(a => a.title)).toEqual(['Esito']);
  });

  it('starts a look through the folders only when the tab asks', async () => {
    const t = setup();
    t.write('reviews/a.md', '# A\n');
    const lib = t.make();
    expect(lib.list().artifacts).toEqual([]);
    expect(lib.list().scanning).toBe(false);
    lib.list({ scan: true });
    expect(lib.list().scanning).toBe(true);
    await lib.refresh();
    expect(lib.list().artifacts.map(a => a.title)).toEqual(['A']);
  });
});
