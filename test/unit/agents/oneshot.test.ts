// One-shot eligibility and provenance tests use fake transports only; no CLI or model tokens are spent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ONE_SHOT_PURPOSES } from '../../../src/shared/agents';
import { OneShotService } from '../../../src/main/agents/oneshot';
import { AgentRunStore } from '../../../src/main/agents/runs';
import { closeAppDbs } from '../../../src/main/app-db';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { setBrainEngines, setTrust, fingerprint, brainEngine } from '../../../src/main/engines/registry';
import type { EngineEntry } from '../../../src/main/engines/registry';
const dirs: string[] = [];
afterEach(() => { setBrainEngines([]); setTrust({}); closeAppDbs(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function setup(engine = 'cursor') {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-once-')); dirs.push(userData);
  const profile = { ...new AgentCatalogService({ userData, models: () => [] }).list().profiles.find(p => p.id === 'artisan')!, engine, model: null };
  const run = vi.fn(async (req: { cwd: string }) => {
    expect(fs.readdirSync(req.cwd)).toEqual([]);
    return { ok: true as const, text: 'done', model: null, effort: null, costUsd: 0.01, tokens: null, turns: 1, durationMs: 1 };
  });
  let fallback: 'auto' | 'off' = 'auto';
  const runs = new AgentRunStore(userData);
  const deps = { userData, profile: () => profile, settings: () => ({ engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true } }),
    registry: () => null, hasKey: () => false, addApiSpend: vi.fn(), fallback: () => fallback, headless: { run }, text: { complete: vi.fn() }, runs };
  const service = new OneShotService(deps);
  return { deps, service, run, runs, userData, off: () => { fallback = 'off'; } };
}
const request = { agentId: 'artisan', system: 'system', prompt: 'digest', maxOutputTokens: 1200, timeoutMs: 120000, purpose: 'upgrade' as const };
it.each(ONE_SHOT_PURPOSES)('falls back to tool-free Claude and persists %s provenance through a restart', async purpose => {
  const f = setup(); const r = await f.service.runOnce({ ...request, purpose });
  expect(r).toMatchObject({ ok: true, engine: 'claude', costBasis: 'reported' });
  expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ noTools: true, maxTokens: 1200, timeoutMs: 120000 }));
  const saved = new AgentRunStore(f.userData).list()[0]!;
  expect(saved).toMatchObject({ source: 'oneshot', oneshot: { engine: 'claude', fallback: true, job: purpose }, endReason: 'completed' });
  expect(saved.chatId).toMatch(/^os_[a-f0-9]{12}$/);
  expect(fs.readdirSync(path.join(f.userData, 'oneshot'))).toEqual([]);
});
it('does not start Cursor with fallback off and reports its isolation reason', async () => {
  const f = setup(); f.off(); expect(await f.service.runOnce(request)).toMatchObject({ ok: false, noEngine: true });
  expect(f.run).not.toHaveBeenCalled();
  expect(f.service.availability()).toContainEqual({ id: 'cursor', available: false, reason: 'non ancora isolato' });
});
it('rejects an API without launch authorization', () => {
  const f = setup();
  const e = brainEngine('example', { kind: 'api', label: 'Example', name: 'Example', baseUrl: 'https://example.test/v1', protocol: 'openai' });
  expect(typeof e).not.toBe('string');
  setBrainEngines([e as EngineEntry]); setTrust({ example: fingerprint(e as EngineEntry) });
  expect(f.service.availability().find(x => x.id === 'example')?.available).toBe(false);
});
it('skips a model-less API fallback and accounts a selected API when its mid-tier model exists', async () => {
  const f = setup();
  const entry = brainEngine('example', { kind: 'api', label: 'Example', name: 'Example', baseUrl: 'https://example.test/v1', protocol: 'openai' }) as EngineEntry;
  setBrainEngines([entry]); setTrust({ example: fingerprint(entry) });
  const deps = { ...f.deps, settings: () => ({ engineOn: { claude: true, example: true }, engines: { claude: true, example: true } }), hasKey: () => true };
  expect((await new OneShotService(deps).runOnce(request)).engine).toBe('claude');
  const api = new OneShotService({ ...deps, registry: () => ({ harnesses: {}, defaultModel: 'mid-model', models: [{ id: 'mid-model', harness: 'example', provider: 'example', routing: 'auto', tier: 'mid', efforts: [], defaultEffort: null,
    price: { input: 1, output: 2, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 } }] }) });
  expect((await api.runOnce(request)).engine).toBe('example');
  expect(f.deps.addApiSpend).toHaveBeenCalledWith('example', 0.01);
});
