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
  it('checks host authorization immediately before a delayed first send', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, goal: 'Routine task', doneWhen: ['A'] }, 'app', f.role);
    let allowed = true;
    const sent = f.m.send(c.id, 'Start the routine step.', undefined, false, 'Routine', false, { kind: 'app' }, {
      beforeSubmit() { if (!allowed) throw new Error('Routine was cancelled'); }, submitted() {}, failed() {},
    });
    allowed = false;
    await expect(sent).rejects.toThrow('Routine was cancelled');
    expect(f.sent).toEqual([]);
  });

  it('a refused report lists the whole array to copy', () => {
    expect(() => checkResult({ outcome: 'done', summary: 's', output: 'o', doneWhen: [{ criterion: 'A', met: true }] }, ['A', 'B c']))
      .toThrow('doneWhen must be: [{"criterion":"A","met":<true|false>,"evidence":"…"}, {"criterion":"B c","met":<true|false>,"evidence":"…"}]');
  });
});
