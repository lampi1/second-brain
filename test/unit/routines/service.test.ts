// Terminal-only routine observation: inert construction/closed views, explicit reads, live file updates and legacy
// data preserved without recovery. Uses real temporary run files; never an engine or DevOps write from the app.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutines } from '../../../src/main/routines/service';
import { createDemoRoutines } from '../../../src/main/routines/demo';
import { createLegacyArchive } from '../../../src/main/routines/legacy';
import { flowBrainContextKey } from '../../../src/main/flows/context';
import { tempDir } from '../routine-runtime/fakes';
import type { RoutineRunDetail } from '../../../src/shared/routines';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('terminal-only app observer', () => {
  it('does no routine IO, cloning or timer work at construction or during 30 idle seconds', () => {
    const root = tempDir('routine-idle-');
    vi.useFakeTimers();
    const read = vi.spyOn(fs, 'readFileSync'), scan = vi.spyOn(fs, 'readdirSync'), watch = vi.spyOn(fs, 'watch'), clone = vi.spyOn(globalThis, 'structuredClone');
    const legacy = createLegacyArchive({ userData: root, brainRoot: () => root });
    const app = createRoutines({ userData: root, terminalRuns: path.join(root, 'terminal'), legacy });
    vi.advanceTimersByTime(30_000);
    expect({ reads: read.mock.calls.length, scans: scan.mock.calls.length, watches: watch.mock.calls.length, clones: clone.mock.calls.length, timers: vi.getTimerCount() }).toEqual({ reads: 0, scans: 0, watches: 0, clones: 0, timers: 0 });
    for (const key of ['start', 'startItem', 'resume', 'cancel', 'setTrigger', 'sync', 'tick', 'settle', 'reconcile']) expect(app).not.toHaveProperty(key);
    app.stop();
  });

  it('reads past app and terminal runs with their steps, reports and all screenshots', async () => {
    const app = createDemoRoutines(tempDir('routine-history-'), Date.now());
    const list = app.snapshot();
    expect(list.runs).toHaveLength(4);
    const done = await app.run(list.runs.find(r => r.status === 'done')!);
    expect(done.archived).toBe(true);
    expect(done.reportPath).toMatch(/report\.md$/);
    expect(done.steps.flatMap(s => s.screenshots)).toHaveLength(1);
    expect(done.lastShot?.path).toMatch(/01-air\.png$/);
    await expect(app.run({ source: 'app', routineId: '..', runId: 'x' })).rejects.toThrow();
    app.stop();
  });

  it('watches only an explicitly opened run and stops reads and events when the view closes', async () => {
    const root = tempDir('routine-watch-'), demo = createDemoRoutines(root, Date.now());
    const snapshot = demo.snapshot(), ref = snapshot.runs.find(r => r.source === 'terminal' && r.status === 'running')!;
    const changed = vi.fn<(change: { subscription: string; run?: RoutineRunDetail; error?: string }) => void>();
    const app = createRoutines({ userData: path.dirname(snapshot.dirs.appRuns), terminalRuns: snapshot.dirs.terminalRuns, changed });
    const run = await app.watch(ref, 'visible-view');
    fs.appendFileSync(path.join(run.dir, 'events.jsonl'), JSON.stringify({ type: 'action', at: Date.now(), n: 1, text: 'Nuovo passo dal terminale' }) + '\n');
    await vi.waitFor(() => expect(changed.mock.calls.some(([c]) => c.run?.events.some(e => e.type === 'action' && e.text === 'Nuovo passo dal terminale'))).toBe(true));
    app.unwatch('different-view'); // a late cleanup cannot close another view
    expect(changed).toHaveBeenCalled();
    app.unwatch('visible-view');
    changed.mockClear();
    const read = vi.spyOn(app, 'run');
    fs.appendFileSync(path.join(run.dir, 'events.jsonl'), JSON.stringify({ type: 'action', at: Date.now(), n: 1, text: 'Pagina chiusa' }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(read).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
    app.stop(); demo.stop();
  });

  it('archives the four stuck cancelled runs without changing unknown outcomes or the original files', () => {
    const root = fs.realpathSync(tempDir('routine-archive-')), key = flowBrainContextKey(root), dir = path.join(root, 'flows', key);
    fs.mkdirSync(dir, { recursive: true });
    const runs = Array.from({ length: 4 }, (_, i) => ({ id: `stuck-${i}`, flowId: 'air-bugfix-auto', flowVersion: 19, status: 'cancelled', steps: [], settlementError: 'A previous DevOps write has an unknown outcome', disposition: { cleanup: 'pending', error: 'unknown' }, pendingReconciliation: { requestedAt: 1 } }));
    const original = JSON.stringify({ schema: 1, versions: [], active: {}, drafts: [], runs });
    const file = path.join(dir, 'state.json'); fs.writeFileSync(file, original);
    const write = vi.spyOn(fs, 'writeFileSync');
    const archive = createLegacyArchive({ userData: root, brainRoot: () => root });
    expect(archive.snapshot().runs).toEqual(runs);
    expect(write).not.toHaveBeenCalled(); expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });
});
