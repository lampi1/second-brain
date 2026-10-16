// Cursor ledger (src/main/brain/cursor-ledger.ts): the hook script on real stop-hook and `agent -p` result input, list
// price + Token Rate, calibration from a usage CSV (factor per model, margin, edge days left out), today's figure
// (exact from the CSV up to its export, estimated after it) and the newest export in Downloads.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  CALIBRATION_FILE, HOOK_SOURCE, LEDGER_FILE, NO_CSV_MARGIN, calibrate, cursorDay, cursorToday, installHook, listUsd, parseUsageCsv,
  readLedger, type LedgerRow,
} from '../../../src/main/brain/cursor-ledger';
import { tmpDir } from './helpers';

const row = (at: number, p: Partial<LedgerRow> = {}): LedgerRow => ({
  at, source: 'hook', conversationId: 'conv-1', generationId: null, model: 'grok-4.7', input: 1_000_000, cacheWrite: 0, cacheRead: 0, output: 0, ...p,
});
const T = (iso: string) => Date.parse(iso);
const runHook = (file: string, input: string, args: string[] = []) => execFileSync(process.execPath, [file, ...args], { input, encoding: 'utf8' });

describe('hook script', () => {
  it('appends one line per stop hook turn (uncached input = input − cache), one per -p result, and answers {}', () => {
    const dir = tmpDir();
    const hook = installHook(dir);
    expect(fs.readFileSync(hook, 'utf8')).toBe(HOOK_SOURCE);
    const stop = { hook_event_name: 'stop', conversation_id: 'c1', generation_id: 'g1', model: 'grok-4.7', status: 'completed', input_tokens: 1000, output_tokens: 50, cache_read_tokens: 600, cache_write_tokens: 100 };
    expect(runHook(hook, '﻿' + JSON.stringify(stop))).toBe('{}');
    const cli = [JSON.stringify({ type: 'system', subtype: 'init', model: 'Grok 4.7' }), JSON.stringify({ type: 'result', subtype: 'success', session_id: 's2', request_id: 'r2', usage: { inputTokens: 300, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 0 } })].join('\n');
    expect(runHook(hook, cli, ['--model', 'gpt-5.6-sol'])).toBe('{}');
    // no tokens (an old Cursor), garbage: no line, still {}
    expect(runHook(hook, JSON.stringify({ hook_event_name: 'stop', conversation_id: 'c3', status: 'completed' }))).toBe('{}');
    expect(runHook(hook, 'not json')).toBe('{}');
    const rows = readLedger(path.join(dir, LEDGER_FILE));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ source: 'hook', conversationId: 'c1', generationId: 'g1', model: 'grok-4.7', input: 300, cacheRead: 600, cacheWrite: 100, output: 50 });
    expect(rows[1]).toMatchObject({ source: 'cli', conversationId: 's2', model: 'gpt-5.6-sol', input: 300, cacheRead: 10, output: 20 });
  });

  it('install rewrites an outdated copy and leaves a current one alone', () => {
    const dir = tmpDir();
    const file = installHook(dir);
    fs.writeFileSync(file, '// old');
    installHook(dir);
    expect(fs.readFileSync(file, 'utf8')).toBe(HOOK_SOURCE);
    const t = fs.statSync(file).mtimeMs;
    installHook(dir);
    expect(fs.statSync(file).mtimeMs).toBe(t);
  });

  it('the ledger keeps one row per generation and skips broken lines', () => {
    const dir = tmpDir();
    const f = path.join(dir, LEDGER_FILE);
    fs.writeFileSync(f, [JSON.stringify(row(1, { generationId: 'g' })), 'oops', JSON.stringify(row(2, { generationId: 'g' })), JSON.stringify(row(3, { input: 0 }))].join('\n'));
    expect(readLedger(f).map(r => r.at)).toEqual([1]);
  });
});

describe('prices', () => {
  it('list price per model, plus the Token Rate on third-party models only; unknown model → null', () => {
    expect(listUsd(row(1, { model: 'grok-4.7', input: 1e6, output: 1e6 }))).toBeCloseTo(2 + 6, 9);
    expect(listUsd(row(1, { model: 'gpt-5.6-sol', input: 1e6, cacheRead: 1e6 }))).toBeCloseTo(4.25 + 0.65, 9);
    expect(listUsd(row(1, { model: 'auto' }))).toBeNull();
  });
});

const csvText = (rows: [string, string, number, number][]) => ['Date,User,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost',
  ...rows.map(([d, m, tok, usd]) => `"${d}",me,Included,${m},No,0,${tok},0,0,${tok},"$${usd.toFixed(2)}"`)].join('\n');

describe('CSV correction', () => {
  // CSV 06/10 → exported 10/10 12:00 Rome: full days 07, 08, 09
  const csv = parseUsageCsv('﻿' + csvText([
    ['2026-10-06T15:00:00Z', 'grok-4.7-low', 1e6, 5],
    ['2026-10-07T10:00:00Z', 'grok-4.7-low', 1e6, 1.7],
    ['2026-10-08T10:00:00Z', 'grok-4.7-low', 1e6, 1.8],
    ['2026-10-09T10:00:00Z', 'gpt-5.6-sol-medium', 1e6, 3.4],
    ['2026-10-10T08:00:00Z', 'grok-4.7-low', 1e6, 1.6],
  ]));
  const exported = T('2026-10-10T10:00:00Z');
  const ledger = [
    row(T('2026-10-06T15:00:05Z')),                           // edge day: left out
    row(T('2026-10-07T10:00:05Z')),                           // 2 $ list
    row(T('2026-10-08T10:00:05Z')),                           // 2 $ list
    row(T('2026-10-09T10:00:05Z'), { model: 'gpt-5.6-sol' }), // 4.25 $ list
  ];

  it('reads the export: dates, models, $ and tokens', () => {
    expect(csv).toHaveLength(5);
    expect(csv[0]).toMatchObject({ model: 'grok-4.7-low', usd: 5, tokens: 1e6 });
  });

  it('factor per model on the full days only, margin = worst day left after it', () => {
    const cal = calibrate(csv, ledger, 'x.csv', exported);
    expect(cal.factors['grok-4.7']).toBe(0.875);           // (1.7 + 1.8) / (2 + 2)
    expect(cal.factors['gpt-5.6-sol']).toBe(0.8);          // 3.4 / 4.25
    expect(cal.margin).toBe(0.05); // the days are off by 2.9% at most: the 5% floor wins
  });

  it('no overlap with the ledger (hook not installed yet) keeps the old factors and the no-CSV margin', () => {
    const cal = calibrate(csv, [], 'x.csv', exported, null);
    expect(cal.factors).toEqual({});
    expect(cal.margin).toBe(NO_CSV_MARGIN);
  });

  it('today: exact from the CSV up to its export, estimated after it, per chat too', () => {
    const cal = calibrate(csv, ledger, 'x.csv', exported);
    const now = T('2026-10-10T16:00:00Z');
    const today = [row(T('2026-10-10T07:59:00Z'), { conversationId: 'a' }), row(T('2026-10-10T14:00:00Z'), { conversationId: 'a' }), row(T('2026-10-10T15:00:00Z'), { conversationId: 'b', model: 'auto' })];
    const d = cursorDay(today, cal, csv, now, exported);
    expect(d.usd).toBeCloseTo(1.6 + 2 * 0.875, 6);
    expect(d.exact).toBe(false);
    expect(d.margin).toBe(0.05);
    expect(d.turns).toBe(3);
    expect(d.unpriced).toBe(1);
    expect(d.chats).toEqual({ a: 3.5 });
    expect(d.unpricedChats).toEqual(['b']);
    expect(d.unpricedModels).toEqual(['auto']);
    expect(d.note).toContain('stima ±5%');
    expect(d.note).toContain('1 turni senza prezzo');
  });

  it('a day the CSV covers to the end of its turns is exact; no CSV at all → list price ±20%', () => {
    const cal = calibrate(csv, ledger, 'x.csv', exported);
    const exact = cursorDay([row(T('2026-10-10T07:59:00Z'))], cal, csv, T('2026-10-10T16:00:00Z'), exported);
    expect(exact).toMatchObject({ usd: 1.6, exact: true, margin: 0 });
    const none = cursorDay([row(T('2026-10-10T14:00:00Z'))], null, [], T('2026-10-10T16:00:00Z'));
    expect(none).toMatchObject({ usd: 2, exact: false, margin: NO_CSV_MARGIN });
    expect(none.note).toContain('nessun CSV ancora');
    expect(cursorDay([], null, [], T('2026-10-10T16:00:00Z')).note).toContain('nessun turno registrato');
  });

  it('a day the ledger saw only in part (hook added mid-day) does not calibrate', () => {
    const half = [row(T('2026-10-07T10:00:05Z'), { input: 4e5 }), ...ledger.slice(2)]; // 07/10: 0.4M of the CSV's 1M tokens
    expect(calibrate(csv, half, 'x.csv', exported).factors['grok-4.7']).toBe(0.9); // 1.8 / 2, from 08/10 alone
  });

  it('today is exact only up to the CSV rows actually read: no CSV left → all estimated, never "0 $ exact"', () => {
    const cal = calibrate(csv, ledger, 'x.csv', exported);
    const d = cursorDay([row(T('2026-10-10T07:59:00Z'))], cal, [], T('2026-10-10T16:00:00Z'), 0);
    expect(d).toMatchObject({ usd: 1.75, exact: false, margin: 0.05 });
  });

  it('only turns without a price after the CSV: unknown, not "≈ 0 $ ±0%"', () => {
    const d = cursorDay([row(T('2026-10-10T14:00:00Z'), { model: 'auto' })], null, [], T('2026-10-10T16:00:00Z'));
    expect(d).toMatchObject({ usd: null, exact: false, margin: 0, unpriced: 1 });
    expect(d.note).toContain('sconosciuto');
  });

  it('a model the CSV has no factor for keeps the no-CSV margin', () => {
    const cal = calibrate(csv, ledger, 'x.csv', exported);
    const d = cursorDay([row(T('2026-10-10T14:00:00Z'), { model: 'claude-sonnet-5.5' })], cal, csv, T('2026-10-10T16:00:00Z'), exported);
    expect(d.margin).toBe(NO_CSV_MARGIN);
    expect(d.note).toContain('listino per i modelli che non ha');
  });

  it('a chat costs all its turns in the ledger read, not only today', () => {
    const d = cursorDay([row(T('2026-10-09T20:00:00Z'), { conversationId: 'a' }), row(T('2026-10-10T14:00:00Z'), { conversationId: 'a' })], null, [], T('2026-10-10T16:00:00Z'));
    expect(d.chats).toEqual({ a: 4 });
    expect(d.todayChats).toEqual({ a: 2 }); // the day's list: today's turns only
    expect(d.usd).toBe(2);
  });

  it('cursorToday finds the newest export in Downloads, calibrates once and saves it', () => {
    const dir = tmpDir(), dl = tmpDir();
    fs.writeFileSync(path.join(dir, LEDGER_FILE), ledger.map(r => JSON.stringify(r)).join('\n'));
    const old = path.join(dl, 'team-usage-events-1-2026-10-09.csv'), file = path.join(dl, 'team-usage-events-1-2026-10-10.csv');
    fs.writeFileSync(old, csvText([['2026-10-08T10:00:00Z', 'grok-4.7', 1e6, 9]]));
    fs.writeFileSync(file, csvText([['2026-10-06T15:00:00Z', 'grok-4.7-low', 1e6, 5], ['2026-10-07T10:00:00Z', 'grok-4.7-low', 1e6, 1.7], ['2026-10-08T10:00:00Z', 'grok-4.7-low', 1e6, 1.8]]));
    fs.utimesSync(file, exported / 1000, exported / 1000);
    fs.utimesSync(old, exported / 1000 - 86400, exported / 1000 - 86400);
    const d = cursorToday({ dir, downloads: dl, now: T('2026-10-10T16:00:00Z') });
    expect(d.calibration?.csvFile).toBe(file);
    expect(d.calibration?.factors['grok-4.7']).toBe(0.875);
    expect(JSON.parse(fs.readFileSync(path.join(dir, CALIBRATION_FILE), 'utf8')).factors['grok-4.7']).toBe(0.875);
  });
});
