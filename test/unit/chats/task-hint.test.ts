// What a role chat needs for agent_report reaches its engine, never the user's bubble (#158, #170): a chat the
// Orchestrator opens with doneWhen gets the criteria exactly as stored, once per assignment; a follow-up gets the task
// version line; the transcript keeps only what was typed, so the renderer's optimistic copy is replaced, not doubled.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';
import { checkResult } from '../../../src/shared/delegation';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-task-hint-')); roots.push(dir);
  const sent: string[] = [];
  let seq = 0;
  const m: ChatManager = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, sessionFactory: (_h, _o, s: SessionSink) => {
    let state = 'idle';
    const self = { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, get busy() { return state === 'running'; },
      start() { s.childrenCoverage?.('complete'); s.changed({ state: 'idle' }); },
      send(text: string) {
        sent.push(text);
        state = 'running'; s.changed({ state: 'running' });
        s.item({ kind: 'assistant', id: `a${++seq}`, at: Date.now(), text: 'Ok.' }, false);
        s.item({ kind: 'result', id: `r${seq}`, at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false);
        state = 'idle'; s.changed({ state: 'idle' });
      },
      close: async () => { state = 'closed'; s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    };
    return self as unknown as HarnessSession;
  } });
  managers.push(m);
  const role = { owner: { ...plainOwner('claude', null), source: 'catalog' as const, id: 'scout', version: 1 }, instructions: 'Cerca.', policy: null };
  return { m, dir, sent, role };
}

describe('task hint (#158, #170)', () => {
  it('a chat the Orchestrator opens with doneWhen gets the criteria as stored; a follow-up gets them again with its version', async () => {
    const f = fixture();
    const o = await f.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true });
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'Trova le fonti.', doneWhen: ['A', 'B'] }, 'agent', f.role);
    await expect.poll(() => f.sent.length).toBe(1);
    expect(f.sent[0]).toContain('- A\n- B');
    // the next message of the same assignment does not repeat them
    await f.m.send(c.id, 'Ancora una cosa.', undefined, false, 'Orchestrator', false, { kind: 'chat', chatId: o.id });
    expect(f.sent[1]).not.toContain('- A');
    // a follow-up assignment (app_assign_task): criteria and version, both to the engine
    await f.m.assignTask(c.id, 'Ora la seconda parte.', { mode: 'continue', source: { kind: 'chat', chatId: o.id } });
    const last = f.sent.at(-1)!;
    expect(last).toContain('- A\n- B');
    expect(last).toContain('Task version 2');
  });

  it("the user's own follow-up shows once, without the version suffix; the engine still gets it", async () => {
    const f = fixture();
    await f.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true });
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'Trova le fonti.', doneWhen: ['A'] }, 'agent', f.role);
    await expect.poll(() => f.sent.length).toBe(1);
    f.m.reportRoot(c.id, { outcome: 'done', summary: 'ok', output: 'ok', doneWhen: [{ criterion: 'A', met: true }] });
    await f.m.send(c.id, 'Ma quindi è un bug?');
    const users = f.m.items(c.id).filter(i => i.kind === 'user').map(i => (i as { text: string }).text);
    expect(users.at(-1)).toBe('Ma quindi è un bug?');
    expect(users.join('\n')).not.toContain('[Task version');
    expect(f.sent.at(-1)).toContain('Task version 2');
  });

  it('a refused report lists the whole array to copy', () => {
    expect(() => checkResult({ outcome: 'done', summary: 's', output: 'o', doneWhen: [{ criterion: 'A', met: true }] }, ['A', 'B c']))
      .toThrow('doneWhen must be: [{"criterion":"A","met":<true|false>,"evidence":"…"}, {"criterion":"B c","met":<true|false>,"evidence":"…"}]');
  });
});
