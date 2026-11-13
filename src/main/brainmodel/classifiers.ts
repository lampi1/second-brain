// The Classificatori section's data (ADR 0077; a section of Qualità since ADR 0210), read-only: the small sorters that
// decide at zero tokens. Per kind of work: the app's chats in the improvement loop's ledger
// (<brain>/ops/state/improve/outcomes.jsonl, each routed chat's prediction line with its kind, joined with its actuals
// and the verdicts of the agent runs of the same chats), how many have a verified outcome and how many succeeded. The
// model-routing table, its history, its quality by route and «who chose the model» left with the table (ADR 0210); an
// old ledger line still loads, its `source` and `version` unread. "Verified" = the user's or a reviewed verdict, from
// the agent run or from the ledger (a run in both counts once; ADR 0095); the brain's proxy outcomes are known but
// unverified and never enter it. Nothing here writes. Used by brainmodel/service.ts; unit tests:
// test/unit/brainmodel/classifiers.test.ts. The grid's cards (classifier-cards.ts) also read the job ledger
// (userData/jobs.jsonl, the cost ledger's kinds).
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { ClassifiersState, KindModelCard } from '../../shared/brain-model';
import { foldOutcome, type LedgerOutcome } from '../brain/routing';
import { classifierCards, verifiedOf, type JobRow } from './classifier-cards';
import { fromLedgerKind } from '../../shared/work-concepts';

interface Prediction { id: string; at: number; kind: string }
interface Actual { usd: number }
export interface ClassifierInputs {
  root: string | null;
  runs: AgentRun[];
  profiles: AgentProfile[];
  /** the job ledger's rows (kind and cost of each chat), for the cost-ledger kind card; absent = none */
  jobs?: () => JobRow[];
  /** the kind-of-work classifier by examples (kind-model.ts, ADR 0197); absent = no card */
  kindModel?: () => Promise<KindModelCard>;
}

/** userData/jobs.jsonl (brain/estimates.ts FileJobStore: the last line of an id wins) as the cards need it. */
export function readJobs(file: string): JobRow[] {
  let text = '';
  try { if (fs.statSync(file).size <= 32 * 1024 * 1024) text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const byId = new Map<string, JobRow>();
  for (const l of text.split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l) as { id?: unknown; at?: unknown; kind?: unknown; actual?: { usd?: unknown } | null };
      if (typeof j.id === 'string' && typeof j.kind === 'string') byId.set(j.id, { at: Number(j.at) || 0, kind: fromLedgerKind(j.kind), usd: typeof j.actual?.usd === 'number' ? j.actual.usd : null });
    } catch { /* a torn line */ }
  }
  return [...byId.values()];
}

/** The ledger's prediction lines of the app's chats (one per chat), their latest actuals and their known outcomes
 *  (later line wins, a measured line never undoes one, an unverified one never replaces a verified one: foldOutcome). */
export function readLedger(root: string | null): { predictions: Prediction[]; actuals: Map<string, Actual>; outcomes: Map<string, LedgerOutcome> } {
  const predictions = new Map<string, Prediction>(), actuals = new Map<string, Actual>(), outcomes = new Map<string, LedgerOutcome>();
  if (!root) return { predictions: [], actuals, outcomes };
  let text = '';
  try { const f = path.join(root, 'ops', 'state', 'improve', 'outcomes.jsonl'); if (fs.statSync(f).size <= 32 * 1024 * 1024) text = fs.readFileSync(f, 'utf8'); } catch { /* no ledger yet */ }
  for (const line of text.split('\n')) {
    if (!line.includes('"app:')) continue;
    try {
      const j = JSON.parse(line) as { id?: unknown; at?: unknown; domain?: unknown; item?: { kind?: string }; predicted?: unknown; actual?: { usd?: number }; outcome?: unknown };
      // an app: id is a routing line; the brain's settlement may leave the domain out
      if ((j.domain !== 'routing' && j.domain !== undefined) || typeof j.id !== 'string' || !j.id.startsWith('app:')) continue;
      if (j.predicted && j.item && !predictions.has(j.id)) predictions.set(j.id, { id: j.id, at: Number(j.at) || 0, kind: String(j.item.kind ?? 'altro') });
      if (j.actual && Number.isFinite(j.actual.usd)) actuals.set(j.id, { usd: Number(j.actual.usd) });
      if (j.outcome) foldOutcome(outcomes, j.id, j.outcome);
    } catch { /* a torn line */ }
  }
  return { predictions: [...predictions.values()], actuals, outcomes };
}

/** Per kind of work: the routed chats, how many have a verified outcome, how many of those succeeded. Verified only, as
 *  every other success figure on the page (ADR 0186: the routing's own per-kind counts took the brain's proxy too). */
function kindsOf(predictions: readonly { id: string; kind: string }[], runByChat: Map<string, AgentRun>, outcomes: Map<string, LedgerOutcome>): ClassifiersState['kinds'] {
  const by = new Map<string, { kind: string; chats: number; known: number; ok: number }>();
  for (const p of predictions) {
    const k = by.get(p.kind) ?? { kind: p.kind, chats: 0, known: 0, ok: 0 };
    const v = verifiedOf(p.id, runByChat, outcomes);
    k.chats++; if (v !== null) { k.known++; if (v) k.ok++; }
    by.set(p.kind, k);
  }
  return [...by.values()].sort((a, b) => b.chats - a.chats || a.kind.localeCompare(b.kind));
}

export async function classifiersState(i: ClassifierInputs, now = Date.now()): Promise<ClassifiersState> {
  const { predictions, actuals, outcomes } = readLedger(i.root);
  const runByChat = new Map([...i.runs].sort((a, b) => b.startedAt - a.startedAt).map(r => [r.chatId, r]));
  return {
    cards: classifierCards({ now, predictions, actuals, outcomes, runs: i.runs, jobs: (() => { try { return i.jobs?.() ?? []; } catch { return []; } })() }),
    kinds: kindsOf(predictions, runByChat, outcomes),
    ...(i.kindModel ? { kindModel: await i.kindModel().catch(() => undefined) } : {}),
  };
}
