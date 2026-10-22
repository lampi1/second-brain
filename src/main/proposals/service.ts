// Memoria → Proposte in main (ADR 0123): every card the user decides, gathered from the sources (sources.ts) in one list,
// newest first; a decision is checked against a fresh read of its source (still open, that side still possible) and run
// through the source's own path; the count for the sidebar badge, pushed as proposals:changed when it changes (after a
// decision, an event of a source, or the minute's check). The "Tieni" marks on applied changes are kept in userData
// (proposals-reviewed.json, small: 60 days at most). Used by index.ts; unit tests: test/unit/proposals/service.test.ts.
import path from 'node:path';
import { sortProposals, type Proposal, type ProposalDecide, type ProposalDecideResult, type ProposalSource, type ProposalsState } from '../../shared/proposals';
import { readLocal, writeLocal } from '../agents/local-store';
import { log, errText } from '../log';
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
}

export class ProposalsService {
  private readonly ports: ProposalPorts;
  private readonly sources: readonly Source[];
  private last: number | null = null;
  private deciding = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private soon: NodeJS.Timeout | null = null;
  constructor(private readonly o: ProposalsOptions) {
    this.ports = { ...o.ports, reviewed: new ReviewedMarks(o.userData, o.ports.now) };
    this.sources = o.sources ?? SOURCES;
  }

  async list(): Promise<ProposalsState> {
    const root = this.o.root?.() ?? null;
    const read = await Promise.allSettled(this.sources.map(s => (s.available(this.ports) ? s.list(this.ports) : Promise.resolve([]))));
    const problems: ProposalSource[] = [], items: Proposal[] = [];
    read.forEach((r, i) => {
      if (r.status === 'fulfilled') items.push(...r.value);
      else { problems.push(this.sources[i]!.id); log.warn('proposals', 'source not read', { data: { source: this.sources[i]!.id }, cause: errText(r.reason), hint: 'the deck shows the other sources; it reads this one again next time' }); }
    });
    for (const it of items) if (it.provenance.files) it.provenance.files = it.provenance.files.map(f => shortPath(f, root));
    const state = { items: sortProposals(items), problems, at: this.ports.now() };
    this.seen(state.items.length);
    return state;
  }
  async count(): Promise<number> { return (await this.list()).items.length; }

  /** The user's decision: only on a card that is open now, only on a side that is possible now. */
  async decide(arg: ProposalDecide): Promise<ProposalDecideResult> {
    const id = typeof arg?.id === 'string' ? arg.id : '', decision = arg?.decision;
    const note = typeof arg?.note === 'string' ? arg.note.slice(0, 1000) : undefined;
    const keep = arg?.keep === 'new' || arg?.keep === 'both' ? arg.keep : undefined;
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
      await source.decide(this.ports, card, decision, note, keep);
      log.info('proposals', 'decided by the user', { data: { source: card.source, decision, applied: card.applied } });
      return { ok: true, state: await this.list() };
    } catch (e) {
      const why = errText(e).split('\n')[0]!.slice(0, 300);
      log.warn('proposals', 'decision not applied', { data: { source: source.id, decision }, cause: why, hint: 'the card stays in the deck; the source refused it' });
      return fail(why || 'Decisione non applicata.');
    } finally { this.deciding.delete(id); }
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
