// The feed events of the app's own improvement work (ADR 0102: the app shows what it does by itself), built from what
// the jobs return, zero tokens: a maintenance pass the app ran by itself that changed skills, roles, rules or memory is
// one quiet "Ruolo aggiornato" (agent-updated, notification center only) with "Annulla" (the whole pass, newest change
// first: brainmodel:rollback); the daily step or a trial evaluation that adds entries to "Da approvare" is one normal
// "Proposta su un ruolo" (agent-proposal) leading there. Neither is ever a toast (ADR 0022). Used by wiring.ts (and
// demo-wiring.ts); pinned by test/unit/brain/announce.test.ts.
import type { BrainChange } from '../../shared/brain-model';
import type { AgentLifecycleProposal } from '../../shared/agent-lifecycle';
import type { FeedInput } from '../services';

/** an undo names at most this many changes (a bigger pass is undone from the Skill page's change log) */
export const UNDO_MAX = 20;
const KIND: Record<BrainChange['kind'], string> = { skill: 'skill', agent: 'ruolo', rule: 'regola', memory: 'memoria' };

export function maintenanceEvent(changes: readonly BrainChange[]): FeedInput | null {
  if (!changes.length) return null;
  const newest = [...changes].sort((a, b) => b.at - a.at);
  const title = changes.length === 1 ? newest[0]!.summary : `La manutenzione ha cambiato ${changes.length} cose`;
  const counts = Object.entries(changes.reduce<Record<string, number>>((m, c) => ({ ...m, [KIND[c.kind]]: (m[KIND[c.kind]] ?? 0) + 1 }), {}))
    .map(([k, n]) => `${n} ${k}`).join(' · ');
  const detail = changes.length === 1 ? newest[0]!.reason : `${counts}: ${newest.slice(0, 3).map(c => c.summary).join('; ')}${changes.length > 3 ? '…' : ''}`;
  const undoable = newest.filter(c => c.canRollback).slice(0, UNDO_MAX).map(c => c.id);
  return { kind: 'agent-updated', title, detail, ...(undoable.length && changes.length <= UNDO_MAX ? { action: { kind: 'brain-undo', ids: undoable } } : {}) };
}

export function proposalEvent(added: readonly AgentLifecycleProposal[], name: (agentId: string) => string): FeedInput | null {
  if (!added.length) return null;
  const who = [...new Set(added.flatMap(p => p.agentIds.map(name)))].slice(0, 3).join(', ');
  const title = added.length === 1 ? `Da approvare: ${who}` : `${added.length} proposte da approvare · ${who}`;
  return { kind: 'agent-proposal', title, detail: added.map(p => p.reason).filter(Boolean).slice(0, 2).join(' · '), action: { kind: 'agent-proposals' } };
}
