// The chat store's one tolerant read (chats/store.ts valid(), ADR 0083): a chats.json written by a release before the
// generic roles marks the user's Orchestrator with the old coordinator key plus `orchestrator: true`; it must load as
// the Orchestrator (never archived), while the other old coordinators load as plain chats. Pins the owner's rule that
// the live Orchestrator is not lost on update, with no other compatibility code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatStore } from '../../../src/main/chats/store';

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('ChatStore: a chats.json of the previous release', () => {
  it('keeps the user\'s Orchestrator, never archived; any other old coordinator is a plain chat', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-store-')); roots.push(root);
    const old = { id: 'o1', harness: 'claude', cwd: '/w', title: 'Orchestrator', isRegia: true, orchestrator: true, closedAt: 5 };
    const plain = { id: 'r2', harness: 'claude', cwd: '/w', title: 'Ordini', isRegia: true };
    fs.writeFileSync(path.join(root, 'chats.json'), JSON.stringify({ version: 2, chats: [old, plain, { id: 'c3', harness: 'claude', cwd: '/w', isOrchestrator: true }] }));
    const loaded = new ChatStore(root).load();
    expect(loaded.map(c => [c.id, c.isOrchestrator])).toEqual([['o1', true], ['r2', false], ['c3', true]]);
    expect(loaded[0]).not.toHaveProperty('closedAt');
  });
});

it('retains host routine placement and frozen prompt identity across restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-store-routine-')); roots.push(root);
  const row = { id: 'worker', harness: 'claude', cwd: '/fixture', title: 'Routine worker', routine: { runId: 'run-1', stepId: 'inspect' }, routinePackage: 'a'.repeat(64), routinePromptHash: 'b'.repeat(64) };
  fs.writeFileSync(path.join(root, 'chats.json'), JSON.stringify({ version: 2, chats: [row] }));
  expect(new ChatStore(root).load()[0]).toMatchObject({ routine: row.routine, routinePackage: row.routinePackage, routinePromptHash: row.routinePromptHash });
});

it('persists the launch manifest without recomputing it or restoring raw context values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-store-context-')); roots.push(root);
  const context = { schema: 1, at: 1, mode: 'sealed', packageDigest: 'a'.repeat(64), memory: { available: true, records: [], omitted: { ineligible: 0, unmatched: 0, budget: 0 }, estimatedTokens: 0, budgetTokens: 0 }, skills: [], instructions: { sha256: 'b'.repeat(64), characters: 300, estimatedTokens: 100 } };
  const row = { id: 'worker', harness: 'claude', cwd: '/fixture', launchContext: { ...context, rawPrompt: 'private-context' } };
  fs.writeFileSync(path.join(root, 'chats.json'), JSON.stringify({ version: 2, chats: [row] }));
  const store = new ChatStore(root), loaded = store.load(); expect(loaded[0]!.launchContext).toEqual(context);
  store.save(loaded); expect(new ChatStore(root).load()[0]!.launchContext).toEqual(context);
  expect(fs.readFileSync(path.join(root, 'chats.json'), 'utf8')).not.toContain('private-context');
});
