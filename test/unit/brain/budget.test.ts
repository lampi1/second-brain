// Spending limits (src/main/brain/budget.ts): the pure evaluateBudget() and the once-only watcher.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { BudgetWatcher, evaluateBudget, type Spend } from '../../../src/main/brain/budget';
import type { BudgetSettings } from '../../../src/shared/contract';
import { tmpDir } from './helpers';

const B = (p: Partial<{ enabled: boolean; claude: Partial<BudgetSettings['claude']>; cursor: Partial<BudgetSettings['cursor']> }> = {}): BudgetSettings => ({
  enabled: p.enabled ?? true,
  claude: { mode: 'warn', dailyUsd: null, perChatUsd: null, ...p.claude },
  cursor: { mode: 'warn', dailyUsd: null, perChatUsd: null, ...p.cursor },
});
const S = (p: { claudeDay?: number | null; cursorDay?: number | null; chats?: { id: string; title: string; usd: number }[]; five?: number | null; week?: number | null } = {}): Spend => ({
  day: '2026-10-11',
  claude: { dayUsd: p.claudeDay ?? null, chats: p.chats ?? [], fiveHourPct: p.five ?? null, fiveHourResetsAt: p.five != null ? Date.parse('2026-10-11T14:00:00Z') : null, weekPct: p.week ?? null, weekResetsAt: null },
  cursor: { dayUsd: p.cursorDay ?? null, chats: [] },
});

describe('evaluateBudget', () => {
  it('nothing under 80 %, 80 at 80 %, 100 at or over the limit', () => {
    const b = B({ claude: { dailyUsd: 200 } });
    expect(evaluateBudget(b, S({ claudeDay: 159 }))).toEqual([]);
    expect(evaluateBudget(b, S({ claudeDay: 160 }))[0]).toMatchObject({ harness: 'claude', scope: 'day', threshold: 80, pct: 80, usd: 160, limitUsd: 200, mode: 'warn' });
    const over = evaluateBudget(b, S({ claudeDay: 230 }))[0]!;
    expect(over.threshold).toBe(100);
    expect(over.text).toBe('Claude oggi: 115% del limite giornaliero (230 $ di 200 $, a prezzo di listino)');
  });

  it('master switch and per-harness mode off silence everything; no limit set = no alert', () => {
    expect(evaluateBudget(B({ enabled: false, claude: { dailyUsd: 10 } }), S({ claudeDay: 50, five: 95 }))).toEqual([]);
    expect(evaluateBudget(B({ claude: { mode: 'off', dailyUsd: 10 } }), S({ claudeDay: 50, five: 95 }))).toEqual([]);
    expect(evaluateBudget(B(), S({ claudeDay: 5000 }))).toEqual([]);
  });

  it('Cursor unknown (no export for today) never alerts; known Cursor spend does, with mode ask', () => {
    const b = B({ cursor: { mode: 'ask', dailyUsd: 20 } });
    expect(evaluateBudget(b, S({ cursorDay: null }))).toEqual([]);
    expect(evaluateBudget(b, S({ cursorDay: 21 }))[0]).toMatchObject({ harness: 'cursor', scope: 'day', threshold: 100, mode: 'ask' });
  });

  it('per-chat limits name the chat; plan windows alert at 80 % and 100 % without a $ limit', () => {
    const chats = [{ id: 's1', title: 'Fix login', usd: 17 }, { id: 's2', title: 'Orchestrator', usd: 3 }];
    const c = evaluateBudget(B({ claude: { perChatUsd: 20 } }), S({ chats }));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ scope: 'chat', chatId: 's1', chatTitle: 'Fix login', threshold: 80 });
    const w = evaluateBudget(B(), S({ five: 82, week: 100 }));
    expect(w.map(x => [x.scope, x.threshold, x.usd])).toEqual([['fiveHour', 80, null], ['week', 100, null]]);
    expect(w[0]!.text).toMatch(/finestra di 5 ore \(si azzera alle \d\d:\d\d\)/);
  });
});

describe('BudgetWatcher', () => {
  it('reports each threshold once, 100 % after 80 %, and remembers across restarts', () => {
    const file = path.join(tmpDir(), 'budget-state.json');
    const b = B({ claude: { dailyUsd: 100 } });
    const w = new BudgetWatcher(file);
    expect(w.check(b, S({ claudeDay: 85 })).map(a => a.threshold)).toEqual([80]);
    expect(w.check(b, S({ claudeDay: 90 }))).toEqual([]);
    const a100 = w.check(b, S({ claudeDay: 101 }));
    expect(a100.map(a => a.threshold)).toEqual([100]);
    expect(a100[0]!.id).toMatch(/[0-9a-f-]{36}/);
    expect(new BudgetWatcher(file).check(b, S({ claudeDay: 120 }))).toEqual([]);
  });

  it('a raised limit or a switch to ask is a new decision: it alerts again the same day', () => {
    const w = new BudgetWatcher(null);
    expect(w.check(B({ claude: { dailyUsd: 50 } }), S({ claudeDay: 51 })).map(a => a.threshold)).toEqual([100]);
    const raised = B({ claude: { dailyUsd: 100 } });
    expect(w.check(raised, S({ claudeDay: 85 })).map(a => [a.threshold, a.limitUsd])).toEqual([[80, 100]]);
    expect(w.check(raised, S({ claudeDay: 120 })).map(a => a.threshold)).toEqual([100]);
    expect(w.check(B({ claude: { dailyUsd: 100, mode: 'ask' } }), S({ claudeDay: 120 })).map(a => [a.threshold, a.mode])).toEqual([[100, 'ask']]);
  });

  it('the same plan window read with a different clock fraction is not a new window', () => {
    const w = new BudgetWatcher(null);
    const at = (resets: number): Spend => ({ ...S(), claude: { ...S().claude, fiveHourPct: 83, fiveHourResetsAt: resets } });
    expect(w.check(B(), at(Date.parse('2026-10-11T11:20:00.231Z')))).toHaveLength(1);
    expect(w.check(B(), at(Date.parse('2026-10-11T11:20:00.845Z')))).toEqual([]);
    expect(w.check(B(), at(1791720000 * 1000 + 0))).toHaveLength(1); // another window (other reset minute)
  });

  it('first seen at 100 %: only the 100 % alert, and its 80 % is not reported later', () => {
    const w = new BudgetWatcher(null);
    const b = B({ claude: { dailyUsd: 100 } });
    expect(w.check(b, S({ claudeDay: 150 })).map(a => a.threshold)).toEqual([100]);
    expect(w.check(b, S({ claudeDay: 85 }))).toEqual([]);
  });
});
