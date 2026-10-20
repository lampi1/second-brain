// The feed events of the app's own improvement work (src/main/brain/announce.ts, ADR 0102): one quiet "Ruolo aggiornato"
// per maintenance pass with an Annulla over its changes (newest first, only the ones that can still be undone, none for
// a pass too big to undo from the feed), one normal "Proposta su un ruolo" per batch of new "Da approvare" entries.
import { describe, expect, it } from 'vitest';
import type { BrainChange } from '../../../src/shared/brain-model';
import type { AgentLifecycleProposal } from '../../../src/shared/agent-lifecycle';
import { maintenanceEvent, proposalEvent, UNDO_MAX } from '../../../src/main/brain/announce';
import { feedAction, stamp } from '../../../src/main/brain/live';

const change = (id: string, at: number, p: Partial<BrainChange> = {}): BrainChange => ({ id, at, job: 'merge-skills', kind: 'skill', action: 'merge', target: 't', summary: `cambio ${id}`, reason: `perché ${id}`, evidence: [], canRollback: true, ...p });

describe('maintenanceEvent', () => {
  it('none for an empty pass; one change = its summary and reason', () => {
    expect(maintenanceEvent([])).toBeNull();
    expect(maintenanceEvent([change('aa11bb22cc33dd44', 1)])).toEqual({ kind: 'agent-updated', title: 'cambio aa11bb22cc33dd44', detail: 'perché aa11bb22cc33dd44', action: { kind: 'brain-undo', ids: ['aa11bb22cc33dd44'] } });
  });
  it('several changes: counted by kind, undone newest first, without the ones already moved on', () => {
    const e = maintenanceEvent([change('0000000000000001', 1), change('0000000000000002', 3, { kind: 'memory' }), change('0000000000000003', 2, { canRollback: false })]);
    expect(e?.title).toBe('La manutenzione ha cambiato 3 cose');
    expect(e?.detail).toMatch(/^2 skill · 1 memoria: /);
    expect(e?.action).toEqual({ kind: 'brain-undo', ids: ['0000000000000002', '0000000000000001'] });
  });
  it('a pass too big for one Annulla carries none (the Skill page undoes it)', () => {
    const many = Array.from({ length: UNDO_MAX + 1 }, (_, i) => change(i.toString(16).padStart(16, '0'), i));
    expect(maintenanceEvent(many)?.action).toBeUndefined();
  });
  it('the stamped event keeps its action, quiet, and the validator refuses a forged one', () => {
    const raw = maintenanceEvent([change('aa11bb22cc33dd44', 1)]);
    expect(raw).not.toBeNull();
    const e = stamp({ ...raw, kind: 'agent-updated', title: 'x' });
    expect(e).toMatchObject({ priority: 'quiet', label: 'Ruolo aggiornato', action: { kind: 'brain-undo', ids: ['aa11bb22cc33dd44'] } });
    expect(feedAction({ kind: 'brain-undo', ids: ['../../etc'] })).toBeUndefined();
    expect(feedAction({ kind: 'brain-undo', ids: [] })).toBeUndefined();
    expect(feedAction({ kind: 'brain-undo', ids: Array.from({ length: 21 }, () => 'aa11bb22cc33dd44') })).toBeUndefined();
  });
});

describe('proposalEvent', () => {
  const p = (key: string, agentIds: string[], reason: string): AgentLifecycleProposal => ({ key, kind: 'tier', agentIds, reason, evidence: [], at: 1, state: 'pending' });
  const names: Record<string, string> = { artisan: 'Artigiano', scout: 'Esploratore' };
  const name = (id: string) => names[id] ?? id;
  it('none without new entries; one entry names its role; more are counted; it leads to Da approvare', () => {
    expect(proposalEvent([], name)).toBeNull();
    expect(proposalEvent([p('k1', ['artisan'], 'costa meno')], name)).toEqual({ kind: 'agent-proposal', title: 'Da approvare: Artigiano', detail: 'costa meno', action: { kind: 'agent-proposals' } });
    expect(proposalEvent([p('k1', ['artisan'], 'a'), p('k2', ['scout'], 'b')], name)?.title).toBe('2 proposte da approvare · Artigiano, Esploratore');
    const one = proposalEvent([p('k1', ['artisan'], 'a')], name);
    expect(one && stamp({ ...one, title: one.title }).priority).toBe('normal');
  });
});
