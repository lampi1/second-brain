// Launch selection keeps protected knowledge and scoped search intact while limiting optional task context.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { selectLaunchMemory } from '../../src/main/rules/launch-memory';
import { confirmMemory, proposeMemory, recallMemory } from '../../src/main/rules/memory-records';

const roots: string[] = [], scope = { roleId: 'artisan' };
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-memory-')); roots.push(root);
  const add = (value: string, sourceEventId = 'memory-proposal:example', project?: string) => proposeMemory(root, {
    scope: { ...scope, ...(project ? { project } : {}) }, subject: 'setup', predicate: 'note', value, sourceEventId, sourceRunId: 'r_example',
  });
  return { root, add };
}
describe('task-selective memory at launch', () => {
  it('loads only relevant model proposals and leaves the rest searchable without storage changes', () => {
    const w = world(); w.add('Database migrations run through the migration runner.'); w.add('Invoices are exported with the accounting workbook.');
    const file = path.join(w.root, 'memory/records.json'), before = fs.readFileSync(file, 'utf8');
    const selected = selectLaunchMemory(w.root, scope, 'Review database migrations');
    expect(selected.text).toContain('Database migrations'); expect(selected.text).not.toContain('Invoices'); expect(selected.omitted).toBe(1);
    expect(recallMemory(w.root, scope, 'Invoices')).toContain('accounting workbook');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(selectLaunchMemory(w.root, scope).selected).toBe(0);
  });
  it('keeps confirmed, security and unknown-provenance content regardless of query or optional budget', () => {
    const w = world(), confirmed = w.add('Invoices are exported with the accounting workbook.');
    confirmMemory(w.root, confirmed.memoryId, { sourceEventId: 'human:approval', sourceRunId: 'human:review', evidence: 'Confirmed by the user' });
    w.add('Production credentials belong in the credential manager.');
    w.add('Deployment follows the release checklist.', 'user:note');
    w.add('Formatting uses the project style guide.', 'old-event');
    w.add('Database migrations use the migration runner.');
    const result = selectLaunchMemory(w.root, scope, 'database', 0);
    expect(result.protected).toBe(4); expect(result.selected).toBe(0);
    for (const text of ['Invoices', 'Production credentials', 'Deployment', 'Formatting']) expect(result.text).toContain(text);
  });
  it('preserves legacy user prose and respects project isolation', () => {
    const w = world(); w.add('Invoices are exported with the accounting workbook.', 'memory-proposal:project', 'project-a');
    fs.mkdirSync(path.join(w.root, 'agents/artisan'), { recursive: true });
    fs.writeFileSync(path.join(w.root, 'agents/artisan/memory.md'), '# User notes\n\nAlways retain my release checklist.\n- Use the approved style guide.\n');
    expect(selectLaunchMemory(w.root, scope, 'unrelated', 0).text).toContain('Always retain my release checklist');
    const isolated = selectLaunchMemory(w.root, { ...scope, project: 'project-b' }, 'invoices');
    expect(isolated.text).not.toContain('Invoices'); expect(isolated.text).not.toContain('Always retain');
  });
  it('uses deterministic whole-record limits and does not promote common query words into relevance', () => {
    const w = world();
    for (let i = 0; i < 45; i++) w.add(`Database validation uses the named fixture category ${i} for representative coverage.`);
    expect(selectLaunchMemory(w.root, scope, 'the and please task').selected).toBe(0);
    const a = selectLaunchMemory(w.root, scope, 'database', 4000), b = selectLaunchMemory(w.root, scope, 'database', 4000);
    expect(a).toEqual(b); expect(a.selected).toBeLessThanOrEqual(40); expect(a.omitted).toBeGreaterThan(0);
    expect(a.text.length).toBeLessThanOrEqual(12000);
  });
});
