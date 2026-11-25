// «Parti» on an idea, «Riprendi» and «Ripianifica» on a job whose chat is gone (ADR 0342): opens a Strategist chat for a
// work map. The chat carries the map's id (ChatSummary.workMap), so the map becomes its own from its first event; its plan
// flow is the usual one, so whatever it proposes waits for the user's ok again. The first message holds what the map
// saved: the idea, the answers, the steps with where they were, what to change.
// Used by wiring-shared.ts attachWorkMaps (WorkMapsDeps.startStrategist); pinned by test/unit/workmap-service.test.ts.
import type { ChatSummary, Harness } from '@shared/contract';
import { ORCHESTRATOR_USER_LABEL } from '@shared/agent-label';
import { WORK_MAP_LIMITS, type WorkMap } from '@shared/work-map';
import type { ChatService } from '../services';

const STEP = { todo: 'da fare', now: 'in corso', done: 'fatto', blocked: 'bloccato' } as const;

/** The new Strategist's first message. */
export function startPrompt(m: WorkMap, change?: string): string {
  const plan = m.plan, again = !!plan?.steps.length || !!m.owner;
  return [
    m.idea ?? m.title,
    ...(m.idea ? [`Titolo del lavoro: ${m.title}.`] : []),
    ...(m.touches.length ? [`Mappe di progetto: ${m.touches.join(', ')} (project_map_read).`] : []),
    ...(again ? ['Questo lavoro continua: la sua chat di prima non c’è più. Controlla a che punto è davvero prima di proporre il piano, che aspetta di nuovo il mio ok.'] : []),
    ...(plan?.clarified.length ? ['Risposte già date (non sono un ok al piano):', ...plan.clarified.map(x => `- ${x.q} → ${x.a}`)] : []),
    ...(plan?.steps.length ? ['Piano salvato:', ...plan.steps.map((s, i) => `${i + 1}. ${s.title} (${s.role ? `${s.role}, ` : ''}${STEP[s.state]})`)] : []),
    ...(change ? [`Cosa cambiare: ${change}`] : []),
  ].join('\n');
}

export interface StartDeps {
  chats: Pick<ChatService, 'create'>;
  /** the engine a chat starts on before its role card decides */
  harness(): Harness;
  /** the last folder the job used, else its project's; null = none known */
  folderOf(map: WorkMap): string | null;
}

export const strategistStarter = (d: StartDeps) => async (m: WorkMap, change: string | undefined, by: string, asked?: string): Promise<ChatSummary> => {
  // the folder the user (or the Orchestrator) named, else the last one it used (ADR 0358)
  const cwd = asked?.trim() || d.folderOf(m);
  if (!cwd) throw new Error('Non so in quale cartella lavorare: scegli prima la cartella del cervello.');
  const prompt = startPrompt(m, change);
  return d.chats.create({ harness: d.harness(), cwd, title: m.title, prompt: by === 'user' ? prompt : `${ORCHESTRATOR_USER_LABEL}\n\n${prompt}`, goal: (change ? `${m.title}: ${change}` : m.idea ?? m.title).slice(0, WORK_MAP_LIMITS.change), orchestrator: false, roleId: 'strategist' },
    'agent', undefined, undefined, { workMap: m.id, ...(m.plan ? { resumePlan: m.plan } : {}) });
};
