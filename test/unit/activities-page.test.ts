// The pure side of the «Attività pianificate» page (src/renderer/lib/activities.ts) and the demo handlers that feed it
// (src/main/ipc-handlers/activities-demo.ts): the form's strings become the same input the Orchestrator's tool validates,
// wrong fields come back as errors, the run line reads «letti · tenuti · proposte · costo», and the demo catalog behaves
// like the engine's contract (save, enable, run, pause, remove, history capped at 20).
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import { activityTemplates, ACTIVITY_HISTORY_MAX, type ActivitiesState } from '../../src/shared/activities';
import { blankDraft, draftFromInput, parseList, runLine, STATUS_TONE, validateDraft } from '../../src/renderer/lib/activities';
import { activitiesDemoHandlers } from '../../src/main/ipc-handlers/activities-demo';

describe('the form draft', () => {
  it('splits lists on commas, semicolons and new lines, dropping empties', () => {
    expect(parseList('a, b;\n c ,, ')).toEqual(['a', 'b', 'c']);
    expect(parseList('')).toEqual([]);
  });
  it('round-trips a template through the form', () => {
    for (const tpl of activityTemplates()) {
      const v = validateDraft(draftFromInput(tpl.input));
      expect(v).toEqual({ ok: true, input: tpl.input });
    }
  });
  it('shows the validator\'s errors for wrong fields, never fixing them silently', () => {
    const d = { ...blankDraft('outlook'), name: 'Posta', propose: '', everyMin: '2', dailyCap: '500', useWindow: true, from: '19:00', to: '08:00' };
    const v = validateDraft(d);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.join('|')).toMatch(/cosa proporre/);
      expect(v.errors.join('|')).toMatch(/ogni quanti minuti/);
      expect(v.errors.join('|')).toMatch(/tetto giornaliero/);
      expect(v.errors.join('|')).toMatch(/fascia oraria/);
    }
  });
  it('treats an empty number as an error, not as zero', () => {
    const v = validateDraft({ ...blankDraft(), propose: 'x', everyMin: '' });
    expect(v.ok).toBe(false);
  });
});

describe('the run line and tones', () => {
  it('writes read · kept · proposals · cost, «nessun costo» when nothing was measured', () => {
    expect(runLine({ read: 12, kept: 3, proposals: 1, costUsd: null })).toMatch(/^letti 12 · tenuti 3 · proposte 1 · /);
    expect(runLine({ read: 0, kept: 0, proposals: 0, costUsd: 0 })).toBe(runLine({ read: 0, kept: 0, proposals: 0, costUsd: null }));
  });
  it('gives every status a tone', () => {
    expect(Object.keys(STATUS_TONE).sort()).toEqual(['capped', 'error', 'idle', 'proposed', 'quiet']);
    expect(STATUS_TONE.error).toBe('bad');
  });
});

describe('the demo handlers', () => {
  const make = () => {
    const pushed: ActivitiesState[] = [];
    const h = activitiesDemoHandlers(s => pushed.push(s), () => Date.UTC(2026, 10, 28, 10, 0));
    const call = <K extends keyof typeof h>(k: K, arg: Parameters<(typeof h)[K]>[0]) => (h[k] as unknown as (a: unknown) => unknown)(arg);
    return { h, pushed, call };
  };
  it('starts with four activities, one of them Gmail marked as costing tokens, and the three templates', async () => {
    const { call } = make();
    const s = await call('activities:state', undefined) as ActivitiesState;
    expect(s.activities).toHaveLength(4);
    expect(s.templates).toHaveLength(3);
    expect(s.activities.find(a => a.source === 'gmail')?.usesModelToRead).toBe(true);
    expect(s.activities.every(a => a.scheduleText.startsWith('ogni'))).toBe(true);
  });
  it('switches an activity, pushes the new state, and the pause clears every next run', async () => {
    const { call, pushed } = make();
    const s0 = await call('activities:state', undefined) as ActivitiesState;
    const off = s0.activities.find(a => !a.enabled)!;
    const r = await call('activities:enable', { id: off.id, on: true }) as { ok: true; state: ActivitiesState };
    expect(r.state.activities.find(a => a.id === off.id)?.enabled).toBe(true);
    expect(pushed).toHaveLength(1);
    const p = await call('activities:pause', { paused: true }) as ActivitiesState;
    expect(p.paused).toBe(true);
    expect(p.activities.every(a => a.nextAt === null)).toBe(true);
  });
  it('saves a new activity, refuses a wrong one, removes it', async () => {
    const { call } = make();
    const bad = await call('activities:save', { input: { name: 'x', source: 'teams', propose: '' } as never }) as { ok: boolean };
    expect(bad.ok).toBe(false);
    const ok = await call('activities:save', { input: { name: 'Nuova', source: 'teams', propose: 'avvisami' } as never }) as { ok: true; id: string; state: ActivitiesState };
    expect(ok.ok).toBe(true);
    expect(ok.state.activities).toHaveLength(5);
    const gone = await call('activities:remove', { id: ok.id }) as { ok: true; state: ActivitiesState };
    expect(gone.state.activities).toHaveLength(4);
    expect((await call('activities:remove', { id: 'nope' }) as { ok: boolean }).ok).toBe(false);
  });
  it('a manual run lands first in the history, which never passes the cap', async () => {
    const { call } = make();
    const s0 = await call('activities:state', undefined) as ActivitiesState;
    const id = s0.activities[0]!.id;
    for (let i = 0; i < ACTIVITY_HISTORY_MAX + 5; i++) await call('activities:run', { id });
    const hist = await call('activities:history', { id }) as { trigger: string }[];
    expect(hist).toHaveLength(ACTIVITY_HISTORY_MAX);
    expect(hist[0]!.trigger).toBe('manual');
  });
});
