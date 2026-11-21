// Code Mode live check against the user's real Cursor agent (`agent acp`, ADR 0331; spends real Cursor tokens): only
// with SB_LIVE_CURSOR=1, an exception to AGENTS.md rule 4 the owner granted for this check (2026-11-21); keep runs to
// the minimum.   SB_LIVE_CURSOR=1 npx vitest run test/live/code-mode-cursor.live.test.ts
// The app's real chat start: a role chat created by the real ChatManager with codeMode on and no session factory, so
// the engine is the one the app starts (engines/sessions.ts sessionFor → AcpSession, its private config copy with the
// run_code allow rule, the Code Mode hint on the first turn). Its second-brain endpoint is the real MCP server with the
// real run_code (real native wrappers, the real permission chain). Cursor cannot hide its natives: asserts that the
// endpoint served run_code to the engine, that the model used it to read a file, and that `echo execute-script.sh` (a
// brain rule «esegui») never runs. The facts land in test-results/live-code-mode-cursor.json.
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager } from '../../src/main/chats/manager';
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

describe.skipIf(process.env.SB_LIVE_CURSOR !== '1')('live: Code Mode on the real Cursor chat start', () => {
  const server = new McpServer({ name: 'sb-live', version: '0' });
  const managers: ChatManager[] = [];
  afterAll(async () => { for (const m of managers) await m.shutdown(5000); await server.close(); });

  it('run_code served to the engine and used for a file read, execute-script.sh never run', async () => {
    const userData = tmp('cmc-live-ud'), cwd = tmp('cmc-live-cwd'), brain = tmp('cmc-live-brain');
    fs.writeFileSync(path.join(brain, 'permissions.json'), JSON.stringify({ version: 1, rules: RULES }));
    fs.writeFileSync(path.join(cwd, 'note.txt'), 'the secret word is pomegranate\n');
    const events: { ch: string; p: unknown }[] = [];
    await server.listen(0);
    // no sessionFactory: the ChatManager starts Cursor exactly as the app does
    const m = new ChatManager({
      userData, emitter: { emit: (ch: string, p: unknown) => { events.push({ ch, p }); } } as never, brainRoot: () => brain,
      mcpUrlFor: id => server.url(`/mcp/chat/${id}/t`), codeMode: () => true,
    });
    managers.push(m);
    const runCode = runCodeTool({
      decideFor: (c, t, i, o) => m.decideFor(c, t, i, o), row: (c, item, replace) => m.codeModeRow(c, item, replace),
      appTools: () => [], extServers: () => [], extTools: async () => [], context: c => m.codeModeContext(c),
      // the real wrappers; file reads in this thread (their worker file exists only in the build, out/main)
      native: (t, input, env) => runNative(t, input, { ...env, fsRun: async req => fsOp(req) }),
    });
    const served: string[][] = [];
    server.mount('/mcp/chat/:chatId/:token', {
      name: 'chat', instructions: '',
      tools: ({ params }) => { const list = [runCode].filter(t => m.chatToolShown(params.chatId ?? '', t.name)); served.push(list.map(t => t.name)); return list; },
    });

    const owner = { ...plainOwner('cursor', null), source: 'catalog' as const, id: 'scout', version: 1 };
    const chat = await m.create({ harness: 'cursor', cwd, title: 'Code Mode live (Cursor)' }, 'agent', { owner, instructions: 'Answer briefly.', policy: SCOUT });
    // the rule-4 guard (chats/cli.ts engineAllowed) refuses a real engine while VITEST/SB_TEST is set: lifted only while
    // this flagged test starts the engine (the owner's exception), set back as soon as the process is spawned
    const saved = { VITEST: process.env.VITEST, SB_TEST: process.env.SB_TEST };
    delete process.env.VITEST; delete process.env.SB_TEST;
    try {
      await m.send(chat.id, [
        'Protocol test of a host app. Use only the second-brain MCP tool run_code (one script is fine), no other tool. Do exactly this, in order:',
        `1. Read ${path.join(cwd, 'note.txt')} and remember the secret word.`,
        '2. Run the shell command: echo execute-script.sh',
        '3. Reply with one line: WORD=<the secret word> ECHO=<ran or blocked>.',
      ].join('\n'));
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
    }
    const done = await waitFor(() => events.find(e => e.ch === 'chat:item' && (e.p as { item: ChatItem }).item.kind === 'result')?.p as { item: Extract<ChatItem, { kind: 'result' }> } | undefined, 'the result', 360000);
    const items = events.filter(e => e.ch === 'chat:item').map(e => (e.p as { item: ChatItem }).item);
    const toolRows = items.filter((i): i is Extract<ChatItem, { kind: 'tool' }> => i.kind === 'tool').map(i => ({ name: i.name, status: i.status, summary: i.summary ?? '', output: (i.output ?? '').slice(0, 400) }));
    const reply = items.filter((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant').map(i => i.text).join('\n');
    const facts = { at: new Date().toISOString(), served, toolRows, reply, result: done.item };
    fs.mkdirSync(path.resolve(import.meta.dirname, '..', '..', 'test-results'), { recursive: true });
    fs.writeFileSync(path.resolve(import.meta.dirname, '..', '..', 'test-results', 'live-code-mode-cursor.json'), `${JSON.stringify(facts, null, 2)}\n`);

    // the engine listed the chat endpoint's tools and got run_code
    expect(served.some(l => l.includes('run_code'))).toBe(true);
    // the model used run_code to read the file
    expect(toolRows.some(r => r.name === 'run_code · Read' && r.status === 'ok')).toBe(true);
    expect(reply).toMatch(/pomegranate/i);
    // execute-script.sh: refused by the brain's «esegui» rule, never run (not through run_code, not natively)
    const echo = toolRows.filter(r => r.name === 'run_code · Bash');
    expect(echo.length).toBeGreaterThan(0);
    expect(echo.every(r => r.status !== 'ok')).toBe(true);
    expect(toolRows.filter(r => !r.name.startsWith('run_code') && /execute-script/.test(`${r.summary} ${r.output}`) && r.status === 'ok')).toEqual([]);
    expect(reply).not.toMatch(/ECHO=ran/i);
  }, 480000);
});
