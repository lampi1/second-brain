// The run store's revision (AgentRunStore.revision): every change worth a write bumps it, a save alone does not, so the
// read worker can keep its copy of the runs between Memoria and estimate reads (issues #276, #277).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AgentRunStore } from '../../../src/main/agents/runs';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

it('bumps on a new run and on touch, never on a save that changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-runrev-')); dirs.push(dir);
  const store = new AgentRunStore(dir);
  const r0 = store.revision;
  const run = store.start({ chatId: 'c_work000001', agentId: 'scout', version: 1, goal: 'Read the docs', startedBy: 'orchestrator', startedAt: 1 });
  const r1 = store.revision;
  expect(r1).toBeGreaterThan(r0);
  store.flush();
  expect(store.revision).toBe(r1);
  run.turns = 3; store.touch();
  expect(store.revision).toBeGreaterThan(r1);
});
