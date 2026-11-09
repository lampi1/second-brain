// «Orchestrators corte» (chats/continuity.ts orchestratorDayDue, ADR 0051): the pure rule (an Orchestrator on Claude, idle a few minutes, with a long
// context begun on an earlier Rome day, once a day) and the ChatManager flow on the fake Claude engine: one quiet
// `/compact` turn, the engine's «Contesto compattato» line in the tile, same chat and session, nothing else shown; never
// twice a day, never a work chat, never with the setting off; a restart keeps when the context began.
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatManager } from '../../../src/main/chats/manager';
import { CACHE_TTL_MS, continuityStep, ORCHESTRATOR_COMPACT, ORCHESTRATOR_DAY_IDLE_MS, ORCHESTRATOR_DAY_MIN, ORCHESTRATOR_PAUSE_COMPACT, ORCHESTRATOR_WARM_MIN, orchestratorDayDue, orchestratorWarmDue, romeDay, type ColdView, type OrchestratorDayView } from '../../../src/main/chats/continuity';
// 2026-10-14 08:00 in Rome; yesterday evening and today in the morning
const NOW = Date.parse('2026-10-14T06:00:00Z');
const v: OrchestratorDayView = {
  harness: 'claude', isOrchestrator: true, state: 'idle', pending: 0, busy: false, alive: true, handoffTurn: false,
  contextTokens: 180_000, lastTurnAt: NOW - ORCHESTRATOR_DAY_IDLE_MS, ctxSince: Date.parse('2026-10-13T18:00:00Z'), askedOn: undefined,
};

describe('orchestrator day rule', () => {
  it('an Orchestrator with a context from yesterday, idle a few minutes, compacts once today', () => {
    expect(romeDay(Date.parse('2026-10-13T22:30:00Z'))).toBe('2026-10-14'); // past midnight in Rome
    expect(orchestratorDayDue(v, NOW)).toBe(true);
    for (const x of [
      { isOrchestrator: false }, { harness: 'cursor' }, { state: 'running' }, { pending: 1 }, { busy: true }, { alive: false }, { handoffTurn: true },
      { contextTokens: ORCHESTRATOR_DAY_MIN - 1 }, { lastTurnAt: NOW - ORCHESTRATOR_DAY_IDLE_MS + 1 }, { ctxSince: undefined },
      { ctxSince: Date.parse('2026-10-13T22:30:00Z') }, { askedOn: '2026-10-14' },
    ] satisfies Partial<OrchestratorDayView>[]) expect(orchestratorDayDue({ ...v, ...x }, NOW), JSON.stringify(x)).toBe(false);
    expect(orchestratorDayDue({ ...v, askedOn: '2026-10-13' }, NOW)).toBe(true);
  });

  it('the summary keeps what the Orchestrator needs to go on', () => {
    expect(ORCHESTRATOR_COMPACT.startsWith('/compact ')).toBe(true);
    for (const w of ['chats you coordinate', 'questions for the user', 'decisions', 'background', "user's language"]) expect(ORCHESTRATOR_COMPACT).toContain(w);
  });
});

describe('orchestrator pause rule (compact before the cache expires)', () => {
  const IDLE = 50 * 60_000;
  const c: ColdView = { harness: 'claude', isOrchestrator: true, state: 'idle', pending: 0, background: 0, busy: false, alive: true, handoffTurn: false,
    contextTokens: 120_000, lastTurnAt: NOW - IDLE, noteAt: 0, lastCallAt: NOW - IDLE };
  it('a long, quiet Orchestrator compacts once per pause, while its cache is warm', () => {
    expect(orchestratorWarmDue(c, NOW, IDLE)).toBe(true);
    for (const x of [
      { isOrchestrator: false }, { harness: 'cursor' }, { state: 'running' }, { pending: 1 }, { busy: true }, { alive: false },
      { contextTokens: ORCHESTRATOR_WARM_MIN - 1 }, { lastCallAt: NOW - IDLE + 1 }, { lastCallAt: NOW - CACHE_TTL_MS - 1 }, { askedFor: NOW - IDLE },
    ] satisfies Partial<ColdView>[]) expect(orchestratorWarmDue({ ...c, ...x }, NOW, IDLE), JSON.stringify(x)).toBe(false);
    expect(continuityStep({ ...c, ctxSince: NOW - IDLE, askedOn: undefined }, NOW, { cold: true, day: true, idleMs: IDLE })).toBe('pause');
    expect(continuityStep({ ...c, ctxSince: NOW - IDLE, askedOn: undefined }, NOW, { cold: true, day: false, idleMs: IDLE })).toBeNull();
    expect(ORCHESTRATOR_PAUSE_COMPACT.startsWith('/compact ')).toBe(true);
  });
});

const managers: ChatManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });
