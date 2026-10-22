// The brain's scripts and changelog (ADR 0076): header parse and write, save / fix / delete with their changelog lines,
// the refusal of a script holding a credential, the word search behind brain_scripts, the Orchestrator-only write tools,
// and the renderer's filters (Script page). Real files in a temp folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrainScripts, findScripts, parseHeader, stripHeader, touchesScripts, withHeader } from '../../../src/main/brain/scripts';
import { BrainChangelog, formatEntry, parseChangelog } from '../../../src/main/brain/changelog';
import { brainScriptsTool, scriptWriteTools } from '../../../src/main/brain/scripts-tools';
import { writeDemoScripts } from '../../../src/main/brain/scripts-demo';
import { filterScripts } from '../../../src/renderer/brain/lib/brain-sections';


let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-scripts-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const meta = { title: 'Backup delle note', description: 'Zip datato del brain', usage: 'node scripts/backup.mjs <dir>', tags: ['backup', 'zip'], tested: { ok: true, note: '120 file', at: '2026-10-19' } };

describe('script header', () => {
  it('writes the header in the language comment syntax and reads it back', () => {
    const js = withHeader('backup.mjs', 'console.log(1);\n', meta);
    expect(js.split('\n')[0]).toBe('// @title Backup delle note');
    const h = parseHeader(js);
    expect(h).toMatchObject({ title: 'Backup delle note', description: 'Zip datato del brain', usage: 'node scripts/backup.mjs <dir>', tags: ['backup', 'zip'] });
    expect(h.tested).toEqual({ state: 'ok', at: '2026-10-19', note: '120 file' });
    const py = withHeader('x.py', 'print(1)', { ...meta, tested: { ok: false, note: 'crash', at: '2026-10-18' } });
    expect(py).toContain('# @tested 2026-10-18 failed: crash');
    expect(parseHeader(py).tested.state).toBe('failed');
  });

  it('keeps the shebang first and replaces an old header instead of stacking it', () => {
    const once = withHeader('x.sh', '#!/usr/bin/env bash\necho hi\n', meta);
    const twice = withHeader('x.sh', once, { ...meta, title: 'Nuovo' });
    expect(twice.split('\n')[0]).toBe('#!/usr/bin/env bash');
    expect(twice.match(/@title/g)).toHaveLength(1);
    expect(twice).toContain('# @title Nuovo');
    expect(stripHeader(twice)).toBe('#!/usr/bin/env bash\necho hi\n');
  });

  it('describes a hand-written script without a header', () => {
    const h = parseHeader('# Pulisce la cartella temp\nrm -rf tmp\n');
    expect(h.title).toBe('');
    expect(h.firstComment).toBe('Pulisce la cartella temp');
    expect(h.tested.state).toBe('untested');
  });
});

describe('BrainScripts', () => {
  it('lists nothing on a fresh brain and creates nothing by reading (ADR 0072)', () => {
    const s = new BrainScripts(() => root);
    expect(s.list().scripts).toEqual([]);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('saves, fixes and deletes, logging each change; a delete keeps a copy', () => {
    const log = new BrainChangelog(() => root, () => new Date(2026, 9, 19, 10, 52));
    const s = new BrainScripts(() => root, log);
    expect(s.save({ name: 'backup.mjs', code: 'console.log(1)', meta, by: 'Orchestrator' }).action).toBe('added');
    expect(s.list().scripts.map(x => x.title)).toEqual(['Backup delle note']);
    expect(s.save({ name: 'backup.mjs', code: 'console.log(2)', meta, by: 'Orchestrator', fix: true, summary: 'gestisce i percorsi con spazi' }).action).toBe('fixed');
    const del = s.delete({ name: 'backup.mjs', by: 'Orchestrator', reason: 'sostituito' });
    expect(fs.existsSync(path.join(root, 'scripts', 'backup.mjs'))).toBe(false);
    expect(fs.existsSync(path.join(root, del.keptAt))).toBe(true);
    expect(s.list().scripts).toEqual([]);
    const entries = log.list().entries;
    expect(entries.map(e => e.action)).toEqual(['deleted', 'fixed', 'added']);
    expect(entries[1]).toMatchObject({ at: '2026-10-19 10:52', kind: 'script', target: 'scripts/backup.mjs', by: 'Orchestrator', summary: 'gestisce i percorsi con spazi' });
    expect(entries[0]!.summary).toContain('scripts/.deleted/');
  });

  it('refuses a credential, a path, an unknown language and an empty body', () => {
    const s = new BrainScripts(() => root);
    const secret = `const ${'pass'}${'word'} = "${'demo-non-reale-42'}";`;
    expect(() => s.save({ name: 'a.mjs', code: secret, meta, by: 'O' })).toThrow(/credential/);
    expect(() => s.save({ name: '../a.mjs', code: 'x', meta, by: 'O' })).toThrow(/name/);
    expect(() => s.save({ name: 'a.exe', code: 'x', meta, by: 'O' })).toThrow(/extension/);
    expect(() => s.save({ name: 'a.mjs', code: '  ', meta, by: 'O' })).toThrow(/empty/);
    expect(fs.existsSync(path.join(root, 'scripts'))).toBe(false);
  });

  it('accepts a secret read at run time, keeps CRLF and the BOM', () => {
    const s = new BrainScripts(() => root);
    const pw = `${'pass'}${'word'}`;
    for (const code of [`${pw} = os.environ["DB_X"]`, 'const token = process.env.GITHUB_TOKEN;', 'api_key = os.getenv("API_KEY")', `const ${pw} = await readCreds();`, `$${pw} = $env:DB_X`])
      expect(() => s.save({ name: 'ok.py', code, meta, by: 'O' }), code).not.toThrow();
    s.save({ name: 'w.ps1', code: '\uFEFFWrite-Output "città"\r\nexit 0\r\n', meta, by: 'O' });
    const text = fs.readFileSync(path.join(root, 'scripts', 'w.ps1'), 'utf8');
    expect(text.startsWith('\uFEFF# @title')).toBe(true);
    expect(text.split('\r\n').length).toBeGreaterThan(5);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('masks a credential in a hand-written script it reads', () => {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'scripts', 'old.py'), `# vecchio\n${'pass'}${'word'} = "${'demo-non-reale-42'}"\n`);
    const d = new BrainScripts(() => root).get('old.py');
    expect(d.masked).toBe(1);
    expect(d.code).not.toContain('demo-non-reale');
  });

  it('finds by words over title, description, usage and tags', () => {
    const list = new BrainScripts(() => writeDemoScripts(path.join(root, 'demo'), Date.UTC(2026, 9, 19, 12))).list().scripts;
    expect(list.length).toBe(4);
    expect(findScripts(list, 'ticket csv').map(s => s.id)).toEqual(['export-ticket.py']);
    expect(findScripts(list, 'backup').map(s => s.id)).toEqual(['backup-note.mjs']);
    expect(findScripts(list, 'nulla di simile')).toEqual([]);
    expect(filterScripts(list, '').map(s => s.id)).not.toContain('conta-righe-log.sh'); // last test failed: hidden
    expect(filterScripts(list, '').length).toBe(3);
    expect(filterScripts(list, 'branch').map(s => s.id)).toEqual(['pulisci-branch.ps1']);
  });

  it('knows which watcher paths touch it', () => {
    expect(touchesScripts('scripts/a.mjs')).toBe(true);
    expect(touchesScripts('changelog.md')).toBe(true);
    expect(touchesScripts('notes/scripts.md')).toBe(false);
  });
});

describe('changelog', () => {
  it('round-trips a line and keeps the title on top', () => {
    const log = new BrainChangelog(() => root, () => new Date(2026, 9, 19, 9, 5));
    log.add({ kind: 'rule', action: 'edited', target: 'rules/git.md', by: 'Orchestrator', summary: 'mai push · su main' });
    log.add({ kind: 'note', action: 'added', target: 'now.md', by: 'Orchestrator', summary: 'priorità\nsettimana' });
    const text = fs.readFileSync(path.join(root, 'changelog.md'), 'utf8');
    expect(text.startsWith('# Changelog del brain')).toBe(true);
    const e = parseChangelog(text);
    expect(e.map(x => x.target)).toEqual(['now.md', 'rules/git.md']);
    expect(e[0]!.summary).toBe('priorità settimana');
    expect(e[1]!.summary).toBe('mai push - su main');
    expect(parseChangelog(formatEntry(e[1]!))).toEqual([e[1]]);
    expect(() => log.add({ kind: 'note', action: 'edited', target: 'x', by: 'O', summary: `ruotata ${'pass'}${'word'}=${'demo-non-reale-42'}` })).toThrow(/credential/);
    fs.appendFileSync(path.join(root, 'changelog.md'), `- 2026-10-19 09:00 · note · edited · x · O · ${'pass'}${'word'}=${'demo-non-reale-42'}\n`);
    expect(log.list().entries.at(-1)!.summary).not.toContain('demo-non-reale');
    expect(() => log.add({ kind: 'x' as never, action: 'added', target: 't', by: 'b', summary: 's' })).toThrow(/kind/);
  });

  it('parses the demo changelog across several days', () => {
    const e = parseChangelog(fs.readFileSync(path.join(writeDemoScripts(path.join(root, 'demo'), Date.UTC(2026, 9, 19, 12)), 'changelog.md'), 'utf8'));
    expect(e.length).toBeGreaterThan(1);
    expect(new Set(e.map(x => x.at.slice(0, 10))).size).toBeGreaterThan(1);
    expect(e.some(x => x.kind === 'script')).toBe(true);
  });
});

describe('tools', () => {
  it('brain_scripts reads; the write tools save and log under the caller', async () => {
    const log = new BrainChangelog(() => root);
    const s = new BrainScripts(() => root, log);
    const [save, del, add] = scriptWriteTools(s, log, () => 'Orchestrator');
    await save!.run({ name: 'a.py', title: 'A', description: 'fa A', code: 'print(1)', tested: { ok: true, note: 'stampa 1' } });
    await expect(Promise.resolve().then(() => save!.run({ name: 'b.py', title: 'B', description: 'fa B', code: 'print(2)' }))).rejects.toThrow(/tested/);
    const found = JSON.parse(String(await brainScriptsTool(s).run({ q: 'fa a' }, {} as never))) as { scripts: { title: string; tested: { state: string } }[] };
    expect(found.scripts).toEqual([expect.objectContaining({ title: 'A', tested: expect.objectContaining({ state: 'ok' }) })]);
    await add!.run({ kind: 'procedure', action: 'added', target: 'runbook/x.md', summary: 'nuova' });
    await del!.run({ name: 'a.py', reason: 'non serve' });
    expect(log.list().entries.map(e => `${e.kind}:${e.action}:${e.by}`)).toEqual(['script:deleted:Orchestrator', 'procedure:added:Orchestrator', 'script:added:Orchestrator']);
  });
});
