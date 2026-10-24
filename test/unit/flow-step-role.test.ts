// An agent step's declared role and tier: validated (tier within the role's tierMax), enforced at bind (the chat must
// run that role on that tier, not a routing-table row), and resolved to a model for the Flussi page.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentProfile } from '../../src/shared/agents';
import type { FlowDefinition, FlowStep } from '../../src/shared/flows';
import { FlowService } from '../../src/main/flows/service';
import { digest, validateDefinition } from '../../src/main/flows/schema';
import { flowRoles } from '../../src/main/flows/roles';
import { stepAgentLabel, stepTierOptions } from '../../src/renderer/lib/flow-step-agent';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
const step = (extra: Partial<FlowStep> = {}): FlowStep => ({ id: 'work', title: 'Work', kind: 'agent', instructions: 'Do the configured task.', inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['result'], timeoutMs: 10_000, maxAttempts: 1, effect: 'read-only', ...extra });
const definition = (steps: FlowStep[]): FlowDefinition => ({ id: 'sample', title: 'Sample', description: 'Test fixture.', aliases: ['sample'], scope: {}, steps });
const tierMax = (role: string) => (role === 'scout' ? 'mid' as const : role === 'artisan' ? 'top' as const : undefined);

describe('flow step role and tier', () => {
  it('validates role and tier and keeps old definitions unchanged', () => {
    expect(validateDefinition(definition([step({ role: 'scout', tier: 'mid' })]), tierMax).steps[0]).toMatchObject({ role: 'scout', tier: 'mid' });
    expect(() => validateDefinition(definition([step({ role: 'scout', tier: 'top' })]), tierMax)).toThrow('maximum');
    expect(() => validateDefinition(definition([step({ role: 'orchestrator' as never })]))).toThrow('role');
    expect(() => validateDefinition(definition([step({ tier: 'mid' })]))).toThrow('declares its role');
    expect(() => validateDefinition(definition([step({ role: 'scout', tier: 'huge' as never })]))).toThrow('tier');
    expect(() => validateDefinition(definition([step({ kind: 'manual', inputs: [], workspaceInput: undefined, role: 'scout' })]))).toThrow('agent step');
    expect(() => validateDefinition(definition([step(), step({ id: 'review', reviewOf: 'work', role: 'artisan' })]))).toThrow('sentinel');
    const plain = definition([step()]);
    expect(validateDefinition(plain).steps[0]).not.toHaveProperty('role');
    expect(digest(plain)).toBe(digest(validateDefinition(plain)));
  });

  it('binds only a chat launched with the declared role and tier', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-flow-role-')); dirs.push(dir);
    const service = new FlowService({ file: path.join(dir, 'state.json'), contextKey: 'brain', tierMax });
    expect(() => service.propose({ definition: definition([step({ role: 'scout', tier: 'top' })]), expectedRevision: 0 })).toThrow('maximum');
    const draft = service.propose({ definition: definition([step({ role: 'scout', tier: 'mid' })]), expectedRevision: 0 });
    service.decideDefinition({ id: 'sample', expectedRevision: draft.revision, answer: 'yes' });
    let run = service.start({ flowId: 'sample', flowVersion: 1, subjectKey: 's', scope: {}, inputs: { workspace: '/w' } }, 'orch');
    const bind = (chatRunId: string, launched: object) => service.bindAgent(run.id, run.revision, 'work', { chatId: 'worker', chatRunId, taskVersion: 1, launched }, 'orch');
    expect(() => bind('a', { roleId: 'artisan', tier: 'mid' })).toThrow('runs as scout');
    expect(() => bind('b', { roleId: 'scout', tier: 'light' })).toThrow('tier mid');
    expect(() => bind('c', { roleId: 'scout', tier: 'mid', fromTable: true })).toThrow('tier mid');
    expect(() => bind('d', {})).toThrow('runs as scout');
    run = bind('e', { roleId: 'scout', tier: 'mid' });
    expect(run.steps[0]!.status).toBe('running');
    expect(JSON.stringify(run)).not.toContain('launched');
  });

  it('a tier pick only proposes a new revision from the exact shown definition, within tierMax', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-flow-tier-')); dirs.push(dir);
    const service = new FlowService({ file: path.join(dir, 'state.json'), contextKey: 'brain', tierMax });
    const first = service.propose({ definition: definition([step({ role: 'scout' }), step({ id: 'free' })]), expectedRevision: 0 });
    service.decideDefinition({ id: 'sample', expectedRevision: first.revision, answer: 'yes' });
    const edited = service.editStepTier({ flowId: 'sample', base: { version: 1 }, stepId: 'work', tier: 'mid' });
    expect(edited).toMatchObject({ revision: 2, status: 'proposed' });
    expect(edited.definition.steps[0]!.tier).toBe('mid');
    let snap = service.snapshot();
    expect(snap.active.sample).toBe(1);
    expect(snap.versions.find(v => v.version === 1)!.definition.steps[0]).not.toHaveProperty('tier');
    // a pending proposal locks the version as a base; the proposal itself can be edited, never activated
    expect(() => service.editStepTier({ flowId: 'sample', base: { version: 1 }, stepId: 'work', tier: 'light' })).toThrow('Definition changed');
    expect(() => service.editStepTier({ flowId: 'sample', base: { draftRevision: 1 }, stepId: 'work', tier: 'light' })).toThrow('Definition changed');
    expect(service.editStepTier({ flowId: 'sample', base: { draftRevision: 2 }, stepId: 'work', tier: null }).definition.steps[0]).not.toHaveProperty('tier');
    expect(() => service.editStepTier({ flowId: 'sample', base: { draftRevision: 3 }, stepId: 'work', tier: 'top' })).toThrow('maximum');
    expect(() => service.editStepTier({ flowId: 'sample', base: { draftRevision: 3 }, stepId: 'free', tier: 'mid' })).toThrow('declared role');
    expect(() => service.editStepTier({ flowId: 'sample', base: { draftRevision: 3 }, stepId: 'work', tier: 'mid', extra: 1 } as never)).toThrow();
    snap = service.snapshot();
    expect(snap.active.sample).toBe(1);
    expect(snap.drafts[0]).toMatchObject({ revision: 3, status: 'proposed' });
    expect(() => service.decideDefinition({ id: 'sample', expectedRevision: 2, answer: 'yes' })).toThrow('stale');
  });

  it('resolves each role\'s model per tier from the given table and labels the step', () => {
    const profile = (id: string, extra: Partial<AgentProfile> = {}) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), avatar: { kind: 'character', value: id }, engine: 'claude', model: null, tier: 'light', tierMax: 'mid', ...extra }) as AgentProfile;
    const roles = flowRoles([profile('orchestrator'), profile('scout'), profile('artisan', { model: 'fixed-model', tierMax: 'top' })], (engine, tier) => `${engine}-${tier}`);
    expect(Object.keys(roles)).toEqual(['scout', 'artisan']);
    expect(roles.scout!.models).toEqual({ light: 'claude-light', mid: 'claude-mid' });
    expect(stepAgentLabel(step({ role: 'scout', tier: 'mid' }), roles.scout)).toBe('Scout · mid · claude-mid');
    expect(stepAgentLabel(step({ role: 'artisan', tier: 'light' }), roles.artisan)).toBe('Artisan · light · fixed-model');
    expect(stepAgentLabel(step({ role: 'scout' }), roles.scout)).toMatch(/^Scout · /);
    expect(stepAgentLabel(step(), undefined)).not.toContain('Scout');
    expect(stepTierOptions(roles.scout)).toEqual([{ tier: 'light', label: 'light · claude-light' }, { tier: 'mid', label: 'mid · claude-mid' }]);
    expect(stepTierOptions(roles.artisan).map(o => o.label)).toEqual(['light · fixed-model', 'mid · fixed-model', 'top · fixed-model']);
    expect(stepTierOptions(undefined)).toEqual([]);
  });
});
