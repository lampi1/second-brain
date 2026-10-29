// The agent runs in userData/app.db (ADR 0199): the one-time move from agent-runs.json (counts equal, the JSON kept as
// agent-runs.json.migrated-<date>), the JSON fallback when the move or the database fails, writes of only the changed
// runs, the prune into rollups, a reopen after a restart, a corrupt database moved aside and rebuilt from the migrated
// copy, the schema version, and the read-only export the levels CLI uses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRunStore, RUNS_MAX, endRun, type RunStart } from '../../../src/main/agents/runs';
import { RunsDb, exportRuns, isSqliteFile, readRunsSource, AREA } from '../../../src/main/agents/runs-db';
import { areaVersion, closeAppDbs, migrate, openAppDb } from '../../../src/main/app-db';
import { emptyTally } from '../../../src/main/agents/run-metrics';
import { diagnoseFile } from '../../../src/main/agents/level-diagnosis';
import { log } from '../../../src/main/log';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); closeAppDbs(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-runsdb-')); roots.push(d); return d; };
const start = (o: Partial<RunStart> = {}): RunStart => ({ chatId: 'c1', agentId: 'reviewer', version: 2, goal: 'Rivedi', startedBy: 'user', startedAt: 1000, costKnown: true, ...o });
const migrated = (dir: string) => fs.readdirSync(dir).filter(n => n.startsWith('agent-runs.json.migrated-'));
const quiet = () => ({ error: vi.spyOn(log, 'error').mockImplementation(() => {}), warn: vi.spyOn(log, 'warn').mockImplementation(() => {}), info: vi.spyOn(log, 'info').mockImplementation(() => {}) });

/** An agent-runs.json as the JSON store writes it: `n` runs (the last open), a rollup, prunedThrough and Flash's log. */
function seedJson(dir: string, n = 30): { runs: ReturnType<AgentRunStore['list']>; body: string; flash: ReturnType<AgentRunStore['flashLog']> } {
  const s = new AgentRunStore(dir, { db: false });
  for (let i = 0; i < n; i++) { const r = s.start(start({ chatId: `c${i}`, startedAt: 1000 + i }), false); if (i < n - 1) endRun(r, 'completed', 2000 + i); }
  s.flashEvent({ kind: 'asked', text: 'quanto costa il piano Pro di Claude?', at: 1000 });
  s.flashEvent({ kind: 'answered', at: 2000 });
  s.flashEvent({ kind: 'asked', text: 'no, è sbagliato', at: 3000 });
  s.save();
  const file = path.join(dir, 'agent-runs.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  raw.rollups = [emptyTally('coder', 1)]; raw.prunedThrough = 500;
  const body = JSON.stringify(raw);
  fs.writeFileSync(file, body);
  return { runs: s.list(), body, flash: s.flashLog() };
}

describe('the move from agent-runs.json', () => {
  it('imports every run, rollup, prunedThrough and Flash log in one go, then keeps the JSON renamed', () => {
    const dir = tmp(), { runs, body, flash } = seedJson(dir);
    const { info } = quiet();
    const s = new AgentRunStore(dir);
    expect(s.backend).toBe('sqlite');
    expect(s.problem).toBeNull();
    expect(s.list()).toEqual(runs);
    expect(s.rolledUp()).toEqual([emptyTally('coder', 1)]);
    expect(s.flashLog()).toEqual(flash);
    expect(flash.done).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, 'agent-runs.json'))).toBe(false);
    const kept = migrated(dir);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/^agent-runs\.json\.migrated-\d{4}-\d{2}-\d{2}T/);
    expect(fs.readFileSync(path.join(dir, kept[0]!), 'utf8')).toBe(body); // byte for byte
    const db = exportRuns(path.join(dir, 'app.db'))!;
    expect(db.runs).toHaveLength(runs.length); // counts equal
    expect(db.prunedThrough).toBe(500);
    expect(info).toHaveBeenCalledWith('agents', 'agent runs moved to app.db', expect.objectContaining({ data: expect.objectContaining({ runs: runs.length, rollups: 1 }) }));
    // a restart reads the database; the migrated copy is never read again nor touched
    s.close();
    const again = new AgentRunStore(dir);
    expect(again.list()).toEqual(runs);
    expect(migrated(dir)).toEqual(kept);
  });

  it('a record out of shape is left out of the database; the original keeps it, as the migrated copy', () => {
    const dir = tmp(), { runs } = seedJson(dir, 3);
    const file = path.join(dir, 'agent-runs.json'), raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { runs: unknown[] };
    raw.runs.splice(1, 0, null, { runId: 'bad' });
    fs.writeFileSync(file, JSON.stringify(raw));
    const { warn } = quiet();
    const s = new AgentRunStore(dir);
    expect(s.list()).toEqual(runs);
    expect(warn).toHaveBeenCalledWith('agents', 'invalid agent run records skipped', expect.objectContaining({ data: { skipped: 2, kept: 3 } }));
    expect(JSON.parse(fs.readFileSync(path.join(dir, migrated(dir)[0]!), 'utf8'))).toEqual(raw);
  });

  it('an agent-runs.json out of shape is kept where it is and reported, as before the database', () => {
    const dir = tmp(), file = path.join(dir, 'agent-runs.json');
    fs.writeFileSync(file, '{"version":2,"runs":[]}');
    const s = new AgentRunStore(dir);
    expect(s.problem).toMatch(/non è leggibile/);
    expect(s.backend).toBe('json');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"version":2,"runs":[]}');
    expect(migrated(dir)).toEqual([]);
  });

  it('a failed import keeps agent-runs.json as the store (fallback), logs why, and is tried again at the next start', () => {
    const dir = tmp(), { runs, body } = seedJson(dir, 5);
    const { error } = quiet();
    const fail = vi.spyOn(RunsDb.prototype, 'importAll').mockImplementation(() => { throw new Error('disk I/O error'); });
    const s = new AgentRunStore(dir);
    expect(s.backend).toBe('json');
    expect(s.problem).toBeNull();
    expect(s.list()).toEqual(runs);
    expect(error).toHaveBeenCalledWith('agents', 'agent runs not moved to app.db', { cause: 'disk I/O error', hint: expect.stringMatching(/agent-runs\.json is kept/) });
    // the fallback keeps recording, in agent-runs.json
    const next = s.start(start({ chatId: 'later' }));
    expect((JSON.parse(fs.readFileSync(path.join(dir, 'agent-runs.json'), 'utf8')) as { runs: { runId: string }[] }).runs.map(r => r.runId)).toContain(next.runId);
    expect(migrated(dir)).toEqual([]);
    fail.mockRestore();
    const again = new AgentRunStore(dir);
    expect(again.backend).toBe('sqlite');
    expect(again.list()).toEqual([...runs, next]);
    expect(migrated(dir)).toHaveLength(1);
    expect(body).not.toBe(''); // the seed was read whole
  });

  it('a rename that fails rolls the import back: nothing half-moved, the JSON stays the store', () => {
    const dir = tmp(), { runs } = seedJson(dir, 4);
    const { error } = quiet();
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
      if (String(b).includes('.migrated-')) throw Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' });
      return rename(a, b);
    });
    const s = new AgentRunStore(dir);
    expect(s.backend).toBe('json');
    expect(s.list()).toEqual(runs);
    expect(error).toHaveBeenCalledWith('agents', 'agent runs not moved to app.db', expect.objectContaining({ cause: expect.stringContaining('EXDEV') }));
    expect(exportRuns(path.join(dir, 'app.db'))).toBeNull(); // rolled back
    expect(fs.existsSync(path.join(dir, 'agent-runs.json'))).toBe(true);
  });

  it('without node:sqlite (an older Node) the store stays on agent-runs.json and says why', () => {
    const dir = tmp(), { runs } = seedJson(dir, 2);
    const { error } = quiet();
    const builtin = process.getBuiltinModule.bind(process);
    vi.spyOn(process, 'getBuiltinModule').mockImplementation(((id: string) => id === 'node:sqlite' ? undefined : builtin(id)) as typeof process.getBuiltinModule);
    const s = new AgentRunStore(dir);
    expect(s.backend).toBe('json');
    expect(s.list()).toEqual(runs);
    expect(error).toHaveBeenCalledWith('agents', 'agent runs database not opened', { cause: expect.stringContaining('node:sqlite'), hint: expect.any(String) });
    expect(fs.existsSync(path.join(dir, 'app.db'))).toBe(false);
  });

  it('agent-runs.json written beside a database that holds runs (an older release after a rollback) is kept, not read', () => {
    const dir = tmp(), s = new AgentRunStore(dir), run = s.start(start());
    s.close();
    fs.writeFileSync(path.join(dir, 'agent-runs.json'), JSON.stringify({ version: 1, runs: [] }));
    const { warn } = quiet();
    const again = new AgentRunStore(dir);
    expect(again.list()).toEqual([run]);
    expect(warn).toHaveBeenCalledWith('agents', 'agent-runs.json found beside app.db', expect.anything());
    expect(fs.readFileSync(path.join(dir, 'agent-runs.json'), 'utf8')).toBe('{"version":1,"runs":[]}');
  });
});

describe('writes, prune and restart', () => {
  it('a save writes only the runs whose JSON changed, in one transaction', () => {
    const dir = tmp(), s = new AgentRunStore(dir);
    const runs = Array.from({ length: 20 }, (_, i) => s.start(start({ chatId: `c${i}` }), false));
    const write = vi.spyOn(RunsDb.prototype, 'write');
    s.save();
    expect(write.mock.calls[0]![0].upsert).toHaveLength(20);
    runs[7]!.costUsd = 0.5; s.touch();
    s.save();
    expect(write.mock.calls[1]![0].upsert.map(r => r.id)).toEqual([runs[7]!.runId]);
    expect(write.mock.calls[1]![0].meta.size).toBe(0); // rollups, prunedThrough and Flash unchanged: not written
    s.flush(); // nothing pending: no write
    expect(write).toHaveBeenCalledTimes(2);
    endRun(runs[3]!, 'closed', 5000); s.save();
    expect(write.mock.calls[2]![0].upsert).toEqual([expect.objectContaining({ id: runs[3]!.runId, agentId: 'reviewer', startedAt: 1000, endedAt: 5000 })]);
  });

  it('past RUNS_MAX the oldest ended runs leave the database, folded into a rollup that survives a restart', () => {
    const dir = tmp(), s = new AgentRunStore(dir);
    const pruned: string[] = [];
    s.onPrune = ids => pruned.push(...ids);
    const old = s.start(start({ agentId: 'coder' }), false); old.costUsd = 0.25; endRun(old, 'completed', 1);
    for (let i = 0; i < RUNS_MAX; i++) endRun(s.start(start({ startedAt: 10 }), false), 'closed', 1000 + i);
    const rev = s.revision;
    s.save();
    expect(pruned).toEqual([old.runId]);
    expect(s.revision).toBeGreaterThan(rev);
    expect(s.list()).toHaveLength(RUNS_MAX);
    s.close();
    const again = new AgentRunStore(dir);
    expect(again.list()).toHaveLength(RUNS_MAX);
    expect(again.get(old.runId)).toBeUndefined();
    expect(again.rolledUp()).toEqual([expect.objectContaining({ agentId: 'coder', ended: 1, cost: { n: 1, values: [0.25], sum: 0.25 } })]);
    expect(again.adopt({ ...old })).toBeUndefined(); // already in the rollups: never counted twice
    expect(exportRuns(path.join(dir, 'app.db'))!.runs).toHaveLength(RUNS_MAX);
  });

  it('reopens after a restart with the same runs in the same order, Flash included; a closed store opens again on its next save', () => {
    const dir = tmp(), s = new AgentRunStore(dir);
    const a = s.start(start({ chatId: 'a' })), b = s.start(start({ chatId: 'b' }));
    s.flashEvent({ kind: 'asked', text: 'x', at: 1 }); s.flashEvent({ kind: 'answered', at: 2 });
    s.flush();
    s.close();
    const c = s.start(start({ chatId: 'c' })); // reopens the connection
    const again = new AgentRunStore(dir);
    expect(again.list().map(r => r.chatId)).toEqual(['a', 'b', 'c']);
    expect(again.list()).toEqual([a, b, c]);
    expect(again.flashLog()).toEqual(s.flashLog());
    expect(fs.existsSync(path.join(dir, 'agent-runs.json'))).toBe(false); // no JSON is ever written beside it
  });

  it('a failed write stays pending and the next flush writes it', () => {
    const dir = tmp(), s = new AgentRunStore(dir), run = s.start(start());
    const write = vi.spyOn(RunsDb.prototype, 'write').mockImplementationOnce(() => { throw new Error('database is locked'); });
    endRun(run, 'closed', 9);
    expect(() => s.save()).toThrow(/locked/);
    expect(s.pending).toBe(true);
    s.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(new AgentRunStore(dir).get(run.runId)?.endReason).toBe('closed');
  });

  it('a start whose write fails is not kept', () => {
    const s = new AgentRunStore(tmp());
    vi.spyOn(RunsDb.prototype, 'write').mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(() => s.start(start())).toThrow(/disk full/);
    expect(s.list()).toEqual([]);
  });
});

describe('a damaged database', () => {
  it('is moved aside (never deleted) and the runs are rebuilt from the migrated copy', () => {
    const dir = tmp(), { runs } = seedJson(dir, 6);
    quiet();
    new AgentRunStore(dir).close();
    closeAppDbs();
    for (const ext of ['-wal', '-shm']) fs.rmSync(path.join(dir, `app.db${ext}`), { force: true });
    const garbage = Buffer.from('this is not a database '.repeat(400));
    fs.writeFileSync(path.join(dir, 'app.db'), garbage);
    const { error } = quiet();
    const s = new AgentRunStore(dir);
    expect(s.backend).toBe('sqlite');
    expect(s.problem).toBeNull();
    expect(s.list()).toEqual(runs);
    const aside = fs.readdirSync(dir).filter(n => /^app\.db\.corrupt-/.test(n));
    expect(aside).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, aside[0]!)).equals(garbage)).toBe(true);
    expect(error).toHaveBeenCalledWith('agents', 'app database damaged: moved aside and created again', { cause: expect.stringMatching(/not a database/), hint: expect.stringContaining(aside[0]!) });
    expect(migrated(dir)).toHaveLength(1); // the copy stays a copy
  });

  it('with no migrated copy it starts empty and keeps recording', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'app.db'), 'garbage '.repeat(1000));
    quiet();
    const s = new AgentRunStore(dir);
    expect(s.backend).toBe('sqlite');
    expect(s.list()).toEqual([]);
    const run = s.start(start());
    expect(new AgentRunStore(dir).get(run.runId)).toEqual(run);
    expect(fs.readdirSync(dir).some(n => n.startsWith('app.db.corrupt-'))).toBe(true);
  });

  it('a lock or any other error is not taken for damage: the file is left as it is', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'app.db')); // cannot be opened as a file
    const { error } = quiet();
    const s = new AgentRunStore(dir);
    expect(s.backend).toBe('json');
    expect(fs.statSync(path.join(dir, 'app.db')).isDirectory()).toBe(true);
    expect(fs.readdirSync(dir).some(n => n.includes('corrupt'))).toBe(false);
    expect(error).toHaveBeenCalledWith('agents', 'agent runs database not opened', expect.objectContaining({ cause: expect.any(String) }));
  });
});

describe('schema and export', () => {
  it('records the area\'s schema version; a newer one (a later release, then a rollback) is never downgraded', () => {
    const dir = tmp(), file = path.join(dir, 'app.db');
    new AgentRunStore(dir).close();
    const { db } = openAppDb(file);
    expect(areaVersion(db, AREA)).toBe(1);
    expect(() => migrate(db, AREA, [])).toThrow(/newer than this release/);
    db.prepare('update schema_version set version = 9 where area = ?').run(AREA);
    db.close();
    const { error } = quiet();
    const s = new AgentRunStore(dir);
    expect(s.backend).toBe('json');
    expect(error).toHaveBeenCalledWith('agents', 'agent runs database schema not ready', expect.objectContaining({ cause: expect.stringMatching(/newer/) }));
    const check = openAppDb(file);
    expect(areaVersion(check.db, AREA)).toBe(9);
    check.db.close();
  });

  it('the levels CLI reads an app.db, an agent-runs.json or a userData folder, read only', () => {
    const dir = tmp(), { runs } = seedJson(dir, 4);
    quiet();
    const jsonDiag = diagnoseFile(readRunsSource(path.join(dir, 'agent-runs.json')).content, 5000);
    new AgentRunStore(dir).close();
    const db = path.join(dir, 'app.db');
    expect(isSqliteFile(db)).toBe(true);
    expect(isSqliteFile(path.join(dir, migrated(dir)[0]!))).toBe(false);
    const fromDir = readRunsSource(dir);
    expect(fromDir.file).toBe(db);
    expect((fromDir.content as { runs: unknown[] }).runs).toHaveLength(runs.length);
    expect(diagnoseFile(readRunsSource(db).content, 5000)).toEqual(jsonDiag);
    expect(diagnoseFile(readRunsSource(path.join(dir, migrated(dir)[0]!)).content, 5000)).toEqual(jsonDiag);
    const empty = tmp();
    expect(() => readRunsSource(empty)).toThrow(/no agent runs/);
  });
});
