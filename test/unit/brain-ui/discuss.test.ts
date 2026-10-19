// Unit tests of the "Discutine" / "Apri una chat" texts and records (src/renderer/brain/lib/discuss.ts): the idea's
// line in ideas.md, the Orchestrator draft (file + line, fields, opening question by state, the state rule), the work chat's
// title and first message, and the "discussa" store (bad storage, dedup, caps).
import { describe, expect, it } from 'vitest';
import type { Idea, Reflection } from '../../../src/renderer/brain/types';
import {
  addDiscussed, chatPrompt, chatTitle, discussText, lineOf, openingQuestion, readDiscussed, topicKey, writeDiscussed, type KV, type Topic,
} from '../../../src/renderer/brain/lib/discuss';

const idea = (o: Partial<Idea> = {}): Idea => ({
  data: '2026-10-05', area: 'personale', titolo: 'Diario vocale', stato: 'aperta', idea: 'Dettare tre righe a fine giornata.', come: '', perche: 'scrivere stanca',
  riprendere: '', fonte: '', per: '', notato: '', penso: '', sicurezza: '', nonso: '', testo: '', chi: 'Tu', scaduta: '', ...o,
});
const refl: Reflection = { data: '2026-10-09', chat: 'Regia', titolo: 'Troppo centralino', notato: 'giro troppi messaggi', penso: 'meglio delegare', sicurezza: 'media', nonso: '' };
const I = (o?: Partial<Idea>): Topic => ({ kind: 'idea', idea: idea(o) });
const R: Topic = { kind: 'reflection', reflection: refl };

const FILE = [
  '# Idee', '', '<!-- Template', '## AAAA-MM-GG · [lavoro] · Titolo breve · `aperta`', '-->', '',
  '## 2026-10-07 · [lavoro] · Diario vocale · `fatta`', '- **Idea:** vecchia.', '',
  '## 2026-10-05 · [personale] · Diario vocale · `aperta`', '- **Idea:** dettare.',
].join('\n');

describe('lineOf', () => {
  it('finds the heading with the same date and title', () => expect(lineOf(FILE, I())).toBe(10));
  it('falls back to the title alone, then to any line', () => {
    expect(lineOf(FILE, I({ data: '2026-01-01' }))).toBe(7);
    expect(lineOf('testo\nparla di Diario vocale qui', I())).toBe(2);
  });
  it('null when missing or empty', () => {
    expect(lineOf(FILE, I({ titolo: 'Altro' }))).toBeNull();
    expect(lineOf('', I())).toBeNull();
    expect(lineOf(FILE, I({ titolo: '  ' }))).toBeNull();
  });
  it('handles CRLF files', () => expect(lineOf(FILE.replace(/\n/g, '\r\n'), I())).toBe(10));
});

describe('discussText', () => {
  it('quotes the idea with file, line, date and state, then asks and keeps the state rule', () => {
    const t = discussText(I(), 10);
    expect(t.split('\n')[0]).toBe('Let\'s discuss my idea «Diario vocale» (ideas.md, line 10, from 05/10, state open).');
    expect(t).toContain('- In short: Dettare tre righe a fine giornata.');
    expect(t).toContain('- Why: scrivere stanca');
    expect(t).not.toContain('- How:'); // empty fields are left out
    expect(t).not.toMatch(/\n{3}/);
    expect(t.endsWith('Do not change the state in ideas.md: I will decide after we talk about it.')).toBe(true);
  });
  it('without a line names only the file', () => expect(discussText(I(), null)).toContain('(ideas.md, from 05/10'));
  it("an AI idea is called a suggestion, with its reasoning and source", () => {
    const t = discussText(I({ chi: 'IA', notato: 'tre chat', penso: 'chiudere', fonte: 'IA · Regia · revisione' }), 3);
    expect(t).toContain("the AI's suggestion «Diario vocale»");
    expect(t).toContain('- Noticed: tre chat');
    expect(t).toContain('- Born in: Regia · revisione');
  });
  it('a reflection quotes ai-reflections.md and its chat', () => {
    const t = discussText(R, 4);
    expect(t).toContain('«Troppo centralino» (ai-reflections.md, line 4, from 09/10, chat Regia)');
    expect(t).toContain('- You noticed: giro troppi messaggi');
  });
  it('long fields are shortened', () => expect(discussText(I({ idea: 'x'.repeat(1000) }), 1).length).toBeLessThan(800));
});

describe('openingQuestion', () => {
  it('depends on state and author', () => {
    expect(openingQuestion(I())).toMatch(/^Does it still/);
    expect(openingQuestion(I({ chi: 'IA' }))).toMatch(/^Are you still/);
    expect(openingQuestion(I({ stato: 'fatta' }))).toMatch(/work/);
    expect(openingQuestion(I({ stato: 'scartata' }))).toMatch(/ruled/);
    expect(openingQuestion(I({ stato: 'in corso' }))).toMatch(/next/);
    expect(openingQuestion(R)).toMatch(/agree/);
  });
});

describe('work chat', () => {
  it('title "Idea · <titolo>", shortened', () => {
    expect(chatTitle(I())).toBe('Idea · Diario vocale');
    expect(chatTitle(I({ titolo: 'a'.repeat(80) })).length).toBeLessThanOrEqual(51);
    expect(chatTitle(R)).toBe('Riflessione · Troppo centralino');
  });
  it('first message points at the file and line and asks for a plan first', () => {
    const p = chatPrompt(I(), 10);
    expect(p).toContain("Let's work on the idea «Diario vocale» (ideas.md, line 10");
    expect(p).toContain('from line 10');
    expect(p).toContain('Only the Orchestrator');
    expect(chatPrompt(I(), null)).not.toContain('from line');
  });
});

describe('discussed records', () => {
  const mem = (init?: string): KV & { v: string | null } => ({ v: init ?? null, getItem() { return this.v; }, setItem(_k, v) { this.v = v; } });
  it('reads nothing from bad or missing storage', () => {
    expect(readDiscussed(null)).toEqual({});
    expect(readDiscussed(mem('{bad'))).toEqual({});
    expect(readDiscussed(mem('[1]'))).toEqual({});
    expect(readDiscussed(mem(JSON.stringify({ a: [{ via: 'x', chatId: 'c', at: 1 }], b: 'no' })))).toEqual({});
  });
  it('round-trips, newest first, one entry per chat', () => {
    const kv = mem();
    let m = addDiscussed({}, 'k', { via: 'regia', chatId: 'r', chatTitle: 'Regia', at: 1 });
    m = addDiscussed(m, 'k', { via: 'chat', chatId: 'c1', chatTitle: 'Idea · X', at: 2 });
    m = addDiscussed(m, 'k', { via: 'regia', chatId: 'r', chatTitle: 'Regia', at: 3 });
    writeDiscussed(kv, m);
    const back = readDiscussed(kv);
    expect(back.k!.map(d => d.at)).toEqual([3, 2]);
  });
  it('keeps at most 5 per topic and drops the oldest topics past the cap', () => {
    let m = {};
    for (let i = 0; i < 8; i++) m = addDiscussed(m, 'k', { via: 'chat', chatId: `c${i}`, chatTitle: '', at: i });
    expect((m as Record<string, unknown[]>).k).toHaveLength(5);
    let big = {};
    for (let i = 0; i < 405; i++) big = addDiscussed(big, `t${i}`, { via: 'chat', chatId: 'c', chatTitle: '', at: i });
    expect(Object.keys(big)).toHaveLength(400);
    expect(big).not.toHaveProperty('t0');
    expect(big).toHaveProperty('t404');
  });
  it('a storage that throws never breaks the page', () => {
    const bad: KV = { getItem() { throw new Error('off'); }, setItem() { throw new Error('off'); } };
    expect(readDiscussed(bad)).toEqual({});
    expect(() => writeDiscussed(bad, {})).not.toThrow();
  });
  it('keys differ by kind, date and title', () => {
    expect(topicKey(I())).not.toBe(topicKey(I({ data: '2026-10-06' })));
    expect(topicKey(R)).toMatch(/^refl\|/);
  });
});

