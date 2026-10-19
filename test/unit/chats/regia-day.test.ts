// «Orchestrators corte» (chats/continuity.ts regiaDayDue, ADR 0051): the pure rule (an Orchestrator on Claude, idle a few minutes, with a long
// context begun on an earlier Rome day, once a day) and the ChatManager flow on the fake Claude engine: one quiet
// `/compact` turn, the engine's «Contesto compattato» line in the tile, same chat and session, nothing else shown; never
// twice a day, never a work chat, never with the setting off; a restart keeps when the context began.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import { REGIA_COMPACT, REGIA_DAY_IDLE_MS, REGIA_DAY_MIN, regiaDayDue, romeDay, type RegiaDayView } from '../../../src/main/chats/continuity';
import { FAKE, recEmitter, tmp, waitFor } from './helpers';

const DAY = 86_400_000;
// 2026-10-14 08:00 in Rome; yesterday evening and today in the morning
const NOW = Date.parse('2026-10-14T06:00:00Z');
const v: RegiaDayView = {
  harness: 'claude', isRegia: true, state: 'idle', pending: 0, busy: false, alive: true, handoffTurn: false,
  contextTokens: 180_000, lastTurnAt: NOW - REGIA_DAY_IDLE_MS, ctxSince: Date.parse('2026-10-13T18:00:00Z'), askedOn: undefined,
};

describe('regia day rule', () => {
  it('a Regia with a context from yesterday, idle a few minutes, compacts once today', () => {
    expect(romeDay(Date.parse('2026-10-13T22:30:00Z'))).toBe('2026-10-14'); // past midnight in Rome
    expect(regiaDayDue(v, NOW)).toBe(true);
    for (const x of [
      { isRegia: false }, { harness: 'cursor' }, { state: 'running' }, { pending: 1 }, { busy: true }, { alive: false }, { handoffTurn: true },
      { contextTokens: REGIA_DAY_MIN - 1 }, { lastTurnAt: NOW - REGIA_DAY_IDLE_MS + 1 }, { ctxSince: undefined },
      { ctxSince: Date.parse('2026-10-13T22:30:00Z') }, { askedOn: '2026-10-14' },
    ] satisfies Partial<RegiaDayView>[]) expect(regiaDayDue({ ...v, ...x }, NOW), JSON.stringify(x)).toBe(false);
    expect(regiaDayDue({ ...v, askedOn: '2026-10-13' }, NOW)).toBe(true);
  });

  it('the summary keeps what the Regia needs to go on', () => {
    expect(REGIA_COMPACT.startsWith('/compact ')).toBe(true);
    for (const w of ['chats you coordinate', 'questions for the user', 'decisions', 'background', "user's language"]) expect(REGIA_COMPACT).toContain(w);
  });
});

const managers: ChatManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

function setup(extra: Partial<ChatManagerOptions> = {}) {
  const userData = tmp('ud'), home = tmp('home'), cwd = tmp('cwd');
  const make = () => {
    const m = new ChatManager({
      emitter: recEmitter(), userData, enginePaths: { claude: FAKE }, claudeHome: home, env: { CLAUDE_CONFIG_DIR: home },
      compactWindowTokens: () => 200_000, coldHandoff: () => false, coldEveryMs: 0, regiaDayCompact: () => true, ...extra,
    });
    managers.push(m);
    return m;
  };
  return { userData, cwd, make };
}
const summary = (m: ChatManager, id: string) => m.list().find(c => c.id === id);
const idle = (m: ChatManager, id: string) => summary(m, id)?.state === 'idle' && !m.items(id).at(-1)?.id.startsWith('u');

describe('ChatManager Regia day compaction', () => {
  it('the next day a long Regia compacts quietly in the same session; a work chat never', async () => {
    const { make, cwd, userData } = setup();
    const m = make();
    const regia = await m.create({ harness: 'claude', cwd, regia: true, prompt: 'big' });
    const work = await m.create({ harness: 'claude', cwd, prompt: 'big', regiaOf: regia.id });
    await waitFor(() => idle(m, regia.id) && idle(m, work.id) && summary(m, regia.id)?.contextTokens === 250_000 && summary(m, work.id)?.contextTokens === 250_000, 'both long and idle');
    expect(m.coldTick()).toBe(0); // today: its context began today
    const before = m.items(regia.id).length, sid = summary(m, regia.id)!.sessionId;
    const tomorrow = Date.now() + DAY;
    expect(m.coldTick(tomorrow)).toBe(1);
    await waitFor(() => m.items(regia.id).some(i => i.kind === 'system' && (i.code === 'compacted' || /Context compacted/.test(i.text))), 'compacted');
    await waitFor(() => summary(m, regia.id)?.contextTokens === 30_000 && idle(m, regia.id), 'smaller context reported');
    const added = m.items(regia.id).slice(before);
    // only the app's line and the engine's: no user message, no answer
    expect(added.every(i => i.kind === 'system')).toBe(true);
    expect(added.some(i => i.kind === 'system' && i.code === 'dayCompactStart')).toBe(true);
    expect(summary(m, regia.id)).toMatchObject({ sessionId: sid, isRegia: true });
    expect(summary(m, work.id)?.regiaOf).toBe(regia.id); // the chats it follows still answer to it
    expect(m.coldTick(tomorrow + 10 * 60_000)).toBe(0); // once a day
    // its context now begins at the compaction (saved): the day after tomorrow it is long again only if it grows
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'chats.json'), 'utf8')).chats.find((x: { id: string }) => x.id === regia.id);
    expect(saved.ctxSince).toBeGreaterThan(Date.now() - 60_000);
  }, 30_000);

  it('nothing with the setting off', async () => {
    const { make, cwd } = setup({ regiaDayCompact: () => false });
    const m = make();
    const regia = await m.create({ harness: 'claude', cwd, regia: true, prompt: 'big' });
    await waitFor(() => idle(m, regia.id) && summary(m, regia.id)?.contextTokens === 250_000, 'long and idle');
    expect(m.coldTick(Date.now() + DAY)).toBe(0);
  }, 20_000);
});
