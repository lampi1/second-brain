// The task estimate (ADR 0087): similar tasks in three tiers, the parts of a request, the fast path, the strips' view
// (an estimate made before the run started), the weekly accuracy backtest, the demo history and the Orchestrator's tool.
import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../../src/shared/agents';
import { actualOf, estimateTask, estimateTool, newRequest, ownRequest, partsOf, requestText, runEstimates, SimilarIndex, held, treeCosts } from '../../../src/main/agents/task-estimate';
import { estimateAccuracy, weekStart } from '../../../src/main/agents/estimate-accuracy';
import { checkRunIds, demoEstimateRuns, estimatesState, mergeRuns } from '../../../src/main/agents/run-estimates';

const MIN = 60_000, DAY = 86400_000;
let seq = 0;
const run = (p: Partial<AgentRun> & { agentId: string; goal: string; min?: number; usd?: number; at?: number }): AgentRun => {
  const id = `r_${(0xa00000000000 + seq++).toString(16)}`;
  const endedAt = p.at ?? 1_000 * DAY + seq * MIN;
  const ms = (p.min ?? 4) * MIN;
  return { runId: id, chatId: `c${seq}`, version: 1, startedBy: 'orchestrator', startedAt: endedAt - ms - MIN, endedAt, endReason: 'completed', executionMs: ms,
    costUsd: p.usd ?? 0.12, tokens: null, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, ...p } as AgentRun;
};
const fixes = (n: number, agentId = 'artisan', min = 4) => Array.from({ length: n }, (_, i) => run({ agentId, goal: `Correggi il bug ${i} del totale`, min: min + (i % 3) }));

describe('parts of a request', () => {
  it('counts list items, else the joins between steps', () => {
    expect(partsOf('Correggi il bug del totale')).toBe(1);
    expect(partsOf('- leggi i log\n- trova la causa\n- sistema il bug')).toBe(3);
    expect(partsOf('Trova la causa e poi sistemala; inoltre aggiorna la guida')).toBe(3);
    expect(partsOf('Fix the bug and then add a test')).toBe(2);
    expect(partsOf(Array.from({ length: 12 }, (_, i) => `${i + 1}. step`).join('\n'))).toBe(8);
  });
  it('counts a join only before an imperative, and a pasted block as one part (ADR 0182)', () => {
    expect(partsOf('guarda il log e poi dimmi cosa succede')).toBe(1);
    expect(partsOf('controlla poi se funziona anche su Safari')).toBe(1);
    expect(partsOf('Fix it then also the tests')).toBe(1);
    expect(partsOf('fai A; poi fai B')).toBe(2);
    const mail = 'Rispondi a questa mail in modo cortese\n\nDa: Mario Rossi\nOggetto: report\n\nCiao,\n- manca il totale\n- poi aggiungi il grafico\n- e controlla le date\nGrazie';
    expect(partsOf(mail)).toBe(1);
    expect(ownRequest(mail)).not.toMatch(/Mario/);
    expect(partsOf('Perché fallisce?\n```\n- a\n- b\n```\n> - c\n> - d')).toBe(1);
    expect(partsOf('Guarda questo log\n2026-10-29 10:00:01 Error: x; poi fai y\n2026-10-29 10:00:02 Error: z')).toBe(1);
  });
  it('estimates only a new request, never a short follow-up', () => {
    for (const t of ['sì', 'ok', 'Vai!', 'continua', 'va bene']) expect(newRequest(t, false), t).toBe(false);
    expect(newRequest('il secondo', true)).toBe(false);
    expect(newRequest('il secondo', false)).toBe(true);
    expect(newRequest('Correggi il bug del totale nella pagina ordini', true)).toBe(true);
  });
  it('drops the app\'s agent label before reading the request', () => {
    expect(requestText('[Messaggio di un agente tramite second-brain, non scritto dall\'utente]\n\nQuanti ordini?')).toBe('Quanti ordini?');
  });
});

describe('estimate from similar tasks', () => {
  it('uses the same agent and kind first, with median, middle half and confidence', () => {
    const e = estimateTask(new SimilarIndex(fixes(12)), { text: 'Correggi il bug dello sconto', agentId: 'artisan' });
    expect(e).toMatchObject({ kind: 'bug-fix', basis: 'agent-kind', n: 12, parts: 1, confidence: 'high', path: 'one-agent', quick: true });
    // elapsed 5..7 min (ADR 0182), times the kind's past actual/estimate ratio
    expect(e.timeMs).toBeGreaterThanOrEqual(5 * MIN);
    expect(e.timeMs).toBeLessThanOrEqual(8 * MIN);
    expect(e.timeLowMs).toBeLessThanOrEqual(e.timeMs!);
    expect(e.timeHighMs).toBeGreaterThanOrEqual(e.timeMs!);
    expect(e.costUsd).toBeCloseTo(0.12);
    expect(e.why).toMatch(/ONE agent/);
  });
  it('falls back to the kind on any agent, then to the agent on any kind, else gives no figure', () => {
    const runs = [...fixes(4, 'artisan'), ...Array.from({ length: 3 }, (_, i) => run({ agentId: 'sentinel', goal: `Esegui i test case ${i} in staging` }))];
    const idx = new SimilarIndex(runs);
    expect(estimateTask(idx, { text: 'Correggi il bug', agentId: 'sentinel' })).toMatchObject({ basis: 'kind', n: 4, confidence: 'high' }); // a tight spread
    expect(estimateTask(idx, { text: 'Scrivi la nota di rilascio', agentId: 'sentinel' })).toMatchObject({ basis: 'agent', n: 3 });
    const none = estimateTask(idx, { text: 'Scrivi la nota di rilascio', agentId: 'herald' });
    expect(none).toMatchObject({ basis: null, n: 0, timeMs: null, costUsd: null, confidence: null, path: 'one-agent' });
  });
  it('keeps at most the 30 most recent similar tasks and only those ended before `before`', () => {
    const runs = fixes(40);
    const idx = new SimilarIndex(runs);
    expect(estimateTask(idx, { text: 'fix bug', agentId: 'artisan' }).n).toBe(30);
    const cut = [...runs].sort((a, b) => a.endedAt! - b.endedAt!)[5]!.endedAt!;
    expect(estimateTask(idx, { text: 'fix bug', agentId: 'artisan', before: cut }).n).toBe(5);
  });
  it('picks the path: self for a short question, a tree for several parts or two slow ones', () => {
    const idx = new SimilarIndex([...fixes(5), ...Array.from({ length: 5 }, (_, i) => run({ agentId: 'scout', goal: `Quanti ordini ${i} ieri?`, min: 2 }))]);
    expect(estimateTask(idx, { text: 'Quanti ordini sono in sospeso?' }).path).toBe('self');
    expect(estimateTask(idx, { text: 'Quanti ordini sono in sospeso?' + ' x'.repeat(300) }).path).toBe('one-agent');
    expect(estimateTask(idx, { text: '- correggi il bug A\n- correggi il bug B\n- correggi il bug C' }).path).toBe('tree');
    expect(estimateTask(idx, { text: 'Correggi il bug A; poi correggi il bug B', agentId: 'artisan' }).path).toBe('one-agent'); // two quick parts
    const slow = new SimilarIndex(fixes(5, 'artisan', 60)), long = ` ${'nel modulo dei totali degli ordini '.repeat(12)}`;
    expect(estimateTask(slow, { text: 'Correggi il bug A; poi correggi il bug B', agentId: 'artisan' })).toMatchObject({ path: 'one-agent', quick: false }); // short: one agent
    expect(estimateTask(slow, { text: `Correggi il bug A${long}; poi correggi il bug B`, agentId: 'artisan' })).toMatchObject({ path: 'tree', quick: false });
    expect(estimateTask(slow, { text: 'Correggi il bug A', agentId: 'artisan' }).why).toMatch(/long/);
  });
  it('learns only from ended, measured, non one-shot runs', () => {
    const r = run({ agentId: 'a', goal: 'x' });
    expect(actualOf(r)).toEqual({ timeMs: 5 * MIN, costUsd: 0.12 }); // elapsed, waits included (ADR 0182)
    expect(actualOf({ ...r, endReason: 'closed' })).toEqual({ timeMs: 4 * MIN, costUsd: 0.12 }); // not completed: its execution time
    expect(actualOf(r, 0.5)).toEqual({ timeMs: 5 * MIN, costUsd: 0.5 }); // the tree's cost
    const kid = { ...run({ agentId: 'scout', goal: 'y', usd: 0.3 }), parentRunId: r.runId }, grandkid = { ...run({ agentId: 'scout', goal: 'z', usd: 0.1 }), parentRunId: kid.runId };
    expect(treeCosts([r, kid, grandkid]).get(r.runId)).toBeCloseTo(0.52);
    expect(actualOf({ ...r, endedAt: undefined })).toBeNull();
    expect(actualOf({ ...r, source: 'oneshot' })).toBeNull();
    expect(actualOf({ ...r, executionMs: undefined, endReason: 'stale', costUsd: null })).toBeNull();
    expect(actualOf({ ...r, executionMs: undefined, startedAt: r.endedAt! - 10 * MIN })).toMatchObject({ timeMs: 10 * MIN });
    expect(actualOf({ ...r, executionMs: undefined, startedAt: r.endedAt! - 9 * 3600_000 })).toMatchObject({ timeMs: null });
    expect(held(4, 8)).toBe(true); expect(held(4, 9)).toBe(false); expect(held(4, 1.9)).toBe(false);
  });
});

describe('the strips\' view', () => {
  it('estimates each run from the runs ended before it started, with the actual and the hit once ended', () => {
    const past = fixes(5);
    const open = run({ agentId: 'artisan', goal: 'Correggi il bug nuovo', at: 2_000 * DAY });
    const openRun = { ...open, endedAt: undefined, endReason: undefined };
    const ended = run({ agentId: 'artisan', goal: 'Correggi un altro bug', min: 30, at: 2_001 * DAY });
    const views = runEstimates([...past, openRun, ended], [openRun.runId, ended.runId, 'r_ffffffffffff']);
    expect(views[openRun.runId]).toMatchObject({ actual: null, hit: null, estimate: { basis: 'agent-kind', n: 5 } });
    expect(views[ended.runId]).toMatchObject({ actual: { timeMs: 31 * MIN }, hit: false, estimate: { n: 5 } }); // itself not counted
    expect(views['r_ffffffffffff']).toBeUndefined();
    expect(runEstimates(past.slice(0, 1), [past[0]!.runId])[past[0]!.runId]).toMatchObject({ estimate: null });
  });
  it('validates run ids and lays chat mirrors over the store', () => {
    expect(checkRunIds(undefined)).toEqual([]);
    expect(checkRunIds(['r_000000000001', 'r_000000000001'])).toEqual(['r_000000000001']);
    expect(() => checkRunIds(['chat-1'])).toThrow(/run ids/);
    expect(() => checkRunIds(Array.from({ length: 201 }, (_, i) => `r_${String(i).padStart(12, '0')}`))).toThrow();
    const a = run({ agentId: 'a', goal: 'x' });
    expect(mergeRuns([a], [undefined, { ...a, goal: 'y' }])).toEqual([{ ...a, goal: 'y' }]);
  });
});

describe('accuracy over the weeks', () => {
  it('backtests each ended run against what was known before it', () => {
    const now = Date.UTC(2026, 9, 19, 12);
    const at = (daysAgo: number) => now - daysAgo * DAY;
    const runs = [
      ...[50, 49, 48].map(d => run({ agentId: 'artisan', goal: 'Correggi il bug', min: 4, at: at(d) })),
      run({ agentId: 'artisan', goal: 'Correggi il bug', min: 40, at: at(20) }), // ten times: a miss
      run({ agentId: 'artisan', goal: 'Correggi il bug', min: 5, at: at(3) }), // a hit
      run({ agentId: 'artisan', goal: 'Correggi il bug', min: 6, at: at(2) }),
    ];
    const acc = estimateAccuracy(runs, now);
    expect(acc.points).toHaveLength(8);
    expect(acc.points.every((p, i, all) => i === 0 || p.weekStart > all[i - 1]!.weekStart)).toBe(true);
    expect(acc.n).toBe(3);
    expect(acc.hitRate).toBeCloseTo(2 / 3);
    expect(acc.hits).toBe(2); // k of n within ×2; no trend (ADR 0101)
    expect(acc).not.toHaveProperty('trend');
    const last = acc.points.filter(p => p.n).at(-1)!;
    expect(last).toMatchObject({ n: 2, hitRate: 1, specificShare: 1 });
    expect(estimateAccuracy([], now)).toMatchObject({ n: 0, hits: 0, hitRate: null });
  });
  it('weeks start on Monday, local time', () => {
    const w = new Date(weekStart(new Date(2026, 9, 22, 15).getTime()));
    expect([w.getDay(), w.getDate(), w.getHours()]).toEqual([1, 19, 0]);
  });
  it('the demo history is deterministic and has checked estimates', () => {
    const now = Date.UTC(2026, 9, 11, 8, 30);
    expect(demoEstimateRuns(now)).toEqual(demoEstimateRuns(now));
    const s = estimatesState(demoEstimateRuns(now), [], now);
    expect(s.accuracy.n).toBeGreaterThan(40);
    expect(s.accuracy.hits).toBeGreaterThan(0);
    expect(s.accuracy.hits).toBeLessThanOrEqual(s.accuracy.n);
  });
});

describe('task_estimate', () => {
  it('answers with the estimate and refuses bad input', async () => {
    const tool = estimateTool(() => fixes(6));
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(await tool.run({ request: 'Correggi il bug', agentId: 'artisan' })).toMatchObject({ basis: 'agent-kind', n: 6, path: 'one-agent' });
    expect(() => tool.run({ request: '' })).toThrow();
    expect(() => tool.run({ request: 'x', agentId: 'Bad Id' })).toThrow();
  });
});
