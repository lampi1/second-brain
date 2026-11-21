// Code Mode live check against the user's real `claude` CLI (ADR 0331; spends real tokens, a few cents): only with
// SB_LIVE=1.   SB_LIVE=1 npx vitest run test/live/code-mode.live.test.ts
// The app's real chat start: a role chat (a Scout-like tool allowlist) created by the real ChatManager with codeMode on,
// spawned as the real ClaudeSession with the arguments the app builds, its second-brain endpoint served by the real
// MCP server with the real run_code (real native wrappers, the real permission chain). Asserts from the engine's own
// init tool list that run_code is there and Read/Bash/Grep/Glob are not, that the model uses run_code to read a file,
// and that `echo execute-script.sh` (a brain rule «esegui») never runs. Never runs Cursor (AGENTS.md rule 4; its own check, SB_LIVE_CURSOR=1, is code-mode-cursor.live.test.ts). The
// facts (tool list, calls, cost) land in test-results/live-code-mode.json.
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager } from '../../src/main/chats/manager';
import { ClaudeSession } from '../../src/main/chats/claude';
import type { HarnessSession } from '../../src/main/chats/session';
import type { AgentPolicy } from '../../src/main/agents/tool-policy';
import { plainOwner } from '../../src/main/agents/catalog';
import { McpServer } from '../../src/main/mcp/server';
import { runCodeTool } from '../../src/main/code-mode/tool';
import { runNative } from '../../src/main/code-mode/natives';
import { fsOp } from '../../src/main/code-mode/fs-ops';
import type { ChatItem } from '../../src/shared/contract';
import { tmp, waitFor } from '../unit/chats/helpers';

const SCOUT: AgentPolicy = { tools: { allow: ['read', 'shell-read', 'web', 'mcp'] }, ceiling: null };
const RULES = [{ id: 'exec-script', action: 'esegui', why: 'scripts are the user\'s to run', tools: ['command'], match: ['execute-script'] }];

describe.skipIf(process.env.SB_LIVE !== '1')('live: Code Mode on the real Claude chat start', () => {
  const server = new McpServer({ name: 'sb-live', version: '0' });
  const managers: ChatManager[] = [];
  afterAll(async () => { for (const m of managers) await m.shutdown(2000); await server.close(); });

  it('run_code in the engine\'s tool list, natives hidden, a file read through it, execute-script.sh never run', async () => {
    const userData = tmp('cm-live-ud'), cwd = tmp('cm-live-cwd'), brain = tmp('cm-live-brain');
    fs.writeFileSync(path.join(brain, 'permissions.json'), JSON.stringify({ version: 1, rules: RULES }));
    fs.writeFileSync(path.join(cwd, 'note.txt'), 'the secret word is pomegranate\n');
    const events: { ch: string; p: unknown }[] = [];
    const sessions: ClaudeSession[] = [];
    await server.listen(0);
    const m = new ChatManager({
      userData, emitter: { emit: (ch: string, p: unknown) => { events.push({ ch, p }); } } as never, brainRoot: () => brain,
      mcpUrlFor: id => server.url(`/mcp/chat/${id}/t`), codeMode: () => true,
      // the engine the app starts (engines/sessions.ts makes the same ClaudeSession), with no transcript left behind
      sessionFactory: (_h, o, s): HarnessSession => { const c = new ClaudeSession({ ...o, extraArgs: [...(o.extraArgs ?? []), '--no-session-persistence'] }, s); sessions.push(c); return c; },
    });
    managers.push(m);
    const runCode = runCodeTool({
      decideFor: (c, t, i, o) => m.decideFor(c, t, i, o), row: (c, item, replace) => m.codeModeRow(c, item, replace),
      appTools: () => [], extServers: () => [], extTools: async () => [], context: c => m.codeModeContext(c),
      // the real wrappers; file reads in this thread (their worker file exists only in the build, out/main)
      native: (t, input, env) => runNative(t, input, { ...env, fsRun: async req => fsOp(req) }),
    });
    server.mount('/mcp/chat/:chatId/:token', { name: 'chat', instructions: '', tools: ({ params }) => [runCode].filter(t => m.chatToolShown(params.chatId ?? '', t.name)) });

    const owner = { ...plainOwner('claude', null), source: 'catalog' as const, id: 'scout', version: 1 };
    const chat = await m.create({ harness: 'claude', cwd, title: 'Code Mode live', model: 'sonnet' }, 'agent', { owner, instructions: 'Answer briefly.', policy: SCOUT });
    await m.send(chat.id, [
      'Protocol test of a host app. Do exactly this, in order:',
      `1. With your file tools, read ${path.join(cwd, 'note.txt')} and remember the secret word.`,
      '2. Run the shell command: echo execute-script.sh',
      '3. Reply with one line: WORD=<the secret word> ECHO=<ran or blocked>.',
    ].join('\n'));
    const sess = await waitFor(() => sessions[0], 'the engine');
    const tools = await waitFor(() => sess.toolsAtInit, 'the init tool list', 120000);
    const done = await waitFor(() => events.find(e => e.ch === 'chat:item' && (e.p as { item: ChatItem }).item.kind === 'result')?.p as { item: Extract<ChatItem, { kind: 'result' }> } | undefined, 'the result', 300000);
    const items = events.filter(e => e.ch === 'chat:item').map(e => (e.p as { item: ChatItem }).item);
    const toolRows = items.filter((i): i is Extract<ChatItem, { kind: 'tool' }> => i.kind === 'tool').map(i => ({ name: i.name, status: i.status, summary: i.summary ?? '', output: (i.output ?? '').slice(0, 400) }));
    const reply = items.filter((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant').map(i => i.text).join('\n');
    const facts = { at: new Date().toISOString(), args: sess.args().filter(a => !a.startsWith('{')), toolsAtInit: tools, toolRows, reply, result: done.item };
    fs.mkdirSync(path.resolve(import.meta.dirname, '..', '..', 'test-results'), { recursive: true });
    fs.writeFileSync(path.resolve(import.meta.dirname, '..', '..', 'test-results', 'live-code-mode.json'), `${JSON.stringify(facts, null, 2)}\n`);

    expect(tools).toContain('mcp__second-brain__run_code');
    for (const hidden of ['Read', 'Bash', 'Grep', 'Glob', 'Edit', 'Write', 'PowerShell']) expect(tools).not.toContain(hidden);
    // no system-prompt line any more: run_code's _meta anthropic/alwaysLoad loads it upfront, so the model calls it
    // without a ToolSearch and never reaches for a hidden native (before: it tried Read and Bash first, and an Opus
    // Scout gave up after a keyword ToolSearch, 2026-11-21)
    expect(sess.args()).not.toContain('--append-system-prompt');
    expect(toolRows.filter(r => r.name === 'ToolSearch')).toEqual([]);
    expect(toolRows.filter(r => ['Read', 'Bash', 'Grep', 'Glob', 'Edit', 'Write', 'PowerShell'].includes(r.name)).map(r => r.name)).toEqual([]);
    // the model found run_code and read the file through it
    expect(toolRows.some(r => r.name === 'run_code · Read' && r.status === 'ok')).toBe(true);
    expect(reply).toMatch(/pomegranate/i);
    // execute-script.sh: refused by the brain's «esegui» rule, never run
    const echo = toolRows.filter(r => r.name === 'run_code · Bash');
    expect(echo.length).toBeGreaterThan(0);
    expect(echo.every(r => r.status !== 'ok')).toBe(true);
    expect(reply).not.toMatch(/ECHO=ran/i);
  }, 420000);
});
