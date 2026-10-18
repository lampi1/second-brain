// Discovery fixtures exercise suggestions and an isolated home without reading the owner's directories.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { findBrainCandidates } from '../../../src/main/brain/detect';
import { ConfigStore } from '../../../src/main/brain/config';
import { SetupService } from '../../../src/main/agents/setup';
const roots: string[] = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-discovery-')); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it('offers the single found brain while a fresh profile still needs the interview', () => {
  const home = temp(), userData = temp(), brain = path.join(home, 'my-memory');
  fs.mkdirSync(path.join(brain, 'ops', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(brain, 'AGENTS.md'), '# Memory');
  fs.writeFileSync(path.join(brain, 'ops', 'tools', 'brain-site.mjs'), '// fixture');
  const config = new ConfigStore(userData, {});
  expect(findBrainCandidates(home)).toEqual([brain]);
  expect(config.get().brainRoot).toBeNull();
  expect(new SetupService(userData, !!config.get().brainRoot).get().status).toBe('new');
  expect(findBrainCandidates(temp())).toEqual([]);
  config.set({ brainRoot: brain });
  expect(new ConfigStore(userData, {}).get().brainRoot).toBe(brain);
  expect(new SetupService(userData, true).get().status).toBe('existing');
});
