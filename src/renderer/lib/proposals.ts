// The Proposte deck's state in the renderer (ADR 0123): the open cards read from main (proposals:list), the badge
// number (proposals:count + the proposals:changed event), and this session's decisions. A decision is held for a few
// seconds before it goes to main (proposals:decide): the next decision, leaving the deck or the timer sends it, and Z /
// Ctrl+Z / «Annulla ultima» takes it back while it is held (nothing was applied yet). A refused decision brings its card
// back with the reason. The card on top is reported once (proposals:shown) and Annulla on a card the app applied by
// itself goes to proposals:undoAuto (ADR 0193). Used by components/brain-model/ProposalsDeck.tsx and the Memoria sidebar badge (Sidebar.tsx).
import { useEffect } from 'react';
import type { Proposal, ProposalDecision, ProposalGroup, ProposalKeep, ProposalsState } from '@shared/proposals';
import { PROPOSAL_GROUPS } from '@shared/proposals';
import { sb } from '../sb';
import { createStore } from '../store/createStore';

/** How long a decision waits before it is applied (Z takes it back meanwhile). */
export const HOLD_MS = 6000;

export interface Decided { card: Proposal; decision: ProposalDecision; note?: string; keep?: ProposalKeep; state: 'held' | 'sent' | 'done' }
export interface DeckState {
  data: ProposalsState | null;
  loading: boolean;
  error: string | null;
  /** main's count (the badge shows it minus a held decision) */
  count: number;
  /** this session's decisions, oldest first */
  decided: Decided[];
  /** the last refusal from main, shown on the deck */
  refused: { title: string; error: string } | null;
}
export const deck = createStore<DeckState>({ data: null, loading: false, error: null, count: 0, decided: [], refused: null });

let started = false, revision = 0, holdTimer: ReturnType<typeof setTimeout> | null = null;
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function refreshProposals(): Promise<void> {
  const mine = ++revision;
  deck.set(s => ({ ...s, loading: !s.data }));
  try {
    const data = await sb.invoke('proposals:list', undefined);
    if (mine === revision) deck.set(s => ({ ...s, data, loading: false, error: null, count: data.items.length }));
  } catch (e) { if (mine === revision) deck.set(s => ({ ...s, loading: false, error: errorText(e) })); }
}
function start(): void {
  if (started) return; started = true;
  sb.on('proposals:changed', ({ count }) => {
    deck.set(s => ({ ...s, count }));
    if (deck.get().data) void refreshProposals();
  });
  void sb.invoke('proposals:count', undefined).then(count => deck.set(s => ({ ...s, count })), () => {});
}

/** Sends the held decision to main now (if any). */
export async function flushDecision(): Promise<void> {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  const held = deck.get().decided.find(d => d.state === 'held');
  if (!held) return;
  const mark = (state: Decided['state']) => deck.set(s => ({ ...s, decided: s.decided.map(d => (d === held || (d.card.id === held.card.id && d.state !== 'done') ? { ...d, state } : d)) }));
  mark('sent');
  try {
    const r = await sb.invoke('proposals:decide', { id: held.card.id, decision: held.decision, seen: held.card.content, ...(held.note ? { note: held.note } : {}), ...(held.keep ? { keep: held.keep, conflicts: held.card.ask.kind === 'remember' ? (held.card.ask.conflicts ?? []).map(x => x.id) : [] } : {}) });
    deck.set(s => ({
      ...s, data: r.state, count: r.state.items.length,
      decided: r.ok ? s.decided.map(d => (d.card.id === held.card.id && d.state === 'sent' ? { ...d, state: 'done' as const } : d)) : s.decided.filter(d => !(d.card.id === held.card.id && d.state === 'sent')),
      refused: r.ok ? s.refused : { title: held.card.title, error: r.error },
    }));
  } catch (e) {
    deck.set(s => ({ ...s, decided: s.decided.filter(d => !(d.card.id === held.card.id && d.state === 'sent')), refused: { title: held.card.title, error: errorText(e) } }));
  }
}

/** The user's swipe, button or key: the previous held decision goes to main, this one is held. */
export function decide(card: Proposal, decision: ProposalDecision, note?: string, keep?: ProposalKeep): void {
  void flushDecision();
  deck.set(s => ({ ...s, refused: null, decided: [...s.decided, { card, decision, ...(note?.trim() ? { note: note.trim() } : {}), ...(keep ? { keep } : {}), state: 'held' }] }));
  holdTimer = setTimeout(() => { void flushDecision(); }, HOLD_MS);
}
/** Z / Ctrl+Z / «Annulla ultima»: the held decision back (its card on top again); false = nothing to take back. */
export function undoLast(): Proposal | null {
  const held = deck.get().decided.find(d => d.state === 'held');
  if (!held) return null;
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  deck.set(s => ({ ...s, decided: s.decided.filter(d => d !== held) }));
  return held.card;
}
export const canUndo = (s: DeckState): boolean => s.decided.some(d => d.state === 'held');

/** The card on top now, once per card (main keeps when it was first seen: ADR 0193's decision time). */
const reported = new Set<string>();
export function reportShown(id: string): void {
  if (reported.has(id)) return;
  reported.add(id);
  void sb.invoke('proposals:shown', { id }).catch(() => { reported.delete(id); });
}
/** Annulla on a card the app applied by itself (ADR 0193): its ledger id; a refusal shows like a decision's. */
export async function undoAuto(id: string, title: string): Promise<void> {
  try {
    const r = await sb.invoke('proposals:undoAuto', { id });
    deck.set(s => ({ ...s, data: r.state, count: r.state.items.length, refused: r.ok ? s.refused : { title, error: r.error } }));
  } catch (e) { deck.set(s => ({ ...s, refused: { title, error: errorText(e) } })); }
}
export const dismissRefusal = (): void => deck.set(s => ({ ...s, refused: null }));

/** The cards still to decide: main's open ones minus this session's decisions in flight. */
export function openCards(s: DeckState): Proposal[] {
  const out = new Set(s.decided.filter(d => d.state !== 'done').map(d => d.card.id));
  return (s.data?.items ?? []).filter(c => !out.has(c.id));
}
/** The filter chips: each group that has cards, with its count, in the fixed order. */
export function groupCounts(cards: readonly Proposal[]): { group: ProposalGroup; n: number }[] {
  return PROPOSAL_GROUPS.map(group => ({ group, n: cards.filter(c => c.group === group).length })).filter(g => g.n > 0);
}
export function tally(s: DeckState): { approved: number; rejected: number; rejectedCards: Proposal[] } {
  const live = s.decided;
  const rejectedCards = live.filter(d => d.decision === 'reject').map(d => d.card);
  return { approved: live.filter(d => d.decision === 'approve').length, rejected: rejectedCards.length, rejectedCards };
}

export function useDeck(): DeckState {
  useEffect(() => {
    start();
    void refreshProposals();
    // leaving the deck sends the held decision (it is the user's, already made)
    return () => { void flushDecision(); };
  }, []);
  return deck.use(s => s);
}
/** The Memoria sidebar badge: open proposals, a held decision already off the count. */
export function useProposalCount(): number {
  useEffect(start, []);
  return deck.use(s => Math.max(0, s.count - s.decided.filter(d => d.state === 'held').length));
}
