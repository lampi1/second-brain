// An agent's tool policy and ceiling on its chats (A2): frozen at start, passed to the engine, clamping the mode, refused
// above the ceiling, kept across restarts and continues, failing closed when the stored copy is damaged.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import { trimInput, type HarnessSession, type SessionOptions, type SessionSink } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';
import { FAIL_CLOSED, type AgentPolicy } from '../../../src/main/agents/tool-policy';
import type { PermissionMode } from '../../../src/shared/contract';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture(extra: Partial<ChatManagerOptions> = {}) {
  const dir = extra.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-policy-'));
  if (!extra.userData) roots.push(dir);
  const home = path.join(dir, 'home');
  const starts: SessionOptions[] = [], modes: PermissionMode[] = [], answers: { id: string; answer: unknown }[] = [], sent: string[] = [];
  let sink!: SessionSink;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, env: { CLAUDE_CONFIG_DIR: home }, ...extra, sessionFactory: (_h, o, s) => {
    sink = s; starts.push(o);
    return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { sink.changed({ state: 'idle' }); }, send(text: string) { sent.push(text); },
      close: async () => { sink.changed({ state: 'closed' }); sink.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: (id: string, answer: unknown) => { answers.push({ id, answer }); return true; },
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async (pm: PermissionMode) => { modes.push(pm); }, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  return { m, dir, home, starts, modes, answers, sent, sink: () => sink };
}
const agent = (policy: AgentPolicy) => ({ owner: plainOwner('claude', null), instructions: 'Sei un revisore.', policy });
const reviewer: AgentPolicy = { tools: { allow: ['read'] }, ceiling: 'default' };

describe('agent policy on chats', () => {
  it('passes the policy to the engine and clamps an explicit mode to the ceiling', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, permissionMode: 'bypassPermissions', prompt: 'x' }, 'user', agent(reviewer));
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read'] }, ceiling: 'default', permissionMode: 'default' });
    expect(f.m.list().find(x => x.id === c.id)?.permissionMode).toBe('default');
  });

  it('a Claude agent without a chosen mode runs at the ceiling when Brother’s settings default is higher', async () => {
    const f = fixture();
    fs.mkdirSync(f.home, { recursive: true });
    fs.writeFileSync(path.join(f.home, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }));
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent(reviewer));
    expect(f.starts.at(-1)?.permissionMode).toBe('default');
    fs.writeFileSync(path.join(f.home, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'plan' } }));
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'y' }, 'user', agent(reviewer));
    expect(f.starts.at(-1)?.permissionMode).toBeNull(); // below the ceiling: his settings decide, as for any chat
  });

  it('a Claude chat with no mode of its own starts in «default», so the app answers its requests, not the engine\'s own default (ADR 0290)', async () => {
    const f = fixture();
    fs.mkdirSync(f.home, { recursive: true });
    // the engine's default is «auto»: its classifier would decide before the app
    fs.writeFileSync(path.join(f.home, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'auto' } }));
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user');
    expect(f.starts.at(-1)?.permissionMode).toBe('default');
    // not a choice of the user: nothing is stored as one, and it bounds no child
    expect(f.m.chosenMode(c.id)).toBeNull();
    // a «default» the user picks is the same for a child: the app answers this chat without asking, so it bounds none;
    // «plan» picked on the chat does, and so does a role limited to «default», through its policy
    await f.m.set(c.id, { permissionMode: 'default' });
    expect(f.m.chosenMode(c.id)).toBeNull();
    await f.m.set(c.id, { permissionMode: 'plan' });
    expect(f.m.chosenMode(c.id)).toBe('plan');
    const limited = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'r' }, 'user', agent(reviewer));
    expect(f.m.chosenMode(limited.id)).toBeNull();
    expect(f.m.agentPolicy(limited.id)?.ceiling).toBe('default');
    // the user's own pick still wins, «auto» included
    await f.m.create({ harness: 'claude', cwd: f.dir, permissionMode: 'auto', prompt: 'y' }, 'user');
    expect(f.starts.at(-1)?.permissionMode).toBe('auto');
    // no settings at all: the same «default»
    fs.rmSync(path.join(f.home, 'settings.json'));
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'z' }, 'user');
    expect(f.starts.at(-1)?.permissionMode).toBe('default');
    // «plan» as the user's engine default is less than «default»: it stays theirs
    const withDefault = async (settings: string, where = path.join(f.home, 'settings.json')) => {
      fs.mkdirSync(path.dirname(where), { recursive: true });
      fs.writeFileSync(where, settings);
      await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'w' }, 'user');
      return f.starts.at(-1)?.permissionMode;
    };
    expect(await withDefault(JSON.stringify({ permissions: { defaultMode: 'plan' } }))).toBeNull();
    // so does a mode the app does not know, and settings it cannot read: it cannot tell what the user asked for
    expect(await withDefault(JSON.stringify({ permissions: { defaultMode: 'dontAsk' } }))).toBeNull();
    expect(await withDefault('{ "permissions": { "defaultMode": "auto" }, }')).toBeNull();
    // the other modes it knows ask no less than «default»: the app answers there too
    expect(await withDefault(JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }))).toBe('default');
    expect(await withDefault(JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }))).toBe('default');
    expect(await withDefault(`\uFEFF${JSON.stringify({ permissions: { defaultMode: 'auto' } })}`)).toBe('default'); // a BOM is not «cannot read»
    // the project's own settings are the last word, as for the CLI
    expect(await withDefault(JSON.stringify({ permissions: { defaultMode: 'plan' } }), path.join(f.dir, '.claude', 'settings.json'))).toBeNull();
  });

  it('the app decides on the whole input: a long Write is answered, not left to the user because its text was shortened for the screen', async () => {
    const f = fixture();
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user');
    const whole = { file_path: path.join(f.dir, 'notes.md'), content: 'riga di testo\n'.repeat(500) };
    const short = trimInput(whole);
    expect((short as typeof whole).content).toMatch(/… \(\+\d+\)$/);
    // as the Claude session sends it: the short input in the request, the whole one beside it
    f.sink().pending({ id: 'w1', type: 'permission', tool: 'Write', title: 'Write', detail: '', input: short, at: 1 }, whole);
    expect(f.answers).toEqual([{ id: 'w1', answer: expect.objectContaining({ kind: 'permission', allow: true }) }]);
    // the shortened one alone is not what will run: it stays the user's call, with the short input on the panel
    f.sink().pending({ id: 'w2', type: 'permission', tool: 'Write', title: 'Write', detail: '', input: short, at: 1 });
    expect(f.answers).toHaveLength(1);
    const shown = f.m.pending().find(p => p.id === 'w2');
    expect((shown?.input as typeof whole).content.length).toBeLessThan(whole.content.length);
  });

  it('a waiting engine starts with no mode and gets «default» when a chat takes it; another engine is left alone', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture({ prewarm: true, prewarmDelayMs: 0 });
      await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user');
      await vi.advanceTimersByTimeAsync(10);
      const waiting = f.starts.length;
      expect(waiting).toBe(2);
      expect(f.starts.at(-1)?.permissionMode).toBeNull();   // a user whose default is «plan» keeps it on this engine
      await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'y' }, 'user');
      await vi.advanceTimersByTimeAsync(10);
      expect(f.starts.filter(o => o.permissionMode === 'default')).toHaveLength(1);   // the second chat started no engine of its own
      expect(f.modes).toEqual(['default']);
      // a user whose engine default is «plan»: the chat that takes the next waiting engine sends it no mode
      fs.mkdirSync(f.home, { recursive: true });
      fs.writeFileSync(path.join(f.home, 'settings.json'), '\uFEFF' + JSON.stringify({ permissions: { defaultMode: 'plan' } })); // a BOM, as Windows editors write
      await vi.advanceTimersByTimeAsync(10);
      const before = f.starts.length;
      await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'z' }, 'user');
      await vi.advanceTimersByTimeAsync(10);
      expect(f.starts.slice(before).filter(o => o.permissionMode !== null)).toEqual([]);
      expect(f.modes).toEqual(['default']);
    } finally { vi.useRealTimers(); }
    const g = fixture();
    await g.m.create({ harness: 'codex', cwd: g.dir, prompt: 'x' }, 'user');
    expect(g.starts.at(-1)?.permissionMode).toBeNull();
  });

  it('refuses a mode above the ceiling and allows one within it', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent(reviewer));
    await expect(f.m.set(c.id, { permissionMode: 'acceptEdits' })).rejects.toThrow(/limite la modalità «default»/);
    await f.m.set(c.id, { permissionMode: 'plan' });
    expect(f.modes).toEqual(['plan']);
  });

  it('a role that may only read commands: a writing command is refused visibly, a reading one runs without asking (ADR 0278)', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent({ tools: { allow: ['read', 'shell-read'] }, ceiling: 'default' }));
    const ask = (id: string, command: string) => f.sink().pending({ id, type: 'permission', tool: 'Bash', title: `Bash: ${command}`, detail: command, input: { command }, at: 1, alwaysRules: ['Bash(git:*)'] });
    ask('p1', 'rm -rf src');
    expect(f.answers).toEqual([{ id: 'p1', answer: expect.objectContaining({ kind: 'permission', allow: false }) }]);
    expect(f.m.pending().filter(p => p.chatId === c.id)).toEqual([]);
    expect(f.m.items(c.id).some(i => i.kind === 'system' && i.code === 'commandReadOnly')).toBe(true);
    ask('p2', 'git status');
    expect(f.answers.find(a => a.id === 'p2')?.answer).toMatchObject({ kind: 'permission', allow: true });
    expect(f.m.pending().some(p => p.id === 'p2')).toBe(false);
  });

  it('the app answers itself (ADR 0254): all passes but what the brain\'s rules hold, refused visibly or sent to the user without «always»', async () => {
    const f = fixture({ brainRoot: () => path.join(__dirname, '..', '..', 'fixtures', 'brain-policy') });
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' });
    const ask = (id: string, command: string, tool = 'Bash') => f.sink().pending({ id, type: 'permission', tool, title: `${tool}: ${command}`, detail: command, input: { command }, at: 1, alwaysRules: ['Bash(x:*)'] });
    ask('a1', 'git status');
    ask('a2', 'git push --force');
    ask('a3', 'npm test');
    ask('a4', 'az webapp restart -n app -g rg');
    ask('a5', 'x', 'mcp__Gmail__send_message');
    expect(f.answers).toEqual([
      { id: 'a1', answer: { kind: 'permission', allow: true } },
      { id: 'a2', answer: { kind: 'permission', allow: true } },
      { id: 'a3', answer: { kind: 'permission', allow: true } },
      { id: 'a4', answer: expect.objectContaining({ kind: 'permission', allow: false, message: expect.stringMatching(/^Held by the user's rule "azure-write".*Esegui/) }) },
    ]);
    expect(f.m.items(c.id).some(i => i.kind === 'system' && i.code === 'policyEsegui')).toBe(true);
    expect(f.m.pending().filter(p => p.chatId === c.id)).toEqual([expect.objectContaining({ id: 'a5', noAlways: true })]);
    expect(f.m.pending().find(p => p.id === 'a5')?.alwaysRules).toBeUndefined();
  });

  it('after a brain rule refuses a Codex, Cursor or OpenCode request, a turn that stopped there is told why once and goes on (ADR 0254)', async () => {
    // a clock that moves on every read: each item comes strictly after the one before
    let clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10));
    try { for (const harness of ['codex', 'cursor', 'opencode']) {
      const f = fixture({ brainRoot: () => path.join(__dirname, '..', '..', 'fixtures', 'brain-policy'), engineOn: () => true });
      await f.m.create({ harness, cwd: f.dir, prompt: 'x' });
      const result = (id: string, extra: object = {}) => f.sink().item({ kind: 'result', id, at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: false, ...extra }, false);
      const refuse = (id: string, command: string) => f.sink().pending({ id, type: 'permission', tool: 'Bash', title: 'Bash', detail: '', input: { command }, at: 1 });
      const notes = () => f.sent.filter(t => t.startsWith('[rifiuto dell’app'));
      f.sink().changed({ state: 'running' });
      refuse('z1', 'az group delete -n rg');
      expect(f.answers.at(-1)).toMatchObject({ id: 'z1', answer: { allow: false } });
      result('r1');
      await vi.waitFor(() => expect(notes(), harness).toEqual([expect.stringContaining('[rifiuto dell’app · regola «azure-write»] Held by the user\'s rule')]));
      // the same rule again in this run: never a loop; the agent said something after a refusal; the user's Stop; a failed turn
      refuse('z2', 'az group delete -n rg'); result('r2');
      refuse('z3', 'cat .env'); f.sink().item({ kind: 'assistant', id: 'a1', at: Date.now(), text: 'Ti lascio il comando da lanciare con Esegui.', streaming: false }, false); result('r3');
      refuse('z4', 'cat .env'); result('r4', { interrupted: true });
      refuse('z5', 'cat .env'); result('r5', { isError: true });
      // a later refusal that stopped the turn is told: the ones above would have arrived before it
      refuse('z6', 'printenv'); result('r6');
      await vi.waitFor(() => expect(notes()).toHaveLength(2));
      expect(notes()[1]).toContain('regola «secrets-never-print»');
    } } finally { now.mockRestore(); }
  });

  it('under brain rules, nothing the user grants for a tool they could hold is «always» (ADR 0254)', async () => {
    const f = fixture({ brainRoot: () => path.join(__dirname, '..', '..', 'fixtures', 'brain-policy') });
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' });
    f.sink().pending({ id: 's1', type: 'permission', tool: 'Bash', title: 'Bash', detail: '', input: { command: 'cp a .git/hooks/pre-commit' }, at: 1, alwaysRules: ['Bash(cp:*)'] });
    expect(f.m.pending().find(p => p.id === 's1')).toMatchObject({ noAlways: true });
    expect(f.m.pending().find(p => p.id === 's1')?.alwaysRules).toBeUndefined();
  });

  it('a brain permissions.json that cannot be read: one notice, then the user decides all but reads (ADR 0254)', async () => {
    const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-policy-brain-'));
    roots.push(brain);
    fs.writeFileSync(path.join(brain, 'permissions.json'), '{ broken');
    const f = fixture({ brainRoot: () => brain });
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' });
    const ask = (id: string, command: string) => f.sink().pending({ id, type: 'permission', tool: 'Bash', title: `Bash: ${command}`, detail: command, input: { command }, at: 1 });
    ask('b1', 'git status');
    ask('b2', 'npm test');
    ask('b3', 'npm run build');
    expect(f.answers).toEqual([{ id: 'b1', answer: { kind: 'permission', allow: true } }]);
    expect(f.m.items(c.id).filter(i => i.kind === 'system' && i.code === 'policyBroken')).toHaveLength(1);
    expect(f.m.pending().filter(p => p.chatId === c.id).map(p => p.id)).toEqual(['b2', 'b3']);
  });

  it('the app never answers for a tool class the role was not given (ADR 0103)', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent({ tools: { allow: ['read'] }, ceiling: null }));
    f.sink().pending({ id: 'e1', type: 'permission', tool: 'Edit', title: 'Edit', detail: '', input: { file_path: path.join(f.dir, 'a.txt') }, at: 1 });
    f.sink().pending({ id: 'e2', type: 'permission', tool: 'Read', title: 'Read', detail: '', input: { file_path: path.join(f.dir, 'a.txt') }, at: 1 });
    expect(f.answers).toEqual([{ id: 'e2', answer: { kind: 'permission', allow: true } }]);
    expect(f.m.pending().filter(p => p.chatId === c.id).map(p => p.id)).toEqual(['e1']);
  });

  it('a chat without an agent policy is untouched', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, permissionMode: 'bypassPermissions', prompt: 'x' });
    expect(f.starts.at(-1)?.permissionMode).toBe('bypassPermissions');
    expect(f.starts.at(-1)?.toolPolicy).toBeUndefined();
    expect(f.m.browserAccess(c.id)).toBe('all');
  });

  it('hides the browser for an agent without the browser class', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent(reviewer));
    const b = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent({ tools: { allow: ['read', 'browser'] }, ceiling: null }));
    expect(f.m.browserAccess(c.id)).toBe('none');
    expect(f.m.browserAccess(b.id)).toBe('all');
  });

  it('a renewed Orchestrator never runs wider than the old one; a root chat the Orchestrator opens runs its own role, not the Orchestrator\'s read-only policy', async () => {
    const f = fixture();
    const orchestrator = await f.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true }, 'user', agent({ tools: { allow: ['read'] }, ceiling: 'plan' }));
    await f.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true, replaces: orchestrator.id });
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read'] }, ceiling: 'plan' });
    // an Artisan the Orchestrator starts writes within its own ceiling (finding: it used to start read-only in plan mode)
    const artisan = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'modifica X', permissionMode: 'acceptEdits' }, 'agent', agent({ tools: { allow: ['read', 'edit', 'shell', 'browser'] }, ceiling: 'acceptEdits' }));
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read', 'edit', 'shell', 'browser'] }, ceiling: 'acceptEdits', permissionMode: 'acceptEdits' });
    expect(f.m.browserAccess(artisan.id)).not.toBe('none');
    // a role's ceiling still holds: a mode above it runs at the ceiling
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'y', permissionMode: 'bypassPermissions' }, 'agent', agent(reviewer));
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read'] }, ceiling: 'default', permissionMode: 'default' });
    // a chat Brother opens himself is his own
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'z' });
    expect(f.starts.at(-1)?.toolPolicy).toBeUndefined();
  });

  it('a chat from the unauthenticated /mcp/app mount runs no wider than the Orchestrator, and needs one open', async () => {
    const f = fixture();
    const artisanRole = agent({ tools: { allow: ['read', 'edit', 'shell', 'browser'] }, ceiling: 'acceptEdits' });
    await expect(f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'agent', artisanRole, {}, { boundByOrchestrator: true })).rejects.toThrow(/Orchestrator aperto/);
    await f.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true }, 'user', agent({ tools: { allow: ['read'] }, ceiling: 'plan' }));
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x', permissionMode: 'acceptEdits' }, 'agent', artisanRole, {}, { boundByOrchestrator: true });
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read'] }, ceiling: 'plan', permissionMode: 'plan' });
    // the Orchestrator's own mount is not bound: the Artisan writes
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'y' }, 'agent', artisanRole);
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read', 'edit', 'shell', 'browser'] }, ceiling: 'acceptEdits' });
  });

  it('ADR 0085: an Orchestrator with every permission still bounds the /mcp/app chats read-only in plan mode; a renewed one runs its role as it is now', async () => {
    const f = fixture();
    const all: AgentPolicy = { tools: { allow: ['read', 'edit', 'shell', 'web', 'browser', 'mcp'] }, ceiling: null };
    const old = await f.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true }, 'user', agent({ tools: { allow: ['read'] }, ceiling: 'plan' }));
    // the user renews it (Ricomincia, Cambia motore) after widening the role: the role's policy, not the old chat's
    await f.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true, replaces: old.id }, 'user', agent(all));
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: all.tools });
    expect(f.starts.at(-1)?.ceiling ?? null).toBeNull();
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x', permissionMode: 'bypassPermissions' }, 'agent', agent(all), {}, { boundByOrchestrator: true });
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read'] }, ceiling: 'plan', permissionMode: 'plan' });
    // its own mount is not bound: a full role runs in the mode asked
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'y', permissionMode: 'bypassPermissions' }, 'agent', agent(all));
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: all.tools, permissionMode: 'bypassPermissions' });
  });

  it('an Orchestrator with no stored policy bounds the /mcp/app chats read-only, in plan mode (fail closed)', async () => {
    const f = fixture();
    await f.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true });
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'agent', agent({ tools: { allow: ['read', 'edit', 'shell'] }, ceiling: 'acceptEdits' }), {}, { boundByOrchestrator: true });
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read'] }, ceiling: 'plan' });
  });

  it('a fork of an agent chat keeps its policy', async () => {
    const f = fixture();
    const src = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent(reviewer));
    expect(src.sessionId).toBeTruthy();
    await f.m.create({ harness: 'claude', cwd: f.dir, resumeSessionId: src.sessionId!, fork: true, prompt: 'continue', permissionMode: 'bypassPermissions' });
    expect(f.starts.at(-1)).toMatchObject({ fork: true, toolPolicy: { allow: ['read'] }, ceiling: 'default', permissionMode: 'default' });
  });

  it('keeps the policy across a restart, and a damaged stored copy fails closed', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent(reviewer));
    await f.m.shutdown();
    const file = path.join(f.dir, 'chats.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as { chats?: { id: string; agentPolicy?: unknown }[] } | { id: string; agentPolicy?: unknown }[];
    const rows = Array.isArray(stored) ? stored : stored.chats ?? [];
    expect(rows.find(r => r.id === c.id)?.agentPolicy).toEqual(reviewer);
    const again = fixture({ userData: f.dir });
    await expect(again.m.set(c.id, { permissionMode: 'acceptEdits' })).rejects.toThrow(/limite/);
    await again.m.shutdown();
    rows.find(r => r.id === c.id)!.agentPolicy = { tools: { allow: ['everything'] }, ceiling: 'default' };
    fs.writeFileSync(file, JSON.stringify(stored));
    const damaged = fixture({ userData: f.dir });
    await expect(damaged.m.set(c.id, { permissionMode: 'default' })).rejects.toThrow(/limite la modalità «plan»/);
    expect(damaged.m.browserAccess(c.id)).toBe('none');
    expect(FAIL_CLOSED.ceiling).toBe('plan');
  });
});

it('refuses archived routine execution before launching any engine', async () => {
  const f = fixture();
  await expect(f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'Do not launch' }, 'app', undefined, {}, { routine: { runId: 'old', stepId: 'web', browserWrite: true } })).rejects.toThrow('terminal-only');
  expect(f.starts).toHaveLength(0);
});
