// The brain model's change log (src/main/brainmodel/changes.ts, ADR 0077): a change records the files' text before and
// after and the agent's versions; undo restores "before" only while the target is still "after"; unchanged and oversized
// writes are skipped (a change that could not be undone is never made); entries persist in userData. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangeLog, writeText, type AgentRestorer } from '../../../src/main/brainmodel/changes';

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-changes-')); dirs.push(d); return d; };
const base = { job: 'corrections' as const, kind: 'skill' as const, action: 'update' as const, target: 'x', summary: 's', reason: 'r', evidence: [] };
const agents = (version: Record<string, number>): AgentRestorer & { restored: [string, number, number][] } => {
  const restored: [string, number, number][] = [];
  return { restored, activeVersion: id => version[id] ?? null, restore: (id, v, e) => { restored.push([id, v, e]); version[id] = v; } };
};

describe('ChangeLog', () => {
  it('reads each changed file once per view and rechecks it before undo', () => {
    const d = fs.realpathSync(tmp()), log = new ChangeLog(d), file = path.join(d, 'shared.md');
    for (let i = 0; i < 30; i++) log.apply(base, [{ file, text: `version ${i}` }]);
    const read = vi.spyOn(fs, 'readFileSync');
    const rows = log.list(agents({}));
    expect(read.mock.calls.filter(([p]) => p === file)).toHaveLength(1);
    expect(rows.filter(row => row.canRollback)).toHaveLength(1);
    fs.writeFileSync(file, 'manual edit');
    expect(() => log.rollback(rows[0]!.id, agents({}))).toThrow('non si può');
    expect(log.list(agents({})).every(row => !row.canRollback)).toBe(true);
  });
  it('writes all or none: a write that fails puts back the files it already wrote and leaves no temp file', () => {
    const d = tmp(), log = new ChangeLog(d, () => 5), a = path.join(d, 'brain', 'a.md'), b = path.join(d, 'brain', 'b.md');
    writeText(a, 'old'); fs.mkdirSync(b);
    expect(() => log.apply(base, [{ file: a, text: 'new' }, { file: b, text: 'x' }])).toThrow();
    expect(fs.readFileSync(a, 'utf8')).toBe('old');
    expect(fs.readdirSync(path.join(d, 'brain')).sort()).toEqual(['a.md', 'b.md']);
    expect(log.all()).toEqual([]);
  });
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
  it('tells its listeners after each rollback (the Proposte ledger, ADR 0193); a throwing listener never fails it', () => {
    const d = tmp(), log = new ChangeLog(d, () => 5), heard: string[] = [];
    log.onRolledBack(() => { throw new Error('boom'); });
    const off = log.onRolledBack(id => heard.push(id));
    const a = log.apply(base, [{ file: path.join(d, 'a.md'), text: 'a' }])!, b = log.apply(base, [{ file: path.join(d, 'b.md'), text: 'b' }])!;
    log.rollback(a.id, agents({}));
    off();
    log.rollback(b.id, agents({}));
    expect(heard).toEqual([a.id]);
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
  it('freezes an aliased write destination so retargeting cannot redirect provenance or rollback', () => {
    const a = tmp(), b = tmp(), holder = tmp(), alias = path.join(holder, 'chosen'), log = new ChangeLog(tmp());
    fs.symlinkSync(a, alias, 'junction');
    const file = path.join(alias, 'nested', 'candidate.md');
    const c = log.apply(base, [{ file, text: 'new' }])!;
    expect(c.files[0]!.file).toBe(path.join(fs.realpathSync(a), 'nested', 'candidate.md'));
    expect(log.madeBy(file)).toBe('corrections');
    fs.mkdirSync(path.join(b, 'nested')); fs.writeFileSync(path.join(b, 'nested', 'candidate.md'), 'new');
    fs.unlinkSync(alias); fs.symlinkSync(b, alias, 'junction');
    expect(log.madeBy(file)).toBeNull();
    log.rollback(c.id, agents({}));
    expect(fs.existsSync(path.join(a, 'nested', 'candidate.md'))).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
  });
  it('captures an aliased deletion before its empty parent disappears and restores the original destination', () => {
    const a = tmp(), b = tmp(), holder = tmp(), alias = path.join(holder, 'chosen'), log = new ChangeLog(tmp());
    fs.symlinkSync(a, alias, 'junction');
    fs.mkdirSync(path.join(a, 'nested')); fs.writeFileSync(path.join(a, 'nested', 'candidate.md'), 'old');
    const c = log.apply(base, [{ file: path.join(alias, 'nested', 'candidate.md'), text: null }])!;
    expect(c.files[0]!.file).toBe(path.join(fs.realpathSync(a), 'nested', 'candidate.md'));
    fs.unlinkSync(alias); fs.symlinkSync(b, alias, 'junction');
    log.rollback(c.id, agents({}));
    expect(fs.readFileSync(path.join(a, 'nested', 'candidate.md'), 'utf8')).toBe('old');
    expect(fs.existsSync(path.join(b, 'nested'))).toBe(false);
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
