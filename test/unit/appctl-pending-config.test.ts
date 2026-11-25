// Configuration changes «da applicare» (src/main/appctl/pending-config.ts, ADR 0360), what a yes proves (appctl/config.ts
// names, appctl/user-words.ts yesAbout) and the app's own panel, which no agent's brief dresses (genui/artifacts.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentWords, names, settingWords } from '../../src/main/appctl/config';
import { CONFIG_TOOL, PENDING_MAX, PendingConfig, type PendingChange } from '../../src/main/appctl/pending-config';
import { answeredText, noteUserAnswered, yesAbout } from '../../src/main/appctl/user-words';
import { Artifacts } from '../../src/main/genui/artifacts';
import type { AgentCatalog, AgentProfile } from '../../src/shared/agents';
import type { Answer, ChatSummary, PendingRequest } from '../../src/shared/contract';

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pending-')); roots.push(d); return d; };
const say = (v: string) => ({ kind: 'question', answers: { q: v } }) as Answer;

function world(apply: (c: PendingChange) => void = () => {}) {
  const file = path.join(tmp(), 'p.json'), events: { ch: string; id: string }[] = [], words: string[] = [], applied: PendingChange[] = [];
  const make = () => new PendingConfig({ file, apply: c => { apply(c); applied.push(c); }, words: (_id, t) => { words.push(t); }, now: () => 5,
    emit: (ch, p) => { events.push({ ch, id: (p as { id?: string; requestId?: string }).id ?? (p as { requestId: string }).requestId }); } });
  const p = make();
  const hold = (key = 'theme', more: Partial<PendingChange> = {}) => p.hold({ area: 'setting', key, value: 1, chatId: 'orch', text: `${key}: 1.`, why: 'perché', ...more });
  return { p, make, hold, events, words, applied };
}

describe('a held change', () => {
  it('is one panel per setting, kept over a restart; a new one of the same thing replaces the old', () => {
    const w = world(), a = w.hold(), b = w.hold();
    expect(w.p.pending().map(x => x.id)).toEqual([b.id]);
    expect(w.events).toEqual([{ ch: 'pending:added', id: a.id }, { ch: 'pending:resolved', id: a.id }, { ch: 'pending:added', id: b.id }]);
    expect(w.make().owns(b.id)).toBe(true);
    for (let i = 0; i < PENDING_MAX + 3; i++) w.hold(`k${i}`);
    expect(w.p.pending()).toHaveLength(PENDING_MAX);
  });
  it('Sì applies it once, No drops it, a failed Sì leaves it open with the new reason', () => {
    let bad = true;
    const w = world(() => { if (bad) throw new Error('modello sconosciuto'); }), a = w.hold();
    expect(() => w.p.answer(a.id, say('Sì (consigliato)'))).toThrow('modello sconosciuto');
    expect(w.p.pending()[0]!.detail).toBe('Da applicare: modello sconosciuto');
    bad = false;
    w.p.answer(a.id, say('Sì'));
    expect([w.applied.length, w.p.pending().length]).toEqual([1, 0]);
    expect(() => w.p.answer(a.id, say('Sì'))).toThrow(/non è più aperta/);
    const c = w.hold('altro');
    w.p.answer(c.id, say('No'));
    expect([w.applied.length, w.p.pending().length]).toEqual([1, 0]);
  });
  it('his own words are a clarification: they go to the chat and the panel comes back (finding 7)', () => {
    const w = world(), a = w.hold();
    w.events.length = 0;
    w.p.answer(a.id, say('aspetta domani'));
    expect(w.words).toEqual(['aspetta domani']);
    expect(w.events).toEqual([{ ch: 'pending:added', id: a.id }]);
    expect(() => w.p.answer(a.id, say(' '))).toThrow('Rispondi Sì o No.');
    expect(w.p.owns(a.id)).toBe(true);
  });
  it('a long text is on the panel whole (finding 6)', () => {
    const w = world(), full = 'riga\n'.repeat(400);
    w.hold('instructions', { area: 'agent', agentId: 'scout', full });
    expect(w.p.pending()[0]!.detail).toContain(full);
  });
});

describe('what a yes proves (findings 1 and 2)', () => {
  const p = { id: 'scout', name: 'Scout', levels: {}, engine: 'claude', model: 'opus' } as unknown as AgentProfile;
  const cat = { profiles: [p, { id: 'artisan', name: 'Artisan' }], models: [{ engine: 'claude', label: 'Claude', models: [{ id: 'opus', name: 'Opus' }] }, { engine: 'opencode', label: 'OpenCode', models: [{ id: 'openai/sol', name: 'Sol' }] }, { engine: 'cursor', label: 'Cursor', models: [] }] } as unknown as AgentCatalog;
  it('the order, when one sentence names it for every role', () => {
    const w = settingWords('engineOrder', ['opencode', 'claude'], cat);
    expect(names('Cambio l’ordine dei motori: prima OpenAI, poi Claude?', w)).toBe(true);
    expect(names('Prima OpenAI, poi Claude, per tutti i ruoli', w)).toBe(true);
    for (const no of ['Prima Claude, poi OpenAI, per tutti i ruoli', 'Scout: prima OpenAI, poi Claude, ordine dei motori', 'Prima OpenAI, poi Claude', 'OpenAI, poi Cursor, poi Claude per tutti i ruoli', 'Non metto OpenAI prima di Claude per tutti i ruoli', 'Procedo?']) expect(names(no, w), no).toBe(false);
  });
  it('a role\'s exception, only with that role\'s name', () => {
    const w = agentWords(p, 'engineOrder', ['opencode', 'claude'], cat);
    expect(names('Solo per Scout: OpenAI, poi Claude', w)).toBe(true);
    expect(names('Solo per Artisan: OpenAI, poi Claude', w)).toBe(false);
    expect(names('Per tutti i ruoli: OpenAI, poi Claude', w)).toBe(false);
  });
  it('anything else only with its canonical sentence, word for word', () => {
    const t = settingWords('engineThresholds', { opencode: 80 }, cat);
    expect(t.text).toBe('Soglie dei motori: OpenAI 80%.');
    expect(names('Applico? Soglie dei motori: OpenAI 80%. Vale dal prossimo avvio.', t)).toBe(true);
    expect(names('OpenAI all’80%, Claude al 90%', t)).toBe(false);
    const empty = agentWords({ ...p, levels: { min: [{ engine: 'claude', model: 'opus' }] } } as AgentProfile, 'levels', { base: [{ engine: 'claude', model: 'opus' }], min: [] }, cat);
    expect(names('Scout: svuoto il livello?', empty)).toBe(false);
    const effort = agentWords(p, 'effort', 'max', cat);
    expect(names('Metto lo Scout su Opus', effort)).toBe(false);
    expect(names('Alzo l’effort dello Scout al massimo', effort)).toBe(false);
  });
  it('new instructions never by a yes to a short card: the panel shows the whole text', () => {
    const w = agentWords(p, 'instructions', 'fai tutto', cat);
    expect(w).toMatchObject({ full: 'fai tutto' });
    expect(names(w.text, w)).toBe(false);
  });
  it('the words of a yes: the question, the Sì option, the «Se Sì» of its own brief; never what the No says', () => {
    const q = { questions: [{ question: 'Procedo?', header: 'x', multiSelect: false, options: [{ label: 'Sì (consigliato)', description: 'Scout su OpenAI' }, { label: 'No', description: 'Prima Claude, poi OpenAI per tutti i ruoli' }] }] } as Pick<PendingRequest, 'questions'>;
    expect(yesAbout(q, 'Lo applico')).toBe('Procedo?\nScout su OpenAI\nLo applico');
  });
  it('one yes, one change', () => {
    noteUserAnswered('one-yes', 10, 'x');
    const a = answeredText('one-yes', 0)!;
    expect(a.text).toBe('x');
    a.used();
    expect(answeredText('one-yes', 0)).toBeNull();
  });
});

describe('the app\'s own panel', () => {
  const brief = { done: ['fatto'], ifYes: 'Faccio il merge', ifNo: 'Resta tutto com’è' };
  const ask = (id: string, tool: string): PendingRequest => ({ id, chatId: 'o', type: 'question', tool, title: 'q', detail: '', input: {}, at: 0 });
  it('is never dressed by an agent\'s waiting brief; the chat\'s own question still is, and only its «Se Sì» counts', () => {
    const store = new Artifacts({ dir: tmp(), chats: () => [{ id: 'o', title: 'o' } as ChatSummary], emit: () => {}, askWaitMs: 60_000 });
    store.show('o', { title: 't', summary: 's', component: 'brief', props: brief, target: 'next-ask' });
    store.observe('pending:added', ask('cfg_1', CONFIG_TOOL));
    expect(store.hasBrief('o')).toBe(true);
    expect(store.briefYes('o', 'cfg_1')).toBe('');
    store.observe('pending:added', ask('q1', 'AskUserQuestion'));
    expect(store.hasBrief('o')).toBe(false);
    expect([store.briefYes('o', 'q1'), store.briefYes('o', 'q2')]).toEqual(['Faccio il merge', '']);
    store.stop();
  });
});

describe('review of the branch (second round)', () => {
  const cat = { profiles: [], models: [] } as unknown as AgentCatalog;
  it('a canonical sentence must fill a sentence of the card: a yes to a longer value is no yes to a shorter one', () => {
    const w = settingWords('theme', 'Italiano', cat);
    expect(names('Lingua: Italiano e inglese.', { text: 'Lingua: Italiano.' })).toBe(false);
    expect(names('Cambio. Lingua: Italiano. Applico?', { text: 'Lingua: Italiano.' })).toBe(true);
    void w;
  });
});
