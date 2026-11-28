// Demo handlers of the «Attività pianificate» (SB_DEMO=1, ADR 0373): the seven 'activities:*' channels answered from a small
// in-memory catalog (four made-up activities with their last runs, one of them Gmail) so that the page, its e2e and the
// README screenshot can be seen with no engine, no source and no token. Nothing is written to disk and no model runs:
// «Esegui ora» adds a quiet run. Pure of Electron: it takes a `push` callback for 'activities:changed'. Used by main/index.ts
// instead of ipc-handlers/activities.ts when the app runs as the demo.
import {
  ACTIVITIES_MAX, ACTIVITY_HISTORY_MAX, activityTemplates, describeSchedule, trimHistory, validateActivityInput,
  type ActivitiesState, type Activity, type ActivityInput, type ActivityResult, type ActivityRun, type ActivityView,
} from '../../shared/activities';
import type { HandlersOf } from './context';

const MIN = 60_000;

export function activitiesDemoHandlers(push: (state: ActivitiesState) => void, now: () => number = Date.now): HandlersOf<'activities'> {
  let seq = 0;
  let paused = false;
  const at0 = now();
  type Loose = Pick<ActivityInput, 'name' | 'source' | 'propose'> & { enabled?: boolean; schedule?: ActivityInput['schedule']; filter?: Partial<ActivityInput['filter']> };
  const input = (i: Loose): ActivityInput => {
    const v = validateActivityInput(i);
    if (!v.ok) throw new Error(v.errors.join('; '));
    return v.value;
  };
  const make = (i: ActivityInput): Activity => ({ ...i, id: `a${++seq}`, createdAt: at0 - 9 * 86_400_000, updatedAt: at0 - 86_400_000 });
  const run = (activityId: string, minAgo: number, p: Partial<ActivityRun>): ActivityRun => ({
    id: `r${++seq}`, activityId, at: at0 - minAgo * MIN, durationMs: 1800, trigger: 'timer', status: 'idle', read: 0, kept: 0, proposals: 0,
    usedModel: false, tokens: null, costUsd: null, model: null, ...p,
  });

  const catalog: Activity[] = [
    make(input({ name: 'DevOps: novità sui miei lavori', source: 'devops', propose: 'Se un collega segnala un bug o mi chiede una review, proponimi cosa fare.', enabled: true,
      schedule: { everyMin: 30, days: [1, 2, 3, 4, 5], window: { from: '08:00', to: '19:00' } }, filter: { unreadOnly: true } })),
    make(input({ name: 'Outlook: mail da rispondere', source: 'outlook', propose: 'Se una mail chiede una mia risposta, proponimi la risposta.', enabled: true,
      schedule: { everyMin: 15, days: [1, 2, 3, 4, 5], window: { from: '08:00', to: '19:00' } }, filter: { unreadOnly: true, excludeNoReply: true } })),
    make(input({ name: 'Teams: menzioni', source: 'teams', propose: 'Se mi chiedono qualcosa in una chat, proponimi cosa rispondere.', enabled: false,
      schedule: { everyMin: 10, days: [], window: null }, filter: { mentionsOnly: true, unreadOnly: true } })),
    make(input({ name: 'Gmail: fatture dei fornitori', source: 'gmail', propose: 'Se arriva una fattura, proponimi dove archiviarla.', enabled: true,
      schedule: { everyMin: 120, days: [], window: null }, filter: { subjectWords: ['fattura'] } })),
  ];
  const [dev, out, teams, gmail] = catalog as [Activity, Activity, Activity, Activity];
  const history = new Map<string, ActivityRun[]>([
    [dev.id, [
      run(dev.id, 12, { read: 14, kept: 3, proposals: 2, status: 'proposed', usedModel: true, tokens: 2100, costUsd: 0.0042, model: 'haiku', durationMs: 5200 }),
      run(dev.id, 42, { read: 14, kept: 0, status: 'idle' }),
      run(dev.id, 72, { read: 15, kept: 1, status: 'quiet', usedModel: true, tokens: 900, costUsd: 0.0018, model: 'haiku', durationMs: 3900 }),
      run(dev.id, 102, { read: 15, kept: 0, status: 'idle', trigger: 'manual' }),
    ]],
    [out.id, [
      run(out.id, 6, { read: 9, kept: 0, status: 'idle' }),
      run(out.id, 21, { read: 9, kept: 2, proposals: 1, status: 'proposed', usedModel: true, tokens: 1500, costUsd: 0.0031, model: 'haiku', durationMs: 4400 }),
      run(out.id, 36, { read: 7, kept: 0, status: 'error', error: 'accesso scaduto: ricollega Outlook nei connettori', durationMs: 600 }),
    ]],
    [teams.id, []],
    [gmail.id, [run(gmail.id, 95, { read: 4, kept: 1, status: 'quiet', usedModel: true, tokens: 3800, costUsd: 0.0125, model: 'haiku', durationMs: 7800 })]],
  ]);

  const view = (a: Activity): ActivityView => {
    const runs = history.get(a.id) ?? [];
    const today = runs.filter(r => new Date(r.at).toDateString() === new Date(now()).toDateString());
    const costs = today.filter(r => r.costUsd !== null);
    return {
      ...a, scheduleText: describeSchedule(a.schedule), lastRun: runs[0] ?? null,
      nextAt: a.enabled && !paused ? now() + a.schedule.everyMin * MIN : null, running: false,
      todayTriage: today.filter(r => r.usedModel).length, todayCostUsd: costs.length ? costs.reduce((s, r) => s + (r.costUsd ?? 0), 0) : null,
      usesModelToRead: a.source === 'gmail',
    };
  };
  const state = (): ActivitiesState => ({ activities: catalog.map(view), paused, gmailConnector: false, templates: activityTemplates() });
  const changed = (): ActivitiesState => { const s = state(); push(s); return s; };
  const find = (id: string) => catalog.find(a => a.id === id);
  const fail = (error: string): ActivityResult => ({ ok: false, error });

  return {
    'activities:state': () => state(),
    'activities:save': ({ id, input: raw }) => {
      const base = id ? find(id) : undefined;
      if (id && !base) return fail('attività non trovata');
      if (!id && catalog.length >= ACTIVITIES_MAX) return fail(`al massimo ${ACTIVITIES_MAX} attività`);
      const v = validateActivityInput(raw, base);
      if (!v.ok) return fail(v.errors.join('; '));
      let a: Activity;
      if (base) { Object.assign(base, v.value, { updatedAt: now() }); a = base; }
      else { a = { ...v.value, id: `a${++seq}`, createdAt: now(), updatedAt: now() }; catalog.push(a); history.set(a.id, []); }
      return { ok: true, id: a.id, state: changed() };
    },
    'activities:enable': ({ id, on }) => {
      const a = find(id);
      if (!a) return fail('attività non trovata');
      a.enabled = on;
      return { ok: true, id, state: changed() };
    },
    'activities:remove': ({ id }) => {
      const i = catalog.findIndex(a => a.id === id);
      if (i < 0) return fail('attività non trovata');
      catalog.splice(i, 1); history.delete(id);
      return { ok: true, id, state: changed() };
    },
    'activities:pause': ({ paused: p }) => { paused = p; return changed(); },
    'activities:run': ({ id }) => {
      const a = find(id);
      if (!a) return fail('attività non trovata');
      const r = run(id, 0, { at: now(), trigger: 'manual', status: 'idle', read: 6 });
      history.set(id, trimHistory([r, ...(history.get(id) ?? [])]).slice(0, ACTIVITY_HISTORY_MAX));
      return { ok: true, id, state: changed(), run: r };
    },
    'activities:history': ({ id }) => history.get(id) ?? [],
  };
}
