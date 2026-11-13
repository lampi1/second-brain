// Scheduled routines (ADR 0280): the calendar (shared/schedules.ts nextDue and parseWhen, in the PC's local time), the
// service (main/schedules/service.ts: a due routine goes to the Orchestrator once, its next time is set before the
// hand-over, a time missed while the app was closed runs once and says how late, pause never fires for the paused
// time, a failed hand-over is recorded) and the Orchestrator's app_schedule tool. A fake clock, a temp file, no timer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nextDue, parseScheduleEdit, parseWhen, type SchedulesState } from '@shared/schedules';
import { SchedulesService, scheduledText, whenWords } from '../../src/main/schedules/service';
import { scheduleTools } from '../../src/main/appctl/schedules';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime(); // November 2026: the 13th is a Friday
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function make(o: { fail?: () => boolean; file?: string } = {}) {
  const dir = o.file ? path.dirname(o.file) : fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sched-'));
  if (!o.file) dirs.push(dir);
  const clock = { t: at(13, 7) };
  const sent: { name: string; late: number; text: string }[] = [];
  const events: SchedulesState[] = [];
  const file = o.file ?? path.join(dir, 'schedules.json');
  const svc = new SchedulesService({ file, now: () => clock.t, changed: s => events.push(s),
    run: async (task, late) => { if (o.fail?.()) throw new Error('Nessun Orchestrator aperto.'); sent.push({ name: task.name, late, text: scheduledText(task, late) }); return { chatId: 'orch-1' }; } });
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { svc, clock, sent, events, file, settle, one: () => svc.state().tasks[0]! };
}

describe('the calendar', () => {
  it('daily: today when the time is still ahead, else tomorrow; week days are respected', () => {
    expect(nextDue({ kind: 'daily', time: '08:00' }, at(13, 7))).toBe(at(13, 8));
    expect(nextDue({ kind: 'daily', time: '08:00' }, at(13, 8))).toBe(at(14, 8));
    // Friday 13th after 08:00, working days only: Monday 16th
    expect(nextDue({ kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] }, at(13, 9))).toBe(at(16, 8));
    expect(nextDue({ kind: 'daily', time: '23:30', days: [5] }, at(13, 23, 30))).toBe(at(20, 23, 30));
    expect(nextDue({ kind: 'daily', time: 'nope' }, at(13, 7))).toBeNull();
  });
  it('every, once and manual', () => {
    expect(nextDue({ kind: 'every', minutes: 120 }, at(13, 7))).toBe(at(13, 9));
    expect(nextDue({ kind: 'every', minutes: 120 }, at(13, 7), at(13, 6))).toBe(at(13, 8));
    expect(nextDue({ kind: 'once', at: at(14, 10) }, at(13, 7))).toBe(at(14, 10));
    expect(nextDue({ kind: 'once', at: at(12, 10) }, at(13, 7))).toBeNull();
    expect(nextDue({ kind: 'manual' }, at(13, 7))).toBeNull();
  });
  it('checks a rule from outside', () => {
    expect(parseWhen({ kind: 'daily', time: '08:05', days: [5, 1, 1] }, 0)).toEqual({ kind: 'daily', time: '08:05', days: [1, 5] });
    // a day that is not 0..6 is refused, never dropped (7 for Sunday would otherwise mean every day)
    for (const days of [[7], [1, 9], ['x'], [null]]) expect(() => parseWhen({ kind: 'daily', time: '08:05', days }, 0)).toThrow(/0 \(Sunday\)/);
    expect(scheduledText({ name: 'N', prompt: 'P', when: { kind: 'manual' }, by: 'orchestrator' }, 0)).toContain('You planned this request');
    expect(scheduledText({ name: 'N', prompt: 'P', when: { kind: 'manual' }, by: 'user' }, 0)).toContain('The user planned this request');
    expect(parseWhen({ kind: 'daily', time: '08:05', days: [0, 1, 2, 3, 4, 5, 6] }, 0)).toEqual({ kind: 'daily', time: '08:05' });
    expect(parseWhen({ kind: 'once', at: new Date(at(14, 10)).toISOString() }, at(13, 7))).toEqual({ kind: 'once', at: at(14, 10) });
    for (const bad of [{ kind: 'daily', time: '8:00' }, { kind: 'daily', time: '24:00' }, { kind: 'every', minutes: 5 }, { kind: 'every', minutes: 'x' }, { kind: 'once', at: at(12, 0) }, { kind: 'cron' }, null]) expect(() => parseWhen(bad, at(13, 7))).toThrow();
    expect(() => parseScheduleEdit({ op: 'nope' }, 0)).toThrow();
    expect(parseScheduleEdit({ op: 'update', id: 'a', on: false, extra: 1 }, 0)).toEqual({ op: 'update', id: 'a', on: false });
  });
  it('says the rule in words', () => {
    expect(whenWords({ kind: 'daily', time: '08:00', days: [1, 5] })).toBe('Mon, Fri at 08:00');
    expect(whenWords({ kind: 'every', minutes: 120 })).toBe('every 2 hour(s)');
  });
});

describe('the service', () => {
  it('hands a due routine to the Orchestrator once and sets its next time', async () => {
    const { svc, clock, sent, settle, one } = make();
    svc.edit({ op: 'create', name: 'Giornale del mattino', prompt: 'Aggiorna il giornale.', when: { kind: 'daily', time: '08:00' } });
    expect(one()).toMatchObject({ on: true, by: 'user', nextAt: at(13, 8), runs: [] });
    svc.tick();
    await settle();
    expect(sent).toHaveLength(0); // 07:00
    clock.t = at(13, 8, 0) + 20_000;
    svc.tick(); svc.tick();
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/^\[scheduled routine «Giornale del mattino» · every day at 08:00\] /);
    expect(sent[0]!.text.endsWith('\n\nAggiorna il giornale.')).toBe(true);
    expect(one().nextAt).toBe(at(14, 8));
    expect(one().runs[0]).toEqual({ at: clock.t, ok: true, chatId: 'orch-1' });
    svc.tick();
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('a time missed while the app was closed runs once, and says how late', async () => {
    const first = make();
    first.svc.edit({ op: 'create', name: 'Ogni due ore', prompt: 'Controlla.', when: { kind: 'every', minutes: 120 } });
    // the app closes and reopens the next morning: nine times were missed
    const again = make({ file: first.file });
    again.clock.t = at(14, 9);
    again.svc.tick();
    await again.settle();
    expect(again.sent).toHaveLength(1);
    expect(again.sent[0]!.late).toBe(24 * 60);
    expect(again.sent[0]!.text).toContain('1440 min late');
    expect(again.one().runs[0]).toMatchObject({ ok: true, late: 1440 });
    expect(again.one().nextAt).toBe(at(14, 11));
  });

  it('once runs once and turns itself off; manual never runs by itself; «Esegui ora» leaves the schedule alone', async () => {
    const { svc, clock, sent, settle } = make();
    svc.edit({ op: 'create', name: 'Una volta', prompt: 'Ricordami la call.', when: { kind: 'once', at: at(13, 9) } });
    svc.edit({ op: 'create', name: '', prompt: 'A mano\nseconda riga', when: { kind: 'manual' } });
    const [once, manual] = svc.state().tasks;
    expect(manual).toMatchObject({ name: 'A mano', nextAt: null });
    svc.edit({ op: 'run', id: manual!.id });
    await settle();
    expect(sent.map(s => s.name)).toEqual(['A mano']);
    expect(svc.state().tasks[1]!.runs[0]).toMatchObject({ ok: true, manual: true });
    svc.edit({ op: 'run', id: once!.id });
    await settle();
    expect(svc.state().tasks[0]).toMatchObject({ on: true, nextAt: at(13, 9) });
    clock.t = at(13, 9, 1);
    svc.tick();
    await settle();
    clock.t = at(15, 9);
    svc.tick();
    await settle();
    expect(sent.map(s => s.name)).toEqual(['A mano', 'Una volta', 'Una volta']);
    expect(svc.state().tasks[0]).toMatchObject({ on: false, nextAt: null });
  });

  it('a paused routine does not fire, and a resume counts from now', async () => {
    const { svc, clock, sent, settle, one } = make();
    svc.edit({ op: 'create', name: 'R', prompt: 'P', when: { kind: 'every', minutes: 60 } });
    svc.edit({ op: 'update', id: one().id, on: false });
    expect(one().nextAt).toBeNull();
    clock.t = at(13, 12);
    svc.tick();
    await settle();
    expect(sent).toHaveLength(0);
    svc.edit({ op: 'update', id: one().id, on: true });
    expect(one().nextAt).toBe(at(13, 13));
    // a new rule counts from now too; a new text keeps the time
    svc.edit({ op: 'update', id: one().id, when: { kind: 'daily', time: '18:00' } });
    expect(one().nextAt).toBe(at(13, 18));
    svc.edit({ op: 'update', id: one().id, prompt: 'Nuovo testo' });
    expect(one()).toMatchObject({ prompt: 'Nuovo testo', nextAt: at(13, 18) });
  });

  it('records a hand-over that failed and still moves to the next time', async () => {
    let down = true;
    const { svc, clock, sent, settle, one } = make({ fail: () => down });
    svc.edit({ op: 'create', name: 'R', prompt: 'P', when: { kind: 'daily', time: '08:00' } });
    clock.t = at(13, 8);
    svc.tick();
    await settle();
    expect(sent).toHaveLength(0);
    expect(one().runs[0]).toMatchObject({ ok: false, error: 'Nessun Orchestrator aperto.' });
    expect(one().nextAt).toBe(at(14, 8));
    down = false;
    svc.edit({ op: 'run', id: one().id });
    await settle();
    expect(one().runs.map(r => r.ok)).toEqual([true, false]);
  });

  it('keeps the list across a restart, refuses empty requests and unknown ids, deletes', () => {
    const { svc, file, events, one } = make();
    expect(() => svc.edit({ op: 'create', name: 'x', prompt: '  ', when: { kind: 'manual' } })).toThrow();
    expect(() => svc.edit({ op: 'delete', id: 'nope' })).toThrow();
    svc.edit({ op: 'create', name: 'R', prompt: 'P', when: { kind: 'daily', time: '08:00', days: [1] } }, 'orchestrator');
    expect(events.at(-1)!.tasks).toHaveLength(1);
    const again = make({ file });
    expect(again.one()).toMatchObject({ name: 'R', by: 'orchestrator', when: { kind: 'daily', time: '08:00', days: [1] } });
    expect(() => svc.edit({ op: 'update', id: one().id, name: ' ' })).toThrow();
    svc.edit({ op: 'delete', id: one().id });
    expect(svc.state().tasks).toEqual([]);
  });
});

describe('app_schedule', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a tool answer is read field by field per case
  const tool = (svc: SchedulesService, ui: string[] = []) => { const [t] = scheduleTools(svc, c => ui.push(`${c.action}:${'value' in c ? String(c.value) : ''}`), () => at(13, 7)); return (a: Record<string, unknown> = {}) => t!.run(a) as Record<string, any>; };
  it('creates in the user\'s name, lists, pauses, runs and deletes by name', async () => {
    const { svc, sent, settle } = make();
    const ui: string[] = [];
    const call = tool(svc, ui);
    expect(call().routines).toEqual([]);
    const made = call({ op: 'create', name: 'Giornale del mattino', request: 'Aggiorna il giornale e dimmi le tre notizie.', when: { kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] } });
    expect(made.created).toMatchObject({ name: 'Giornale del mattino', by: 'orchestrator', whenInWords: 'Mon, Tue, Wed, Thu, Fri at 08:00', next: new Date(at(13, 8)).toISOString() });
    expect(ui).toEqual(['page:flussi']);
    expect(call({ op: 'pause', routine: 'giornale' }).paused).toMatchObject({ on: false, next: null });
    expect(call({ op: 'resume', routine: 'Giornale del mattino' }).resumed.on).toBe(true);
    expect(call({ op: 'update', routine: 'giornale', when: { kind: 'every', minutes: 60 } }).updated.whenInWords).toBe('every 1 hour(s)');
    call({ op: 'run', routine: 'giornale' });
    await settle();
    expect(sent).toHaveLength(1);
    expect(call().routines[0].lastRuns[0]).toMatchObject({ ok: true, manual: true });
    expect(() => call({ op: 'delete', routine: 'nope' })).toThrow(/non trovata/);
    expect(() => call({ op: 'create', request: 'x', when: { kind: 'every', minutes: 1 } })).toThrow(/minutes/);
    expect(call({ op: 'delete', routine: 'giornale' })).toEqual({ deleted: 'Giornale del mattino' });
  });
});
