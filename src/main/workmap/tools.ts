// The work maps on the Orchestrator's app_project_map (ADR 0342): the actions about a job (jobs, job, idea, approve, keep,
// start, stop, resume, replan, archive, reopen, seen), each with the map's id in `job`. They decide for the user with the
// same authority as app_resolve_question on a plan (only the authenticated Orchestrator has the tool).
// Used by projectmap/tools.ts appProjectMapTool; pinned by test/unit/workmap-service.test.ts.
import { workText, type WorkMapAction } from '@shared/work-map';
import type { WorkMaps } from './service';

export const JOB_ACTIONS = ['jobs', 'job', 'idea', 'approve', 'keep', 'start', 'stop', 'resume', 'replan', 'archive', 'reopen', 'seen'] as const;
type JobAction = (typeof JOB_ACTIONS)[number];
export const isJobAction = (a: string): a is JobAction => (JOB_ACTIONS as readonly string[]).includes(a);

export const JOB_TEXT = 'Every Strategist job, and every idea, has its own work map that the app draws and keeps by itself (ADR 0342). jobs (what waits for the user first; query looks in the archive too) | job (one, as text, with what can be done now) | idea (title, text, project: a map with no chat, when the user has an idea or wants to plan later) | approve (its plan; it starts at once) | keep (approve and leave it for later) | start (a kept plan, or an idea: opens a Strategist) | stop | resume | replan (text: what to change; started steps go on, nothing new starts before the user\'s ok) | archive | reopen | seen (a finished one: it goes to the archive). All but jobs and idea take job = its id, or its exact title.';
export const JOB_PROPS = {
  job: { type: 'string', description: 'the work map: its id (wm_…) or its exact title' },
  query: { type: 'string', description: 'jobs: words to look for, the archive included' },
  archived: { type: 'boolean', description: 'jobs: the archived ones' },
  cwd: { type: 'string', description: 'resume, start: another existing absolute folder for its Strategist; default: the last one it used' },
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function jobOf(maps: WorkMaps, v: unknown): string {
  const name = text(v);
  if (!name) throw new Error('job: the work map\'s id (app_project_map jobs)');
  if (maps.get(name)) return name;
  const named = [...maps.list(), ...maps.list({ archived: true })].filter(m => m.title.toLowerCase() === name.toLowerCase());
  if (named.length === 1) return named[0]!.id;
  throw new Error(named.length ? `job: ${named.length} maps are called «${name}»: use the id` : `job: no work map «${name}» (app_project_map jobs)`);
}

export async function jobAction(maps: WorkMaps, action: JobAction, a: Record<string, unknown>): Promise<unknown> {
  if (action === 'jobs') return { jobs: maps.list({ archived: a.archived === true, ...(text(a.query) ? { query: text(a.query) } : {}) }) };
  if (action === 'idea') {
    const m = maps.idea({ title: text(a.title), idea: text(a.text), project: text(a.project) }, 'Orchestrator');
    return { ok: true, job: m.id, state: m.state };
  }
  const id = jobOf(maps, a.job);
  if (action === 'job') return workText(maps.view(id)!);
  // the plan that is proposed now: a newer one is refused by the chat itself
  const at = maps.get(id)?.plan?.at;
  const m = await maps.act(id, action satisfies WorkMapAction, { ...(at !== undefined ? { at } : {}), ...(text(a.text) ? { text: text(a.text) } : {}) }, 'Orchestrator');
  return { ok: true, job: m.id, state: m.state, ...(m.owner ? { chatId: m.owner.chatId } : {}) };
}
