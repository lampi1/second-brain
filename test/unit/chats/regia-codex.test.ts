// A Codex Orchestrator's app_create_chat path over an isolated real MCP server and ChatManager, ending at a fake Codex
// app-server's turn/start. Proves title, engine, ownership and the full labelled brief survive without duplicate
// real chats, credentials, network services or model calls. Also checks the existing engine policy stays enforced.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { appControlTools, AGENT_LABEL } from '../../../src/main/appctl/tools';
import { routeChat, type RouteRequest } from '../../../src/main/brain/routing';
import { ChatManager } from '../../../src/main/chats/manager';
import { engineOf, fingerprint, setTrust } from '../../../src/main/engines/registry';
import { McpServer, type McpTool } from '../../../src/main/mcp/server';
import type { BrainService, BrowserService } from '../../../src/main/services';
import { recEmitter, tmp, waitFor } from './helpers';

const FAKE = path.resolve(import.meta.dirname, '../../fixtures/fake-codex-app-server.mjs');
const live: { manager: ChatManager; server: McpServer }[] = [];
afterEach(async () => {
  try { for (const { manager, server } of live.splice(0)) { try { await manager.shutdown(200); } finally { server.close(); } } }
  finally { setTrust({}); }
});

async function setup() {
  const cwd = tmp('regia-codex-cwd'), userData = tmp('regia-codex-data');
  const log = path.join(userData, 'codex.jsonl');
  // Synthetic trust in this test process only: no real user's settings or trust file are changed.
  setTrust({ codex: fingerprint(engineOf('codex')!) });
  const manager = new ChatManager({ emitter: recEmitter(), userData, enginePaths: { codex: FAKE }, env: { FAKE_CODEX_LOG: log, FAKE_CODEX_DELAY: '1' } });
  const server = new McpServer({ name: 'regia-codex-test', version: '0' });
  live.push({ manager, server });
  const regia = await manager.create({ harness: 'codex', cwd, title: 'Regia · Test isolato', regia: true });
  let enabled = true;
  const brain = {
    routingInfo: () => ({ registry: null }), route: (req: RouteRequest) => routeChat(req, null, null, null),
    settings: () => ({ messaging: { crossHarness: false }, engineOn: { codex: enabled }, engines: { codex: enabled },
      regiaChats: { harness: 'codex', claudeModel: '', cursorModel: '', claudeEffort: '' } }),
    info: () => ({ brainRoot: cwd }),
  } as unknown as BrainService;
  const tools = appControlTools({ chats: manager, browser: { list: () => [] } as unknown as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }, regia.id);
  server.mount('/mcp/app', { name: 'app', instructions: 'Isolated app-control test', tools: tools.map((t): McpTool => ({ ...t, inputSchema: t.inputSchema as Record<string, unknown>, run: async a => JSON.stringify(await t.run(a)) })) });
  const port = await server.listen(0);
  const rpc = async (method: string, params: object = {}): Promise<{ result: { content: { text: string }[]; isError?: boolean; tools?: { name: string; inputSchema: { properties: { harness: { description: string } } } }[] } }> => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp/app`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    expect(response.status).toBe(200);
    return response.json();
  };
  return { manager, regia, cwd, log, rpc, disable: () => { enabled = false; } };
}

describe('Codex app_create_chat', () => {
  it('advertises Codex and delivers one work chat with the informative title and complete brief', async () => {
    const { manager, regia, cwd, log, rpc } = await setup();
    const listed = await rpc('tools/list');
    expect(listed.result.tools?.find(t => t.name === 'app_create_chat')?.inputSchema.properties.harness.description).toContain('codex');
    const title = 'Alfa · Conferme MCP e consegna brief';
    const prompt = `Contesto: progetto Alfa.\nObiettivo: verifica il passaggio completo.\n${'Dettaglio del lavoro. '.repeat(300)}\nConsegna: report finale integrale.`;
    const reply = await rpc('tools/call', { name: 'app_create_chat', arguments: { title, prompt, cwd, harness: 'codex' } });
    expect(reply.result.isError).not.toBe(true);
    const made = JSON.parse(reply.result.content[0]!.text) as { chatId: string; title: string; harness: string; cwd: string };
    expect(made).toMatchObject({ title, harness: 'codex', cwd });
    expect(manager.list()).toHaveLength(2);
    const chat = manager.list().find(c => c.id === made.chatId)!;
    expect(chat).toMatchObject({ title, harness: 'codex', isRegia: false, regiaOf: regia.id });
    const lines = (): { cwd?: string; msg?: { method?: string; params?: { input?: { type: string; text: string }[] } } }[] => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    await waitFor(() => manager.items(made.chatId).some(i => i.kind === 'assistant' && i.text === 'Ciao da Codex'), 'fake work chat completes');
    const turns = lines().filter(l => l.msg?.method === 'turn/start');
    expect(turns).toHaveLength(1);
    const text = turns[0]!.msg!.params!.input!.find(i => i.type === 'text')!.text;
    expect(text.startsWith(AGENT_LABEL)).toBe(true);
    expect(text).toContain(`Il tuo Orchestrator è «${regia.title}»`);
    expect(text.endsWith(prompt)).toBe(true);
    expect(lines().filter(l => l.cwd).every(l => l.cwd === cwd)).toBe(true);
    expect(manager.list().filter(c => c.isRegia)).toHaveLength(1);
  });

  it('keeps an explicit engine refusal visible and does not create a chat', async () => {
    const { manager, rpc, disable } = await setup();
    disable();
    const reply = await rpc('tools/call', { name: 'app_create_chat', arguments: { title: 'Alfa · Non avviare', prompt: 'Brief', harness: 'codex' } });
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0]!.text).toContain('spento');
    expect(manager.list()).toHaveLength(1);
  });
});
