// app_create_chat where:'cloud' and app_chats' cloud list (src/main/appctl/tools.ts, ADR 0080): the Orchestrator starts
// a cloud agent through the same policy as a chat (an engine agents may not open is refused), the prompt is labelled
// as an agent's, never the user's; a bad where or engine is refused before anything starts.
import { describe, expect, it } from 'vitest';
import { AGENT_LABEL, appControlTools } from '../../../src/main/appctl/tools';
import type { BrainService, BrowserService, ChatService } from '../../../src/main/services';
import type { CloudService } from '../../../src/main/cloud/service';
import type { CloudStartRequest } from '../../../src/shared/cloud';

function setup(engines: Record<string, boolean> = { claude: true, cursor: true, codex: true }) {
  const started: { req: CloudStartRequest; by: string }[] = [];
  const cloud = {
    start: async (req: CloudStartRequest, by: string) => { started.push({ req, by }); return { id: 'bc_1', engine: req.engine, title: req.title, status: 'queued', repo: 'acme/shop', branch: 'cursor/x', url: 'https://cursor.com/agents?id=bc_1', by: 'agent', updatedAt: 0 }; },
    state: () => ({ agents: [{ id: 'bc_1', engine: 'cursor', title: 'Shop · X', status: 'running', repo: 'acme/shop', url: null, by: 'agent', updatedAt: 0, costUsd: 0.4 }], caps: {}, todayUsd: 0.4, polling: false }),
  } as unknown as CloudService;
  const chats = { list: () => [], pending: () => [], create: async () => { throw new Error('no local chat'); } } as unknown as ChatService;
  const brain = { settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true, cursor: true, codex: true }, engines, orchestratorChats: { harness: 'claude' }, contextWarnTokens: 1 }), info: () => ({ brainRoot: '/brain' }), routingInfo: () => ({ registry: null }) } as unknown as BrainService;
  const tools = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', cloud });
  return { started, tool: (n: string) => tools.find(t => t.name === n)! };
}

describe('app_create_chat where cloud', () => {
  it('starts a cloud agent (default Cursor) labelled as an agent’s message', async () => {
    const { started, tool } = setup();
    const out = await tool('app_create_chat').run({ title: 'Shop · X', prompt: 'fix it', cwd: '/w/shop', where: 'cloud' });
    expect(out).toMatchObject({ cloudAgentId: 'bc_1', engine: 'cursor', branch: 'cursor/x' });
    expect(started[0]!.by).toBe('agent');
    expect(started[0]!.req).toMatchObject({ engine: 'cursor', cwd: '/w/shop', title: 'Shop · X' });
    expect(started[0]!.req.prompt.startsWith(AGENT_LABEL)).toBe(true);
  });

  it('refuses an engine agents may not open, an unknown engine or where', async () => {
    const { started, tool } = setup({ claude: true, cursor: false, codex: true });
    await expect(Promise.resolve().then(() => tool('app_create_chat').run({ title: 'A', prompt: 'p', cwd: '/w', where: 'cloud' }))).rejects.toThrow(/bloccato/);
    await expect(Promise.resolve().then(() => tool('app_create_chat').run({ title: 'A', prompt: 'p', cwd: '/w', where: 'cloud', harness: 'api' }))).rejects.toThrow(/cursor \| codex \| claude/);
    await expect(Promise.resolve().then(() => tool('app_create_chat').run({ title: 'A', prompt: 'p', cwd: '/w', where: 'moon' }))).rejects.toThrow(/local \| cloud/);
    expect(started).toHaveLength(0);
  });

  it('app_chats lists the cloud agents', async () => {
    const { tool } = setup();
    const out = await tool('app_chats').run({}) as { cloud: unknown[] };
    expect(out.cloud).toEqual([expect.objectContaining({ id: 'bc_1', engine: 'cursor', status: 'running', costUsd: 0.4 })]);
  });
});
