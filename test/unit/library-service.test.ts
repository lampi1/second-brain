// Memoria → Artifact (ADR 0328), the index in main: only what an agent declares (save) is an artifact, nothing is
// looked for in folders or chats; versions (a rewritten file keeps its old content as a copy, a -v2 joins its report),
// a file that went shown as missing until the user removes the card (the file itself is never touched), areas, the
// index kept across a restart, an index of ADR 0319 migrated, a card's picture, the artifact_save tool. Temp folders
// only; no timers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryService, migrate, type LibraryChat, type LibraryPorts } from '../../src/main/library/service';
import { demoDocx, seedDemoArtifacts, tinyPdf } from '../../src/main/library/demo';
import { artifactSaveTool } from '../../src/main/library/tools';
import { ToolRefusal } from '../../src/main/mcp/refusal';
import type { CallCtx } from '../../src/main/mcp/server';

const temporary: string[] = [];
afterEach(() => { for (const d of temporary.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function setup(chats: LibraryChat[] = []) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-library-')));
  temporary.push(base);
  const brain = path.join(base, 'brain'), userData = path.join(base, 'user');
  fs.mkdirSync(brain, { recursive: true }); fs.mkdirSync(userData, { recursive: true });
  let changed = 0;
  const ports: LibraryPorts = { userData, brainRoot: () => brain, chats: () => chats, changed: () => { changed++; } };
  const write = (rel: string, body: string | Buffer, mtime?: number, root = brain) => {
    const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body);
    if (mtime) fs.utimesSync(f, new Date(mtime), new Date(mtime));
    return f;
  };
  return { base, brain, userData, ports, write, changed: () => changed, make: (p: Partial<LibraryPorts> = {}) => new LibraryService({ ...ports, ...p }) };
}
const chat = (id: string, cwd: string, title = id, extra: Partial<LibraryChat> = {}): LibraryChat => ({ id, title, cwd, isOrchestrator: false, ...extra });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('what is an artifact', () => {
  it('is only what an agent declares: files lying in the brain or a chat’s folder are never picked up', async () => {
    const t = setup();
    t.write('reviews/report.html', '<title>Mai dichiarato</title>');
    t.write('tmp/scratch.md', '# Appunti');
    t.write('evidence/shot.png', PNG);
    t.write('evidence/chat-c1/shot.png', PNG, undefined, t.userData);
    const lib = t.make();
    expect(lib.list({ check: true }).artifacts).toEqual([]);
    await lib.refresh();
    expect(lib.list().artifacts).toEqual([]);
  });

  it('saves the file where it is, with the agent’s title and summary or the document’s own', async () => {
    const project = path.join(os.tmpdir(), 'x');
    const t = setup([chat('c1', project, 'Analisi costi')]);
    const own = t.write('reviews/costi.md', '# Costi di novembre\n\nIn una settimana gli agenti hanno speso 31 $ su 46 compiti.\n', 5_000);
    const named = t.write('reviews/piano.html', '<title>x</title><p>y</p>', 6_000);
    const lib = t.make();
    const first = await lib.save('c1', { path: own });
    expect(first).toMatchObject({ created: true, versions: 1, artifact: { title: 'Costi di novembre', summary: 'In una settimana gli agenti hanno speso 31 $ su 46 compiti.', kind: 'markdown', chatId: 'c1', chatTitle: 'Analisi costi', path: own, missing: false } });
    await lib.save('c1', { path: named, title: '  Piano di  rilascio ', summary: 'Tre passi per la 1.0.' });
    const list = lib.list().artifacts;
    expect(list.map(a => a.title)).toEqual(['Piano di rilascio', 'Costi di novembre']);
    expect(list[0]).toMatchObject({ summary: 'Tre passi per la 1.0.', kind: 'html' });
    expect(list[0]).not.toHaveProperty('given');
    expect(t.changed()).toBe(2);
    // the file was not moved, and the app kept a copy of it
    expect(fs.existsSync(own)).toBe(true);
    expect(fs.readFileSync(list[1]!.versions[0]!.copy!, 'utf8')).toContain('Costi di novembre');
    // saved again as it is: nothing new
    expect(await lib.save('c1', { path: own })).toMatchObject({ created: false, versions: 1 });
    expect(t.changed()).toBe(2);
  });

  it('takes a path relative to the chat’s folder, then to the brain', async () => {
    const t = setup();
    const project = path.join(t.base, 'shop');
    const chats = [chat('c1', project)];
    const inProject = t.write('docs/piano.md', '# Piano', undefined, project);
    const inBrain = t.write('reviews/analisi.md', '# Analisi');
    const lib = t.make({ chats: () => chats });
    expect((await lib.save('c1', { path: 'docs/piano.md' })).artifact).toMatchObject({ path: inProject, area: 'shop' });
    expect((await lib.save('c1', { path: 'reviews/analisi.md' })).artifact).toMatchObject({ path: inBrain, area: 'shop' });
    // without a chat: the brain only
    expect((await lib.save(undefined, { path: t.write('reviews/solo.md', '# Solo') })).artifact).toMatchObject({ area: 'Brain' });
  });

  it('refuses what is not a file the viewer opens, an empty file, a missing one and a credential', async () => {
    const t = setup();
    const lib = t.make();
    await expect(lib.save(undefined, { path: '' })).rejects.toThrow(/path: required/);
    await expect(lib.save(undefined, { path: t.write('reviews/demo.mp4', 'x') })).rejects.toThrow(/html, md, pdf/);
    await expect(lib.save(undefined, { path: t.write('reviews/main.ts', 'x') })).rejects.toThrow(/an artifact is one of/);
    await expect(lib.save(undefined, { path: path.join(t.brain, 'reviews', 'manca.md') })).rejects.toThrow(/no file at/);
    await expect(lib.save(undefined, { path: t.write('reviews/vuoto.md', '') })).rejects.toThrow(/empty/);
    await expect(lib.save(undefined, { path: t.write('reviews/note.md', `# Note\n\n${'pass'}word = ${'y'.repeat(12)}\n`) })).rejects.toThrow(/credential/);
    await expect(lib.save(undefined, { path: t.write('reviews/storage-state.json', '{}') })).rejects.toThrow(/an artifact is one of/);
    expect(lib.list().artifacts).toEqual([]);
    expect(t.changed()).toBe(0);
  });

  it('takes every format the viewer opens, binary ones copied too', async () => {
    const t = setup();
    const lib = t.make();
    const files = { 'a.pdf': tinyPdf('Audit', ['riga']), 'b.docx': demoDocx(), 'c.csv': 'ordine;totale\n1;12\n', 'd.png': PNG, 'e.txt': 'Verbale\n\nSi è deciso di spostare il rilascio a lunedì prossimo.\n', 'f.json': '{"a":1}' };
    let at = 1_000;
    for (const [name, body] of Object.entries(files)) await lib.save(undefined, { path: t.write(`reviews/${name}`, body, at += 1_000) });
    const list = lib.list().artifacts;
    expect(list.map(a => a.kind)).toEqual(['data', 'document', 'image', 'data', 'document', 'pdf']);
    expect(list.find(a => a.path.endsWith('c.csv'))).toMatchObject({ summary: 'ordine · totale' });
    expect(list.find(a => a.path.endsWith('e.txt'))).toMatchObject({ summary: 'Si è deciso di spostare il rilascio a lunedì prossimo.' });
    for (const a of list) expect(fs.statSync(a.versions[0]!.copy!).size).toBe(a.size);
  });
});

describe('versions', () => {
  it('makes a -v2 and a rewritten file versions of one artifact, the old content kept as a copy', async () => {
    const t = setup();
    const v1 = t.write('reviews/analisi-costi.md', '# Analisi\n\nPrima versione del testo dei costi.\n', 10_000);
    const lib = t.make();
    await lib.save('c1', { path: v1, title: 'Analisi dei costi' });
    const v2 = t.write('reviews/analisi-costi-v2.md', '# Analisi\n\nSeconda versione.\n', 20_000);
    expect(await lib.save('c2', { path: v2 })).toMatchObject({ created: false, versions: 2, artifact: { path: v2, title: 'Analisi dei costi', chatId: 'c2' } });
    // the same file written again: seen when the tab opens, with no call of the agent
    fs.writeFileSync(v2, '# Analisi\n\nTerza versione, riscritta.\n'); fs.utimesSync(v2, new Date(30_000), new Date(30_000));
    await lib.refresh();
    const [a] = lib.list().artifacts;
    expect(lib.list().artifacts).toHaveLength(1);
    expect(a!.versions.map(v => [path.basename(v.path), v.at, !!v.missing])).toEqual([['analisi-costi-v2.md', 30_000, false], ['analisi-costi-v2.md', 20_000, true], ['analisi-costi.md', 10_000, false]]);
    expect(fs.readFileSync(a!.versions[1]!.copy!, 'utf8')).toContain('Seconda versione');
    expect(a!.title).toBe('Analisi dei costi');
  });

  it('keeps a file that went, marked missing, and unmarks it when it is back', async () => {
    const t = setup();
    const f = t.write('reviews/bozza.md', '# Bozza del confronto\n\nUna prima bozza del confronto dei prezzi.\n', 10_000);
    const lib = t.make();
    await lib.save(undefined, { path: f });
    fs.rmSync(f);
    await lib.refresh();
    expect(lib.list().artifacts[0]).toMatchObject({ missing: true, title: 'Bozza del confronto' });
    t.write('reviews/bozza.md', '# Bozza del confronto\n\nUna prima bozza del confronto dei prezzi.\n', 10_000);
    await lib.refresh();
    expect(lib.list().artifacts[0]).toMatchObject({ missing: false });
  });
});

describe('a file rewritten behind the app’s back', () => {
  it('with an older date becomes the current version once, and every later look changes nothing', async () => {
    const t = setup();
    const f = t.write('reviews/report.md', '# Report\n\nIl testo nuovo del report.\n', 20_000);
    const lib = t.make();
    await lib.save(undefined, { path: f });
    // put back from a backup: other content, an older date
    t.write('reviews/report.md', '# Report\n\nIl testo di prima.\n', 10_000);
    await lib.refresh();
    const shape = () => lib.list().artifacts[0]!.versions.map(v => [v.at, !!v.missing]);
    expect(shape()).toEqual([[20_000, true], [10_000, false]]);
    expect(lib.list().artifacts[0]).toMatchObject({ at: 10_000, missing: false });
    const seen = t.changed();
    await lib.refresh();
    await lib.refresh();
    expect(shape()).toEqual([[20_000, true], [10_000, false]]);
    expect(t.changed()).toBe(seen);
  });

  it('a file that went and came back with other content is a new version, the old one stays as its copy', async () => {
    const t = setup();
    const f = t.write('reviews/report.md', '# Report\n\nPrima stesura.\n', 10_000);
    const lib = t.make();
    await lib.save(undefined, { path: f });
    fs.rmSync(f);
    await lib.refresh();
    t.write('reviews/report.md', '# Report\n\nSeconda stesura, più lunga.\n', 30_000);
    await lib.refresh();
    await lib.refresh();
    expect(lib.list().artifacts[0]!.versions.map(v => [v.at, !!v.missing, !!v.copy])).toEqual([[30_000, false, true], [10_000, true, true]]);
  });

  it('with a credential in it is still listed, but the app keeps no copy of that text', async () => {
    const t = setup();
    const f = t.write('reviews/results.json', '{"scenari": 12, "passati": 10}', 10_000);
    const lib = t.make();
    await lib.save(undefined, { path: f });
    // built here: a value shaped like a credential never sits in the repo (the guard)
    t.write('reviews/results.json', JSON.stringify({ ['access' + '_token']: 'x'.repeat(36) }), 20_000);
    await lib.refresh();
    const [now, before] = lib.list().artifacts[0]!.versions;
    expect([now!.at, now!.copy]).toEqual([20_000, undefined]);
    expect(fs.readFileSync(before!.copy!, 'utf8')).toContain('scenari');
    for (const name of fs.readdirSync(path.join(t.userData, 'library', 'versions'))) expect(fs.readFileSync(path.join(t.userData, 'library', 'versions', name), 'utf8')).not.toContain('access_token');
  });
});

describe('taking a card off the list', () => {
  it('drops the index entry and the app’s copies, never the user’s file', async () => {
    const t = setup();
    const f = t.write('reviews/report.html', '<title>Report</title><p>Un paragrafo abbastanza lungo da essere un riassunto.</p>');
    const lib = t.make();
    const { artifact } = await lib.save(undefined, { path: f });
    const copy = lib.list().artifacts[0]!.versions[0]!.copy!;
    expect(fs.existsSync(copy)).toBe(true);
    expect((await lib.remove(artifact.id)).artifacts).toEqual([]);
    expect(fs.existsSync(copy)).toBe(false);
    expect(fs.existsSync(f)).toBe(true);
    // a picture's card image goes with it
    const withThumb = t.make({ thumbnail: async () => 'data:image/jpeg;base64,AAAA' });
    const png = t.write('reviews/grafico.png', PNG);
    const picture = (await withThumb.save(undefined, { path: png })).artifact.id;
    await withThumb.thumb(picture);
    const thumbs = path.join(t.userData, 'library', 'thumbs');
    expect(fs.readdirSync(thumbs)).toHaveLength(1);
    await withThumb.remove(picture);
    expect(fs.readdirSync(thumbs)).toEqual([]);
    expect(fs.existsSync(png)).toBe(true);
    // an unknown id changes nothing; the same file can be an artifact again
    await lib.remove('nope');
    expect((await lib.save(undefined, { path: f })).created).toBe(true);
  });
});

describe('the index on disk', () => {
  it('is kept across a restart and started over from an unreadable one', async () => {
    const t = setup();
    await t.make().save('c1', { path: t.write('reviews/a.md', '# A'), title: 'Titolo dato' });
    expect(t.make().list().artifacts).toMatchObject([{ title: 'Titolo dato', chatId: 'c1' }]);
    fs.writeFileSync(path.join(t.userData, 'library', 'index.json'), '{nope');
    expect(t.make().list().artifacts).toEqual([]);
    expect(fs.readdirSync(path.join(t.userData, 'library')).some(n => n.startsWith('index.json.bad-'))).toBe(true);
  });

  it('keeps of an ADR 0319 index only what the user starred and the documents a chat reported', async () => {
    const t = setup();
    const copies = path.join(t.userData, 'library', 'versions');
    fs.mkdirSync(copies, { recursive: true });
    const kept = path.join(copies, 'kept.html'), orphan = path.join(copies, 'orphan.md');
    fs.writeFileSync(kept, '<p>x</p>'); fs.writeFileSync(orphan, '# x');
    fs.mkdirSync(path.join(t.userData, 'library', 'thumbs')); fs.writeFileSync(path.join(t.userData, 'library', 'thumbs', 'a.jpg'), 'x');
    const report = t.write('reviews/report.html', '<title>Report</title>', 10_000);
    const old = (id: string, file: string, kind: string, extra: object) => ({ id, title: id, kind, area: 'Brain', summary: '', path: file, at: 10_000, size: 21, missing: false, versions: [{ path: file, at: 10_000, size: 21 }], ...extra });
    const artifacts = [
      old('report', report, 'html', { origin: 'chat', chatId: 'c1', versions: [{ path: report, at: 10_000, size: 21, copy: kept }] }),
      old('starred', path.join(t.brain, 'evidence', 'shot.png'), 'image', { origin: 'scan', pinned: true }),
      old('shot', path.join(t.userData, 'evidence', 'chat-c1', 'a.png'), 'image', { origin: 'chat', chatId: 'c1' }),
      old('scratch', path.join(t.brain, 'tmp', 'note.md'), 'markdown', { origin: 'scan', versions: [{ path: path.join(t.brain, 'tmp', 'note.md'), at: 1, size: 3, copy: orphan }] }),
      old('linked-md', path.join(t.brain, 'docs', 'x.md'), 'markdown', { origin: 'chat', chatId: 'c1' }),
      old('video', path.join(t.brain, 'tmp', 'demo.mp4'), 'media', { origin: 'chat', pinned: true }),
    ];
    fs.writeFileSync(path.join(t.userData, 'library', 'index.json'), JSON.stringify({ v: 1, backfilled: true, scannedAt: 1, dropped: 0, copyBytes: 0, cleaned: 0, cleanedAt: null, artifacts }));
    const lib = t.make();
    expect(lib.list().artifacts.map(a => a.id).sort()).toEqual(['report', 'starred']);
    expect(lib.list().artifacts[0]).not.toHaveProperty('origin');
    expect(lib.list().artifacts.find(a => a.id === 'starred')).not.toHaveProperty('pinned');
    // the app closed before the tab was ever opened: the index is the new one already, the cleaning is still owed
    expect(JSON.parse(fs.readFileSync(path.join(t.userData, 'library', 'index.json'), 'utf8'))).toMatchObject({ v: 2, sweep: true });
    expect(fs.existsSync(orphan)).toBe(true);
    const again = t.make();
    // the first look at the files also deletes the app's own copies and pictures nobody lists any more
    await again.refresh();
    expect(JSON.parse(fs.readFileSync(path.join(t.userData, 'library', 'index.json'), 'utf8'))).not.toHaveProperty('sweep');
    await lib.refresh();
    expect([fs.existsSync(kept), fs.existsSync(orphan), fs.existsSync(path.join(t.userData, 'library', 'thumbs'))]).toEqual([true, false, false]);
    expect(JSON.parse(fs.readFileSync(path.join(t.userData, 'library', 'index.json'), 'utf8')).v).toBe(2);
    expect(migrate([])).toEqual([]);
  });
});

describe('areas', () => {
  it('names the chat’s app or repo, the brain’s project, the project folder, the chat’s folder, Brain', async () => {
    const t = setup();
    const shop = path.join(t.base, 'shop');
    fs.mkdirSync(shop, { recursive: true });
    const chats = [chat('tagged', shop, 'T', { run: { tags: { app: 'alfa', repo: 'alfa-repo' } } }), chat('plain', shop), chat('orch', t.brain, 'O', { isOrchestrator: true })];
    const lib = t.make({ chats: () => chats });
    expect(lib.areaOf(path.join(t.brain, 'reviews', 'x.md'), 'tagged')).toBe('alfa');
    expect(lib.areaOf(path.join(t.brain, 'projects', 'beta', 'x.md'))).toBe('beta');
    expect(lib.areaOf(path.join(shop, 'docs', 'x.md'))).toBe('shop');
    expect(lib.areaOf(path.join(t.brain, 'reviews', 'x.md'), 'plain')).toBe('shop');
    expect(lib.areaOf(path.join(t.brain, 'reviews', 'x.md'), 'orch')).toBe('Brain');
    expect(lib.areaOf(path.join(t.base, 'altrove', 'x.md'))).toBe('altrove');
  });
});

describe('card pictures and the system’s app', () => {
  it('gives an HTML head to draw, a text’s first lines, an image scaled by the port (cached) and a GIF as it is', async () => {
    const t = setup();
    let made = 0;
    const lib = t.make({ thumbnail: async () => { made++; return 'data:image/jpeg;base64,AAAA'; } });
    const id = async (rel: string, body: string | Buffer) => (await lib.save(undefined, { path: t.write(rel, body) })).artifact.id;
    expect(await lib.thumb(await id('reviews/r.html', '<title>R</title><p>ciao</p>'))).toMatchObject({ kind: 'html', text: '<title>R</title><p>ciao</p>' });
    expect(await lib.thumb(await id('reviews/t.csv', 'a;b\n1;2\n'))).toEqual({ kind: 'text', text: 'a;b\n1;2\n' });
    expect(await lib.thumb(await id('reviews/m.md', '# Titolo'))).toBeNull();
    const png = await id('reviews/p.png', PNG);
    expect(await lib.thumb(png)).toEqual({ kind: 'image', dataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(await lib.thumb(png)).toEqual({ kind: 'image', dataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(made).toBe(1);
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(20)]);
    expect(await lib.thumb(await id('reviews/g.gif', gif))).toEqual({ kind: 'image', dataUrl: `data:image/gif;base64,${gif.toString('base64')}` });
    expect(await lib.thumb(await id('reviews/fake.gif', 'not a gif'))).toBeNull();
    expect(await lib.thumb('nope')).toBeNull();
  });

  it('opens only an indexed file with the system’s app, a gone one by its kept copy', async () => {
    const t = setup();
    const opened: string[] = [];
    const lib = t.make({ openPath: async f => { opened.push(f); return ''; } });
    const f = t.write('reviews/verbale.docx', demoDocx());
    await lib.save(undefined, { path: f });
    expect(await lib.open(f)).toEqual({ ok: true });
    expect(await lib.open(path.join(t.brain, 'reviews', 'altro.docx'))).toEqual({ ok: false, error: 'not an artifact' });
    fs.rmSync(f);
    await lib.refresh();
    const copy = lib.list().artifacts[0]!.versions[0]!.copy!;
    expect(await lib.open(f)).toEqual({ ok: true });
    expect(opened).toEqual([f, copy]);
  });
});

describe('a brain reached through a link', () => {
  it('compares real paths (a junction on Windows, /var → /private/var on macOS)', async () => {
    const t = setup();
    const link = path.join(t.base, 'brain-link');
    try { fs.symlinkSync(t.brain, link, 'junction'); } catch { return; }
    const lib = t.make({ brainRoot: () => link });
    const f = t.write('projects/beta/piano.md', '# Piano');
    expect((await lib.save(undefined, { path: path.join(link, 'projects', 'beta', 'piano.md') })).artifact).toMatchObject({ path: f, area: 'beta' });
  });
});

describe('artifact_save', () => {
  const ctx = (chatId: string): CallCtx => ({ mount: 'chat', params: { chatId }, sessionId: '', signal: new AbortController().signal, progress: () => false });
  it('declares the calling chat’s file and answers what was saved', async () => {
    const t = setup([chat('c1', path.join(os.tmpdir(), 'x'), 'Scrive il piano')]);
    const lib = t.make();
    const tool = artifactSaveTool(lib);
    const f = t.write('reviews/piano.md', '# Piano di rilascio\n\nTre passi.\n');
    expect(JSON.parse(await tool.run({ path: f, summary: 'Tre passi per la 1.0.' }, ctx('c1')) as string)).toMatchObject({ saved: true, title: 'Piano di rilascio', path: f, versions: 1, note: 'In Memoria → Artifact now.' });
    expect(lib.list().artifacts).toMatchObject([{ chatId: 'c1', chatTitle: 'Scrive il piano', summary: 'Tre passi per la 1.0.' }]);
    fs.writeFileSync(f, '# Piano di rilascio\n\nQuattro passi.\n'); fs.utimesSync(f, new Date(90_000_000), new Date(90_000_000));
    expect(JSON.parse(await tool.run({ path: f }, ctx('c1')) as string)).toMatchObject({ versions: 2, note: 'Saved as «Piano di rilascio» (2 versions).' });
  });
  it('answers a wrong path or format as a refusal the agent can fix, and says when a file is an artifact', async () => {
    const t = setup();
    const tool = artifactSaveTool(t.make());
    await expect(tool.run({ path: t.write('evidence/demo.mp4', 'x') }, ctx('c1'))).rejects.toBeInstanceOf(ToolRefusal);
    await expect(tool.run({}, ctx('c1'))).rejects.toThrow(/path: required/);
    expect(tool.description).toMatch(/report.*document.*plan/);
    expect(tool.description).toMatch(/Never for screenshots/);
    expect(tool.inputSchema).toMatchObject({ required: ['path'], additionalProperties: false });
  });
});

describe('the demo', () => {
  it('seeds reports, a plan, a table, a PDF and a Word file, with one report in two versions and one file to lose', async () => {
    const t = setup([chat('qa', path.join(os.tmpdir(), 'q'), 'QA'), chat('mappa', path.join(os.tmpdir(), 'm')), chat('fix', path.join(os.tmpdir(), 'f'))]);
    const lib = t.make();
    const seeded = seedDemoArtifacts({ brain: t.brain, now: Date.UTC(2026, 10, 19, 12) });
    for (const s of seeded.saves) await lib.save(s.chat, s);
    fs.rmSync(seeded.vanish);
    await lib.refresh();
    const list = lib.list().artifacts;
    expect(list).toHaveLength(seeded.saves.length - 1);
    expect(list.every(a => a.kind !== 'image')).toBe(true);
    expect(list.find(a => a.title === 'Analisi dei costi degli agenti')!.versions).toHaveLength(2);
    expect(list.filter(a => a.missing).map(a => a.title)).toEqual(['Bozza del confronto prezzi']);
    expect(list[0]).toMatchObject({ title: 'QA rimborsi · esito della giornata', chatTitle: 'QA' });
  });
});
