// The Orchestrator's tool for the scheduled activities (src/main/appctl/activities.ts, ADR 0373) over a fake service that
// behaves like the engine's handlers (validated save, switch, remove, run, history): every action, the id given as a name,
// and every refusal with its reason in Italian. No engine, no clock, no disk.
import { describe, expect, it } from 'vitest';
import { activityTools, describeFilter, type ActivitiesControl } from '../../src/main/appctl/activities';
import { activityTemplates, defaultFilter, describeSchedule, type ActivitiesState, type ActivityInput, type ActivityResult, type ActivityRun, type ActivityView } from '../../src/shared/activities';

const NOW = new Date(2026, 10, 28, 9, 0).getTime();

function run(over: Partial<ActivityRun> = {}): ActivityRun {
  return { id: 'r1', activityId: 'a1', at: NOW - 60_000, durationMs: 2300, trigger: 'timer', status: 'proposed', read: 12, kept: 3, proposals: 2, usedModel: true, tokens: 1800, costUsd: 0.0123, model: 'haiku', ...over };
}

function make(seed: ActivityInput[] = []) {
  const runs = new Map<string, ActivityRun[]>();
  const st: ActivitiesState = { activities: [], paused: false, gmailConnector: false, templates: activityTemplates() };
  let n = 0;
  const view = (id: string, input: ActivityInput): ActivityView => ({
    ...input, id, createdAt: NOW, updatedAt: NOW, scheduleText: describeSchedule(input.schedule), lastRun: runs.get(id)?.[0] ?? null,
    nextAt: input.enabled ? NOW + 60_000 : null, running: false, todayTriage: 1, todayCostUsd: 0.0123, usesModelToRead: input.source === 'gmail',
  });
  const ok = (id: string, r?: ActivityRun): ActivityResult => ({ ok: true, id, state: st, ...(r ? { run: r } : {}) });
  /** the calls made after the seeding: the service's writes the tool asked for */
  const calls: string[] = [];
  const svc: ActivitiesControl = {
    state: () => st,
    save: ({ id, input }) => {
      calls.push(`save:${id ?? 'new'}`);
      if (!id) { const nid = `a${++n}`; st.activities.push(view(nid, input)); return ok(nid); }
      const i = st.activities.findIndex(x => x.id === id);
      if (i < 0) return { ok: false, error: 'attività non trovata' };
      st.activities[i] = view(id, input);
      return ok(id);
    },
    enable: ({ id, on }) => { calls.push(`enable:${id}:${on}`); const i = st.activities.findIndex(x => x.id === id); st.activities[i] = view(id, { ...st.activities[i]!, enabled: on }); return ok(id); },
    remove: ({ id }) => { calls.push(`remove:${id}`); st.activities = st.activities.filter(x => x.id !== id); return ok(id); },
    run: async ({ id }) => { calls.push(`run:${id}`); const r = run({ activityId: id, trigger: 'manual' }); runs.set(id, [r, ...(runs.get(id) ?? [])]); const i = st.activities.findIndex(x => x.id === id); st.activities[i] = { ...st.activities[i]!, lastRun: r }; return ok(id, r); },
    history: ({ id }) => runs.get(id) ?? [],
  };
  const tool = activityTools(svc, () => NOW)[0]!;
  const input = (name: string, over: Partial<ActivityInput> = {}): ActivityInput => ({ name, source: 'outlook', schedule: { everyMin: 15, days: [1, 2, 3, 4, 5], window: { from: '08:00', to: '19:00' } }, filter: { ...defaultFilter(), unreadOnly: true }, propose: 'Se serve una risposta, proponimela.', dailyCap: 10, enabled: false, ...over });
  for (const s of seed) svc.save({ input: s });
  calls.length = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a tool answer is read field by field per case
  const call = async (a: Record<string, unknown>) => await tool.run(a) as Record<string, any>;
  return { svc, st, call, tool, calls, input, runs };
}

describe('app_activity', () => {
  it('is one tool, not read-only, and names the filter fields and the daily cap', () => {
    const { tool } = make();
    expect(tool.name).toBe('app_activity');
    expect(tool.annotations?.readOnlyHint).toBe(false);
    for (const w of ['senders', 'subjectWords', 'mentionsOnly', 'unreadOnly', 'excludeNoReply', 'dailyCap', '100', 'ZERO tokens']) expect(tool.description, w).toContain(w);
  });

  it('list: empty catalog says how to start and offers the ready-made ones', async () => {
    const { call } = make();
    const r = await call({ action: 'list' });
    expect(r.activities).toEqual([]);
    expect(r.note).toMatch(/create/);
    expect(r.readyMade.map((t: { template: string }) => t.template)).toEqual(['devops', 'outlook', 'teams']);
  });

  it('list: rules in words, last run, today and costs, never an item\'s text', async () => {
    const t = make();
    t.svc.save({ input: t.input('Mail importanti', { filter: { ...defaultFilter(), unreadOnly: true, excludeNoReply: true, senders: ['anna'] } }) });
    t.svc.save({ input: t.input('Posta Gmail', { source: 'gmail' }) });
    await t.svc.run({ id: 'a1' });
    const r = await t.call({ action: 'list' });
    const a = r.activities[0];
    expect(a).toMatchObject({ id: 'a1', name: 'Mail importanti', source: 'Outlook', on: false, schedule: 'ogni 15 min · lun-ven · 08:00-19:00', filter: 'solo non lette · senza no-reply · mittenti: anna', today: '1 di 10 passaggi' });
    expect(a.lastRun).toMatchObject({ result: 'proposte inviate all\'Orchestrator', read: 12, kept: 3, proposals: 2, costUsd: 0.0123, trigger: 'a mano' });
    expect(r.activities[1].cost).toMatch(/Gmail/);
    expect(a.cost).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/"text"|body|snippet/);
    expect(r.todayCostUsd).toBe(0.0246);
  });

  it('list with an id (or a name) gives that activity only; a pause is said', async () => {
    const t = make([make().input('Teams menzioni', { source: 'teams' }), make().input('Outlook')]);
    t.st.paused = true;
    const one = await t.call({ action: 'list', id: 'teams MENZIONI' });
    expect(one.activity.name).toBe('Teams menzioni');
    expect((await t.call({ action: 'list' })).note).toMatch(/Pausa/);
  });

  it('create: fills the defaults, starts off, and refuses a second one with the same name', async () => {
    const { call, st, calls } = make();
    const r = await call({ action: 'create', name: 'Mail del capo', source: 'outlook', propose: 'Proponimi la risposta.', filter: { senders: ['capo'] } });
    expect(r.created).toMatchObject({ name: 'Mail del capo', on: false, schedule: 'ogni 30 min', dailyCap: 20, filter: 'mittenti: capo' });
    expect(r.next).toMatch(/spenta/);
    expect(st.activities).toHaveLength(1);
    expect(calls).toEqual(['save:new']);
    await expect(call({ action: 'create', name: 'mail DEL capo', source: 'teams', propose: 'x' })).rejects.toThrow(/esiste già un'attività chiamata/);
    expect(st.activities).toHaveLength(1);
  });

  it('create: on request it starts on, with its schedule and cap', async () => {
    const { call } = make();
    const r = await call({ action: 'create', name: 'Bug', source: 'devops', propose: 'Proponimi un fix.', enabled: true, dailyCap: 5, schedule: { everyMin: 60, days: [1, 2, 3], window: { from: '09:00', to: '12:00' } } });
    expect(r.created).toMatchObject({ on: true, schedule: 'ogni ora · lun-mer · 09:00-12:00', dailyCap: 5, nextRun: expect.any(String) });
  });

  it.each([
    [{ source: 'outlook', propose: 'x' }, /nome: obbligatorio/],
    [{ name: 'A', propose: 'x' }, /fonte: obbligatoria/],
    [{ name: 'A', source: 'slack', propose: 'x' }, /fonte: una tra devops, outlook, teams, gmail/],
    [{ name: 'A', source: 'outlook' }, /cosa proporre/],
    [{ name: 'A', source: 'outlook', propose: 'x', schedule: { everyMin: 2 } }, /ogni quanti minuti: da 5 a 720/],
    [{ name: 'A', source: 'outlook', propose: 'x', schedule: { window: { from: '19:00', to: '08:00' } } }, /«da» deve essere prima di «a»/],
    [{ name: 'A', source: 'outlook', propose: 'x', schedule: { days: [0, 9] } }, /giorni: numeri da 1/],
    [{ name: 'A', source: 'outlook', propose: 'x', dailyCap: 500 }, /tetto giornaliero: da 1 a 100/],
    [{ name: 'A', source: 'outlook', propose: 'x', filter: { unreadOnly: 'sì' } }, /filtro unreadOnly: sì o no/],
    [{ name: 'A', source: 'outlook', propose: 'x', enabled: 'yes' }, /acceso: sì o no/],
  ])('create refuses %j with an Italian reason', async (args, reason) => {
    const { call, st } = make();
    const err = await call({ action: 'create', ...args }).then(() => null, (e: Error) => e.message);
    expect(err).toMatch(/^attività non creata: /);
    expect(err).toMatch(reason);
    expect(st.activities).toEqual([]);
  });

  it('create refuses past the catalog limit', async () => {
    const t = make();
    for (let i = 0; i < 30; i++) t.svc.save({ input: t.input(`A${i}`) });
    await expect(t.call({ action: 'create', name: 'Una di troppo', source: 'outlook', propose: 'x' })).rejects.toThrow(/al massimo 30 attività/);
  });

  it('update: merges schedule and filter over the current ones, by name', async () => {
    const t = make();
    t.svc.save({ input: t.input('Mail', { filter: { ...defaultFilter(), unreadOnly: true, senders: ['anna'] } }) });
    t.calls.length = 0;
    const r = await t.call({ action: 'update', id: 'mail', schedule: { everyMin: 120 }, filter: { excludeNoReply: true }, propose: 'Nuova frase.' });
    expect(r.updated).toMatchObject({ schedule: 'ogni 2 ore · lun-ven · 08:00-19:00', filter: 'solo non lette · senza no-reply · mittenti: anna', propose: 'Nuova frase.', dailyCap: 10 });
    expect(t.calls).toEqual(['save:a1']);
  });

  it('update: renames, clears the window with null, and keeps the name free for itself', async () => {
    const t = make();
    t.svc.save({ input: t.input('Mail') });
    t.svc.save({ input: t.input('Altra') });
    const r = await t.call({ action: 'update', id: 'a1', name: 'Mail', schedule: { window: null } });
    expect(r.updated.schedule).toBe('ogni 15 min · lun-ven');
    await expect(t.call({ action: 'update', id: 'a1', name: 'altra' })).rejects.toThrow(/esiste già/);
  });

  it('update refuses: nothing to change, a wrong field, an unknown or an ambiguous activity', async () => {
    const t = make();
    t.svc.save({ input: t.input('Mail uno') });
    t.svc.save({ input: t.input('Mail due') });
    t.calls.length = 0;
    await expect(t.call({ action: 'update', id: 'Mail uno' })).rejects.toThrow(/niente da cambiare/);
    await expect(t.call({ action: 'update', id: 'Mail uno', propose: '   ' })).rejects.toThrow(/«Mail uno» non modificata: .*cosa proporre/);
    await expect(t.call({ action: 'update', id: 'Mail uno', schedule: { everyMin: 1 } })).rejects.toThrow(/da 5 a 720/);
    await expect(t.call({ action: 'update', id: 'Posta', propose: 'x' })).rejects.toThrow(/attività sconosciuta: «posta»\. Le attività: «Mail uno», «Mail due»/);
    await expect(t.call({ action: 'update', id: 'mail', propose: 'x' })).rejects.toThrow(/più attività corrispondono/);
    await expect(t.call({ action: 'update', propose: 'x' })).rejects.toThrow(/manca `id`/);
    expect(t.calls).toEqual([]);
  });

  it('enable and disable switch it, by id or by name', async () => {
    const t = make();
    t.svc.save({ input: t.input('Mail') });
    t.calls.length = 0;
    expect((await t.call({ action: 'enable', id: 'Mail' })).enabled).toMatchObject({ name: 'Mail', on: true });
    expect((await t.call({ action: 'disable', id: 'a1' })).disabled).toMatchObject({ on: false, nextRun: null });
    expect(t.calls).toEqual(['enable:a1:true', 'enable:a1:false']);
    t.st.paused = true;
    expect((await t.call({ action: 'enable', id: 'a1' })).note).toMatch(/Pausa generale/);
    await expect(t.call({ action: 'enable', id: 'nulla' })).rejects.toThrow(/attività sconosciuta/);
  });

  it('delete removes it and says what is left; a service refusal comes through', async () => {
    const t = make();
    t.svc.save({ input: t.input('Mail') });
    t.svc.save({ input: t.input('Teams', { source: 'teams' }) });
    t.calls.length = 0;
    const r = await t.call({ action: 'delete', id: 'Mail' });
    expect(r).toMatchObject({ deleted: 'Mail', left: ['Teams'] });
    expect(t.calls).toEqual(['remove:a1']);
    t.svc.remove = () => ({ ok: false, error: 'sta girando: riprova tra un momento' });
    await expect(t.call({ action: 'delete', id: 'Teams' })).rejects.toThrow('sta girando: riprova tra un momento');
  });

  it('run: one run now, with what it read, kept, proposed and cost; capped and failed runs are told', async () => {
    const t = make();
    t.svc.save({ input: t.input('Mail') });
    const r = await t.call({ action: 'run', id: 'Mail' });
    expect(r.ran).toBe('Mail');
    expect(r.run).toMatchObject({ trigger: 'a mano', read: 12, kept: 3, proposals: 2, costUsd: 0.0123, tokens: 1800, seconds: 2.3 });
    expect(r.next).toMatch(/una alla volta/);
    t.svc.run = () => ({ ok: true, id: 'a1', state: t.st, run: run({ status: 'capped', proposals: 0, kept: 0, usedModel: false, tokens: null, costUsd: null }) });
    expect((await t.call({ action: 'run', id: 'a1' })).run).toMatchObject({ result: 'ferma: raggiunto il tetto giornaliero', costUsd: null });
    t.svc.run = () => ({ ok: false, error: 'le attività pianificate non sono ancora pronte' });
    await expect(t.call({ action: 'run', id: 'a1' })).rejects.toThrow('non sono ancora pronte');
  });

  it('history: the runs newest first with their total cost, errors in the user\'s words', async () => {
    const t = make();
    t.svc.save({ input: t.input('Mail') });
    t.runs.set('a1', [run({ id: 'old', at: NOW - 3_600_000, costUsd: 0.01 }), run({ id: 'new', at: NOW - 60_000, status: 'error', error: 'accesso scaduto', usedModel: false, tokens: null, costUsd: null })]);
    const r = await t.call({ action: 'history', id: 'Mail' });
    expect(r.runs).toHaveLength(2);
    expect(r.runs[0]).toMatchObject({ status: 'error', result: 'errore', error: 'accesso scaduto' });
    expect(r.totalCostUsd).toBe(0.01);
    t.runs.set('a1', []);
    expect((await t.call({ action: 'history', id: 'a1' })).note).toBe('Nessun giro ancora.');
  });

  it('refuses an unknown action', async () => {
    await expect(make().call({ action: 'pause' })).rejects.toThrow(/action: una tra list, create, update, enable, disable, delete, run, history/);
  });
});

describe('describeFilter', () => {
  it('says the filter in words, and «passa tutto» when it is empty', () => {
    expect(describeFilter(defaultFilter())).toBe('passa tutto');
    expect(describeFilter({ senders: ['a', 'b'], subjectWords: ['urgente'], mentionsOnly: true, unreadOnly: false, excludeNoReply: false })).toBe('solo dove ti nominano · mittenti: a, b · titolo con: urgente');
  });
});
