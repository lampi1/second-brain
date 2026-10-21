// Durable Battito admissions and actions: fake transports/capabilities, no real model or brain writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PulseService } from '../../../src/main/pulse/service';
import { PulseStore } from '../../../src/main/pulse/store';
import { admitRun, budgetState, type PulseRunRecord } from '../../../src/main/pulse/budget';
import { AgentRunStore } from '../../../src/main/agents/runs';
import { defaults } from '../../../src/main/brain/settings-schema';
import { fromSaved } from '../../../src/main/brain/config';
import { buildDigest, refExists } from '../../../src/main/pulse/digest';
import type { OneShotService } from '../../../src/main/agents/oneshot';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-service-')); dirs.push(dir);
  const settings = defaults(), at = new Date(2026, 9, 18, 13).getTime();
  const material = { now: '- prepare review', ideas: '', errors: '', journal: '', agents: [], chats: [], files: [] };
  const runOnce = vi.fn(async () => ({ ok: true, engine: 'claude', model: 'sonnet', costUsd: 0.01, costBasis: 'reported', tokens: null, durationMs: 1,
    text: JSON.stringify({ cards: [{ type: 'idea', title: 'Revisione pronta', body: 'Leggi il diff.', why: 'La revisione è aperta.', refs: ['d1'], places: ['board'] }] }) }));
  const saveIdea = vi.fn(async () => {}), act = vi.fn(async () => 'orchestrator'), approve = vi.fn(async () => {});
  const deps = { file: path.join(dir, 'pulse.json'), once: { runOnce, profile: () => ({}), pick: () => ({ id: 'claude' }), availability: () => [] } as unknown as OneShotService,
    runs: new AgentRunStore(dir), settings: () => settings, material: () => material, visible: () => true, calls: true, env: {},
    now: () => at, lang: () => 'it' as const, emit: vi.fn(), emitApprovals: vi.fn(), emitHeadline: vi.fn(), saveIdea, canSave: () => true, act, approve,
    legacyHeadline: () => ({ text: 'Cached joke', at, source: 'previous' as const, model: 'legacy', monthUsd: 0.3, monthCalls: 5 }) };
  return { deps, service: new PulseService(deps), runOnce, settings, material, saveIdea, act, at };
}
it('persists admissions, skips unchanged evidence and saves only on a user action', async () => {
  const f = fixture(); expect(await f.service.run('pulse')).toEqual({ ok: true });
  expect(f.saveIdea).not.toHaveBeenCalled();
  const card = f.service.list('board').cards[0]!;
  expect(card.title).toBe('Revisione pronta');
  const restarted = new PulseService(f.deps);
  expect(restarted.status().today.jobs.pulse.runs).toBe(1);
  expect(await restarted.run('pulse', 'slot2')).toMatchObject({ ok: false }); expect(f.runOnce).toHaveBeenCalledOnce();
  expect(await restarted.handlers()['pulse:save']({ id: card.id }, undefined as never)).toEqual({ ok: true });
  expect(f.saveIdea).toHaveBeenCalledOnce(); expect(restarted.list('board').cards).toEqual([]);
});
it('blocks real calls in tests and with the global switch off', async () => {
  const f = fixture(); const guarded = new PulseService({ ...f.deps, env: { VITEST: 'true' } });
  expect(await guarded.run('pulse')).toMatchObject({ ok: false });
  f.settings.pulse!.on = false; expect(await f.service.run('headline')).toMatchObject({ ok: false });
  expect(f.runOnce).not.toHaveBeenCalled();
});
it('filters search card types before applying the two-card cap', async () => {
  const f = fixture();
  f.runOnce.mockResolvedValue({ ok: true, engine: 'claude', model: 'sonnet', costUsd: 0.01, costBasis: 'reported', tokens: null, durationMs: 1,
    text: JSON.stringify({ cards: [
      { type: 'idea', title: 'Pianifica la settimana', body: 'Un piano.', why: 'Attività aperte.', refs: ['d1'], places: ['search'] },
      { type: 'collegamento', title: 'Note e revisione condividono un obiettivo', body: 'Un collegamento.', why: 'Revisione aperta.', refs: ['d1'], places: ['search'] },
      { type: 'curiosita', title: 'Un dettaglio da approfondire', body: 'Una curiosità.', why: 'Dal riepilogo.', refs: ['d1'], places: ['search'] },
    ] }) });
  expect(await f.service.run('pulse')).toEqual({ ok: true });
  expect(f.service.list('search').cards.map(c => c.type)).toEqual(['collegamento', 'curiosita']);
});
it('writes the Dashboard line in the day\'s first cards call only, and asks for card actions (ADR 0102)', async () => {
  const f = fixture();
  f.runOnce.mockResolvedValue({ ok: true, engine: 'claude', model: 'sonnet', costUsd: 0.01, costBasis: 'reported', tokens: null, durationMs: 1,
    text: JSON.stringify({ headline: 'Gli agenti lavorano, il caffè no.', cards: [{ type: 'promemoria', title: 'Rivedi la PR', body: 'La build è rossa.', why: 'Dal filo.', refs: ['d1'], places: ['board'], action: { kind: 'chat', prompt: 'Guarda la build rossa' } }] }) });
  expect(await f.service.run('pulse')).toEqual({ ok: true });
  const first = (f.runOnce.mock.calls[0] as unknown as [{ system: string; maxOutputTokens: number }])[0];
  expect(first.system).toContain('"headline"');
  expect(first.system).toContain('"action"');
  expect(f.service.headline()).toMatchObject({ text: 'Gli agenti lavorano, il caffè no.', source: 'model' });
  expect(f.service.list('board').cards[0]?.action).toEqual({ kind: 'chat', prompt: 'Guarda la build rossa' });
  f.material.now += '\n- a new thread'; // the digest changes: a second call that day
  await f.service.run('pulse', 'slot2');
  const second = (f.runOnce.mock.calls[1] as unknown as [{ system: string }])[0];
  expect(second.system).not.toContain('"headline"');
  // no headline job of its own any more: the scheduler has the cards only
  expect(f.service.pendingApprovals()).toBe(0);
});
it('keeps legacy headline opt-out unless new preference explicitly overrides it', () => {
  expect(fromSaved({ headlineOn: false }).pulse!.headline.on).toBe(false);
  expect(fromSaved({ headlineOn: false, pulse: { headline: { on: true } } }).pulse!.headline.on).toBe(true);
});
it('refuses a corrupt card ID before any path action', () => {
  const f = fixture(); fs.writeFileSync(f.deps.file, JSON.stringify({ version: 1, cards: [{ id: '../../outside' }], keys: [], runs: [], approvals: [], claims: {} }));
  expect(new PulseStore(f.deps.file).problem).not.toBeNull();
});
it('checks full evidence existence rather than its truncated prompt membership', () => {
  const f = fixture(), d = buildDigest(f.material), ref = d.entries[0]!.ref;
  f.material.now += '\n' + Array.from({ length: 20 }, (_, i) => `- later ${i}`).join('\n');
  expect(buildDigest(f.material).entries.some(e => e.ref.ref === ref.ref)).toBe(false);
  expect(refExists(ref, f.material)).toBe(true);
});
it('enforces independent allocations and counts unknown-cost calls against the run cap', () => {
  const f = fixture(); const records: PulseRunRecord[] = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, job: 'pulse', slot: `slot${i}`, at: f.at,
    engine: 'claude', usd: null, basis: 'unknown', result: 'failed', digestHash: '' }));
  expect(admitRun(records, 'pulse', 'claude', f.at, 0.25, false)).toBe(false);
  expect(admitRun(records, 'pulse', 'claude', f.at, 0.25, true)).toBe(true);
  records.push({ ...records[0]!, slot: 'manual' });
  expect(admitRun(records, 'pulse', 'claude', f.at, 0.25, true)).toBe(false);
  expect(budgetState(records, f.at, 0.25).basis).toBe('unknown');
  expect(admitRun([{ ...records[0]!, job: 'headline', usd: 0.05, basis: 'reported' }], 'headline', 'claude', f.at, 0.25, false)).toBe(false);
});
it('an Apply that fails says why, on screen and in the log, and leaves the proposal pending (#128)', async () => {
  const f = fixture();
  const approve = vi.fn(async () => { throw new Error('Il modello non è tra quelli noti del motore.'); });
  const service = new PulseService({ ...f.deps, approve });
  const data = (service as unknown as { store: PulseStore }).store.data;
  data.approvals.push({ id: 'pa_1', kind: 'learned-rule', agentId: 'pulse', title: 'Adatta Battito', text: 'Riduci le carte idea.', evidence: [], engine: null, createdAt: f.at, state: 'pending' });
  const decide = service.handlers()['approvals:decide'];
  expect(await decide({ id: 'pa_1', decision: 'approve' }, undefined as never)).toEqual({ ok: false, error: 'Proposta non applicata: Il modello non è tra quelli noti del motore.' });
  expect(data.approvals[0]!.state).toBe('pending');
  expect(await decide({ id: 'pa_1', decision: 'nope' as never }, undefined as never)).toEqual({ ok: false, error: 'Proposta non applicata.' });
});
