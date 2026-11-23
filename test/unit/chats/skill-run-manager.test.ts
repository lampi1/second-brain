// The skills a run used reach its Grindhouse card at once (OS · App semplice, branch C): a skill Claude loads, or the
// SKILL.md another engine reads, joins the run's tags and the chat is announced as updated in the same step (the card's
// chips would otherwise wait for the next unrelated update); a command that only mentions a SKILL.md is no use.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';
import type { ChatItem, ChatSummary } from '../../../src/shared/contract';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { vi.useRealTimers(); for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

async function fixture(harness: 'claude' | 'codex') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-skill-run-'));
  roots.push(dir);
  const updates: ChatSummary[] = [];
  let sink!: SessionSink;
  const m = new ChatManager({ userData: dir, emitter: { emit: (e: string, p: unknown) => { if (e === 'chat:updated') updates.push(p as ChatSummary); } } as never, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, sessionFactory: (_h, _o, s) => {
    sink = s;
    return { harness, sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { s.changed({ state: 'idle' }); }, send() {},
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  const c = await m.create({ harness, cwd: dir, prompt: 'Lavora' }, 'agent',
    { owner: { ...plainOwner(harness, null), source: 'catalog', id: 'artisan', version: 1 }, instructions: 'Sei un artigiano.', policy: null });
  const tool = (id: string, name: string, input: Record<string, unknown>) => sink.item({ kind: 'tool', id, at: Date.now(), name, summary: name, input, status: 'ok' } as ChatItem, false);
  return { m, c, tool, updates, skills: () => m.list().find(x => x.id === c.id)?.run?.tags?.skills ?? [] };
}

describe('skills on a run', () => {
  it('a skill Claude loads joins the run tags and the chat is announced as updated at once', async () => {
    const f = await fixture('claude');
    const before = f.updates.length;
    f.tool('t1', 'Skill', { skill: 'ops-core' });
    expect(f.skills()).toEqual(['ops-core']);
    expect(f.updates.length).toBeGreaterThan(before);
    expect(f.updates.at(-1)?.run?.tags?.skills).toEqual(['ops-core']);
  });

  it('a SKILL.md another engine reads (a Codex shell command) joins the run tags and is announced at once', async () => {
    const f = await fixture('codex');
    const before = f.updates.length;
    f.tool('t1', 'Shell', { command: 'cat /b/skills/air-qa/SKILL.md', cwd: '/b' });
    expect(f.skills()).toEqual(['air-qa']);
    expect(f.updates.length).toBeGreaterThan(before);
    expect(f.updates.at(-1)?.run?.tags?.skills).toEqual(['air-qa']);
  });

  it('a command that only mentions or changes a SKILL.md is no use: nothing joins, nothing is announced', async () => {
    const f = await fixture('codex');
    f.tool('t1', 'Shell', { command: 'rm /b/skills/air-qa/SKILL.md' });
    f.tool('t2', 'Shell', { command: 'grep -n x /b/skills/air-qa/SKILL.md' });
    f.tool('t3', 'Edit', { file_path: '/b/skills/air-qa/SKILL.md' });
    const n = f.updates.length;
    f.tool('t4', 'Shell', { command: 'ls /b/skills/air-qa/SKILL.md' });
    expect(f.skills()).toEqual([]);
    expect(f.updates.length).toBe(n);
  });
});
