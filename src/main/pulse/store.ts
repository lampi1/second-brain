// Atomic local Battito ledger. Refuse corrupt records rather than silently resetting spent budgets or approvals.
import type { ApprovalItem, PulseCard } from '../../shared/pulse';
import type { HeadlineState } from '../../shared/contract';
import type { JobStamp } from '../jobs/scheduler';
import type { PulseRunRecord } from './budget';
import { readLocal, writeLocal } from '../agents/local-store';
export interface PulseData {
  version: 1; cards: PulseCard[]; keys: string[]; runs: PulseRunRecord[];
  approvals: ApprovalItem[]; claims: Record<string, JobStamp>; headline?: HeadlineState;
  headlineSpend?: { month: string; usd: number; calls: number };
}
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const text = (s: unknown, max: number) => typeof s === 'string' && s.length <= max;
export class PulseStore {
  data: PulseData = { version: 1, cards: [], keys: [], runs: [], approvals: [], claims: {} };
  problem: string | null = null;
  constructor(private readonly file: string) {
    try {
      const raw = readLocal(file);
      if (raw === undefined) return;
      const s = raw as PulseData;
      if (!s || s.version !== 1 || !Array.isArray(s.cards) || s.cards.length > 200
        || !Array.isArray(s.keys) || s.keys.length > 200 || !s.keys.every(k => text(k, 80))
        || !Array.isArray(s.runs) || s.runs.length > 90 || !Array.isArray(s.approvals) || s.approvals.length > 500
        || !s.claims || typeof s.claims !== 'object' || Array.isArray(s.claims)) throw Error();
      for (const c of s.cards) {
        if (!c || typeof c.id !== 'string' || !/^pc_[a-f0-9]{12}$/.test(c.id) || !text(c.title, 80) || !text(c.body, 280) || !text(c.why, 160)
          || !finite(c.createdAt) || !finite(c.expiresAt) || !Array.isArray(c.refs) || c.refs.length > 3
          || !c.refs.every(r => r && text(r.kind, 20) && text(r.ref, 240)) || !Array.isArray(c.places) || c.places.length > 4
          || !c.places.every(p => text(p, 250)) || !['new', 'seen', 'saved', 'acted', 'dismissed', 'expired'].includes(c.state)) throw Error();
      }
      for (const r of s.runs) if (!r || !['pulse', 'headline'].includes(r.job) || !finite(r.at) || !(r.usd === null || finite(r.usd))
        || !['reported', 'estimated', 'unknown'].includes(r.basis) || !text(r.id, 80) || !text(r.slot, 100) || !text(r.digestHash, 80) || !text(r.result, 100)) throw Error();
      for (const a of s.approvals) if (!a || !text(a.id, 80) || !text(a.agentId, 80) || !text(a.title, 80) || !text(a.text, 4000)
        || !finite(a.createdAt) || !['learned-rule', 'agent-suggestion', 'maintenance'].includes(a.kind)
        || !['pending', 'approved', 'discarded'].includes(a.state) || !Array.isArray(a.evidence) || !a.evidence.every(e => text(e, 240))) throw Error();
      for (const [id, claim] of Object.entries(s.claims)) if (!['pulse', 'headline'].includes(id) || !claim || !finite(claim.at) || !text(claim.slot, 100)) throw Error();
      if (s.headline && (!text(s.headline.text, 160) || !finite(s.headline.monthUsd) || !finite(s.headline.monthCalls))) throw Error();
      if (s.headlineSpend && (!/^\d{4}-\d{2}$/.test(s.headlineSpend.month) || !finite(s.headlineSpend.usd) || !finite(s.headlineSpend.calls))) throw Error();
      this.data = s;
    } catch { this.problem = 'Archivio Battito non valido: originale conservato, esecuzioni sospese.'; }
  }
  save(): void {
    if (this.problem) throw Error(this.problem);
    // Pending approvals never expire or disappear; capacity is enforced by producers.
    this.data.cards = this.data.cards.slice(-200); this.data.keys = this.data.keys.slice(-200); this.data.runs = this.data.runs.slice(-90);
    writeLocal(this.file, this.data);
  }
}
