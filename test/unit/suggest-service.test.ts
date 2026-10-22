// The model part of the chat composer's suggestion (main/suggest/service.ts, ADR 0118): never a call when off (setting,
// tests/demo) or with too short a line; the short context (the line and the last message, cut and scrubbed) on the
// small model with few output tokens; repeated prefixes and typing along an answer served from the cache with no
// call; a newer request or cancel() aborts the one in flight; the daily budget stops the calls and today's spend is
// kept across a restart; the answer is cleaned.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TextRequest, TextResult } from '../../src/main/engines/text';
import { ComposerSuggest, cleanAnswer, type SuggestDeps } from '../../src/main/suggest/service';
import { SUGGEST_LAST_MAX, SUGGEST_MAX_OUT } from '../../src/shared/composer-suggest';

const ok = (text: string, usd: number | null = 0.0001): TextResult => ({ ok: true, text, usd, model: 'claude-haiku-4-5', engine: 'anthropic', usage: { input: 100, output: 8, cacheRead: 0, cacheWrite: 0 } });

let dir: string;
let settings: ReturnType<SuggestDeps['settings']>;
let calls: { req: TextRequest; signal?: AbortSignal }[];
let now: number;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-suggest-')); settings = { on: true, modelOn: true, dailyUsd: 0.05 }; calls = []; now = new Date(2026, 9, 22, 10).getTime(); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const make = (complete: (req: TextRequest, signal?: AbortSignal) => Promise<TextResult> = async () => ok(' per il login'), extra: Partial<SuggestDeps> = {}) => new ComposerSuggest({
  file: path.join(dir, 'suggest.json'),
  complete: (req, signal) => { calls.push({ req, signal }); return complete(req, signal); },
  settings: () => settings, model: () => 'claude-haiku-4-5', calls: true, now: () => now, ...extra,
});
const ask = (s: ComposerSuggest, line: string, lastMessage = 'Ho finito il refactoring.') => s.suggest({ chatId: 'c1', line, lastMessage });

describe('ComposerSuggest', () => {
  it('sends a short context to the small model with few output tokens', async () => {
    const s = make();
    const a = await ask(s, 'prima riga\nscrivi un test', `${'x'.repeat(2000)} token=abc123secret`);
    expect(a).toEqual({ text: ' per il login', cached: false });
    expect(calls).toHaveLength(1);
    const { req } = calls[0]!;
    expect(req).toMatchObject({ purpose: 'composer-suggest', model: 'claude-haiku-4-5', maxTokens: SUGGEST_MAX_OUT });
    expect(req.prompt).toContain('scrivi un test');
    expect(req.prompt).not.toContain('prima riga'); // only the current line
    expect(req.prompt).not.toContain('abc123secret'); // scrubbed
    expect(req.prompt.length).toBeLessThan(SUGGEST_LAST_MAX + 200);
  });
  it('never calls when off, in tests/demo, or with a short line', async () => {
    settings.modelOn = false;
    expect((await ask(make(), 'scrivi un test')).reason).toBe('off');
    settings = { on: false, modelOn: true, dailyUsd: 0.05 };
    expect((await ask(make(), 'scrivi un test')).reason).toBe('off');
    settings.on = true;
    expect((await ask(make(undefined, { calls: false }), 'scrivi un test')).reason).toBe('off');
    expect((await ask(make(), 'ciao')).reason).toBe('short');
    expect(calls).toHaveLength(0);
  });
  it('serves a repeated prefix and a typed-along answer from the cache, with no call', async () => {
    const s = make();
    await ask(s, 'scrivi un test');
    expect(await ask(s, 'scrivi un test')).toEqual({ text: ' per il login', cached: true });
    expect(await ask(s, 'scrivi un test per')).toEqual({ text: ' il login', cached: true });
    expect(calls).toHaveLength(1);
    expect(s.state()).toMatchObject({ calls: 1, cacheHits: 2 });
    // another last message is another context: a new call
    await ask(s, 'scrivi un test', 'Altro messaggio');
    expect(calls).toHaveLength(2);
  });
  it('caches an empty answer too, so the same prefix is not asked again', async () => {
    const s = make(async () => ok('-'));
    expect(await ask(s, 'scrivi un test')).toEqual({ text: null, cached: false, reason: 'empty' });
    expect(await ask(s, 'scrivi un test')).toEqual({ text: null, cached: true, reason: 'empty' });
    expect(calls).toHaveLength(1);
  });
  it('a newer request or cancel() aborts the one in flight', async () => {
    const hang = (_r: TextRequest, signal?: AbortSignal) => new Promise<TextResult>(resolve => signal?.addEventListener('abort', () => resolve({ ok: false, error: 'richiesta annullata' })));
    const s = make(hang);
    const first = ask(s, 'scrivi un test');
    s.cancel('c1');
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect((await first).reason).toBe('cancelled');
    const second = ask(s, 'scrivi un test lungo');
    const third = ask(s, 'scrivi un test lungo e');
    expect(calls[1]!.signal?.aborted).toBe(true);
    expect((await second).reason).toBe('cancelled');
    s.cancel('c1');
    expect((await third).reason).toBe('cancelled');
    // nothing answered, but each call was sent and may be billed: counted at the estimate against the daily cap
    expect(s.state().calls).toBe(3);
    expect(s.state().usd).toBeGreaterThan(0);
  });
  it('stops at the daily budget, keeps today across a restart, starts over the next day', async () => {
    settings.dailyUsd = 0.01;
    const s = make(async () => ok(' altro', 0.006));
    await ask(s, 'scrivi un test');
    await ask(s, 'scrivi un altro test');
    expect((await ask(s, 'scrivi un terzo test')).reason).toBe('budget');
    expect(calls).toHaveLength(2);
    const again = make();
    expect(again.state()).toMatchObject({ calls: 2, usd: 0.012, budgetUsd: 0.01, modelOn: true, model: 'claude-haiku-4-5' });
    expect((await ask(again, 'scrivi un quarto test')).reason).toBe('budget');
    now += 24 * 3_600_000;
    expect(again.state()).toMatchObject({ calls: 0, usd: 0 });
    expect((await ask(again, 'scrivi un quarto test')).text).toBe(' per il login');
  });
  it('an answer with no price still counts against the budget', async () => {
    const s = make(async () => ok(' x', null));
    await ask(s, 'scrivi un test');
    expect(s.state().usd).toBeGreaterThan(0);
  });
  it('no API engine or key: nothing spent, no suggestion', async () => {
    const s = make(async () => ({ ok: false, unavailable: true, reason: 'manca la chiave' }));
    expect((await ask(s, 'scrivi un test')).reason).toBe('unavailable');
    expect(s.state().calls).toBe(0);
  });
});

describe('cleanAnswer', () => {
  it('keeps the continuation only', () => {
    expect(cleanAnswer(' per il login\naltro', 'scrivi un test')).toBe(' per il login');
    expect(cleanAnswer('"per il login"', 'scrivi un test ')).toBe('per il login');
    expect(cleanAnswer('scrivi un test per il login', 'scrivi un test')).toBe(' per il login');
    expect(cleanAnswer(' -', 'scrivi un test')).toBe('');
    expect(cleanAnswer('', 'scrivi un test')).toBe('');
  });
});
