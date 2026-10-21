// Readable Log lines for the app's own automatic choices (shared/activity-log.ts): an estimate with its keyword
// classifier's kind, the mail classifier's class for a message to the Orchestrator, a Battito run. Pure formatting;
// the callers record them with journal.ts. Used by main/wiring.ts (the estimate under a request), agents/task-estimate.ts
// (task_estimate), chats/mail.ts (send_to_chat) and pulse/service.ts; tests: test/unit/activity/records.test.ts.
import type { LogInput } from '../../shared/activity-log';
import type { TaskEstimate } from '../../shared/task-estimate';

const PATH: Record<string, string> = { self: 'risponde l’Orchestrator', 'one-agent': 'un solo agente', tree: 'più agenti in albero' };
const CONF: Record<string, string> = { high: 'alta', medium: 'media', low: 'bassa' };
export const minutes = (ms: number): string => ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 3600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3600_000).toFixed(1).replace('.', ',')} h`;
const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

/** An estimate: the classifier's kind, the figures (or why none) and the path. by = who asked (the app, the Orchestrator). */
export function estimateRecords(e: TaskEstimate, request: string, by: string): LogInput[] {
  const figures = e.basis && e.timeMs !== null
    ? `~${minutes(e.timeMs)}${e.costUsd !== null ? ` · ~${usd(e.costUsd)}` : ''} · ${e.n} lavori simili, affidabilità ${CONF[e.confidence ?? 'low'] ?? e.confidence}`
    : `nessuna cifra: meno di 3 lavori simili`;
  return [
    { kind: 'classifier', level: 'info', title: `Classificatore stime: «${e.kind}»`, text: `${e.parts} ${e.parts === 1 ? 'parte' : 'parti'} nella richiesta`, input: request },
    { kind: 'estimate', level: 'info', title: `Stima (${by}): ${figures}`, text: `Percorso: ${PATH[e.path] ?? e.path}. ${e.why}`, input: request },
  ];
}

const CLASS: Record<string, string> = { now: 'urgente, consegnato subito', group: 'da leggere, consegnato con le altre novità', quiet: 'solo avanzamento, consegnato col prossimo turno' };
/** The mail classifier's class for one message (send_to_chat). */
export function mailRecord(from: string, to: string, cls: string, text: string, when: string): LogInput {
  return { kind: 'classifier', level: 'info', title: `Classificatore posta: ${from} → ${to}: ${CLASS[cls] ?? cls}`, text: when, input: text };
}

/** A Battito run's end: what it did and what it cost. */
export function pulseRecord(job: 'pulse' | 'headline', slot: string, r: { ok: boolean; error?: string }, extra: { cards?: number; usd?: number | null; engine?: string | null; ms?: number }): LogInput {
  const what = job === 'headline' ? 'la frase del giorno' : `${extra.cards ?? 0} ${extra.cards === 1 ? 'carta' : 'carte'}`;
  return { kind: 'pulse', level: r.ok ? 'ok' : 'info', title: r.ok ? `Battito: ${what}${extra.engine ? ` con ${extra.engine}` : ''}` : `Battito non ha lavorato: ${r.error ?? 'nessun motivo'}`,
    text: slot === 'manual' ? 'Avviato da te' : `Turno ${slot}`, ...(typeof extra.usd === 'number' ? { costUsd: extra.usd } : {}), ...(extra.ms ? { ms: extra.ms } : {}) };
}
