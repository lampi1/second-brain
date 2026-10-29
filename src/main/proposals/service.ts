// Memoria → Proposte in main (ADR 0123): every card the user decides, gathered from the sources (sources.ts) in one list,
// newest first; a decision is checked against a fresh read of its source (still open, that side still possible) and run
// through the source's own path; the count for the sidebar badge, pushed as proposals:changed when it changes (after a
// decision, an event of a source, or the minute's check). The "Tieni" marks on applied changes are kept in userData
// (proposals-reviewed.json, small: 60 days at most). Skill and rule proposals from the app's other parts appear only
// once the user presses «Manutenzione» (heldBack, ADR 0153). Every decision goes to the ledger (ledger.ts, ADR 0193);
// a card whose group the user always approves is applied by itself through the same source.decide, logged, written to
// the activity journal and listed in «Applicate da sole» with Annulla; every card still shown says why it is asked
// (policy.ts). Used by index.ts; unit tests: test/unit/proposals/service.test.ts, test/unit/proposals/policy.test.ts.
import path from 'node:path';
import { sortProposals, type Proposal, type ProposalAutoApplied, type ProposalDecide, type ProposalDecideResult, type ProposalDecision, type ProposalGroupPolicy, type ProposalKeep, type ProposalSource, type ProposalsState } from '../../shared/proposals';
import type { LogInput } from '../../shared/activity-log';
import { readLocal, writeLocal } from '../agents/local-store';
import { logEvent } from '../activity/journal';
import { log, errText } from '../log';
import { DecisionLedger, type DecisionEntry } from './ledger';
import { autoNow, cardSize, groupPolicy, hasEvidence, policyLine, reversible, savedThisWeek, whyAsked } from './policy';
import { SOURCES, shortPath, type ProposalPorts, type Source } from './sources';

const KEEP_MS = 60 * 86_400_000;

/** The Tieni marks: change id → when the user kept it. */
export class ReviewedMarks {
  private readonly file: string;
  private marks: Record<string, number>;
  constructor(userData: string, private readonly now: () => number = Date.now) {
    this.file = path.join(userData, 'proposals-reviewed.json');
    const raw = readLocal(this.file) as { marks?: Record<string, unknown> } | undefined;
    this.marks = {};
    for (const [id, at] of Object.entries(raw?.marks ?? {})) if (typeof at === 'number' && /^[\w-]{1,80}$/.test(id)) this.marks[id] = at;
  }
  has(id: string): boolean { return id in this.marks; }
  mark(id: string): void {
    const cut = this.now() - KEEP_MS;
    this.marks = Object.fromEntries(Object.entries({ ...this.marks, [id]: this.now() }).filter(([, at]) => at >= cut));
    writeLocal(this.file, { version: 1, marks: this.marks });
  }
}

export interface ProposalsOptions {
  ports: Omit<ProposalPorts, 'reviewed'>;
  userData: string;
  /** the brain folder (files inside it are shown relative to it) */
  root?: () => string | null;
  /** the count changed */
  emit?: (count: number) => void;
  sources?: readonly Source[];
  /** when the user last pressed «Manutenzione» (ms; null = never): the skill and rule proposals the app's other parts
   *  make wait for it (ADR 0153); absent = nothing is held */
  clickAt?: () => number | null;
  /** the activity journal (the Log page): an auto-applied card is one line there; default the app's journal */
  record?: (e: LogInput) => void;
}
/** The «Applicate da sole» list: the newest auto-applied cards of the last two weeks. */
const AUTO_LIST = 20, AUTO_LIST_MS = 14 * 86_400_000;

/** The sources whose skill and rule proposals wait for the user's «Manutenzione» (ADR 0153): the skill candidates
 *  and the Battito's learned rules. The maintenance's own cards, applied changes, settings, trials and tiers do not. */
const HELD: readonly ProposalSource[] = ['candidate', 'pulse'];
/** A held card made after the last click: hidden until the next one. */
export const heldBack = (c: Proposal, clickAt: number | null): boolean =>
  HELD.includes(c.source) && (clickAt === null || Date.parse(c.provenance.at) > clickAt);

export class ProposalsService {
  private readonly ports: ProposalPorts;
  private readonly sources: readonly Source[];
  private last: number | null = null;
  private deciding = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private soon: NodeJS.Timeout | null = null;
  readonly ledger: DecisionLedger;
  /** when each card was first on top of the deck (proposals:shown), for the ledger's decision time */
  private readonly shownAt = new Map<string, number>();
  /** cards whose automatic approval failed: shown to the user, never retried by itself */
  private readonly autoFailed = new Set<string>();
  /** an approved revert card is rolling its change back now (apply) */
  private appReverting = 0;
  constructor(private readonly o: ProposalsOptions) {
    this.ports = { ...o.ports, reviewed: new ReviewedMarks(o.userData, o.ports.now) };
    this.sources = o.sources ?? SOURCES;
    this.ledger = new DecisionLedger(o.userData, o.ports.now);
  }

  /** One list at a time: two reads at once could apply the same obvious card twice. */
  private listing: Promise<unknown> = Promise.resolve();
  async list(): Promise<ProposalsState> {
    const next = this.listing.then(() => this.listNow());
    this.listing = next.catch(() => {});
    return next;
  }
  private async listNow(): Promise<ProposalsState> {
    const root = this.o.root?.() ?? null;
    const read = await Promise.allSettled(this.sources.map(s => (s.available(this.ports) ? s.list(this.ports) : Promise.resolve([]))));
    const problems: ProposalSource[] = [], items: Proposal[] = [];
    read.forEach((r, i) => {
      if (r.status === 'fulfilled') { const at = this.o.clickAt ? this.o.clickAt() : undefined; items.push(...(at === undefined ? r.value : r.value.filter(c => !heldBack(c, at)))); }
      else { problems.push(this.sources[i]!.id); log.warn('proposals', 'source not read', { data: { source: this.sources[i]!.id }, cause: errText(r.reason), hint: 'the deck shows the other sources; it reads this one again next time' }); }
    });
    for (const it of items) if (it.provenance.files) it.provenance.files = it.provenance.files.map(f => shortPath(f, root));
    // the obvious ones go by themselves (ADR 0193); each one still shown says why it is asked
    // per group and source: «Tieni» on applied changes never builds trust for new research cards
    const policy = new Map<string, ProposalGroupPolicy>(), ledger = this.ledger.all();
    const policyOf = (c: Proposal): ProposalGroupPolicy => {
      const key = `${c.group}|${c.source}`;
      if (!policy.has(key)) policy.set(key, groupPolicy(c.group, ledger, c.source));
      return policy.get(key)!;
    };
    const shown: Proposal[] = [];
    for (const c of sortProposals(items)) {
      const p = policyOf(c);
      if (!this.autoFailed.has(c.id) && autoNow(c, p) && await this.autoApply(c, p)) continue;
      shown.push({ ...c, why: whyAsked(c, p) });
    }
    const state: ProposalsState = { items: shown, problems, at: this.ports.now(), auto: this.autoList(), saved: savedThisWeek(this.ledger.all(), this.ports.now()) };
    this.seen(state.items.length);
    return state;
  }
  async count(): Promise<number> { return (await this.list()).items.length; }

  /** The user's decision: only on a card that is open now, only on a side that is possible now. */
  async decide(arg: ProposalDecide): Promise<ProposalDecideResult> {
    const id = typeof arg?.id === 'string' ? arg.id : '', decision = arg?.decision;
    const note = typeof arg?.note === 'string' ? arg.note.slice(0, 1000) : undefined;
    const keep = arg?.keep === 'new' || arg?.keep === 'both' ? arg.keep : undefined;
    const shown = Array.isArray(arg?.conflicts) ? arg.conflicts.filter((x): x is string => typeof x === 'string').slice(0, 50) : undefined;
    const fail = async (error: string): Promise<ProposalDecideResult> => ({ ok: false, error, state: await this.list() });
    if (!id || id.length > 300 || (decision !== 'approve' && decision !== 'reject')) return fail('Richiesta non valida.');
    const source = this.sources.find(s => id.startsWith(`${s.id}:`));
    if (!source || !source.available(this.ports)) return fail('Fonte della proposta non disponibile.');
    if (this.deciding.has(id)) return fail('Decisione già in corso su questa proposta.');
    this.deciding.add(id);
    try {
      const card = (await source.list(this.ports)).find(c => c.id === id);
      if (!card) return await fail('La proposta non è più da decidere: forse è già stata decisa altrove.');
      if (decision === 'approve' ? !card.canApprove : !card.canReject) return await fail('Questa scelta non è più possibile su questa proposta.');
      if (typeof arg.seen === 'string' && arg.seen !== card.content) return await fail('La proposta è cambiata mentre la leggevi: guardala di nuovo prima di decidere.');
      await this.apply(source, card, decision, 'user', note, keep && { keep, shown: shown ?? [] });
      log.info('proposals', 'decided by the user', { data: { source: card.source, decision, applied: card.applied } });
      return { ok: true, state: await this.list() };
    } catch (e) {
      const why = errText(e).split('\n')[0]!.slice(0, 300);
      log.warn('proposals', 'decision not applied', { data: { source: source.id, decision }, cause: why, hint: 'the card stays in the deck; the source refused it' });
      return fail(why || 'Decisione non applicata.');
    } finally { this.deciding.delete(id); }
  }

  /** The decision through the card's own source, then one ledger entry (a ledger problem never undoes the decision). */
  private async apply(source: Source, card: Proposal, decision: ProposalDecision, by: DecisionEntry['by'], note?: string, choice?: { keep: ProposalKeep; shown: string[] }): Promise<void> {
    // a «riuscito se» revert rolls a change back through the change log: the app's own check, never the user's undo of
    // the decision that made it (changeUndone ignores rollbacks while it runs)
    const revert = decision === 'approve' && card.ask.kind === 'research' && card.ask.finding === 'revert';
    if (revert) this.appReverting++;
    let made: string[] | void;
    try { made = await source.decide(this.ports, card, decision, note, choice); } finally { if (revert) this.appReverting--; }
    const first = this.shownAt.get(card.id), now = this.ports.now();
    this.shownAt.delete(card.id);
    try {
      this.ledger.add({
        card: card.id, at: now, source: card.source, group: card.group, ask: card.ask.kind, applied: card.applied, reversible: reversible(card),
        evidence: hasEvidence(card), size: cardSize(card), decision, by, title: card.title,
        ...(by === 'user' && first !== undefined ? { ms: Math.max(0, now - first) } : {}),
        ...(made?.length ? { changes: made } : {}), ...(card.ask.kind === 'policy' ? { domain: card.ask.domain } : {}),
      });
    } catch (e) { log.warn('proposals', 'decision not recorded', { data: { source: card.source }, cause: errText(e), hint: 'the decision is applied; the policy does not count it' }); }
  }

  /** An obvious card (its group's policy says so): approved through the same source path as the user's, logged. */
  private async autoApply(card: Proposal, p: ProposalGroupPolicy): Promise<boolean> {
    const source = this.sources.find(s => s.id === card.source);
    if (!source || this.deciding.has(card.id)) return false;
    this.deciding.add(card.id);
    try {
      // read again from its source, as decide does: still open, unchanged, approve side still possible
      const fresh = (await source.list(this.ports)).find(c => c.id === card.id);
      if (!fresh || !fresh.canApprove || fresh.content !== card.content) return false;
      await this.apply(source, card, 'approve', 'auto');
      const reason = policyLine(p);
      log.info('proposals', 'auto-applied', { data: { group: card.group, source: card.source, reason } });
      (this.o.record ?? logEvent)({ kind: 'brain', level: 'info', title: `Proposta applicata da sola: ${card.title}`,
        text: `Su questo tipo hai detto sì ${p.yes} volte su ${p.n}. Si annulla da Memoria → Proposte, «Applicate da sole».` });
      return true;
    } catch (e) {
      this.autoFailed.add(card.id);
      log.warn('proposals', 'auto-apply failed', { data: { group: card.group, source: card.source }, cause: errText(e).split('\n')[0]!.slice(0, 300), hint: 'the card stays in the deck for the user to decide' });
      return false;
    } finally { this.deciding.delete(card.id); }
  }

  /** The deck shows this card on top now (the first time counts). */
  shown(id: unknown): void {
    if (typeof id !== 'string' || !id || id.length > 300 || this.shownAt.has(id)) return;
    this.shownAt.set(id, this.ports.now());
    if (this.shownAt.size > 500) this.shownAt.delete(this.shownAt.keys().next().value!);
  }

  /** A change-log entry was rolled back (from anywhere: the deck, the Log, the feed): the decisions that made or kept
   *  it count as no from now on. */
  changeUndone(changeId: string): void {
    if (this.appReverting > 0) {
      log.info('proposals', 'change rolled back by an approved revert card', { data: { change: changeId } });
      this.changed();
      return;
    }
    const hit = this.ledger.changeUndone(changeId);
    if (!hit.length) return;
    log.info('proposals', 'approved change undone', { data: { groups: [...new Set(hit.map(e => e.group))], auto: hit.filter(e => e.by === 'auto').length } });
    this.changed();
  }

  /** Annulla on a card the app applied by itself: its changes rolled back newest first (or the loop's policy). */
  async undoAuto(arg: { id?: unknown } | undefined): Promise<ProposalDecideResult> {
    const id = typeof arg?.id === 'string' ? arg.id : '';
    const e = id ? this.ledger.get(id) : undefined;
    const fail = async (error: string): Promise<ProposalDecideResult> => ({ ok: false, error, state: await this.list() });
    if (!e || e.by !== 'auto') return fail('Richiesta non valida.');
    if (e.undoneAt !== undefined) return fail('Già annullata.');
    try {
      if (e.changes?.length) {
        if (!this.ports.changes) throw new Error('Registro delle modifiche non disponibile.');
        // a change already rolled back (from the Log, a revert card) is skipped: nothing left to undo there
        const gone = new Set(this.ports.changes.stored().filter(c => c.rolledBackAt !== undefined).map(c => c.id));
        for (const c of [...e.changes].reverse()) if (!gone.has(c)) await this.ports.changes.rollback(c);
      } else if (e.source === 'policy' && e.domain) {
        const r = await this.ports.policies?.act({ action: 'rollback', domain: e.domain });
        if (!r?.ok) throw new Error(r && !r.ok ? r.error : 'Ciclo di miglioramento non disponibile.');
      } else throw new Error('Questa proposta non si può annullare da qui.');
      this.ledger.markUndone(e.id);
      log.info('proposals', 'auto-applied undone by the user', { data: { group: e.group, source: e.source } });
      return { ok: true, state: await this.list() };
    } catch (err) {
      const why = errText(err).split('\n')[0]!.slice(0, 300);
      log.warn('proposals', 'auto-applied not undone', { data: { group: e.group, source: e.source }, cause: why, hint: 'the change may have been edited since: undo the newer change first, from the Log' });
      return fail(why || 'Non annullata.');
    }
  }

  /** The newest auto-applied cards, with whether Annulla still works. */
  private autoList(): ProposalAutoApplied[] {
    const since = this.ports.now() - AUTO_LIST_MS;
    const recent = this.ledger.all().filter(e => e.by === 'auto' && e.at >= since).slice(-AUTO_LIST).reverse();
    if (!recent.length) return [];
    let changes: { id: string; canRollback: boolean; rolledBackAt?: number }[] = [];
    try { changes = this.ports.changes?.list() ?? []; } catch { /* unreadable now: Annulla shows as not possible */ }
    // a change already rolled back elsewhere (the Log, a revert card): its entry shows as taken back, no Annulla
    const back = (e: DecisionEntry): number | undefined => {
      if (!e.changes?.length) return undefined;
      const at = e.changes.map(id => changes.find(c => c.id === id)?.rolledBackAt);
      return at.every(x => x !== undefined) ? Math.max(...(at as number[])) : undefined;
    };
    const undoable = (e: DecisionEntry): boolean => e.undoneAt === undefined && (e.changes?.length
      ? back(e) === undefined && e.changes.every(id => { const c = changes.find(x => x.id === id); return c?.canRollback === true || c?.rolledBackAt !== undefined; })
      : e.source === 'policy' && !!e.domain && !!this.ports.policies);
    return recent.map(e => {
      const undoneAt = e.undoneAt ?? back(e);
      return { id: e.id, card: e.card, source: e.source, group: e.group, title: e.title, at: e.at, ...(undoneAt !== undefined ? { undoneAt } : {}), canUndo: undoable(e) };
    });
  }

  /** A source said something changed: count again a moment later (several events in a row count once). */
  changed(): void {
    if (this.soon) return;
    this.soon = setTimeout(() => { this.soon = null; void this.list().catch(() => {}); }, 400);
    this.soon.unref?.();
  }
  /** The minute's check (settings proposals and the loop's status have no event of their own here). */
  start(everyMs = 60_000): void {
    if (this.timer) return;
    this.changed();
    this.timer = setInterval(() => this.changed(), everyMs);
    this.timer.unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); if (this.soon) clearTimeout(this.soon); this.timer = this.soon = null; }
  private seen(n: number): void { if (n === this.last) return; this.last = n; this.o.emit?.(n); }
}
