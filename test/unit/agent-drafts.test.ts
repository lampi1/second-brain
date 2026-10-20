// Unsaved role edits stay recoverable per role and isolated from callers' mutations; a copy for an app update is
// checked field by field (only a role's behaviour, its character fixed) before it is trusted.
import { expect, it, vi } from 'vitest';
import type { AgentDraft } from '@shared/agents';
import { agentDraftCheckpoint, enableAgentDraftRecovery, readAgentEditor, rememberAgentEditor, validateAgentDraftCopy } from '../../src/renderer/lib/agent-drafts';

const draft: AgentDraft = { name: 'Scout', purpose: 'Cerca fatti', instructions: 'Cite sources', engine: 'claude', model: null, avatar: { kind: 'character', value: 'scout' },
  tools: { allow: ['read', 'web'] }, permissionCeiling: 'default', tier: 'mid', tierMax: 'top', launches: [], skills: ['brain-edit'] };

it('retains separate unsaved edits per role', () => {
  rememberAgentEditor({ id: 'scout', draft });
  rememberAgentEditor({ id: 'judge', draft: { ...draft, name: 'Judge', avatar: { kind: 'character', value: 'judge' } } });
  expect(readAgentEditor('scout')?.draft.name).toBe('Scout');
  expect(readAgentEditor('judge')?.draft.name).toBe('Judge');
  const copy = readAgentEditor('scout')!; copy.draft.instructions = 'Changed';
  expect(readAgentEditor('scout')?.draft.instructions).toBe('Cite sources');
});
it('retains the edited catalog revision across navigation without adopting a newer revision', () => {
  rememberAgentEditor({ id: 'artisan', baseRevision: 123, draft });
  const restored = readAgentEditor('artisan')!;
  expect(restored.baseRevision).toBe(123);
  restored.baseRevision = 456;
  expect(readAgentEditor('artisan')?.baseRevision).toBe(123);
});
it('keeps an 8000-character role text and the captured copy current before a restart', () => {
  const values = new Map<string, string>(); vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => values.set(key, value) });
  rememberAgentEditor({ id: 'scribe', draft: { ...draft, instructions: 'x'.repeat(8000) } });
  expect(() => validateAgentDraftCopy(agentDraftCheckpoint())).not.toThrow();
  enableAgentDraftRecovery(); rememberAgentEditor({ id: 'scribe', draft: { ...draft, instructions: 'Updated work' } });
  expect(values.get('sb.update.agent-drafts.v1')).toContain('Updated work');
  vi.unstubAllGlobals();
});
it('refuses a copy whose draft is out of shape', () => {
  const copy = (d: unknown) => ({ version: 1, active: 'scout', entries: [['scout', { id: 'scout', draft: d }]] });
  expect(() => validateAgentDraftCopy(copy(draft))).not.toThrow();
  for (const bad of [{ avatar: { kind: 'image', dataUrl: 'data:image/png;base64,AA==' } }, { avatar: { kind: 'character', value: 'pirate' } }, { tier: 'huge' },
    { launches: ['orchestrator'] }, { tools: { allow: ['root'] } }, { permissionCeiling: 'bypassPermissions' }, { skills: ['../x'] }, { instructions: 'x'.repeat(8001) }])
    expect(() => validateAgentDraftCopy(copy({ ...draft, ...bad }))).toThrow();
  expect(() => validateAgentDraftCopy({ version: 1, active: 'other', entries: [['scout', { id: 'scout', draft }]] })).toThrow();
  expect(() => validateAgentDraftCopy({ version: 1, active: null, entries: [['scout', { id: 'judge', draft }]] })).toThrow();
});
