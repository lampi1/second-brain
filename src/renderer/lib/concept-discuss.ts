// Where «Discutine» on a Guida card goes (components/GuidePage.tsx). An explainer agent in the catalog that can start
// gets a new chat of its own with the card as a draft in its input (not sent: the model starts when the user presses
// Enter); without one, the card and the instruction to reuse or propose an "Explainer" agent go to the Orchestrator as a
// draft (the same path as every other «Discutine»: actions.ts brainBridge.draftToOrchestrator). Pure: the page runs the plan.
import type { AgentCatalog, AgentProfile } from '@shared/agents';
import type { Harness } from '@shared/contract';
import { discussText, isExplainer, orchestratorText, type ConceptCard, type GuideLang } from '@shared/concept-guide';
import { profileCanStart } from './role-consumers';

export type DiscussPlan =
  | { via: 'agent'; agentId: string; agentName: string; harness: Harness; cwd: string; title: string; draft: string }
  | { via: 'orchestrator'; draft: string };

/** The explainer agent that can start now, if any (first match in catalog order). */
export function explainerOf(catalog: AgentCatalog | null): AgentProfile | null {
  if (!catalog || catalog.problem) return null;
  return catalog.profiles.find(p => isExplainer(p) && profileCanStart(p, catalog.models.find(m => m.engine === p.engine))) ?? null;
}

/** `cwd` is the folder a new chat starts in (the brain); without one an agent chat cannot start, so the Orchestrator takes it. */
export function planDiscuss(card: ConceptCard, lang: GuideLang, catalog: AgentCatalog | null, cwd: string | null | undefined): DiscussPlan {
  const agent = cwd ? explainerOf(catalog) : null;
  if (agent && cwd) {
    return { via: 'agent', agentId: agent.id, agentName: agent.name, harness: agent.engine, cwd, title: `${lang === 'en' ? 'Guide' : 'Guida'} · ${card.title[lang]}`, draft: discussText(card, lang) };
  }
  return { via: 'orchestrator', draft: orchestratorText(card, lang) };
}
