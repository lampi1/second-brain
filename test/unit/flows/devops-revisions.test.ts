// Own-write suppression is based on exact host receipts, not changedBy identity, time windows or ignoring whole bugs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DevOpsRevisions } from '../../../src/main/flows/devops-revisions';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
const setup = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-test-')); dirs.push(dir); const file = path.join(dir, 'journal.json'); return { file, journal: new DevOpsRevisions(file) }; };
it('suppresses exact host patch revisions across restart, but preserves intervening human revisions', async () => {
  const { file, journal } = setup(), read = vi.fn(); journal.revision('contoso', 42, 2); journal.revision('contoso', 42, 4);
  const restored = new DevOpsRevisions(file);
  expect(await restored.externalRevision('CONTOSO', 42, 1, 2, read)).toBeNull();
  expect(await restored.externalRevision('contoso', 42, 1, 4, read)).toBe(3);
  expect(await restored.externalRevision('other', 42, 1, 4, read)).toBe(4);
  expect(read).not.toHaveBeenCalled();
});
it('recognizes only original host comment revisions, never a later human edit of the same comment', async () => {
  const { journal } = setup(); journal.comment('contoso', 42, 12);
  const read = vi.fn(async (rev: number) => ({ id: 42, rev, commentVersionRef: { commentId: 12, version: rev === 2 ? 1 : 2, createdInRevision: 2, isDeleted: false } }));
  expect(await journal.externalRevision('contoso', 42, 1, 2, read)).toBeNull();
  expect(await journal.externalRevision('contoso', 42, 1, 3, read)).toBe(3);
  expect(read.mock.calls.filter(([rev]) => rev === 2)).toHaveLength(1);
});
it('uncertain writes fence detection rather than recursively creating another run; exact completion releases the fence', async () => {
  const { file, journal } = setup(); journal.pending('contoso', 42, 'op-a'); journal.revision('contoso', 42, 2);
  await expect(new DevOpsRevisions(file).externalRevision('contoso', 42, 1, 2, vi.fn())).rejects.toThrow('uncertain');
  journal.done('contoso', 42, 'op-b'); await expect(journal.externalRevision('contoso', 42, 1, 2, vi.fn())).rejects.toThrow('uncertain');
  journal.done('contoso', 42, 'op-a'); expect(await journal.externalRevision('contoso', 42, 1, 2, vi.fn())).toBeNull();
});
