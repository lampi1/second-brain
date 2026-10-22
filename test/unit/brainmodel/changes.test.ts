// The brain model's change log (src/main/brainmodel/changes.ts, ADR 0077): a change records the files' text before and
// after and the agent's versions; undo restores "before" only while the target is still "after"; unchanged and oversized
// writes are skipped (a change that could not be undone is never made); entries persist in userData. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChangeLog, writeText, type AgentRestorer } from '../../../src/main/brainmodel/changes';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-changes-')); dirs.push(d); return d; };
const base = { job: 'corrections' as const, kind: 'skill' as const, action: 'update' as const, target: 'x', summary: 's', reason: 'r', evidence: [] };
const agents = (version: Record<string, number>): AgentRestorer & { restored: [string, number, number][] } => {
  const restored: [string, number, number][] = [];
  return { restored, activeVersion: id => version[id] ?? null, restore: (id, v, e) => { restored.push([id, v, e]); version[id] = v; } };
};

describe('ChangeLog', () => {
  it('applies, lists newest first and undoes a file change; a created file is removed with its empty folder', () => {
    const d = tmp(), log = new ChangeLog(d, () => 5), file = path.join(d, 'brain', 'skill', 'SKILL.md');
    const c = log.apply(base, [{ file, text: 'nuovo' }])!;
    expect(fs.readFileSync(file, 'utf8')).toBe('nuovo');
    expect(log.list(agents({}))).toEqual([expect.objectContaining({ id: c.id, at: 5, canRollback: true })]);
    expect(log.madeBy(file)).toBe('corrections');
    log.rollback(c.id, agents({}));
    expect(fs.existsSync(path.dirname(file))).toBe(false);
    expect(log.madeBy(file)).toBeNull();
    expect(new ChangeLog(d).list(agents({}))[0]).toMatchObject({ id: c.id, canRollback: false }); // persisted, undone
  });
  it('never overwrites a newer edit, and refuses a change that would not be undoable', () => {
    const d = tmp(), log = new ChangeLog(d), file = path.join(d, 'a.md');
    writeText(file, 'prima');
    const c = log.apply(base, [{ file, text: 'dopo' }])!;
    fs.writeFileSync(file, 'modificato a mano');
    expect(log.list(agents({}))[0]!.canRollback).toBe(false);
    expect(() => log.rollback(c.id, agents({}))).toThrow(/non si può più annullare/);
    expect(fs.readFileSync(file, 'utf8')).toBe('modificato a mano');
    expect(log.apply(base, [{ file, text: 'modificato a mano' }])).toBeNull(); // unchanged: nothing recorded
    expect(log.apply(base, [{ file, text: 'x'.repeat(300 * 1024) }])).toBeNull(); // too big to keep a copy of
    // all or nothing: one file too big and the other write is not made either (a move never writes only its pointers)
    const other = path.join(d, 'b.md');
    expect(log.apply(base, [{ file: other, text: 'puntatore' }, { file, text: 'x'.repeat(300 * 1024) }])).toBeNull();
    expect(fs.existsSync(other)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('modificato a mano');
  });
  it('undoes an agent change only while the agent is still on the version it left', () => {
    const d = tmp(), log = new ChangeLog(d);
    const c = log.record({ ...base, kind: 'agent', target: 'a1' }, [], { id: 'a1', before: 2, after: 3 });
    expect(log.list(agents({ a1: 4 }))[0]!.canRollback).toBe(false);
    const a = agents({ a1: 3 });
    log.rollback(c.id, a);
    expect(a.restored).toEqual([['a1', 2, 3]]);
    expect(() => log.rollback('missing', a)).toThrow(/non trovata/);
  });
  it('seals a change when it is recorded, drops a seed of an unknown shape on load and seals the missing ones once', () => {
    const d = tmp(), seed = { hypothesis: 'fewer' as const, scope: ['artisan'], skill: null };
    const log = new ChangeLog(d, () => 5, () => seed);
    const c = log.record(base, []);
    expect(log.seedOf(c.id)).toEqual(seed);
    expect(log.list(agents({}))[0]).not.toHaveProperty('seed');
    const file = path.join(d, 'brain-changes.json'), raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.changes[0].seed = 'rotto';
    fs.writeFileSync(file, JSON.stringify(raw));
    const again = new ChangeLog(d);
    expect(again.seedOf(c.id)).toBeUndefined();
    let calls = 0;
    again.sealMissing(() => { calls++; return { ...seed, scope: [] }; });
    again.sealMissing(() => { calls++; return seed; });
    expect(calls).toBe(1);
    expect(new ChangeLog(d).seedOf(c.id)).toEqual({ ...seed, scope: [] }); // kept on disk
  });
});
