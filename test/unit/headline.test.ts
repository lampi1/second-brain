// The Grindhouse's headline (main/headline.ts, SPEC 18): the line on screen never waits for a model; a failed or timed
// out refresh keeps the previous line, else a built-in one; refreshes only when due (an hour after the last try), on,
// on screen; the digest is scrubbed; repeats are refused; the month's spend is counted. And the Home renders its
// heading before the headline arrives (HomeHeadline.tsx).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HeadlineState } from '../../src/shared/contract';
import type { TextRequest, TextResult } from '../../src/main/engines/text';
import { BUILTIN, Headline, buildPrompt, builtinLine, pickLine, scrub, type HeadlineDeps } from '../../src/main/headline';
import { HeadlineLine } from '../../src/renderer/brain/pages/HomeHeadline';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 17, 19, 0);
const answer = (lines: string[], best = 0) => JSON.stringify({ candidates: lines, best });
const okResult = (text: string, usd = 0.02): TextResult => ({ ok: true, text, usd, model: 'claude-opus-5-5', engine: 'anthropic', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });

let dir: string;
let now: number;
let settings: ReturnType<HeadlineDeps['settings']>;
let visible: boolean;
let emitted: HeadlineState[];
let calls: TextRequest[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-headline-'));
  now = T0; settings = { on: true, model: '', effort: '' }; visible = true; emitted = []; calls = [];
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const make = (complete: (req: TextRequest, signal?: AbortSignal) => Promise<TextResult>, extra: Partial<HeadlineDeps> = {}) => new Headline({
  file: path.join(dir, 'headline.json'),
  complete: (req, signal) => { calls.push(req); return complete(req, signal); },
  settings: () => settings, lang: () => 'it',
  material: () => ({ chats: [{ title: 'Magazzino · fix login', state: 'error', lastText: 'token=abc123 non valido', costUsd: 1.5 }], nowMd: '- UI · ui-astra: suite rossa', journal: '', aiErrors: '- 2026-10-17 · ha detto che mancava un file' }),
  visible: () => visible, emit: s => emitted.push(s), now: () => now, ...extra,
});

describe('Headline', () => {
  it('shows a built-in line before any answer, without calling a model', () => {
    const h = make(async () => okResult(answer(['mai'])));
    expect(h.get()).toMatchObject({ source: 'builtin', text: builtinLine('it', T0), at: null, model: 'claude-opus-5-5', monthUsd: 0, monthCalls: 0 });
    expect(BUILTIN.it).toContain(h.get().text);
    expect(calls).toHaveLength(0);
  });

  it('a good refresh shows the best candidate, counts its cost, saves it and tells the page', async () => {
    const h = make(async () => okResult(answer(['La prima battuta, quella buona', 'La seconda battuta'], 0), 0.03));
    const s = await h.refresh();
    expect(s).toMatchObject({ source: 'model', text: 'La prima battuta, quella buona', at: T0, monthUsd: 0.03, monthCalls: 1 });
    expect(emitted.at(-1)).toEqual(s);
    expect(calls[0]).toMatchObject({ purpose: 'headline', model: 'claude-opus-5-5', effort: 'low', maxTokens: 1500 });
    expect(make(async () => okResult('')).get()).toMatchObject({ source: 'model', text: 'La prima battuta, quella buona' }); // read back from disk
  });

  it('a failed refresh keeps the previous line; with none, the built-in one', async () => {
    const fresh = make(async () => ({ ok: false, error: 'rete: api.anthropic.com non raggiungibile' }));
    expect(await fresh.refresh()).toMatchObject({ source: 'builtin', text: builtinLine('it', T0) });
    const h = make(async () => okResult(answer(['Una battuta che resta a lungo'])));
    await h.refresh();
    now += HOUR;
    const failing = make(async () => ({ ok: false, error: 'troppe richieste (429)' }));
    expect(await failing.refresh()).toMatchObject({ source: 'previous', text: 'Una battuta che resta a lungo', monthCalls: 3 });
  });

  it('a refresh that times out (or throws) keeps the previous line', async () => {
    await make(async () => okResult(answer(['Prima della lentezza, una battuta']))).refresh();
    const slow = make((_req, signal) => new Promise<TextResult>(resolve => signal!.addEventListener('abort', () => resolve({ ok: false, error: 'non ha risposto in tempo' }))), { timeoutMs: 20 });
    expect(await slow.refresh()).toMatchObject({ source: 'previous', text: 'Prima della lentezza, una battuta' });
    const broken = make(async () => { throw new Error('boom'); });
    expect(await broken.refresh()).toMatchObject({ source: 'previous', text: 'Prima della lentezza, una battuta' });
  });

  it('no API key: nothing sent, nothing counted, the built-in line stays', async () => {
    const h = make(async () => ({ ok: false, unavailable: true, reason: 'manca la chiave' }));
    expect(await h.refresh()).toMatchObject({ source: 'builtin', monthCalls: 0 });
  });

  it('get() never waits for a pending refresh', async () => {
    let release!: (r: TextResult) => void;
    const h = make(() => new Promise<TextResult>(r => { release = r; }));
    const pending = h.refresh();
    expect(h.get().source).toBe('builtin'); // answered at once, the request still out
    release(okResult(answer(['Arrivata dopo, come sempre'])));
    expect((await pending).text).toBe('Arrivata dopo, come sempre');
  });

  it('refreshes only when due, on and on screen; one request at a time', async () => {
    const h = make(async () => okResult(answer([`Battuta numero ${calls.length}`])));
    visible = false;
    h.start(); h.stop();
    expect(calls).toHaveLength(0); // in the tray: nothing
    visible = true;
    await Promise.all([h.refresh(), h.refresh()]);
    expect(calls).toHaveLength(1);
    expect(h.due()).toBe(false);
    now += HOUR - 1; expect(h.due()).toBe(false);
    now += 1; expect(h.due()).toBe(true);
    settings = { ...settings, on: false };
    expect(h.due()).toBe(false);
    expect(h.get().source).toBe('builtin'); // off: the app's own list, zero tokens
    expect(make(async () => okResult(''), { calls: false }).due()).toBe(false); // demo and tests
  });

  it('uses the model and effort of the settings', async () => {
    settings = { on: true, model: 'claude-sonnet-5', effort: 'medium' };
    await make(async () => okResult(answer(['Una battuta di Sonnet']))).refresh();
    expect(calls[0]).toMatchObject({ model: 'claude-sonnet-5', effort: 'medium' });
  });

  it('the month spend starts again in a new month', async () => {
    await make(async () => okResult(answer(['Battuta di ottobre']), 0.05)).refresh();
    now = Date.UTC(2026, 10, 2);
    expect(make(async () => okResult('')).get()).toMatchObject({ monthUsd: 0, monthCalls: 0 });
  });
});

describe('pickLine', () => {
  it('takes the best candidate, from JSON in a code fence too', () => {
    expect(pickLine('```json\n' + answer(['Una battuta qualunque', 'La battuta migliore'], 1) + '\n```', [])).toBe('La battuta migliore');
  });
  it('refuses a recent line (case and punctuation aside) and takes the next', () => {
    expect(pickLine(answer(['Già detta, questa!', 'Questa invece è nuova'], 0), ['già detta questa'])).toBe('Questa invece è nuova');
    expect(pickLine(answer(['Già detta, questa!']), ['Già detta, questa!'])).toBeNull();
  });
  it('rejects answers that are not the JSON asked for', () => {
    expect(pickLine('Ecco una battuta senza JSON', [])).toBeNull();
    expect(pickLine('{"candidates": []}', [])).toBeNull();
    expect(pickLine('{"candidates": [42, "ok"]}', [])).toBeNull();
  });
});

describe('the digest', () => {
  it('scrubs what looks like a credential or an address', () => {
    const s = scrub('password: hunter2 · token=abc123 · sk-ant-api03-abcdef123456 · ghp_abcdefghijklmnopqrstuvwxyz · mario@example.com · AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH12');
    for (const leak of ['hunter2', 'abc123', 'sk-ant', 'ghp_', 'mario@', 'AAAABBBB']) expect(s).not.toContain(leak);
    const env = scrub('DB_PASSWORD=Hunter3! · export GITHUB_TOKEN=def456 · PGPASSWORD=hunter4 · {"password": "Hunter5"} · la password è Hunter6');
    for (const leak of ['Hunter3', 'def456', 'hunter4', 'Hunter5', 'Hunter6']) expect(env).not.toContain(leak);
  });
  it('carries the real events, the lines already used, and only the last lines of the files', () => {
    const journal = Array.from({ length: 40 }, (_, i) => `riga ${i}`).join('\n');
    const { system, prompt } = buildPrompt({
      now: T0, lang: 'it', recent: ['La battuta di ieri'],
      chats: [{ title: 'Magazzino · fix login', state: 'error', lastText: 'api_key=zzz999 rifiutata', costUsd: 2 }],
      nowMd: '# now\n- UI · ui-astra: suite rossa\nnon una riga di elenco', journal, aiErrors: '- ha detto che il file mancava',
    });
    expect(prompt).toContain('Magazzino · fix login');
    expect(prompt).toContain('suite rossa');
    expect(prompt).not.toContain('non una riga di elenco');
    expect(prompt).toContain('riga 39');
    expect(prompt).not.toContain('riga 29');
    expect(prompt).toContain('il file mancava');
    expect(prompt).toContain('La battuta di ieri');
    expect(prompt).not.toContain('zzz999');
    expect(system).toContain('Italian');
    expect(system).toContain('"candidates"');
  });
});

describe('HeadlineLine', () => {
  it('keeps its place empty while the headline loads, then shows it', () => {
    const loading = renderToStaticMarkup(createElement(HeadlineLine, { state: null }));
    expect(loading).toContain('data-testid="dash-headline"');
    expect(loading).toContain('data-source="loading"');
    const shown = renderToStaticMarkup(createElement(HeadlineLine, { state: { text: 'Una battuta', source: 'model', at: T0, model: 'claude-opus-5-5', monthUsd: 0, monthCalls: 1 } }));
    expect(shown).toContain('Una battuta');
    expect(shown).toContain('data-source="model"');
  });
});
