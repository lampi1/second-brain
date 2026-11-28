// The Orchestrator's tool for the «Attività pianificate» (ADR 0373; owner 2026-11-28: «l'orchestrator ovviamente deve poterle
// gestire in toto, attivarle, disabilitarle, crearne nuove facilmente»): ONE tool, app_activity, with the actions list,
// create, update, enable, disable, delete, run and history (ActivityToolArgs in src/shared/activities.ts). It calls the same
// service methods as the page's IPC handlers (ActivitiesControl below mirrors the 'activities:*' channels), so there is no
// second path to a write: every field goes through validateActivityInput, and a wrong one is refused with a reason in
// Italian. No approval and no «user turn» gate: the Orchestrator counts as the user (ADR 0275), an activity only reads and
// proposes (ADR 0373 decision 4) and can be deleted and rebuilt in a minute. `id` is an activity's id or its name. The
// answers carry names, the rules in words, last runs and costs, and never an item's text (no mail bodies, no chat text).
// The engine part builds the service; the integrator hands it to appControlTools as `activities` (see the wiring notes in
// docs/tasks/scheduled-activities.md). Tests: test/unit/appctl-activities.test.ts, with a fake ActivitiesControl.
import {
  ACTIVITIES_MAX, ACTIVITY_ACTIONS, ACTIVITY_CAP_DEFAULT, ACTIVITY_CAP_MAX, ACTIVITY_EVERY_DEFAULT, ACTIVITY_EVERY_MAX, ACTIVITY_EVERY_MIN,
  ACTIVITY_HISTORY_MAX, ACTIVITY_NAME_MAX, ACTIVITY_PROPOSE_MAX, ACTIVITY_SOURCES, ACTIVITY_SOURCE_NAME, readsAtZeroTokens, sumCost,
  validateActivityInput, type ActivitiesState, type ActivityFilter, type ActivityInput, type ActivityResult, type ActivityRun,
  type ActivityRunStatus, type ActivityView,
} from '../../shared/activities';

type Maybe<T> = T | Promise<T>;

/** What the tool needs of the engine's service: the page's 'activities:*' handlers (src/shared/contract/activities.ts). */
export interface ActivitiesControl {
  state(): Maybe<ActivitiesState>;
  save(a: { id?: string; input: ActivityInput }): Maybe<ActivityResult>;
  enable(a: { id: string; on: boolean }): Maybe<ActivityResult>;
  remove(a: { id: string }): Maybe<ActivityResult>;
  run(a: { id: string }): Maybe<ActivityResult>;
  history(a: { id: string }): Maybe<ActivityRun[]>;
  pause(a: { paused: boolean }): Maybe<ActivitiesState>;
}
interface Tool { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(a: Record<string, unknown>): Promise<object> | object }

const REF_MAX = 80;
const ref = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, REF_MAX) : '');
const iso = (at: number | null): string | null => (at === null ? null : new Date(at).toISOString());
const usd = (v: number | null): number | null => (v === null ? null : Math.round(v * 10_000) / 10_000);

const STATUS_WORDS: Record<ActivityRunStatus, string> = {
  idle: 'niente di nuovo (0 token)', quiet: 'letto, nessuna proposta', proposed: 'proposte inviate all\'Orchestrator',
  capped: 'ferma: raggiunto il tetto giornaliero', error: 'errore',
};

/** The filter in the user's words: «solo non lette · senza no-reply · mittenti: anna, bob». */
export function describeFilter(f: ActivityFilter): string {
  const parts = [
    ...(f.unreadOnly ? ['solo non lette'] : []), ...(f.mentionsOnly ? ['solo dove ti nominano'] : []), ...(f.excludeNoReply ? ['senza no-reply'] : []),
    ...(f.senders.length ? [`mittenti: ${f.senders.join(', ')}`] : []), ...(f.subjectWords.length ? [`titolo con: ${f.subjectWords.join(', ')}`] : []),
  ];
  return parts.length ? parts.join(' · ') : 'passa tutto';
}

function runRow(r: ActivityRun): object {
  return {
    at: iso(r.at), trigger: r.trigger === 'manual' ? 'a mano' : 'timer', result: STATUS_WORDS[r.status], status: r.status, read: r.read, kept: r.kept, proposals: r.proposals,
    usedModel: r.usedModel, tokens: r.tokens, costUsd: usd(r.costUsd), model: r.model, seconds: Math.round(r.durationMs / 100) / 10, ...(r.error ? { error: r.error } : {}),
  };
}

function row(a: ActivityView, gmailConnector: boolean): object {
  return {
    id: a.id, name: a.name, source: ACTIVITY_SOURCE_NAME[a.source], on: a.enabled, running: a.running, schedule: a.scheduleText, filter: describeFilter(a.filter), propose: a.propose,
    dailyCap: a.dailyCap, today: `${a.todayTriage} di ${a.dailyCap} passaggi`, todayCostUsd: usd(a.todayCostUsd), nextRun: iso(a.nextAt),
    lastRun: a.lastRun ? runRow(a.lastRun) : null,
    ...(!readsAtZeroTokens(a.source, gmailConnector) ? { cost: 'Gmail senza un connettore dell\'app: ogni lettura costa token' } : {}),
  };
}

function fail(reasons: string[], what: string): never { throw new Error(`${what}: ${reasons.join('; ')}`); }

export function activityTools(svc: ActivitiesControl, now: () => number = Date.now): Tool[] {
  /** the activity an argument names: its id, its name in any case, or a part of the name that matches only one */
  const find = async (v: unknown): Promise<{ a: ActivityView; st: ActivitiesState }> => {
    const st = await svc.state();
    const k = ref(v).toLowerCase();
    const list = st.activities;
    const names = () => list.map(x => `«${x.name}»`).join(', ') || 'nessuna';
    if (!k) throw new Error(`manca \`id\` (l'id o il nome di un'attività). Le attività: ${names()}`);
    const exact = list.filter(x => x.id.toLowerCase() === k || x.name.toLowerCase() === k);
    const hit = exact.length ? exact : list.filter(x => x.name.toLowerCase().includes(k));
    if (hit.length !== 1) throw new Error(`${hit.length ? 'più attività corrispondono' : 'attività sconosciuta'}: «${k}». Le attività: ${names()}`);
    return { a: hit[0]!, st };
  };
  /** the fields the caller gave, as the raw input validateActivityInput checks (a wrong type is its error, never fixed here) */
  const fields = (a: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of ['name', 'source', 'schedule', 'filter', 'propose', 'dailyCap', 'enabled']) if (a[k] !== undefined) out[k] = a[k];
    return out;
  };
  const unique = (st: ActivitiesState, name: string, exceptId?: string): void => {
    if (st.activities.some(x => x.id !== exceptId && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`esiste già un'attività chiamata «${name}»: scegli un altro nome`);
  };
  const saved = async (r: ActivityResult, id: string): Promise<ActivityView> => {
    if (!r.ok) throw new Error(r.error);
    const v = r.state.activities.find(x => x.id === r.id) ?? (await svc.state()).activities.find(x => x.id === id);
    if (!v) throw new Error('l\'attività non risulta salvata');
    return v;
  };

  return [{
    name: 'app_activity',
    description: `The user's «Attività pianificate» (the page that replaced Task): things the app watches on a timer at ZERO tokens: DevOps, Outlook, Teams or Gmail. Each activity has a source (${ACTIVITY_SOURCES.join(', ')}), a schedule, a deterministic filter and the user's own sentence of what to propose. A run reads the source, keeps only what is new and passes the filter; only if something is left, ONE cheap AI pass (the only cost) decides if there is something to propose, and then you get one grouped news to bring to the user as Sì/No. Nothing is sent or changed by an activity: it only proposes. Do what the user asks at once, no confirmation: «attiva», «spegni», «crea un'attività che mi avvisa quando…», «cancella». One call = one action. action list: every activity with its rules in words, last run, today's passes and cost, the global pause, the ready-made templates; with \`id\` (id or name) one activity. action create: \`name\`, \`source\` and \`propose\` (the user's sentence, at most ${ACTIVITY_PROPOSE_MAX} characters) are required; \`schedule\` (everyMin ${ACTIVITY_EVERY_MIN}-${ACTIVITY_EVERY_MAX}, default ${ACTIVITY_EVERY_DEFAULT}; days: ISO 1 = Monday … 7 = Sunday, empty = every day; window {from, to} local HH:MM, from before to, null = all day), \`filter\` and \`dailyCap\` (triage passes per day, 1-${ACTIVITY_CAP_MAX}, default ${ACTIVITY_CAP_DEFAULT}; at the cap it stops and says so) are optional; it starts OFF unless you pass \`enabled: true\`: if the user wants it watching, pass it. The filter fields: \`senders\` (the sender contains one of these words), \`subjectWords\` (the title contains one), \`mentionsOnly\`, \`unreadOnly\`, \`excludeNoReply\`; empty = everything passes, so a narrow filter is what keeps it cheap. At most ${ACTIVITIES_MAX} activities, names unique. action update: \`id\` plus only the fields to change (schedule and filter merge over the current ones). action enable / disable: \`id\`. action delete: \`id\`; its history goes with it, do it only when the user asks. action run: \`id\`, one run now (counted against the daily cap): returns what it read, kept, proposed and cost. action history: \`id\`, the last ${ACTIVITY_HISTORY_MAX} runs, newest first. A wrong field is refused with the reason in Italian: fix it and call again. Answers never carry the text of a mail or message.`,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: [...ACTIVITY_ACTIONS] },
      id: { type: 'string', description: 'an activity\'s id or its name (every action but list and create; list may omit it)' },
      name: { type: 'string', description: `create, update: the name as the user says it, unique, at most ${ACTIVITY_NAME_MAX} characters` },
      source: { type: 'string', enum: [...ACTIVITY_SOURCES], description: 'create, update' },
      schedule: { type: 'object', description: 'when to look; fields you omit keep their value (default: every 30 minutes, every day, all day)', properties: {
        everyMin: { type: 'number', description: `${ACTIVITY_EVERY_MIN}-${ACTIVITY_EVERY_MAX}` },
        days: { type: 'array', items: { type: 'number' }, description: 'ISO days, 1 = Monday … 7 = Sunday; empty = every day' },
        window: { type: ['object', 'null'], properties: { from: { type: 'string', description: 'HH:MM local' }, to: { type: 'string', description: 'HH:MM local, after from' } }, description: 'only inside this local time window; null = all day' },
      } },
      filter: { type: 'object', description: 'the deterministic filter, applied before any AI; fields you omit keep their value', properties: {
        senders: { type: 'array', items: { type: 'string' } }, subjectWords: { type: 'array', items: { type: 'string' } },
        mentionsOnly: { type: 'boolean' }, unreadOnly: { type: 'boolean' }, excludeNoReply: { type: 'boolean' },
      } },
      propose: { type: 'string', description: 'the user\'s sentence of what to propose when something passes, e.g. «se un collega segnala un bug, proponimi un fix»' },
      dailyCap: { type: 'number', description: `triage passes per day, 1-${ACTIVITY_CAP_MAX}` },
      enabled: { type: 'boolean', description: 'create, update: on or off' },
      paused: { type: 'boolean', description: 'pause: true = global pause on, false = resume' },
    }, required: ['action'] },
    run: async a => {
      const action = a.action;
      if (action === 'list') {
        const st = await svc.state();
        if (ref(a.id)) { const { a: one } = await find(a.id); return { activity: row(one, st.gmailConnector) }; }
        return {
          paused: st.paused, ...(st.paused ? { note: 'Pausa generale: nessuna attività parte da sola (a mano sì).' } : {}),
          activities: st.activities.map(x => row(x, st.gmailConnector)),
          todayCostUsd: usd(sumCost(st.activities.map(x => ({ costUsd: x.todayCostUsd })))),
          readyMade: st.templates.map(t => ({ template: t.id, name: t.label, source: ACTIVITY_SOURCE_NAME[t.input.source], propose: t.input.propose })),
          ...(st.activities.length ? {} : { note: 'Nessuna attività. Creane una con action create (name, source, propose), o parti da un modello.' }),
        };
      }
      if (action === 'create') {
        const st = await svc.state();
        const name = typeof a.name === 'string' ? a.name.trim() : '';
        if (!name) fail(['nome: obbligatorio'], 'attività non creata');
        if (st.activities.length >= ACTIVITIES_MAX) fail([`al massimo ${ACTIVITIES_MAX} attività: cancellane una`], 'attività non creata');
        const v = validateActivityInput(fields(a));
        if (!v.ok) return fail(v.errors, 'attività non creata');
        unique(st, v.value.name);
        const one = await saved(await svc.save({ input: v.value }), '');
        return { created: row(one, st.gmailConnector), next: one.enabled ? 'È accesa: parte al prossimo orario utile, o provala con action run.' : 'È spenta: accendila con action enable quando l\'utente la vuole.' };
      }
      if (action === 'update') {
        const { a: cur, st } = await find(a.id);
        const base: ActivityInput = { name: cur.name, source: cur.source, schedule: cur.schedule, filter: cur.filter, propose: cur.propose, dailyCap: cur.dailyCap, enabled: cur.enabled };
        const f = fields(a);
        if (!Object.keys(f).length) throw new Error('niente da cambiare: indica almeno un campo (name, source, schedule, filter, propose, dailyCap, enabled)');
        const v = validateActivityInput(f, base);
        if (!v.ok) return fail(v.errors, `«${cur.name}» non modificata`);
        unique(st, v.value.name, cur.id);
        const one = await saved(await svc.save({ id: cur.id, input: v.value }), cur.id);
        return { updated: row(one, st.gmailConnector) };
      }
      if (action === 'enable' || action === 'disable') {
        const { a: cur, st } = await find(a.id);
        const on = action === 'enable';
        const one = await saved(await svc.enable({ id: cur.id, on }), cur.id);
        return { [on ? 'enabled' : 'disabled']: row(one, st.gmailConnector), ...(on && st.paused ? { note: 'Pausa generale accesa: parte solo a mano finché non la togli.' } : {}) };
      }
      if (action === 'delete') {
        const { a: cur } = await find(a.id);
        const r = await svc.remove({ id: cur.id });
        if (!r.ok) throw new Error(r.error);
        return { deleted: cur.name, left: r.state.activities.map(x => x.name), note: 'Con la sua cronologia.' };
      }
      if (action === 'run') {
        const { a: cur } = await find(a.id);
        const r = await svc.run({ id: cur.id });
        if (!r.ok) throw new Error(r.error);
        const last = r.run ?? r.state.activities.find(x => x.id === cur.id)?.lastRun ?? null;
        return { ran: cur.name, run: last ? runRow(last) : null, ...(last?.proposals ? { next: 'Le proposte sono arrivate come notizia: portale all\'utente una alla volta.' } : {}), at: iso(now()) };
      }
      if (action === 'history') {
        const { a: cur } = await find(a.id);
        const runs = [...(await svc.history({ id: cur.id }))].sort((x, y) => y.at - x.at).slice(0, ACTIVITY_HISTORY_MAX);
        return { activity: cur.name, runs: runs.map(runRow), totalCostUsd: usd(sumCost(runs)), ...(runs.length ? {} : { note: 'Nessun giro ancora.' }) };
      }
      if (action === 'pause') {
        if (typeof a.paused !== 'boolean') throw new Error('manca `paused`: true per la pausa generale, false per riprendere');
        const st = await svc.pause({ paused: a.paused });
        return { paused: st.paused, note: st.paused ? 'Pausa generale accesa: nessuna attività parte da sola (a mano sì).' : 'Pausa tolta: le attività accese ripartono ai loro orari.' };
      }
      throw new Error(`action: una tra ${ACTIVITY_ACTIONS.join(', ')}`);
    },
  }];
}
