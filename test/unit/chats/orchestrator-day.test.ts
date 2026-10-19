// «Orchestrators corte» (chats/continuity.ts orchestratorDayDue, ADR 0051): the pure rule (an Orchestrator on Claude, idle a few minutes, with a long
// context begun on an earlier Rome day, once a day) and the ChatManager flow on the fake Claude engine: one quiet
// `/compact` turn, the engine's «Contesto compattato» line in the tile, same chat and session, nothing else shown; never
// twice a day, never a work chat, never with the setting off; a restart keeps when the context began.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import { ORCHESTRATOR_COMPACT, ORCHESTRATOR_DAY_IDLE_MS, ORCHESTRATOR_DAY_MIN, orchestratorDayDue, romeDay, type OrchestratorDayView } from '../../../src/main/chats/continuity';
import { FAKE, recEmitter, tmp, waitFor } from './helpers';

const DAY = 86_400_000;
// 2026-10-14 08:00 in Rome; yesterday evening and today in the morning
const NOW = Date.parse('2026-10-14T06:00:00Z');
const v: OrchestratorDayView = {
  harness: 'claude', isOrchestrator: true, state: 'idle', pending: 0, busy: false, alive: true, handoffTurn: false,
  contextTokens: 180_000, lastTurnAt: NOW - ORCHESTRATOR_DAY_IDLE_MS, ctxSince: Date.parse('2026-10-13T18:00:00Z'), askedOn: undefined,
};

describe('orchestrator day rule', () => {
  it('a Orchestrator with a context from yesterday, idle a few minutes, compacts once today', () => {
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

const managers: ChatManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

function setup(extra: Partial<ChatManagerOptions> = {}) {
  const userData = tmp('ud'), home = tmp('home'), cwd = tmp('cwd');
  const make = () => {
    const m = new ChatManager({
      emitter: recEmitter(), userData, enginePaths: { claude: FAKE }, claudeHome: home, env: { CLAUDE_CONFIG_DIR: home },
      compactWindowTokens: () => 200_000, coldHandoff: () => false, coldEveryMs: 0, orchestratorDayCompact: () => true, ...extra,
    });
    managers.push(m);
    return m;
  };
  return { userData, cwd, make };
}
const summary = (m: ChatManager, id: string) => m.list().find(c => c.id === id);
const idle = (m: ChatManager, id: string) => summary(m, id)?.state === 'idle' && !m.items(id).at(-1)?.id.startsWith('u');

describe('ChatManager Orchestrator day compaction', () => {
  it('the next day a long Orchestrator compacts quietly in the same session; a work chat never', async () => {
    const { make, cwd, userData } = setup();
    const m = make();
    const orchestrator = await m.create({ harness: 'claude', cwd, orchestrator: true, prompt: 'big' });
    const work = await m.create({ harness: 'claude', cwd, prompt: 'big' });
    await waitFor(() => idle(m, orchestrator.id) && idle(m, work.id) && summary(m, orchestrator.id)?.contextTokens === 250_000 && summary(m, work.id)?.contextTokens === 250_000, 'both long and idle');
    expect(m.coldTick()).toBe(0); // today: its context began today
    const before = m.items(orchestrator.id).length, sid = summary(m, orchestrator.id)!.sessionId;
    const tomorrow = Date.now() + DAY;
    expect(m.coldTick(tomorrow)).toBe(1);
    await waitFor(() => m.items(orchestrator.id).some(i => i.kind === 'system' && (i.code === 'compacted' || /Context compacted/.test(i.text))), 'compacted');
    await waitFor(() => summary(m, orchestrator.id)?.contextTokens === 30_000 && idle(m, orchestrator.id), 'smaller context reported');
    const added = m.items(orchestrator.id).slice(before);
    // only the app's line and the engine's: no user message, no answer
    expect(added.every(i => i.kind === 'system')).toBe(true);
    expect(added.some(i => i.kind === 'system' && i.code === 'dayCompactStart')).toBe(true);
    expect(summary(m, orchestrator.id)).toMatchObject({ sessionId: sid, isOrchestrator: true });
    expect(summary(m, work.id)?.isOrchestrator).toBe(false);
    expect(m.coldTick(tomorrow + 10 * 60_000)).toBe(0); // once a day
    // its context now begins at the compaction (saved): the day after tomorrow it is long again only if it grows
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'chats.json'), 'utf8')).chats.find((x: { id: string }) => x.id === orchestrator.id);
    expect(saved.ctxSince).toBeGreaterThan(Date.now() - 60_000);
  }, 30_000);

  it('nothing with the setting off', async () => {
    const { make, cwd } = setup({ orchestratorDayCompact: () => false });
    const m = make();
    const orchestrator = await m.create({ harness: 'claude', cwd, orchestrator: true, prompt: 'big' });
    await waitFor(() => idle(m, orchestrator.id) && summary(m, orchestrator.id)?.contextTokens === 250_000, 'long and idle');
    expect(m.coldTick(Date.now() + DAY)).toBe(0);
  }, 20_000);
});
