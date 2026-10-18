// The Orchestrator messages of the agents' improvement loop: the batched feedback request on ended runs (an automatic
// wake, so it costs the user's tokens: gated here and capped in lifecycle.ts) and the drafting request the user starts by
// approving a queue entry (Agenti → Da approvare). Why a gate: each delivery to an idle Orchestrator is a new turn that
// re-reads its whole context (regia-delivery.ts, ~0.18 $ measured), so the automatic one goes only to an Orchestrator
// that exists, runs on an engine the user left on, is idle (never closed: it is not resumed for this), has nothing open
// with the user and has been quiet for FEEDBACK_QUIET_MS, while no request waits for the user anywhere in the app.
// Pure: wiring.ts sends the text; pinned by test/unit/agents/agent-loop.test.ts.
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { AgentLifecycleProposal } from '../../shared/agent-lifecycle';
import type { ChatSummary, Harness } from '../../shared/contract';
import { APP_EVENT_LABEL } from '../chats/regia-wake';

export const FEEDBACK_QUIET_MS = 5 * 60_000;
const cut = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export type FeedbackGate = { chat: ChatSummary } | { refused: string };
/** The Orchestrator that may receive the automatic feedback request now, or why not (logged by the caller). */
export function feedbackGate(chats: readonly ChatSummary[], now: number, engineOn: (h: Harness) => boolean, userWaiting: boolean): FeedbackGate {
  const o = chats.find(c => c.isRegia && c.orchestrator && !c.closedAt);
  if (!o) return { refused: 'no Orchestrator' };
  if (!engineOn(o.harness)) return { refused: 'Orchestrator engine switched off' };
  if (o.state !== 'idle') return { refused: `Orchestrator ${o.state}` };
  if (o.pending || o.handoffBusy || o.queued) return { refused: 'Orchestrator waits for the user' };
  if (userWaiting) return { refused: 'a request waits for the user' };
  if (now - o.updatedAt < FEEDBACK_QUIET_MS) return { refused: 'Orchestrator active in the last minutes' };
  return { chat: o };
}

/** The one batched request: each run with what the Orchestrator needs to judge it, then the rules of the answer. */
export function feedbackMessage(runs: readonly AgentRun[], agents: readonly AgentProfile[]): string {
  const name = (id: string) => agents.find(a => a.id === id)?.name ?? id;
  const lines = runs.map(r => {
    const parent = r.spawnedBy ?? r.parentRunId;
    return `- ${r.runId} · ${name(r.agentId)} v${r.version} · ${r.endReason ?? 'ended'}${r.costUsd !== null ? ` · ${r.costUsd.toFixed(2)} $` : ''} · domande ${r.counters.questions}`
      + `${r.outcome ? ` · esito ${r.outcome.verdict} (${r.outcome.basis})` : ''}${parent ? ` · sotto-agente di ${parent}` : ''} · «${cut(r.goal, 120)}»`;
  });
  return [APP_EVENT_LABEL, `Esecuzioni di Agenti finite senza un giudizio dell'utente (${runs.length}):`, ...lines,
    'Per ciascuna: agent_run_report (runId), poi agent_feedback con verdict, notes, evidence e, se una parte della definizione è mancata, gap + gapKey breve e stabile.',
    'Se dal lavoro emerge una regola riutilizzabile per quell\'Agente, proponila con agent_learn_propose (agentId, rule, evidence = i runId).',
    'Non cambiare definizioni: agent_update / agent_propose mettono solo una proposta in «Da approvare», decide l\'utente. Non scrivere all\'utente per questo; una riga di chiusura basta.'].join('\n');
}

/** The user approved a queue entry that needs a concrete draft: the Orchestrator prepares it as a proposal. */
export function draftRequestMessage(p: AgentLifecycleProposal, agents: readonly AgentProfile[]): string {
  const who = p.agentIds.map(id => `${agents.find(a => a.id === id)?.name ?? id} (${id})`).join(', ');
  const what = p.kind === 'update' ? `aggiornare la definizione di ${who}` : p.kind === 'merge' ? `unire ${who}` : p.kind === 'split' ? `dividere ${who} per il gruppo indicato`
    : 'creare un nuovo Agente';
  const refs = p.evidence.slice(0, 16).map(e => `${e.kind}:${e.ref}`).join(', ');
  return ["[messaggio di second-brain: l'utente ha chiesto una bozza da Agenti → «Da approvare»; non vale come ok per applicare nulla]",
    `Proposta ${p.key}: ${what}. Motivo: ${p.reason}.${refs ? ` Evidenze: ${refs}.` : ''}`,
    p.kind === 'create' ? 'Prepara la bozza con agent_suggest (draft completo, reason, expectedEffect).' : 'Prepara la bozza con agent_propose (agentId, patch, reason, expectedEffect); per un\'unione proponi l\'archiviazione dell\'altro con agent_archive.',
    'La bozza torna all\'utente in «Da approvare» per la decisione finale; un cambio di comportamento approvato parte in prova contro la versione attuale.'].join('\n');
}
