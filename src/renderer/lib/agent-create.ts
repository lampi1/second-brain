// "Crea agente" questionnaire model: the answers, their limits and the message they become. The message goes to the
// Orchestrator through the normal user send path (store send → 'chat:send'), so it is the user's own request that
// agent_create needs (#49); nothing here creates an agent or grants access. Used by components/AgentCreateDialog.tsx.
import { t } from '../i18n';

export const AGENT_KINDS = ['development', 'review', 'research', 'writing', 'ops', 'assistant', 'other'] as const;
export const AGENT_NEEDS = ['files', 'code', 'terminal', 'web', 'browser', 'services'] as const;
export const AGENT_AUTONOMY = ['read', 'ask', 'auto'] as const;
export const CREATE_STEPS = ['goal', 'tools', 'autonomy', 'review'] as const;
export type AgentKind = typeof AGENT_KINDS[number];
export type AgentNeed = typeof AGENT_NEEDS[number];
export type AgentAutonomy = typeof AGENT_AUTONOMY[number];

export const CREATE_LIMITS = { name: 80, goal: 2000, sources: 1000, limits: 1000 } as const;

export interface AgentCreateAnswers {
  kind: AgentKind | null;
  name: string;
  goal: string;
  needs: AgentNeed[];
  sources: string;
  autonomy: AgentAutonomy | null;
  limits: string;
  /** the engine's label as the user saw it, '' = the Orchestrator chooses */
  engine: string;
}

export const emptyAnswers = (): AgentCreateAnswers => ({ kind: null, name: '', goal: '', needs: [], sources: '', autonomy: null, limits: '', engine: '' });

/** Only the goal is required: every other answer is optional. */
export const canSend = (a: AgentCreateAnswers): boolean => !!a.goal.trim();

// one line per answer: inner line breaks become spaces so a list item never looks like another field
const flat = (text: string, max: number): string => text.replace(/\s+/g, ' ').trim().slice(0, max);

/** The message the user sends to the Orchestrator, in the UI language; empty answers are left out. */
export function agentRequestMessage(a: AgentCreateAnswers): string {
  const line = (key: Parameters<typeof t>[0], value: string) => value ? [`- ${t(key)}: ${value}`] : [];
  const needs = AGENT_NEEDS.filter(n => a.needs.includes(n)).map(n => t(`agentCreate.tool.${n}`)).join(', ');
  return [
    t('agentCreate.prompt.intro'),
    '',
    ...line('agentCreate.prompt.kind', a.kind ? t(`agentCreate.kind.${a.kind}`) : ''),
    ...line('agentCreate.prompt.name', flat(a.name, CREATE_LIMITS.name)),
    ...line('agentCreate.prompt.goal', flat(a.goal, CREATE_LIMITS.goal)),
    ...line('agentCreate.prompt.tools', needs),
    ...line('agentCreate.prompt.sources', flat(a.sources, CREATE_LIMITS.sources)),
    ...line('agentCreate.prompt.autonomy', a.autonomy ? t(`agentCreate.autonomy.${a.autonomy}`) : ''),
    ...line('agentCreate.prompt.limits', flat(a.limits, CREATE_LIMITS.limits)),
    ...line('agentCreate.prompt.engine', flat(a.engine, 80)),
    '',
    t('agentCreate.prompt.steps'),
  ].join('\n');
}
