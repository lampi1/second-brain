// The app's Routine section in main (src/main/routines/): the package store (zip round trip, refused files, write-only
// secret slots, a revision keeping the stored secrets) and the service (runs from the app and terminal folders, one
// trigger loop per switched-on package, the one-time legacy conversion, missing credentials blocking starts).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RoutinePackage, RoutineRuntime } from '../../../packages/routine-runtime/src/index';
import { createDemoRoutines, demoPackages } from '../../../src/main/routines/demo';
import { createRoutines, type LegacyRoutine } from '../../../src/main/routines/service';
import { createRoutineStore, SECRET_PLACEHOLDER, secretSlots, withSecrets } from '../../../src/main/routines/store';
import { readZip, writeZip } from '../../../src/main/agents/pack/zip';
import type { FlowDefinition } from '../../../src/shared/flows';
import { tempDir } from '../routine-runtime/fakes';

const NOW = Date.UTC(2026, 9, 27, 10, 0);
const [bugfix, notes] = demoPackages() as [RoutinePackage, RoutinePackage];
const fakeRuntime = (startItem = vi.fn(() => ({ runId: 'r1', finished: new Promise<never>(() => {}) }))) =>
  ({ startItem, start: vi.fn(), resume: vi.fn(), cancel: vi.fn(), store: { trigger: () => ({ schema: 1, cursor: {}, subjects: {}, starts: [] }) } }) as unknown as RoutineRuntime;

describe('routine package store', () => {
  it('round-trips a package zip with its assets and refuses files outside assets/', () => {
    const store = createRoutineStore(tempDir('routines-store-'));
    store.save(bugfix, new Map([['prompts/fix.md', Buffer.from('# fix')]]));
    const { filename, bytes } = store.exportZip('air-bugfix');
    expect(filename).toBe('air-bugfix.routine.zip');
    expect([...readZip(bytes).keys()].sort()).toEqual(['assets/prompts/fix.md', 'routine.json']);
    const other = createRoutineStore(tempDir('routines-store-'));
    expect(other.importZip(bytes).pkg.credentials?.[0]?.password).toBe('demo-only');
    expect(fs.readFileSync(path.join(other.dirOf('air-bugfix'), 'assets', 'prompts', 'fix.md'), 'utf8')).toBe('# fix');
    const bad = writeZip(new Map([['routine.json', Buffer.from(JSON.stringify(bugfix))], ['run.ps1', Buffer.from('x')]]));
    expect(() => other.importZip(bad)).toThrow(/run\.ps1/);
  });

  it('lists the placeholder slots as unset, fills only known slots and keeps stored secrets on a revision', () => {
    expect(secretSlots(notes)).toEqual([expect.objectContaining({ slot: 'devopsPat', set: false })]);
    expect(() => withSecrets(notes, { 'login:0:user': 'x' })).toThrow();
    expect(() => withSecrets(notes, { devopsPat: SECRET_PLACEHOLDER })).toThrow();
    const store = createRoutineStore(tempDir('routines-store-'));
    store.save(notes);
    expect(secretSlots(store.setSecrets('release-notes', { devopsPat: 'pat-value' }).pkg)[0]!.set).toBe(true);
    // an agent's revision carries the placeholder again: the stored value stays
    const revised = store.save({ ...notes, routine: { ...notes.routine, title: 'Note v2' } });
    expect(revised.pkg.secrets?.devopsPat).toBe('pat-value');
    expect(revised.pkg.routine.title).toBe('Note v2');
  });
});

describe('routines service', () => {
  it('lists packages and the runs of both the app and the terminal folders, never a secret value', () => {
    const routines = createDemoRoutines(tempDir('routines-demo-'), NOW);
    const snap = routines.snapshot();
    expect(snap.routines.map(r => r.id)).toEqual(['air-bugfix', 'release-notes']);
    expect(new Set(snap.runs.map(r => r.source))).toEqual(new Set(['app', 'terminal']));
    expect(snap.runs).toHaveLength(4);
    const waiting = snap.runs.find(r => r.status === 'waiting-human')!;
    expect(waiting.waiting?.url).toContain('_workitems/edit/48213');
    expect(waiting.workItemUrl).toBe(`https://dev.azure.com/${bugfix.routine.devops!.organization}/Air/_workitems/edit/48213`);
    expect(snap.routines[1]!.secretSlots.some(s => !s.set)).toBe(true);
    expect(snap.routines[0]!.commands.item).toContain('workItem=ID');
    expect(JSON.stringify(snap)).not.toContain('demo-only');
  });

  it('refuses a start or a trigger while credentials are missing', () => {
    const routines = createDemoRoutines(tempDir('routines-demo-'), NOW);
    expect(() => routines.startItem('release-notes', 1)).toThrow(/Credenziali da inserire/);
    const userData = tempDir('routines-'), startItem = vi.fn(() => ({ runId: 'r1', finished: new Promise<never>(() => {}) }));
    const svc = createRoutines({ userData, terminalRuns: tempDir('routines-term-'), runtimeFor: () => fakeRuntime(startItem), convert: () => bugfix, loop: () => ({ start() {}, stop() {} }) });
    svc.store.save({ ...bugfix, credentials: [{ ...bugfix.credentials![0]!, password: SECRET_PLACEHOLDER }] });
    expect(() => svc.setTrigger('air-bugfix', true)).toThrow(/Credenziali da inserire/);
    svc.setSecrets('air-bugfix', { 'login:0:password': 'typed' });
    expect(svc.startItem('air-bugfix', 42)).toEqual({ source: 'app', routineId: 'air-bugfix', runId: 'r1' });
    expect(startItem).toHaveBeenCalledWith(42, {});
  });

  it('runs one trigger loop per switched-on package and stops it when switched off', () => {
    const loops: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
    const svc = createRoutines({ userData: tempDir('routines-'), terminalRuns: tempDir('routines-term-'), runtimeFor: () => fakeRuntime(), convert: () => bugfix,
      loop: () => { const l = { start: vi.fn(), stop: vi.fn() }; loops.push(l); return l; } });
    svc.store.save(bugfix);
    svc.setTrigger('air-bugfix', true);
    svc.sync(); svc.snapshot();
    expect(loops).toHaveLength(1);
    expect(loops[0]!.start).toHaveBeenCalledTimes(1);
    svc.setTrigger('air-bugfix', true, { everyMinutes: 10, states: ['New'], includeTags: ['ai-fixable'], excludeTags: [], workItemIds: [] });
    expect(loops).toHaveLength(2);
    expect(loops[0]!.stop).toHaveBeenCalled();
    svc.setTrigger('air-bugfix', false);
    expect(loops[1]!.stop).toHaveBeenCalled();
    svc.stop();
  });

  it('converts an active legacy routine once, moving its enabled trigger to the package', () => {
    const pauseLegacy = vi.fn();
    const item: LegacyRoutine = { flowId: 'air-bugfix', title: 'Air', definition: {} as FlowDefinition, rule: { id: 'rule-1', revision: 3, enabled: true, automation: {} as NonNullable<LegacyRoutine['rule']>['automation'] } };
    const convert = vi.fn(() => bugfix);
    const svc = createRoutines({ userData: tempDir('routines-'), terminalRuns: tempDir('routines-term-'), runtimeFor: () => fakeRuntime(), convert, legacy: () => [item], pauseLegacy, loop: () => ({ start() {}, stop() {} }) });
    svc.sync(); svc.sync();
    expect(convert).toHaveBeenCalledTimes(1);
    expect(pauseLegacy).toHaveBeenCalledWith('rule-1', 3);
    expect(svc.store.get('air-bugfix').app.triggerEnabled).toBe(true);
    expect(svc.packaged('air-bugfix')).toBe(true);
  });

  it('refuses run paths outside the run roots and cancels only app runs', () => {
    const routines = createDemoRoutines(tempDir('routines-demo-'), NOW);
    expect(() => routines.run({ source: 'app', routineId: '..', runId: 'x' })).toThrow();
    expect(() => routines.cancel({ source: 'terminal', routineId: 'air-bugfix', runId: '20261026-163000-112233' })).toThrow(/terminale/);
  });
});
