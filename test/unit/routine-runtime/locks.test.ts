// Cross-process locks (locks.ts): routines run from different terminals never take the same work item, the same
// workspace folder or the same package's watch at once; a lock expires or is taken over when its process is gone.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createLocks, createRoutineRuntime, createRunStore, createMasker, createTriggerLoop, pathLockName, ResourceBusy, type RoutineTrigger } from '../../../packages/routine-runtime/src/index';
import type { FlowDetectionResult } from '../../../src/shared/flow-automation';
import { done, fakeDevOps, routinePackage, scriptedEngine, tempDir } from './fakes';

describe('locks', () => {
  it('one owner at a time, re-entrant for the owner, released only by it', () => {
    const dir = tempDir(), locks = createLocks(dir, { alive: () => true });
    expect(locks.acquire('item-x-1', 'run-a')).not.toBeNull();
    expect(locks.acquire('item-x-1', 'run-b')).toBeNull();
    expect(locks.holder('item-x-1')?.owner).toBe('run-a');
    expect(locks.acquire('item-x-1', 'run-a')).not.toBeNull();
    locks.release(['item-x-1'], 'run-b');
    expect(locks.holder('item-x-1')?.owner).toBe('run-a');
    locks.release(['item-x-1'], 'run-a');
    expect(locks.acquire('item-x-1', 'run-b')).not.toBeNull();
  });

  it('an expired lock, or one whose process on this host is gone, is taken over; another host\'s live lock is not', () => {
    const dir = tempDir();
    let now = 1_000;
    const a = createLocks(dir, { now: () => now, ttlMs: 100, pid: 11, host: 'pc' });
    // pid 11 is gone, as b sees it
    const b = createLocks(dir, { now: () => now, ttlMs: 100, pid: 22, host: 'pc', alive: pid => pid !== 11 });
    a.acquire('l', 'run-a');
    expect(b.acquire('l', 'run-b')?.owner).toBe('run-b');
    const other = createLocks(dir, { now: () => now, ttlMs: 100, pid: 33, host: 'other-pc', alive: () => false });
    other.acquire('m', 'run-c');
    expect(b.acquire('m', 'run-b')).toBeNull();
    now += 101;
    expect(b.acquire('m', 'run-b')?.owner).toBe('run-b');
  });

  it('a new lock appears already written: a fully written temp file is hard-linked into place, then removed', () => {
    const dir = tempDir(), locks = createLocks(dir, { alive: () => true });
    let links = 0;
    const link = vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
      expect(fs.existsSync(to)).toBe(false); // the lock name is never visible before its content
      expect(JSON.parse(fs.readFileSync(from, 'utf8'))).toMatchObject({ owner: 'run-a' });
      links++; link.mockRestore(); fs.linkSync(from, to);
    });
    try {
      expect(locks.acquire('item-x-2', 'run-a')?.owner).toBe('run-a');
      expect(links).toBe(1);
    } finally { link.mockRestore(); }
    expect(fs.readdirSync(dir)).toEqual(['item-x-2.lock']); // no temp file left behind
    expect(locks.acquire('item-x-2', 'run-b')).toBeNull(); // EEXIST: taken
    expect(fs.readdirSync(dir)).toEqual(['item-x-2.lock']);
  });

  it('path lock names ignore case and separators', () => {
    expect(pathLockName('workspace', 'C:\\Repos\\App-5')).toBe(pathLockName('workspace', 'c:/repos/app-5'));
  });
});

describe('runs and locks', () => {
  const setup = () => {
    const root = tempDir(), devops = fakeDevOps(), lockDir = path.join(root, 'locks');
    devops.addItem({ id: 5, fields: { 'System.Title': 'x', 'System.State': 'New' } });
    const pkg = routinePackage({ inputs: [{ name: 'workItem' }, { name: 'workspace', default: path.join(root, 'ws-{{workItem}}') }] });
    // two terminals: different runs roots, the same lock folder
    const runtime = (name: string) => createRoutineRuntime({ pkg, paths: { runsRoot: path.join(root, name), workspace: id => path.join(root, name, id, 'ws') },
      engine: scriptedEngine(() => done('ok')), devops: { authorization: devops.authorization, request: devops.request }, locks: createLocks(lockDir) });
    return { root, lockDir, runtime };
  };

  it('a work item or workspace held by another live run is refused; the run frees its locks when it ends', async () => {
    const { lockDir, runtime, root } = setup();
    const other = createLocks(lockDir, { alive: () => true });
    other.acquire('item-contoso-5', 'run-elsewhere');
    expect(() => runtime('a').startItem(5)).toThrow(ResourceBusy);
    expect(() => runtime('a').startItem(5)).toThrow(/work item 5 is in use by run run-elsewhere/);
    other.release(['item-contoso-5'], 'run-elsewhere');
    other.acquire(pathLockName('workspace', path.join(root, 'ws-5')), 'run-elsewhere');
    expect(() => runtime('b').startItem(5)).toThrow(/workspace .*ws-5 is in use/);
    // the refused start took nothing: the item lock is free again
    expect(other.holder('item-contoso-5')).toBeNull();
    other.release([pathLockName('workspace', path.join(root, 'ws-5'))], 'run-elsewhere');
    const run = await runtime('a').startItem(5).finished;
    expect(run.status).toBe('done');
    expect(fs.readdirSync(lockDir)).toEqual([]);
  });
});

describe('trigger and a refused start', () => {
  it('an item whose start is refused is forgotten and tried again on the next pass', async () => {
    const store = createRunStore(path.join(tempDir(), 'runs'), createMasker());
    const trigger: RoutineTrigger = { kind: 'devops', everyMinutes: 5, organization: 'contoso', project: 'Proj', areaPath: 'Proj', workItemType: 'Bug', states: ['New'], includeExisting: false };
    const result = (): FlowDetectionResult => ({ items: [{ title: 'Bug 1', inputs: { 'work-item-id': '1' } }], cursor: { 1: '3' }, summary: '1.' } as unknown as FlowDetectionResult);
    let busy = true;
    const loop = createTriggerLoop({ routineId: 'demo', trigger, store, detect: async () => result(),
      start: id => { if (busy) throw new ResourceBusy('work item 1 is in use'); return { runId: `run-${id}` }; } });
    const first = await loop.tick();
    expect(first.started).toEqual([]);
    expect(store.trigger().subjects).toEqual({});
    expect(store.trigger().cursor).toEqual({});
    busy = false;
    expect((await loop.tick()).started).toEqual([{ workItem: 1, runId: 'run-1' }]);
  });
});
