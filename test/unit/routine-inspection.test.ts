// Exact grant and package review exposes material target fields and disabled production intents before approval.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { FlowAutomationConfig, TestDeployTarget } from '../../src/shared/flow-automation';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import { FlowAutomationSummary } from '../../src/renderer/components/FlowAutomationSummary';
import { FlowDefinition } from '../../src/renderer/components/FlowDefinition';
import { setLang } from '../../src/renderer/i18n';
it('shows every deployment destination and artifact pin in the consent summary', () => {
  setLang('en');
  const target: TestDeployTarget = { id: 'test-node', organization: 'contoso', project: 'Example', projectId: 'project-guid', releaseDefinitionId: 7, definitionRevision: 2, definitionSha256: 'a'.repeat(64), environmentId: 11, environmentName: 'Verification', deploymentGroupId: 13, queueId: 17, poolId: 19, agentId: 23, machineId: 29, machineName: 'sample-agent', computerName: 'sample-host', artifactAlias: 'release-build', buildDefinitionId: 31, repositoryId: 'repository-guid', confirmedTest: true };
  const config: FlowAutomationConfig = { flowId: 'sample', flowVersion: 1, scope: {}, inputs: {}, priority: 'normal', trigger: { kind: 'devops', everyMinutes: 1, organization: 'contoso', project: 'Example', areaPath: 'Example', workItemType: 'Bug', states: ['New'], includeExisting: false }, devopsWrite: { organization: 'contoso', projects: ['Example'], ops: ['pr-create', 'test-deploy'], fields: [], deployTargets: [target] } };
  const html = renderToStaticMarkup(createElement(FlowAutomationSummary, { config }));
  for (const key of ['computerName', 'poolId', 'agentId', 'machineId', 'deploymentGroupId', 'queueId', 'repositoryId', 'projectId', 'artifactAlias', 'buildDefinitionId'] as const) { expect(html).toContain(`<dt>${key}</dt>`); expect(html).toContain(String(target[key])); }
  expect(html).toContain('explicitly approved test deployment targets'); expect(html).not.toContain('Approved test target');
});
it('production declarations show non-execution and distinct row limits and rollback', () => {
  setLang('en'); const html = renderToStaticMarkup(createElement(FlowDefinition, { definition: { id: 'sample', title: 'Example', description: 'Fixture', aliases: [], scope: {}, steps: [], package: { schema: 1, assets: [], outputs: [], requiredOps: [], production: [{ id: 'proposal', targetId: 'not-enabled', operation: 'db-write', recipeAssetId: 'change.sql', recipeSha256: 'a'.repeat(64), rollbackAssetId: 'undo.sql', timeoutMs: 1000, maxAffectedRows: 3 }] } } }));
  expect(html).toContain('design only, not enabled'); expect(html).toContain('Maximum rows affected'); expect(html).toContain('undo.sql'); expect(html).not.toContain('Approved package');
});
