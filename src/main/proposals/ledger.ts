// The Proposte decision ledger (ADR 0193): one entry per decided card, the user's or the app's own (auto), with what
// the policy needs to learn which cards are obvious (source, group, ask kind, applied or not, reversible, verified
// evidence, size, the answer, the time from first shown to the decision) and, later, when an approved or auto-applied
// change was taken back (an undo counts as a no). Kept in userData (proposal-decisions.json, the last MAX entries,
// atomic writes through agents/local-store.ts); a corrupt file is moved aside (never overwritten) and the ledger starts
// empty, so the policy simply asks again. Used by proposals/service.ts and, read only, by brainmodel/research.ts (the
// data pack's «decisions» section); unit tests: test/unit/proposals/policy.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PROPOSAL_GROUPS, PROPOSAL_SOURCES, type ProposalDecision, type ProposalGroup, type ProposalSource } from '../../shared/proposals';
import { readLocal, writeLocal } from '../agents/local-store';
import { log, errText } from '../log';

export const LEDGER_FILE = 'proposal-decisions.json';
/** Entries kept: enough for every group's window (policy.ts POLICY.window) many times over. */
export const LEDGER_MAX = 2000;

export interface DecisionEntry {
  /** the entry's own id (proposals:undoAuto) */
  id: string;
  /** the card's id (`<source>:<id>`) */
  card: string;
  at: number;
  source: ProposalSource;
  group: ProposalGroup;
  /** the card's ask.kind */
  ask: string;
  /** the card was already applied when decided (Tieni / Annulla) */
  applied: boolean;
  /** the change can be taken back from the app (change log or the loop's rollback) */
  reversible: boolean;
  /** the card carried verified evidence (runs whose result can be opened) */
  evidence: boolean;
  /** characters of content and code */
  size: number;
  decision: ProposalDecision;
  by: 'user' | 'auto';
  /** from the card first shown on top of the deck to the decision (user decisions the deck reported) */
  ms?: number;
  /** the change-log entries the decision made or kept (their rollback undoes it) */
  changes?: string[];
  /** an improvement-loop policy's domain (its undo is learn:act rollback) */
  domain?: string;
  /** the card's title, short (the «Applicate da sole» list) */
  title: string;
  /** when an approved or auto-applied change was taken back */
  undoneAt?: number;
}

const str = (v: unknown, n: number): string | null => (typeof v === 'string' && v.length <= n ? v : null);
/** One stored entry, checked field by field; null = dropped. */
function valid(x: unknown): DecisionEntry | null {
  if (!x || typeof x !== 'object') return null;
  const e = x as Record<string, unknown>;
  const id = str(e.id, 80), card = str(e.card, 300), ask = str(e.ask, 40), title = str(e.title, 200);
  if (!id || !card || ask === null || title === null || typeof e.at !== 'number' || !Number.isFinite(e.at)) return null;
  if (!PROPOSAL_SOURCES.includes(e.source as ProposalSource) || !PROPOSAL_GROUPS.includes(e.group as ProposalGroup)) return null;
  if (e.decision !== 'approve' && e.decision !== 'reject') return null;
  if (e.by !== 'user' && e.by !== 'auto') return null;
  const changes = Array.isArray(e.changes) ? e.changes.filter((c): c is string => typeof c === 'string' && c.length <= 80).slice(0, 20) : undefined;
  return {
    id, card, at: e.at, source: e.source as ProposalSource, group: e.group as ProposalGroup, ask, title,
    applied: e.applied === true, reversible: e.reversible === true, evidence: e.evidence === true,
    size: typeof e.size === 'number' && Number.isFinite(e.size) ? Math.max(0, Math.round(e.size)) : 0,
    decision: e.decision, by: e.by,
    ...(typeof e.ms === 'number' && Number.isFinite(e.ms) && e.ms >= 0 ? { ms: Math.round(e.ms) } : {}),
    ...(changes?.length ? { changes } : {}),
    ...(str(e.domain, 60) ? { domain: e.domain as string } : {}),
    ...(typeof e.undoneAt === 'number' && Number.isFinite(e.undoneAt) ? { undoneAt: e.undoneAt } : {}),
  };
}

/** The entries in a ledger file; a missing or unreadable file reads as none (read only: never moves anything). */
export function readLedger(userData: string): DecisionEntry[] {
  try { return parse(readLocal(path.join(userData, LEDGER_FILE))); } catch { return []; }
}
const parse = (raw: unknown): DecisionEntry[] => {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries) ? (raw as { entries: unknown[] }).entries : [];
  return list.map(valid).filter((e): e is DecisionEntry => e !== null).slice(-LEDGER_MAX);
};

export class DecisionLedger {
  private readonly file: string;
  private entries: DecisionEntry[] = [];
  constructor(userData: string, private readonly now: () => number = Date.now) {
    this.file = path.join(userData, LEDGER_FILE);
    try { this.entries = parse(readLocal(this.file)); }
    catch (e) {
      // a broken file is kept beside (never overwritten): the policy starts again from no data and asks
      const aside = `${this.file}.corrupt-${this.now()}`;
      try { fs.renameSync(this.file, aside); } catch { /* gone or locked: the next write replaces nothing it could not read */ }
      log.warn('proposals', 'decision ledger not read', { cause: errText(e), data: { kept: path.basename(aside) }, hint: 'the broken file was moved aside; the Proposte deck asks every card again until new decisions are recorded' });
      this.entries = [];
    }
  }
  all(): readonly DecisionEntry[] { return this.entries; }
  get(id: string): DecisionEntry | undefined { return this.entries.find(e => e.id === id); }
  add(e: Omit<DecisionEntry, 'id' | 'at'> & { at?: number }): DecisionEntry {
    const at = e.at ?? this.now();
    const entry = valid({ ...e, at, id: `${at.toString(36)}-${randomBytes(3).toString('hex')}`, title: e.title.slice(0, 200) });
    if (!entry) throw new Error('Invalid decision entry.');
    this.entries = [...this.entries, entry].slice(-LEDGER_MAX);
    this.save();
    return entry;
  }
  /** Marks one entry undone (an approved or auto-applied change taken back); false = unknown or already undone. */
  markUndone(id: string, at = this.now()): boolean {
    const e = this.entries.find(x => x.id === id);
    if (!e || e.undoneAt !== undefined || e.decision !== 'approve') return false;
    e.undoneAt = at;
    this.save();
    return true;
  }
  /** A change-log entry was rolled back: the approved decisions that made or kept it are undone. Returns them. */
  changeUndone(changeId: string, at = this.now()): DecisionEntry[] {
    const hit = this.entries.filter(e => e.decision === 'approve' && e.undoneAt === undefined && e.changes?.includes(changeId));
    for (const e of hit) e.undoneAt = at;
    if (hit.length) this.save();
    return hit;
  }
  private save(): void {
    try { writeLocal(this.file, { version: 1, entries: this.entries }); }
    catch (e) { log.warn('proposals', 'decision ledger not saved', { cause: errText(e), hint: 'the decision is applied; the policy learns from it only while the app stays open' }); }
  }
}
