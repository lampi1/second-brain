// Code Mode's launch on the real spawn path (ADR 0331): a role chat (its tool allowlist, as a Scout delegated by the
// Orchestrator) created through the real ChatManager, its options turned into the real ClaudeSession CLI arguments.
// The real-app failure of 2026-11-21: run_code was on the chat's endpoint and pre-allowed, the natives were hidden, but
// Claude defers MCP tools behind ToolSearch and nothing told the model to use run_code: it searched for Read/Bash by
// name and by "read file shell grep", found nothing and stopped. No engine runs: the session factory only records.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import { ClaudeSession } from '../../../src/main/chats/claude';
import type { HarnessSession, SessionOptions } from '../../../src/main/chats/session';
import type { AgentPolicy } from '../../../src/main/agents/tool-policy';
import { runCodeTool } from '../../../src/main/code-mode/tool';
import { toolListEntry } from '../../../src/main/mcp/server';
import { plainOwner } from '../../../src/main/agents/catalog';

const dirs: string[] = [], managers: ChatManager[] = [];
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cml-'))); dirs.push(d); return d; };
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(50); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/** a Scout-like role: reads, read-only commands, web, the app's MCP servers */
const SCOUT: AgentPolicy = { tools: { allow: ['read', 'shell-read', 'web', 'mcp'] }, ceiling: null };

async function roleChat(on: boolean, harness: 'claude' | 'cursor' | 'antigravity' = 'claude'): Promise<{ m: ChatManager; id: string; opts: SessionOptions }> {
  const seen: SessionOptions[] = [];
  const m = new ChatManager({
    userData: tmp(), emitter: { emit: () => {} } as never, brainRoot: () => null,
    mcpUrlFor: id => `http://127.0.0.1:4000/mcp/chat/${id}/token`, codeMode: () => on,
    sessionFactory: (h, options, s): HarnessSession => { seen.push(options); return { harness: h, state: 'idle', sessionId: options.sessionId ?? null, pid: null, root: null, busy: false, alive: true,
      start: () => { s.changed({ state: 'idle' }); }, send: () => {}, answer: () => false, interrupt: async () => {}, setModel: async () => {}, setPermissionMode: async () => {}, setEffort: async () => {},
      rename: async () => {}, contextUsage: async () => null, usage: async () => null, close: async () => {}, killNow: () => {} }; },
  });
  managers.push(m);
  const owner = { ...plainOwner(harness, null), source: 'catalog' as const, id: 'scout', version: 1 };
  const chat = await m.create({ harness, cwd: tmp(), title: 'Prova Code Mode' }, 'agent', { owner, instructions: 'Cerca.', policy: SCOUT });
  await m.send(chat.id, 'Leggi tre file.');
  return { m, id: chat.id, opts: seen.at(-1)! };
}

const flag = (args: string[], name: string): string | undefined => { const i = args.lastIndexOf(name); return i < 0 ? undefined : args[i + 1]; };

describe('Code Mode on the real Claude spawn path (role allowlist + codeMode)', () => {
  it('on: run_code shown and pre-allowed, natives hidden, no system-prompt line (run_code is loaded upfront instead)', async () => {
    const { m, id, opts } = await roleChat(true);
    expect(m.chatToolShown(id, 'run_code')).toBe(true);
    const args = new ClaudeSession(opts, { changed: () => {} } as never).args();
    expect(args.find(a => a.startsWith('--tools='))).toMatch(/Read/); // the role's allowlist, as in the real app
    expect(flag(args, '--allowedTools')!.split(',')).toContain('mcp__second-brain__run_code');
    expect(flag(args, '--disallowedTools')!.split(',')).toEqual(expect.arrayContaining(['Bash', 'Read', 'Grep', 'Glob', 'Edit', 'Write']));
    // Claude defers MCP tools behind ToolSearch: run_code's own _meta (anthropic/alwaysLoad) loads it upfront, the
    // documented mechanism, so no system-prompt line points the model at it (ADR 0331 point 6)
    expect(args).not.toContain('--append-system-prompt');
    expect(args.join(' ')).not.toMatch(/select:mcp__second-brain__run_code/);
    expect(JSON.parse(flag(args, '--mcp-config')!).mcpServers['second-brain'].url).toContain(`/mcp/chat/${id}/`);
  });

  it('off: no run_code, no hidden natives, no hint', async () => {
    const { m, id, opts } = await roleChat(false);
    expect(m.chatToolShown(id, 'run_code')).toBe(false);
    const args = new ClaudeSession(opts, { changed: () => {} } as never).args();
    expect(args).not.toContain('--disallowedTools');
    expect(args).not.toContain('--append-system-prompt');
    expect(args.join(' ')).not.toMatch(/run_code/);
  });

  it('Cursor: run_code shown, no Claude-only flags', async () => {
    const { m, id, opts } = await roleChat(true, 'cursor');
    expect(m.chatToolShown(id, 'run_code')).toBe(true);
    expect(opts.codeMode).toBe(true);
    expect((opts.extraArgs ?? []).join(' ')).not.toMatch(/disallowedTools|append-system-prompt/);
  });

  it('Cursor (ACP): no documented way to load or hide tools, so the first prompt keeps the Code Mode line', async () => {
    const { opts } = await roleChat(true, 'cursor');
    const { AcpSession } = await import('../../../src/main/chats/acp');
    const s = new AcpSession({ ...opts, engineId: 'cursor', label: 'Cursor', args: [], brainInstructions: 'Regole.' }, { changed: () => {} } as never) as unknown as { brainContext(): { text: string }[] };
    expect(s.brainContext()[0]?.text).toMatch(/prefer the second-brain tool run_code/);
    const sFlat = new AcpSession({ ...opts, engineId: 'cursor', label: 'Cursor', args: [], mcpUrl: 'http://127.0.0.1:4319/mcp/chat/x/t', flatJsonArgsHint: true, brainInstructions: 'Regole.' }, { changed: () => {} } as never) as unknown as { brainContext(): { text: string }[] };
    expect(sFlat.brainContext()[0]?.text).toMatch(/tasksJson instead of tasks.*propsJson instead of props/);
  });

  it('Antigravity (ACP): run_code exposed and first-turn hint added when on, neither when off, no Claude-only flags', async () => {
    const { AcpSession } = await import('../../../src/main/chats/acp');
    const on = await roleChat(true, 'antigravity');
    expect(on.m.chatToolShown(on.id, 'run_code')).toBe(true);
    expect(on.opts.codeMode).toBe(true);
    expect((on.opts.extraArgs ?? []).join(' ')).not.toMatch(/disallowedTools|append-system-prompt/);
    const sOn = new AcpSession({ ...on.opts, engineId: 'antigravity', label: 'Antigravity', args: [], brainInstructions: 'Regole.' }, { changed: () => {} } as never) as unknown as { brainContext(): { text: string }[] };
    expect(sOn.brainContext()[0]?.text).toMatch(/prefer the second-brain tool run_code/);

    const off = await roleChat(false, 'antigravity');
    expect(off.m.chatToolShown(off.id, 'run_code')).toBe(false);
    expect(off.opts.codeMode).toBeUndefined();
    const sOff = new AcpSession({ ...off.opts, engineId: 'antigravity', label: 'Antigravity', args: [], brainInstructions: 'Regole.' }, { changed: () => {} } as never) as unknown as { brainContext(): { text: string }[] };
    expect(sOff.brainContext()[0]?.text).not.toMatch(/run_code/);
  });

  it('Codex, OpenCode: Code Mode at Cursor\'s level (2026-11-23): run_code shown, the flag on, no Claude-only flags; off = none', async () => {
    for (const h of ['codex', 'opencode'] as const) {
      const on = await roleChat(true, h as never);
      expect(on.m.chatToolShown(on.id, 'run_code')).toBe(true);
      expect(on.opts.codeMode).toBe(true);
      expect((on.opts.extraArgs ?? []).join(' ')).not.toMatch(/disallowedTools|append-system-prompt/);
      const off = await roleChat(false, h as never);
      expect(off.m.chatToolShown(off.id, 'run_code')).toBe(false);
      expect(off.opts.codeMode).toBeUndefined();
    }
  });

  it('run_code\'s tools/list entry carries _meta anthropic/alwaysLoad (Claude loads it without ToolSearch); other tools none', () => {
    const t = runCodeTool({ decideFor: async () => ({ kind: 'deny', reason: '' }) as never, row: () => {}, appTools: () => [], extServers: () => [], extTools: async () => [], context: () => ({ error: 'x' }) });
    expect(toolListEntry(t, { chatId: 'c1' })).toMatchObject({ name: 'run_code', _meta: { 'anthropic/alwaysLoad': true } });
    expect(toolListEntry({ name: 'x', description: 'd', inputSchema: {}, run: () => ({ text: '' }) as never }, {})).not.toHaveProperty('_meta');
  });

  it('a keyword ToolSearch for the hidden natives finds run_code: its description names them first', () => {
    const t = runCodeTool({ decideFor: async () => ({ kind: 'deny', reason: '' }) as never, row: () => {}, appTools: () => [], extServers: () => [], extTools: async () => [], context: () => ({ error: 'x' }) });
    const head = t.description.slice(0, 120).toLowerCase();
    for (const word of ['read', 'file', 'shell', 'bash', 'grep', 'glob']) expect(head).toContain(word);
  });
});
