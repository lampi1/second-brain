// Synthetic exact-target approval fixture shared by UI specifications and hidden dev review; contains no account data.
import type { FlowSnapshot } from '../../src/shared/flows';
const guid = '11111111-2222-3333-4444-555555555555';
export const routineConsentSnapshot: FlowSnapshot = {
  contextKey: 'synthetic-routine-consent', drafts: [], active: { 'test-fix': 1 }, runs: [],
  versions: [{ version: 1, draftRevision: 1, digest: 'fixture', activatedAt: 1, definition: {
    id: 'test-fix', title: 'Correzione verificata in test', description: 'Analisi, fix e verifica su un solo ambiente di test condiviso.', aliases: [], scope: { project: 'Example' },
    steps: [{ id: 'before', title: 'Verifica BEFORE', kind: 'agent', role: 'scout', tier: 'mid', engine: 'claude', model: 'sonnet', agentPrompt: 'Verify only the approved test target.', instructions: 'Raccogli screenshot e risultati; interrompi se l’ambiente cambia.', workspaceInput: 'workspace', inputs: ['workspace'], evidence: ['Screenshot e risultato'], timeoutMs: 60000, maxAttempts: 2, effect: 'read-only', testEnvironment: 'shared-test' }],
    package: { schema: 1, assets: [], outputs: [], requiredOps: ['test-environment', 'git-push', 'test-deploy', 'pr-validation'], intake: true },
  } }],
  automation: { revision: 1, paused: false, background: false, events: [], rules: [{ id: 'test-rule', revision: 1, ownerOrchestratorId: 'fixture', status: 'proposed', failures: 0, createdAt: 1, updatedAt: 1, config: {
    flowId: 'test-fix', flowVersion: 1, scope: { project: 'Example' }, inputs: { workspace: '/synthetic/workspace' }, priority: 'normal',
    trigger: { kind: 'devops', everyMinutes: 5, organization: 'contoso', project: 'Example', areaPath: 'Example\\Team', workItemType: 'Bug', states: ['New'], includeExisting: false, excludeTags: ['ai-needs-human'] },
    devopsWrite: { organization: 'contoso', projects: ['Example'], ops: ['comment', 'test-environment', 'git-push', 'pr-validation', 'test-deploy'], fields: [], pushTargets: [{ project: 'Example', repositoryId: guid, workspaceInput: 'workspace' }], deployTargets: [{ kind: 'app-service', id: 'shared-test', organization: 'contoso', project: 'Example', projectId: guid, releaseDefinitionId: 4, definitionRevision: 2, definitionSha256: 'a'.repeat(64), environmentId: 9, environmentName: 'Shared test', queueId: 7, artifactAlias: '_app', buildDefinitionId: 6, repositoryId: guid, subscriptionId: guid, resourceGroup: 'Sample_Test', webAppName: 'sample-test', serviceConnectionId: guid, allowedTaskIds: ['497d490f-eea7-4f2b-ab94-48d9c1acdcb1'], confirmedTest: true }] },
  } }] },
};
