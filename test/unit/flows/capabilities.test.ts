// Discovery must help compose routines without granting authority, changing state or inventing enabled operations.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DEVOPS_WRITE_OPS } from '../../../src/shared/flow-automation';
import { FlowService } from '../../../src/main/flows/service';
import { flowTools } from '../../../src/main/flows/tools';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-capabilities-')); dirs.push(dir);
  const service = new FlowService({ file: path.join(dir, 'flows.json'), contextKey: 'test' });
  const deps = { ownerId: 'owner', service: () => service, resolveBinding: () => null };
  return { service, deps, tool: flowTools(deps).find(t => t.name === 'app_flow_capabilities')! };
}
it('preserves the empty-argument API and exposes detailed building blocks without any state change', async () => {
  const { service, tool } = setup(), before = service.snapshot();
  expect(tool.annotations?.readOnlyHint).toBe(true);
  expect(await tool.run({})).toMatchObject({ automaticProduction: { enabled: false }, testDeploy: { enabled: true } });
  const authoring = await tool.run({ section: 'authoring' });
  expect(authoring).toMatchObject({ steps: { check: { actions: ['script', 'query'] } }, automation: { triggerKinds: ['manual', 'interval', 'devops'] } });
  expect(await tool.run({ section: 'devops' })).toMatchObject({ operations: [...DEVOPS_WRITE_OPS] });
  expect(await tool.run({ section: 'test-targets' })).toMatchObject({ deployment: { kinds: ['app-service', 'deployment-group'] }, database: { grant: 'testDbRead.targetIds' } });
  expect(service.snapshot()).toEqual(before);
});
it('rejects invented sections and arguments and remains unavailable without an authenticated owner', () => {
  const { tool, deps } = setup();
  for (const section of ['execute', 'approve', null, {}, 1]) expect(() => tool.run({ section })).toThrow('capability section');
  expect(() => tool.run({ section: 'devops', approve: true })).toThrow('unknown field');
  expect(flowTools({ ...deps, ownerId: '' })).toEqual([]);
});
it('returns independent catalogs so a caller cannot add grants for later discovery', async () => {
  const { tool } = setup(), first = await tool.run({ section: 'devops' }) as { operations: string[] };
  first.operations.push('merge-pr');
  expect(await tool.run({ section: 'devops' })).toMatchObject({ operations: [...DEVOPS_WRITE_OPS] });
  expect(DEVOPS_WRITE_OPS).not.toContain('merge-pr');
});
