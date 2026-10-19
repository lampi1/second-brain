// The routing ledger end to end (ADR 0032): a chat an Orchestrator opens with app_create_chat naming no model is routed by the
// brain's table and, at its first turn end, writes its prediction and then its measured actuals to the shared ledger
// (<brain>/ops/state/improve/outcomes.jsonl) that the improvement loop learns from (the user, 2026-10-14: "inizi a
// raccogliere dati dalle sue prime scelte"). The real app with the fake Claude CLI and a fixture brain (registry +
// table v1), hidden; no screenshot: nothing on screen changes.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { launch } from './helpers';
import { McpClient } from './fixture-server';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => (a && typeof a === 'object' ? resolve(a.port) : reject(new Error('no port')))); });
});

/** A brain with the model registry and a one-row table: chats of the area «Prova» → Haiku, low effort. */
function fixtureBrain(): string {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-'));
  const price = { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 0.1, output: 5 };
  fs.mkdirSync(path.join(brain, 'harness'));
  fs.writeFileSync(path.join(brain, 'harness', 'models.json'), JSON.stringify({
    harnesses: { claude: { routing: 'auto' }, cursor: { routing: 'manual' }, api: { routing: 'manual' } }, defaultModel: 'claude-opus-5-5', modifiers: {},
    models: [
      { id: 'claude-opus-5-5', harness: 'claude', provider: 'anthropic', routing: 'auto', price, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
      { id: 'claude-haiku-5-5', harness: 'claude', provider: 'anthropic', routing: 'auto', price, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
    ],
  }));
  const dir = path.join(brain, 'ops', 'state', 'improve', 'routing');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v1.json'), JSON.stringify({ version: 1, exploration: 0, routes: [
    { kind: '*', area: 'Prova', harness: 'claude', model: 'claude-haiku-5-5', effort: 'low', why: 'prova: il più economico', since: '2026-10-14', evidence: 'e2e' },
  ] }));
  fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify({ version: 1, appliedAt: '2026-10-14T08:00:00.000Z', by: 'e2e' }));
  return brain;
}

test('a chat opened without a model writes its routing prediction, then its measured actuals, to the ledger', async () => {
  const brain = fixtureBrain();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
  const port = await freePort();
  // SB_LOAD_FORCE: a calm machine, so the agent's chat is never held in the CPU queue (ADR 0036) under the parallel suite
  const { app, page } = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home, SB_BRAIN: brain, SB_MCP_PORT: String(port), SB_LOAD_FORCE: '10,60' });
  try {
    const agent = new McpClient(`http://127.0.0.1:${port}/mcp/app`);
    await agent.init();
    // agent first (ADR 0078): no agentId, so the classifier picks the agent imported from the «Prova» row (its profile
    // carries the row's model and effort); its route still writes the ledger like a table route
    const made = JSON.parse(await agent.ok('app_create_chat', { title: 'Prova · Leggi i log', prompt: 'ciao' })) as { chatId: string; model: string; effort: string; route: { source: string; tableVersion: number } };
    expect(made).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low', route: { source: 'agent', agent: { chosenBy: 'classifier' } } });

    const ledger = path.join(brain, 'ops', 'state', 'improve', 'outcomes.jsonl');
    const lines = async (): Promise<Record<string, unknown>[]> => {
      try { return fs.readFileSync(ledger, 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>).filter(l => l.id === `app:${made.chatId}`); } catch { return []; }
    };
    // the fake CLI's first turn needs a node process started: slow beside the parallel suite (chat-duration.spec.ts)
    await expect.poll(async () => (await lines()).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    expect((await page.evaluate(() => window.sb.invoke('chat:list', undefined))).find(c => c.id === made.chatId)?.state).toBe('idle');
    const [pred, actual] = await lines();
    expect(pred).toMatchObject({ domain: 'routing', item: { harness: 'claude', model: 'claude-haiku-5-5', effort: 'low', area: 'Prova' },
      predicted: { policy: 'routing', version: null, value: { model: 'claude-haiku-5-5', effort: 'low', source: 'agent' } } });
    expect(String((pred!.predicted as { value: { reason: string } }).value.reason)).toContain('scelto dal classificatore');
    expect(actual).toMatchObject({ domain: 'routing', outcome: { known: false, source: 'measured' }, actual: { turns: 1, handoffs: 0 } });
    expect(typeof (actual!.actual as { usd: unknown }).usd).toBe('number');
  } finally {
    await app.close();
  }
});
