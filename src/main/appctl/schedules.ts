// The Orchestrator and the scheduled routines (ADR 0280; owner 2026-11-13: routines planned inside the app like
// Claude's scheduled tasks, «senza blocchi di permessi»): app_schedule on the Orchestrator's own endpoint lists the
// user's planned requests and creates, changes, pauses, resumes, deletes or runs one now, through the same
// SchedulesService as the Routine page. No approval: the Orchestrator counts as the user (ADR 0275), and a planned
// request does only what the Orchestrator could already do when asked. Tests: test/unit/schedules.test.ts.
import { parseScheduleEdit, type ScheduleEdit, type ScheduledTask, type SchedulesState } from '../../shared/schedules';
import type { EventMap } from '../../shared/contract';
import { whenWords } from '../schedules/service';

export interface SchedulesControl { state(): SchedulesState; edit(e: ScheduleEdit, by?: ScheduledTask['by']): SchedulesState }
interface Tool { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(a: Record<string, unknown>): object }

const iso = (at: number | null) => (at === null ? null : new Date(at).toISOString());
const row = (t: ScheduledTask) => ({ id: t.id, name: t.name, request: t.prompt, when: t.when, whenInWords: whenWords(t.when), on: t.on, next: iso(t.nextAt), by: t.by, lastRuns: t.runs.slice(0, 5).map(r => ({ at: iso(r.at), ...(r.ok ? { ok: true } : { ok: false, error: r.error }), ...(r.manual ? { manual: true } : {}), ...(r.late ? { lateMin: r.late } : {}) })) });

export function scheduleTools(s: SchedulesControl, emitUi: (cmd: EventMap['ui:command']) => void, now: () => number = Date.now): Tool[] {
  const find = (ref: unknown) => {
    const k = typeof ref === 'string' ? ref.trim().toLowerCase() : '';
    const all = s.state().tasks;
    const hit = all.filter(t => t.id === k || t.name.toLowerCase() === k);
    const one = hit.length === 1 ? hit[0] : k ? (all.filter(t => t.name.toLowerCase().includes(k)).length === 1 ? all.find(t => t.name.toLowerCase().includes(k)) : undefined) : undefined;
    if (!one) throw new Error(`routine pianificata non trovata (o più di una) per «${k}». Le routine: ${all.map(t => `${t.id} («${t.name}»)`).join(', ') || 'nessuna'}`);
    return one;
  };
  return [{
    name: 'app_schedule',
    description: 'The user\'s SCHEDULED ROUTINES (Routine → Pianificate): requests planned in advance that the app hands to you at their time, like scheduled tasks. Each has a name, the request in the user\'s words, and when: {kind:"daily", time:"HH:MM", days:[1,2,3,4,5]} (local time; days 0 = Sunday … 6 = Saturday, omit for every day), {kind:"every", minutes:N} (15 minutes to 7 days), {kind:"once", at:"<ISO date-time>"} or {kind:"manual"}. op list (default): every routine with its next time and last runs. op create: `name`, `request` (write it so that it stands alone months later: what to do, on which project, repo or edition, and what to report), `when`. op update: `routine` (id or name) plus the fields to change. op pause / resume / delete / run (now, once, beside its schedule): `routine`. Use it when the user says «ogni mattina…», «ogni lunedì…», «tra due ore ricordami…», «pianifica…»: create it at once and tell them when it will first run. When a message starts with «[scheduled routine …]» it is one of these: do the request as if the user had just asked, and do not ask them to confirm it. A missed time (the app was closed) runs once when the app opens. It never runs a terminal routine package by itself.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: {
      op: { type: 'string', enum: ['list', 'create', 'update', 'pause', 'resume', 'delete', 'run'] },
      routine: { type: 'string', description: 'update, pause, resume, delete, run: the routine\'s id or name' },
      name: { type: 'string', description: 'a short name («Giornale del mattino»)' },
      request: { type: 'string', description: 'what to do at each run, self-contained, at most 4,000 characters' },
      when: { type: 'object', description: 'the rule, as described above', properties: { kind: { type: 'string', enum: ['daily', 'every', 'once', 'manual'] }, time: { type: 'string' }, days: { type: 'array', items: { type: 'number' } }, minutes: { type: 'number' }, at: { type: 'string' } }, required: ['kind'] },
    }, required: [] },
    run: a => {
      const op = typeof a.op === 'string' ? a.op : 'list';
      if (op === 'list') return { routines: s.state().tasks.map(row), ...(s.state().tasks.length ? {} : { note: 'None yet. Create one with op create.' }) };
      if (op === 'create') {
        const before = new Set(s.state().tasks.map(t => t.id));
        const st = s.edit(parseScheduleEdit({ op: 'create', name: a.name, prompt: a.request, when: a.when }, now()), 'orchestrator');
        emitUi({ action: 'page', value: 'flussi' });
        return { created: row(st.tasks.find(t => !before.has(t.id))!) };
      }
      const t = find(a.routine);
      if (op === 'update') return { updated: row(s.edit(parseScheduleEdit({ op: 'update', id: t.id, ...(a.name !== undefined ? { name: a.name } : {}), ...(a.request !== undefined ? { prompt: a.request } : {}), ...(a.when !== undefined ? { when: a.when } : {}) }, now())).tasks.find(x => x.id === t.id)!) };
      if (op === 'pause' || op === 'resume') return { [op === 'pause' ? 'paused' : 'resumed']: row(s.edit({ op: 'update', id: t.id, on: op === 'resume' }).tasks.find(x => x.id === t.id)!) };
      if (op === 'delete') { s.edit({ op: 'delete', id: t.id }); return { deleted: t.name }; }
      if (op === 'run') { s.edit({ op: 'run', id: t.id }); return { started: t.name, note: 'Its request arrives in your conversation as a «[scheduled routine …]» message.' }; }
      throw new Error('op: list, create, update, pause, resume, delete o run');
    },
  }];
}
