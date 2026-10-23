// The working-line phrases of the day (daily-phrases.ts): the model's lines are checked (short, no link, no markup,
// enough per kind), written once a day per language, and a failed day is not tried again until the next one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyPhrasesService, parsePhrases, phrasesPrompt, PHRASE_KINDS } from '../../src/main/daily-phrases';
import type { Lang } from '../../src/shared/contract';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-phrases-')); dirs.push(d); return d; };
const answer = (kind: string, n: number, word = 'Riavvio il router') => Array.from({ length: n }, (_, i) => `${kind} | ${word} ${i}…`).join('\n');

describe('parsePhrases', () => {
  it('keeps good lines per kind and drops bad ones and thin kinds', () => {
    const text = [
      answer('fix', 6), '- any | "Cerco su Stack Overflow…"', 'any | vedi https://x.io…', 'any | **grassetto**…', `any | ${'x'.repeat(80)}`,
      'nope | ignored…', 'plan | only one…', 'just text',
    ].join('\n');
    const out = parsePhrases(text);
    expect(out.fix).toHaveLength(6);
    expect(out.any).toBeUndefined();
    expect(out.plan).toBeUndefined();
    expect(parsePhrases(answer('any', 9)).any).toHaveLength(9);
    expect(parsePhrases(answer('fix', 9)).fix).toHaveLength(6);
  });
  it('asks for every kind in the UI language', () => {
    const { prompt } = phrasesPrompt('it');
    for (const k of Object.keys(PHRASE_KINDS)) expect(prompt).toContain(`- ${k} (`);
    expect(prompt).toMatch(/Italian|italiano/i);
  });
});

describe('DailyPhrasesService', () => {
  it('writes once a day per language and keeps a failed day', async () => {
    const userData = tmp();
    let now = Date.parse('2026-10-23T09:00:00');
    let lang: Lang = 'it';
    let reply = { ok: true, text: answer('any', 16) };
    const ask = vi.fn(async () => reply);
    const emit = vi.fn();
    const s = new DailyPhrasesService({ userData, lang: () => lang, ask, emit, now: () => now });
    expect(s.today()).toBeNull();
    await s.ensure();
    expect(s.today()?.lines.any).toHaveLength(16);
    expect(emit).toHaveBeenCalledTimes(1);
    await s.ensure();
    expect(ask).toHaveBeenCalledTimes(1);
    // read again from disk
    expect(new DailyPhrasesService({ userData, lang: () => lang, ask, emit, now: () => now }).today()?.day).toBe('2026-10-23');

    lang = 'en';
    reply = { ok: false, text: '' };
    expect(s.today()).toBeNull();
    await s.ensure();
    await s.ensure();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(s.today()).toBeNull();

    now += 86_400_000;
    reply = { ok: true, text: answer('any', 16, 'Reboot') };
    await s.ensure();
    expect(ask).toHaveBeenCalledTimes(3);
    expect(s.today()).toMatchObject({ day: '2026-10-24', lang: 'en' });
  });
});
