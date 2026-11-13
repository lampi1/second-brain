// Regression across the engine/service boundary: a failed inventory must preserve its old root identity as well as
// its data, so a newly selected unavailable brain cannot query another brain's persisted index.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { Engine } from '../../../src/main/search/hybrid/engine';
import { HybridSearch } from '../../../src/main/search/hybrid/service';
import type { WorkerReq } from '../../../src/main/search/hybrid/protocol';
import { Store } from '../../../src/main/search/hybrid/store';

it('does not claim a retained index belongs to an unavailable brain', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-root-switch-'));
  const store = new Store(':memory:', null);
  try {
    fs.writeFileSync(path.join(root, 'now.md'), 'previous brain content');
    const engine = new Engine(store, async () => ['now.md']);
    let selected = root;
    const service = new HybridSearch({ dir: '', brainRoot: () => selected, workerFile: '', download: false });
    // Bridge the service to the real engine without a worker thread; rejected requests behave like worker ok:false.
    (service as unknown as { call: (req: WorkerReq) => Promise<unknown> }).call = req => {
      if (req.op === 'sync') return engine.sync(req.root);
      if (req.op === 'query') return engine.query(req.q);
      throw new Error('unexpected operation');
    };
    expect(await service.sync()).toBe(true);
    selected = path.join(root, 'offline');
    expect(await service.sync()).toBe(false);
    await expect(service.query('previous')).rejects.toThrow('brain index not ready');
    expect(engine.status().docs).toBe(1);
    selected = root;
    expect((await service.query('previous')).map(h => h.path)).toEqual(['now.md']);
  } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
