// Demo pack wiring must use the real guard with a valid isolated deny list, never bypass it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type * as GuardModule from '../../src/main/brain/guard';
vi.mock('electron', () => ({ app: { getVersion: () => '0.1.0' }, dialog: {}, shell: {} }));
vi.mock('../../src/main/brain/guard', async importOriginal => ({ ...await importOriginal<typeof GuardModule>(), appScanner: () => path.resolve('tools/guard/scan.mjs') }));
import { createAgentPacks } from '../../src/main/agents/pack/wiring';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import type { BrainService } from '../../src/main/services';
it('prepares a demo export through the shipped scanner', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pack-demo-'));
  try {
    const catalog = new AgentCatalogService({ userData: data, models: () => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: null, authenticated: null }] });
    // Reproduce a profile from the previous demo version, which created an empty deny file.
    fs.writeFileSync(path.join(data, 'demo-agent-deny.txt'), '');
    const service = createAgentPacks(data, {} as BrainService, catalog, true);
    const plan = await service.packs.exportPlan('scout', 'sbagent');
    expect(plan.findings).toEqual([]); service.packs.close();
  } finally { fs.rmSync(data, { recursive: true, force: true }); }
});
