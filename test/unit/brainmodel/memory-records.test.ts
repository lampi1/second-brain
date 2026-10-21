// Durable memory regression tests: provenance, project boundaries, non-destructive legacy recall and supersession.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { confirmMemory, proposeMemory, readMemoryRecords, recallMemory } from '../../../src/main/rules/memory-records';
import { memoryTools } from '../../../src/main/rules/memory-tool';
const dirs: string[] = [];
const brain = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-records-')); dirs.push(root); return root; };
afterEach(() => { for (const root of dirs.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const input = { scope: { roleId: 'scout', project: '/project/a' }, subject: 'repository', predicate: 'base branch', value: 'develop', sourceEventId: 'event-1', sourceRunId: 'run-1' };
it('deduplicates across dates without turning assertions into confirmed facts', () => {
  const root = brain(), a = proposeMemory(root, input, '2026-01-01T00:00:00Z');
  expect(proposeMemory(root, input, '2026-02-01T00:00:00Z').memoryId).toBe(a.memoryId);
  expect(readMemoryRecords(root)).toHaveLength(1);
  expect(a.status).toBe('proposed');
  expect(() => confirmMemory(root, a.memoryId, { sourceEventId: 'event-2', sourceRunId: 'run-1', evidence: 'same author assertion' })).toThrow(/Independent/);
});
it('isolates project and role and ranks relevant whole records within budget', () => {
  const root = brain(); proposeMemory(root, input);
  proposeMemory(root, { ...input, subject: 'hosting', predicate: 'hostname', value: 'irrelevant host' });
  expect(recallMemory(root, { ...input.scope, project: '/project/b' }, 'branch')).toBe('');
  expect(recallMemory(root, { ...input.scope, roleId: 'artisan' }, 'branch')).toBe('');
  const result = recallMemory(root, input.scope, 'branch');
  expect(result).toContain('develop'); expect(result).not.toContain('irrelevant');
  expect(recallMemory(root, input.scope, 'branch', 2)).toBe('');
  expect(() => JSON.parse(result)).not.toThrow();
});
it('requires independent verification to supersede a fact and retains history', () => {
  const root = brain(), a = proposeMemory(root, input);
  confirmMemory(root, a.memoryId, { sourceEventId: 'review-1', sourceRunId: 'review-run-1', evidence: 'checked repository' });
  const b = proposeMemory(root, { ...input, value: 'main', supersedes: a.memoryId });
  expect(recallMemory(root, input.scope, 'branch')).toContain('develop');
  confirmMemory(root, b.memoryId, { sourceEventId: 'review-2', sourceRunId: 'review-run-2', evidence: 'checked changed repository' });
  expect(recallMemory(root, input.scope, 'branch')).not.toContain('develop');
  expect(readMemoryRecords(root).find(r => r.memoryId === a.memoryId)).toMatchObject({ status: 'retracted' });
  expect(() => proposeMemory(root, { ...input, scope: { ...input.scope, project: '/project/b' }, supersedes: a.memoryId })).toThrow(/scoped/);
});
it('preserves legacy files and labels unscoped legacy data without leaking it into a project', () => {
  const root = brain(), file = path.join(root, 'agents/scout/memory.md'); fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = '# Memory\n- 2026-01-01 · branch develop\n'; fs.writeFileSync(file, text);
  expect(recallMemory(root, { roleId: 'scout' }, 'branch')).toContain('unverified-legacy');
  expect(recallMemory(root, input.scope, 'branch')).toBe('');
  expect(fs.readFileSync(file, 'utf8')).toBe(text);
});
it('offers proposals to direct root chats and refuses forged provenance or confirmation', async () => {
  const root = brain(), tool = memoryTools({ root: () => root, context: id => id === 'root-chat' ? { scope: input.scope, sourceRunId: 'host-run' } : null })[0]!;
  const ctx: Parameters<typeof tool.run>[1] = { mount: 'chat', sessionId: '', signal: new AbortController().signal, progress: () => false, params: { chatId: 'root-chat' } };
  const args = { subject: 'repository', predicate: 'branch', value: 'main' };
  const value = JSON.parse(await tool.run(args, ctx) as string);
  expect(value).toMatchObject({ status: 'proposed', sourceRunId: 'host-run', scope: input.scope });
  expect(() => tool.run({ ...args, status: 'confirmed' }, ctx)).toThrow(/Unknown/);
  expect(() => tool.run(args, { ...ctx, params: { chatId: 'unknown' } })).toThrow(/require/);
});
