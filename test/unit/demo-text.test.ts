// Unit tests of the demo's content in the UI language (src/main/demo-text.ts): Italian stays as written (the default:
// what the e2e specs read), English goes through the one table: the seed's chats, items and open requests, the
// Strategist's tree, the scripted answers built with names (patterns, line by line), Flash's read-only "btw" answer and
// the browser tabs' pages carry no Italian left.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DemoChats, FROZEN_EPOCH, demoTree, seed } from '../../src/main/demo';
import { localize, setDemoLang, tr } from '../../src/main/demo-text';
import { pageUrl } from '../../src/main/demo-pages';
import { writeDemoBrain } from '../../src/main/brainmodel/demo';

// Italian-looking text: accents or common Italian words (the same idea as visible-language.test.ts)
const ITALIAN = /[àèéìòù]|\b(il|lo|la|gli|le|di|del|della|che|non|per|una|uno|con|nel|sono|questo|questa|ancora|nessun[aoe]?|ora|giorni?|ore|minuti|rimborsi?|sconto|ordine|aspetta|prova)\b/i;
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
afterEach(() => setDemoLang('it'));

describe('demo text', () => {
  it('keeps the Italian content as written by default', () => {
    expect(tr('QA · Rimborsi')).toBe('QA · Rimborsi');
    const s = seed(FROZEN_EPOCH);
    expect(s.chats.find(c => c.id === 'qa')!.title).toBe('QA · Rimborsi');
    expect(localize({ a: ['Che si fa adesso?'] })).toEqual({ a: ['Che si fa adesso?'] });
  });

  it('turns the seed, the tree and the open requests into English', () => {
    setDemoLang('en');
    const s = seed(FROZEN_EPOCH), t = demoTree(FROZEN_EPOCH);
    const visible = [
      ...[...s.chats, ...t.chats].flatMap(c => [c.title, c.lastText, c.run?.goal ?? '', ...(c.agentChildren?.children.map(x => x.task) ?? []), ...(c.plan?.steps.map(x => x.title) ?? [])]),
      ...Object.values({ ...s.items, ...t.items }).flat().flatMap(i => ('text' in i && i.kind !== 'user' ? [i.text] : i.kind === 'user' && !('from' in i && i.from) && !i.text.startsWith('[') ? [i.text] : [])),
      ...s.pending.flatMap(p => [p.title, ...(p.questions ?? []).flatMap(q => [q.question, ...q.options.flatMap(o => [o.label, o.description ?? ''])])]),
      ...s.tabs.map(x => x.title),
    ].filter((x): x is string => !!x);
    expect(visible.filter(x => ITALIAN.test(x))).toEqual([]);
    expect(s.chats.find(c => c.id === 'qa')!.title).toBe('QA · Refunds');
  });

  it('translates the texts built with names, and several lines line by line', () => {
    setDemoLang('en');
    expect(tr('Segnato: riparto da **QA rimborsi**.')).toBe('Noted: I’ll pick up from **Refunds QA**.');
    expect(tr('Ecco il quadro:\n\n- **Ti aspettano 0**: nessuna')).toBe('Here is the picture:\n\n- **Waiting for you 0**: none');
    expect(tr('not in the table')).toBe('not in the table');
  });

  it('answers in English as the scripts run: a thanks, a decision, Flash\'s read-only "btw"', async () => {
    setDemoLang('en');
    const s = seed(FROZEN_EPOCH);
    const chats = new DemoChats(() => {}, { freeze: true }, s);
    await chats.answer('orchestrator', 'orchestrator-q1', { kind: 'question', answers: { 'Where do I pick up?': 'Refunds QA' } });
    await flush();
    const said = chats.items('orchestrator').filter(i => i.kind === 'assistant').at(-1);
    expect(said && 'text' in said ? said.text : '').toBe('Noted: I’ll pick up from **Refunds QA**.');
    const flash = await chats.create({ harness: 'claude', cwd: 'C:\\demo', quick: true });
    await chats.send(flash.id, 'What is waiting for me?');
    await flush();
    const answer = chats.items(flash.id).filter(i => i.kind === 'assistant').map(i => ('text' in i ? i.text : '')).join('\n');
    expect(answer).toContain('From the Orchestrator’s chat, without touching anything:');
    expect(answer).toContain('**Waiting for you**');
    expect(answer).toContain('«Make it a job»');
    expect(answer.split('\n').filter(l => ITALIAN.test(l))).toEqual([]);
  });

  it('draws the browser tabs\' pages and writes the demo brain in English', () => {
    setDemoLang('en');
    const html = decodeURIComponent(pageUrl('nota').replace(/^data:text\/html;charset=utf-8,/, ''));
    expect(html).toContain('Refund 2026/118');
    expect(html).not.toContain('Rimborso');
    const dir = writeDemoBrain(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-demo-text-')), FROZEN_EPOCH);
    expect(fs.readFileSync(path.join(dir, 'routines.md'), 'utf8')).toContain('## Daily report');
    expect(fs.existsSync(path.join(dir, 'runbook', 'releases.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.claude', 'skills', 'release-notes', 'SKILL.md'))).toBe(true);
  });
});
