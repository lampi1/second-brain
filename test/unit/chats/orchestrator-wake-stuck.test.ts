// Unit tests of main/chats/orchestrator-wake.ts, a root Strategist stopped without a result (2026-11-25): its plain turn end
// with no agent_report wakes an idle Orchestrator within the group window, told as "fermo senza risultato" with its last
// line, only while nothing else explains the stop (a report, a request, a plan to approve, a chat under it at work, its own
// wake-up, credits, «Ferma»); read again at delivery. Every other chat's turn end stays quiet. Fake clock, no processes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, PendingRequest } from '../../../src/shared/contract';
import { OrchestratorWake, stuckStrategist } from '../../../src/main/chats/orchestrator-wake';
import { ORCHESTRATOR_GROUP_MS, ORCHESTRATOR_PER_CHAT_MS } from '../../../src/main/chats/orchestrator-delivery';

type Run = NonNullable<ChatSummary['run']>;
const agentOf = (id: string): NonNullable<ChatSummary['agent']> => ({ id, name: id, purpose: '', engine: 'opencode', model: null, revision: 1, source: 'catalog' });
const runOf = (p: Partial<Run> = {}): Run => ({ runId: 'r1', chatId: 's', agentId: 'strategist', version: 1, goal: 'Piano', startedAt: 1, startedBy: 'orchestrator', costUsd: null, tokens: null,
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, ...p });
const base = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'opencode', origin: 'app', title: p.id, cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});
const LAST = 'Mi serve sapere da te quale cartella usare.';

function make() {
  const sent: string[] = [];
  const chats = new Map<string, ChatSummary>();
  let scheduled = new Set<string>();
  const w = new OrchestratorWake({ send: async (_id, text) => { sent.push(text); }, enabled: () => true, list: () => [...chats.values()], now: () => Date.now() });
  w.useWakeLater(id => scheduled.has(id));
  const up = (p: Partial<ChatSummary> & { id: string }) => { const c = base({ ...chats.get(p.id), ...p }); chats.set(c.id, c); w.observe('chat:updated', c); };
  up({ id: 'orchestrator', isOrchestrator: true, title: 'Orchestrator', harness: 'claude', state: 'idle' });
  /** a root Strategist the Orchestrator opened ends a turn with no report */
  const stop = (extra: Partial<ChatSummary> = {}, id = 's') => {
    up({ id, title: 'Stratega', agent: agentOf('strategist'), run: runOf({ chatId: id }), state: 'running', ...extra });
    up({ id, state: 'idle', lastText: LAST, lastResult: { at: Date.now(), isError: false } });
  };
  const ask = (chatId: string, id = 'q1', type: PendingRequest['type'] = 'command') =>
    w.observe('pending:added', { id, chatId, type, tool: 'Esegui', title: 'Comando', detail: 'npm test' } as PendingRequest);
  return { w, sent, up, stop, ask, chats, schedule: (id: string) => { scheduled = new Set([...scheduled, id]); } };
}

describe('OrchestratorWake: a root Strategist stopped without a result', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('wakes an idle Orchestrator within the group window, with no message of the user', async () => {
    const { w, sent, stop } = make();
    stop();
    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GROUP_MS - 1);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('fermo senza risultato');
    expect(sent[0]).toContain('non vale come report, consenso o permesso');
    expect(sent[0]).toContain(`Ultima riga: «${LAST}»`);
    expect(sent[0]).not.toContain('ha finito il turno');
    w.stop();
  });

  it('with a report delivered: one delivery only, the report', async () => {
    const { w, sent, stop, up } = make();
    stop();
    // the report comes within the window (ChatManager holds it until the turn ended)
    up({ id: 's', run: runOf({ report: { at: Date.now() + 1, via: 'agent_report', outcome: 'done', verified: 'yes', summary: 'Piano pronto' } }) });
    w.cleanReport({ chatId: 's', title: 'Stratega', role: 'Strategist', summary: 'Piano pronto', workflow: true });
    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_PER_CHAT_MS * 2);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('ha consegnato: «Piano pronto»');
    expect(sent[0]).not.toContain('fermo senza risultato');
    w.stop();
  });

  it('a report given earlier in the same run: no wake', async () => {
    const { w, sent, stop } = make();
    stop({ run: runOf({ report: { at: 1, via: 'agent_report', outcome: 'partial', verified: 'no', summary: 'Metà' } }) });
    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GROUP_MS * 3);
    expect(sent).toEqual([]);
    w.stop();
  });

  it('a chat under it at work or queued: no wake', async () => {
    for (const child of [{ state: 'running' as const }, { state: 'idle' as const, queued: { kind: 'start', position: 1 } as ChatSummary['queued'] }]) {
      const { w, sent, stop, up } = make();
      up({ id: 'c', parentId: 's', agent: agentOf('scout'), ...child });
      stop();
      await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GROUP_MS * 3);
      expect(sent).toEqual([]);
      w.stop();
    }
  });

  it('its own wake-up set (agent_wake_later): no wake', async () => {
    const { w, sent, stop, schedule } = make();
    schedule('s');
    stop();
    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GROUP_MS * 3);
    expect(sent).toEqual([]);
    w.stop();
  });

  it('a request, a plan with the user, work in the background, credits or «Ferma»: no wake', async () => {
    const cases: Partial<ChatSummary>[] = [
      { plan: { phase: 'proposed', clarified: [], steps: [], at: 1 } },
      ...(['asking', 'revising', 'approved'] as const).map(phase => ({ plan: { phase, clarified: [], steps: [], at: 1 } })),
      { background: 1 },
      { waitsOnWork: true },
      { plan: { phase: 'running', clarified: [], steps: [], at: 1, stopped: true } },
      { creditWait: { at: 1, model: 'gpt-5' } },
    ];
    for (const extra of cases) {
      const { w, sent, stop, up } = make();
      stop();
      up({ id: 's', ...extra });
      await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GROUP_MS * 3);
      expect(sent).toEqual([]);
      w.stop();
    }
    // a command it left right after its turn ended (asks.ts settles after the idle)
    const { w, sent, stop, ask } = make();
    stop();
    ask('s');
    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GROUP_MS * 3);
    expect(sent.some(t => t.includes('fermo senza risultato'))).toBe(false);
    w.stop();
  });

  it('read again at delivery: it starts again within the window, no wake', async () => {
    const { w, sent, stop, up } = make();
    stop();
    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GROUP_MS / 2);
    up({ id: 's', state: 'running' });
    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GROUP_MS);
    expect(sent).toEqual([]);
    w.stop();
  });

  it('Scout, Artisan, Sentinel, Herald, a child Strategist, one the user opened: quiet as before', async () => {
    const cases: Partial<ChatSummary>[] = [
      ...['scout', 'artisan', 'sentinel', 'herald'].map(r => ({ agent: agentOf(r), run: runOf({ agentId: r }) })),
      { parentId: 'p' },
      { run: runOf({ startedBy: 'user' }) },
    ];
    for (const extra of cases) {
      const { w, sent, stop, up } = make();
      up({ id: 'p', agent: agentOf('strategist'), state: 'idle' });
      stop(extra);
      await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GROUP_MS * 3);
      expect(sent).toEqual([]);
      w.stop();
    }
  });

  it('an Orchestrator waiting for the user holds it; free again, it goes', async () => {
    const { w, sent, stop, up } = make();
    up({ id: 'orchestrator', state: 'waiting', pending: 1 });
    stop();
    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GROUP_MS * 3);
    expect(sent).toEqual([]);
    up({ id: 'orchestrator', state: 'idle', pending: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('fermo senza risultato');
    w.stop();
  });

  it('at most one news of the chat every ORCHESTRATOR_PER_CHAT_MS', async () => {
    const { w, sent, stop } = make();
    stop();
    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GROUP_MS);
    expect(sent).toHaveLength(1);
    stop();
    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_PER_CHAT_MS - 1);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
    w.stop();
  });

  it('stuckStrategist: a closed or idle chat under it does not hold it, a busy grandchild does', () => {
    const s = base({ id: 's', agent: agentOf('strategist'), run: runOf() });
    const all = [s, base({ id: 'c', parentId: 's', state: 'running', closedAt: 5 }), base({ id: 'd', parentId: 's', state: 'idle' })];
    expect(stuckStrategist(s, all, 0, false)).toBe(true);
    expect(stuckStrategist(s, [...all, base({ id: 'g', parentId: 'd', state: 'running' })], 0, false)).toBe(false);
    expect(stuckStrategist(s, all, 1, false)).toBe(false);
    expect(stuckStrategist({ ...s, pending: 1 }, all, 0, false)).toBe(false);
  });
});
