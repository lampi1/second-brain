// The brain upgrade's second kind, marked items (ADR 0124): ideas scattered in the notes ("Idea:", "💡", the items under
// an "## Idee" heading) move into ideas.md by the generic job: a local scan that skips code, templates and credentials,
// one agent answer, one undoable change, never twice, a pointer where each was; the moved ideas read back through the
// brain's own parser (the Idee page's data) as the owner's or the AI's, with where and when they came from.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAIN_LAYOUT, pendingSections } from '../../../src/shared/brain-layout';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { candidates, itemText, parseVerdicts, readRecord, upgrade, type UpgradeAsk } from '../../../src/main/brainmodel/upgrade';
// @ts-expect-error: the brain's own parser is plain JavaScript without types
import { ideas as parseIdeas } from '../../../brain-template/ops/tools/brain-site/parse.mjs';

type IdeaRow = { data: string; area: string; titolo: string; stato: string; idea: string; fonte: string; chi: string; origin?: string };
let root: string, userData: string, log: ChangeLog;
const NOW = Date.parse('2026-10-22T08:00:00Z');
const write = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const IDEAS = BRAIN_LAYOUT.find(s => s.id === 'ideas')!;
const MARKERS = (IDEAS.receives as { markers: readonly string[] }).markers;
const NOTE = [
  '# Progetto app', '',
  'Riunione del 2026-10-01 con il team.', '',
  '- Idea: un report settimanale dei ticket chiusi', '  da mandare il venerdì', '- Fatto il deploy', '',
  '💡 Tema scuro anche per le email', '',
  '## Idee', '',
  '- Un widget con il meteo', '- L\'IA propone: raggruppare le notifiche per chat', '',
  '## Altro', '',
  '```text', 'Idea: dentro un blocco di codice, non conta', '```', '',
  '<!--', '- Idea: un modello nel commento', '-->', '',
].join('\n');
/** keeps every candidate; the one that says "IA" is the AI's */
const keepAll: UpgradeAsk = async (_s, prompt) => {
  const { candidates: list } = JSON.parse(prompt) as { candidates: { id: string; text: string }[] };
  return { ok: true, text: JSON.stringify({ items: list.map(c => ({ id: c.id, keep: true, title: c.text.replace(/^[-\s💡]*(Idea:\s*)?/u, '').slice(0, 40), area: 'lavoro', author: /IA/.test(c.text) ? 'ai' : 'user' })) }) };
};
const ctx = (ask?: UpgradeAsk) => ({ root, userData, log, app: '0.2.0', ask, now: () => NOW });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-upgrade-items-'));
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-upgrade-items-ud-'));
  log = new ChangeLog(userData, () => NOW);
  write('brain.json', JSON.stringify({ machinery: 'product-v1' }, null, 2));
  write('progetti/app.md', NOTE);
  write('ideas.md', '# Idee e riflessioni da riprendere\n\nPensieri da non perdere.\n\n## 2026-09-01 · [lavoro] · Idea già scritta · `aperta`\n- **Idea:** esiste già.\n- **Fonte:** Alex\n');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(userData, { recursive: true, force: true }); });

describe('marked items: ideas into ideas.md', () => {
  it('finds marked lines, a marked paragraph and the items under an "Idee" heading, never code or templates', () => {
    const found = candidates(root, IDEAS);
    expect(found.map(c => c.whole)).toEqual([
      '- Idea: un report settimanale dei ticket chiusi\n  da mandare il venerdì',
      '💡 Tema scuro anche per le email',
      '- Un widget con il meteo',
      '- L\'IA propone: raggruppare le notifiche per chat',
    ]);
    expect(found[0]!.prefix).toBe('- ');
    expect(found[2]!.heading).toBe('Idee');
    expect(itemText(found[0]!, MARKERS)).toBe('un report settimanale dei ticket chiusi da mandare il venerdì');
    expect(itemText(found[1]!, MARKERS)).toBe('Tema scuro anche per le email');
  });

  it('moves the kept ideas on top of ideas.md with source and date, pointers in the note, one undoable change, never twice', async () => {
    const ask = vi.fn(keepAll);
    const r = await upgrade(ctx(ask));
    expect(r).toMatchObject({ changes: 1 });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]![0]).toContain('author ("user"');
    const text = read('ideas.md');
    expect(text.startsWith('# Idee e riflessioni da riprendere\n\nPensieri da non perdere.\n\n## ')).toBe(true);
    const rows = parseIdeas(text) as IdeaRow[];
    expect(rows).toHaveLength(5);
    expect(rows.at(-1)!.titolo).toBe('Idea già scritta'); // the old one stays below the new ones
    const report = rows.find(i => i.titolo.startsWith('un report'))!;
    expect(report).toMatchObject({ area: 'lavoro', stato: 'aperta', chi: 'Owner', idea: 'un report settimanale dei ticket chiusi da mandare il venerdì' });
    expect(report.fonte).toBe('nota `progetti/app.md` (Progetto app), spostata il 2026-10-22');
    expect(JSON.parse(report.origin!)).toMatchObject({ kind: 'human', source: 'brain-upgrade' });
    const ai = rows.find(i => i.chi === 'IA')!;
    expect(ai.fonte).toBe('IA · nota progetti/app.md · spostata dalle note il 2026-10-22');
    expect(ai.origin).toBeUndefined(); // an AI's origin is never invented
    // the note's date is the idea's day when the note says none
    const day = fs.statSync(path.join(root, 'progetti/app.md')).mtime.toISOString().slice(0, 10);
    expect(rows.find(i => i.titolo.startsWith('Tema scuro'))!.data).toBe(day);
    const note = read('progetti/app.md');
    expect(note).toContain('- → `ideas.md` (un report settimanale dei ticket chiusi)\n- Fatto il deploy');
    expect(note).toContain('→ `ideas.md` (Tema scuro anche per le email)');
    expect(note).toContain('## Idee\n\n- → `ideas.md` (Un widget con il meteo)');
    expect(note).toContain('Idea: dentro un blocco di codice, non conta');
    expect(note).toContain('- Idea: un modello nel commento');
    expect(pendingSections(readRecord(root, userData))).toEqual([]);
    // never twice, and Annulla puts both files back
    expect(await upgrade(ctx(ask))).toMatchObject({ changes: 0 });
    expect(ask).toHaveBeenCalledTimes(1);
    const change = log.all().find(c => c.job === 'upgrade')!;
    expect(change.summary).toContain('4 elementi spostati in ideas.md');
    log.rollback(change.id, { activeVersion: () => null, restore: () => {} });
    expect(read('progetti/app.md')).toBe(NOTE);
    expect(parseIdeas(read('ideas.md'))).toHaveLength(1);
    expect(await upgrade(ctx(ask))).toMatchObject({ changes: 0 });
  });

  it('creates ideas.md when missing, skips an idea already there and one the agent drops', async () => {
    fs.rmSync(path.join(root, 'ideas.md'));
    write('progetti/app.md', '# App\n\n- Idea: Tema scuro\n- Idea: Tema scuro\n- Idea: non è un\'idea vera ma un promemoria\n');
    const ask: UpgradeAsk = async (_s, prompt) => {
      const { candidates: list } = JSON.parse(prompt) as { candidates: { id: string; text: string }[] };
      return { ok: true, text: JSON.stringify({ items: list.map(c => /promemoria/.test(c.text) ? { id: c.id, keep: false } : { id: c.id, keep: true, title: 'Tema scuro', area: 'personale', author: 'user' }) }) };
    };
    await upgrade(ctx(ask));
    const rows = parseIdeas(read('ideas.md')) as IdeaRow[];
    expect(rows.map(r => [r.titolo, r.area])).toEqual([['Tema scuro', 'personale']]);
    expect(read('progetti/app.md')).toBe('# App\n\n- → `ideas.md` (Tema scuro)\n- Idea: Tema scuro\n- Idea: non è un\'idea vera ma un promemoria\n');
  });

  it('never reads an item that may hold a credential, and keeps the step pending when a note changes while the agent reads', async () => {
    const fake = ['gh', 'p_', 'a'.repeat(36)].join(''); // built at run time: no secret-shaped literal in the repo
    write('progetti/secret.md', `- Idea: usare il token ${fake} per il bot\n`);
    expect(candidates(root, IDEAS).some(c => c.file === 'progetti/secret.md')).toBe(false);
    const edits: UpgradeAsk = async (s, prompt) => { write('progetti/app.md', `Nuova riga.\n${NOTE}`); return keepAll(s, prompt); };
    const r = await upgrade(ctx(edits));
    expect(r.changes).toBe(0);
    expect(r.note).toContain('ideas');
    expect(pendingSections(readRecord(root, userData)).map(s => s.id)).toEqual(['ideas']);
    expect(parseIdeas(read('ideas.md'))).toHaveLength(1);
  });

  it('skips the brain\'s own guides and the place itself', () => {
    write('AGENTS.md', '- Idea: the format of an idea line\n');
    write('ops/runbook/x.md', '- Idea: a runbook example\n');
    write('ideas.md', '- Idea: already in the place\n');
    expect(candidates(root, IDEAS).map(c => c.file)).toEqual(['progetti/app.md', 'progetti/app.md', 'progetti/app.md', 'progetti/app.md']);
  });

  it('parses item verdicts: a title is needed, area and author fall back to work and the owner', () => {
    expect(parseVerdicts('{"items":[{"id":"c1","keep":true,"title":"A · `b`","area":"x","author":"robot"},{"id":"c2","keep":true}]}', ['c1', 'c2'], 'item'))
      .toEqual([{ id: 'c1', keep: true, title: 'A - b', area: 'lavoro', author: 'user' }, { id: 'c2', keep: false }]);
  });
});
