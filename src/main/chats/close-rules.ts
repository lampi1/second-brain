// When an agent may close a chat (ADR 0217): the rules app_close_chat (appctl/tools.ts, the Orchestrator) and
// agent_close_child (agents/delegation.ts, a parent on its own descendants) share. A close cancels the chat's whole
// delegation tree, so it is refused while the chat or any open descendant waits for the user: his open questions,
// permissions and a Strategist plan waiting for «Approva e parti» (phase 'proposed', ADR 0108) are his. Never an
// Orchestrator. Pure: the callers check who may ask and do the close themselves.
import type { ChatSummary } from '../../shared/contract';

/** The ids of every chat under `id` (children, grandchildren… by parentId), the chat itself excluded. */
export function descendantIds(id: string, all: readonly ChatSummary[]): Set<string> {
  const under = new Set([id]);
  for (let grew = true; grew;) { grew = false; for (const x of all) if (x.parentId && under.has(x.parentId) && !under.has(x.id)) { under.add(x.id); grew = true; } }
  under.delete(id);
  return under;
}

/** The chat waits for the user: an open question or permission, or a plan he has to approve. */
const waitsForUser = (c: ChatSummary): boolean => c.pending > 0 || c.plan?.phase === 'proposed';

/** Why an agent may not close `target`, null = it may (the caller then closes it and its tree). */
export function closeRefusal(target: ChatSummary, all: readonly ChatSummary[]): string | null {
  if (target.isOrchestrator) return 'L’Orchestrator non si chiude da uno strumento: solo l’utente, dal suo menu ⋯';
  if (waitsForUser(target)) return `«${target.title}» aspetta una risposta dell’utente: chiudila solo lui`;
  const under = descendantIds(target.id, all);
  const asking = all.find(x => under.has(x.id) && !x.closedAt && waitsForUser(x));
  return asking ? `«${asking.title}», sotto «${target.title}», aspetta una risposta dell’utente: chiudile solo lui` : null;
}
