// Issue #485: safe local commands of a chat that may only read (its role's card or a parent in plan mode) no longer
// reach the user: a bash loop or function, PowerShell's pipe cmdlets, and a brain script run by another engine from
// where its tool says it runs. Through the real ChatManager, with a fake session (no engine runs).
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';
import type { Harness } from '../../../src/shared/contract';
import type { ToolClass } from '../../../src/shared/agents';

const roots: string[] = [], managers: ChatManager[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-false-prompts-')); roots.push(d); return d; };
afterEach(async () => { vi.restoreAllMocks(); for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function fixture(extra: Partial<ChatManagerOptions> = {}) {
  const dir = extra.userData ?? tmp(), starts: SessionOptions[] = [], answers: { id: string; answer: { allow?: boolean; message?: string } }[] = [];
  let sink!: SessionSink;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, engineOn: () => true, codeMode: () => true, mcpUrlFor: id => `http://127.0.0.1:4000/mcp/chat/${id}`,
    env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, ...extra, sessionFactory: (harness, o, s) => {
      sink = s; starts.push(o);
      return { harness, sessionId: null, pid: null, root: null, alive: true, busy: false, start() { s.changed({ state: 'idle' }); }, send() {},
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: (id: string, answer: never) => { answers.push({ id, answer }); return true; },
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
        toolContext: () => ({ files: [], inline: null, cwd: o.cwd, env: {} }) } as unknown as HarnessSession;
    } });
  managers.push(m);
  const child = async (harness: Harness, tools?: ToolClass[], isolated?: string) => {
    const parent = await m.create({ harness, cwd: dir, prompt: 'x' }, 'user');
    return m.create({ harness, cwd: isolated ?? dir, parentId: parent.id, prompt: 'y', delegation: { role: 'scout', goal: 'Cerca', doneWhen: ['Fatto'], at: 1, ...(tools ? { tools } : {}) } }, 'agent',
      { owner: { ...plainOwner(harness, null), id: 'scout' }, instructions: 'Cerca.', policy: null });
  };
  let n = 0;
  /** what the app did with the request: allowed, refused, or left to the user */
  const ask = (command: string, tool = 'Bash', input: unknown = { command }): 'allow' | 'deny' | 'user' => {
    const id = `q${++n}`;
    sink.pending({ id, type: 'permission', tool, title: `${tool}: ${command}`, detail: command, input, at: 1, alwaysRules: ['Bash(x:*)'] }, input);
    const a = answers.find(x => x.id === id);
    return a ? a.answer.allow ? 'allow' : 'deny' : 'user';
  };
  return { m, dir, starts, answers, child, ask };
}


const limited = (f: ReturnType<typeof fixture>, harness: Harness, cwd = f.dir) =>
  f.m.create({ harness, cwd, prompt: 'x' }, 'user', { owner: plainOwner(harness, null), instructions: 'i', policy: { tools: null, ceiling: 'default' } });

describe('no false prompts on safe local commands (#485)', () => {
  it('Claude: a bash loop or function that only reads, and PowerShell readers in a pipe, run with no panel', async () => {
    const f = fixture();
    await limited(f, 'claude');
    expect(f.ask('for b in main dev; do git log --oneline -1 "$b"; done')).toBe('allow');
    expect(f.ask('Q(){ grep -rn "$1" src | head -5; }; Q foo; Q bar')).toBe('allow');
    expect(f.ask('Get-ChildItem -Recurse -Filter *.ts | Select-Object -First 5', 'PowerShell')).toBe('allow');
    expect(f.ask('Get-Content package.json | ConvertFrom-Json | Format-List', 'PowerShell')).toBe('allow');
    // what writes still asks
    expect(f.ask('for b in a b; do git branch $b; done')).toBe('user');
    expect(f.ask('Get-ChildItem | Remove-Item', 'PowerShell')).toBe('user');
  });

  it('OpenCode: a declared brain script run from the brain while the chat works in another repository', async () => {
    const brain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-false-prompts-brain-')));
    roots.push(brain);
    fs.mkdirSync(path.join(brain, '.agents', 'skills', 'x', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(brain, '.agents', 'skills', 'x', 'scripts', 'read.mjs'), 'console.log(1)\n');
    fs.writeFileSync(path.join(brain, 'read-only-tools.md'), '- .agents/skills/x/scripts/read.mjs: reads\n');
    const f = fixture({ brainRoot: () => brain });
    const repo = tmp();
    await limited(f, 'opencode', repo);
    const command = 'node .agents/skills/x/scripts/read.mjs list';
    expect(f.ask(command, 'Shell', { command, workdir: brain })).toBe('allow');
    expect(f.ask(command, 'Shell', { command, cwd: brain })).toBe('allow');
    // from the repository itself the same words name another file: not the declared one
    expect(f.ask(command, 'Shell', { command })).toBe('user');
    // two folders named: which one the engine honours is not known
    expect(f.ask(command, 'Shell', { command, cwd: repo, workdir: brain })).toBe('user');
    // Claude's Bash has no folder of its own: a key added to its input is not where it runs
    await limited(f, 'claude', repo);
    expect(f.ask(command, 'Bash', { command, cwd: brain })).toBe('user');
  });
});
