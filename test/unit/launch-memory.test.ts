// Launch selection injects only relevant confirmed facts, with hard limits and the scoped archive left unchanged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LAUNCH_MEMORY_RECORDS, LAUNCH_MEMORY_TOKENS, selectLaunchMemory } from '../../src/main/rules/launch-memory';
import { confirmMemory, proposeMemory, quoteMemory, readMemoryRecords, recallMemory, retractMemory, type MemoryRecord, type MemoryScope } from '../../src/main/rules/memory-records';

const roots: string[] = [], scope = { roleId: 'artisan' };
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-memory-')); roots.push(root);
  const add = (value: string, memoryScope: MemoryScope = scope, sourceEventId = 'memory-proposal:example') => proposeMemory(root, {
    scope: memoryScope, subject: 'setup', predicate: 'note', value, sourceEventId, sourceRunId: 'r_example',
  }, '2026-01-01T00:00:00Z');
  const confirm = (record: MemoryRecord) => confirmMemory(root, record.memoryId, { sourceEventId: 'human:approval', sourceRunId: 'human:review', evidence: 'Confirmed by the user after checking the repository guide' }, '2026-01-02T00:00:00Z');
  return { root, add, confirm };
}
describe('task-selective memory at launch', () => {
  it('loads relevant confirmed facts with evidence and leaves omitted facts searchable without storage changes', () => {
    const w = world(); w.confirm(w.add('Database migrations run through the migration runner.')); w.confirm(w.add('Invoices are exported with the accounting workbook.'));
    const file = path.join(w.root, 'memory/records.json'), before = fs.readFileSync(file, 'utf8');
    const selected = selectLaunchMemory(w.root, scope, 'Review database migrations');
    expect(selected.text).toContain('Database migrations'); expect(selected.text).not.toContain('Invoices'); expect(selected.omitted).toBe(1);
    expect(JSON.parse(selected.text)).toMatchObject({ status: 'confirmed', scope, sourceEventId: 'memory-proposal:example', sourceRunId: 'r_example', verification: { sourceEventId: 'human:approval', evidence: 'Confirmed by the user after checking the repository guide' } });
    expect(recallMemory(w.root, scope, 'Invoices')).toContain('accounting workbook');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(selectLaunchMemory(w.root, scope).text).toBe('');
    expect(selectLaunchMemory(w.root, scope, 'the and please task review check').text).toBe('');
    expect(selectLaunchMemory(w.root, scope, 'unrelated').text).toBe('');
  });
  it('never uses proposals, observed, disputed, retracted or not-yet-valid facts as launch context', () => {
    const w = world();
    w.add('Database production credentials belong in the credential manager.');
    w.add('Database deployment follows the release checklist.', scope, 'user:note');
    w.add('Database formatting uses the project style guide.', scope, 'old-event');
    const revoked = w.confirm(w.add('Database migrations use the retired runner.'));
    retractMemory(w.root, revoked.memoryId, 'rejected after review', '2026-02-01T00:00:00Z');
    const file = path.join(w.root, 'memory/records.json'), rows = readMemoryRecords(w.root);
    rows.push({ ...revoked, memoryId: 'observed', value: 'Database observed assertion', status: 'observed', transitions: undefined, validTo: null });
    rows.push({ ...revoked, memoryId: 'disputed', value: 'Database disputed assertion', status: 'disputed', transitions: undefined, validTo: null });
    rows.push({ ...revoked, memoryId: 'future', value: 'Database future assertion', status: 'confirmed', validFrom: '2999-01-01T00:00:00Z', transitions: undefined, validTo: null });
    fs.writeFileSync(file, JSON.stringify(rows));
    expect(selectLaunchMemory(w.root, scope, 'Database production credentials deployment formatting migrations observed disputed future').text).toBe('');
  });
  it('does not autoload legacy prose or re-enter a rejected record through its legacy copy', () => {
    const w = world(), revoked = w.confirm(w.add('Database migrations use the retired runner.'));
    retractMemory(w.root, revoked.memoryId, 'incorrect', '2026-02-01T00:00:00Z');
    fs.mkdirSync(path.join(w.root, 'agents/artisan'), { recursive: true });
    const file = path.join(w.root, 'agents/artisan/memory.md'), legacy = `# User notes\n\nDatabase release checklist.\n- Database legacy notes remain searchable.\n- 2026-01-01 · ${revoked.value}\n`;
    fs.writeFileSync(file, legacy);
    expect(selectLaunchMemory(w.root, scope, 'database').text).toBe('');
    expect(recallMemory(w.root, scope, 'database')).toContain('legacy notes');
    expect(recallMemory(w.root, scope, 'database')).not.toContain('retired runner');
    expect(fs.readFileSync(file, 'utf8')).toBe(legacy);
  });
  it('isolates role, user, project, repository and environment before relevance ranking', () => {
    const w = world(), scoped = { roleId: 'artisan', userId: 'owner', project: 'project-a', repository: 'repo-a', environment: 'development' };
    w.confirm(w.add('Database migrations use the local fixture.', scoped));
    for (const key of ['roleId', 'userId', 'project', 'repository', 'environment'] as const) {
      w.confirm(w.add(`Database migrations use a different ${key} fixture.`, { ...scoped, [key]: 'other' }));
      if (key !== 'roleId') expect(selectLaunchMemory(w.root, { ...scoped, [key]: undefined }, 'database').text).toBe('');
    }
    const result = selectLaunchMemory(w.root, scoped, 'database');
    expect(result.selected).toBe(1); expect(result.text).toContain('local fixture'); expect(result.text).not.toContain('different');
    expect(selectLaunchMemory(w.root, scope, 'database').text).toBe('');
  });
  it('caps all confirmed records, including security keywords, with deterministic whole-record budgets', () => {
    const w = world();
    for (let i = 0; i < 20; i++) w.confirm(w.add(`Database credentials use the named fixture category ${i} for representative coverage.`));
    const a = selectLaunchMemory(w.root, scope, 'database', 4000), b = selectLaunchMemory(w.root, scope, 'database', 4000);
    expect(a).toEqual(b); expect(a.selected).toBeGreaterThan(0); expect(a.selected).toBeLessThanOrEqual(LAUNCH_MEMORY_RECORDS); expect(a.omitted).toBe(20 - a.selected);
    expect(a.text.length).toBeLessThanOrEqual(LAUNCH_MEMORY_TOKENS * 3); expect(a.estimatedTokens).toBeLessThanOrEqual(LAUNCH_MEMORY_TOKENS);
    for (const row of a.text.split('\n')) expect(JSON.parse(row)).toHaveProperty('verification.evidence');
    const file = path.join(w.root, 'memory/records.json'); fs.writeFileSync(file, JSON.stringify(readMemoryRecords(w.root).reverse()));
    expect(selectLaunchMemory(w.root, scope, 'database', 4000)).toEqual(a);
    for (const budget of [0, -1, 1, 0.5, NaN, Infinity]) expect(selectLaunchMemory(w.root, scope, 'database', budget).text).toBe('');
  });
  it('skips oversized facts whole and still considers smaller relevant facts', () => {
    const w = world(); w.confirm(w.add(`Database migration ${'condition '.repeat(90)}must never run against production.`));
    w.confirm(w.add('Database maintenance uses a local fixture.'));
    const result = selectLaunchMemory(w.root, scope, 'database migration', 300);
    expect(result.text).not.toContain('condition'); expect(result.text).toContain('local fixture');
    expect(result.text.length).toBeLessThanOrEqual(900);
  });
  it('limits the number of facts even when small confirmed records fit the character budget', () => {
    const w = world(), seed = w.confirm(w.add('Database fixture'));
    const rows = Array.from({ length: 20 }, (_, i): MemoryRecord => ({ ...seed, memoryId: String(i), subject: 'db', predicate: 'use', value: 'Database fixture', sourceEventId: 'e', sourceRunId: 'r', verification: undefined }));
    fs.writeFileSync(path.join(w.root, 'memory/records.json'), JSON.stringify(rows));
    expect(selectLaunchMemory(w.root, scope, 'database').selected).toBe(LAUNCH_MEMORY_RECORDS);
  });
  it('keeps a large archive intact while loading only task matches, with a measurable fixed ceiling', () => {
    const w = world(), seed = w.confirm(w.add('Database migrations use a local fixture.'));
    const rows = Array.from({ length: 500 }, (_, i): MemoryRecord => ({ ...seed, memoryId: `fixture-${String(i).padStart(4, '0')}`,
      value: i < 2 ? `Database migrations use the local fixture category ${i}.` : `Invoices use the accounting workbook category ${i}.` }));
    const file = path.join(w.root, 'memory/records.json'); fs.writeFileSync(file, JSON.stringify(rows));
    const before = fs.readFileSync(file, 'utf8'), oldPrompt = rows.map(quoteMemory).join('\n'), selected = selectLaunchMemory(w.root, scope, 'Review database migrations');
    expect(selected.selected).toBe(2); expect(selected.omitted).toBe(498); expect(selected.text.length).toBeLessThan(oldPrompt.length / 100);
    expect(recallMemory(w.root, scope, 'Invoices')).toContain('accounting workbook');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});
