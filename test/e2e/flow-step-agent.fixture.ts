// Fixture for flow-step-agent.spec.ts: a flow with role/tier agent steps and a running run; isolated demo data.
import type { FlowSnapshot } from '../../src/shared/flows';

const step = { inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['summary'], timeoutMs: 60_000, maxAttempts: 1 };
export const stepAgentSnapshot = (): FlowSnapshot => {
  const definition = { id: 'demo-fix', title: 'Correzione di prova', description: 'Un flusso di prova isolato: indaga, correggi, rivedi.', aliases: ['correzione prova'], scope: {},
    steps: [
      { ...step, id: 'investigate', title: 'Indaga la causa', kind: 'agent' as const, instructions: 'Trova la causa.', effect: 'read-only' as const, role: 'scout' as const, tier: 'mid' as const },
      { ...step, id: 'fix', title: 'Correggi', kind: 'agent' as const, instructions: 'Applica la correzione.', effect: 'code' as const, role: 'artisan' as const },
      { ...step, id: 'free', title: 'Riassumi', kind: 'agent' as const, instructions: 'Riassumi il lavoro.', effect: 'read-only' as const },
    ] };
  const now = Date.now();
  return { contextKey: 'flow-step-agent-fixture', drafts: [], active: { 'demo-fix': 1 },
    versions: [{ definition, version: 1, draftRevision: 1, digest: 'fixture', activatedAt: now }],
    runs: [{ id: 'run-1', revision: 2, flowId: 'demo-fix', flowVersion: 1, definitionDigest: 'fixture', ownerOrchestratorId: 'orc', subjectKey: 'Bug di prova', scope: {}, inputs: { workspace: 'C:/demo' },
      status: 'active', currentStep: 0, createdAt: now, updatedAt: now,
      steps: [{ stepId: 'investigate', status: 'running', attempts: 1, startedAt: now }, { stepId: 'fix', status: 'pending', attempts: 0 }, { stepId: 'free', status: 'pending', attempts: 0 }] }],
    roles: {
      scout: { name: 'Scout', avatar: { kind: 'character', value: 'scout' }, tier: 'light', tierMax: 'mid', model: null, models: { light: 'demo-light-model', mid: 'demo-mid-model' } },
      artisan: { name: 'Artisan', avatar: { kind: 'character', value: 'artisan' }, tier: 'mid', tierMax: 'top', model: null, models: { light: 'demo-light-model', mid: 'demo-mid-model', top: 'demo-top-model' } },
    } };
};
