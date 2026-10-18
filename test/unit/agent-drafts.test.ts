// Session-local drafts remain recoverable per agent and are isolated from callers' mutations.
import { expect,it } from 'vitest';
import type { AgentDraft } from '@shared/agents';
import { readAgentEditor,rememberAgentEditor } from '../../src/renderer/lib/agent-drafts';
const draft:AgentDraft={name:'Assistant',purpose:'Daily work',instructions:'Write clearly',engine:'claude',model:null,avatar:{kind:'symbol',value:'briefcase'}};
it('retains separate unsaved edits and guide messages when switching profiles',()=>{
  rememberAgentEditor({id:'one',draft,message:'first request',history:[],suggestion:null});
  rememberAgentEditor({id:'two',draft:{...draft,name:'Second'},message:'second request',history:[],suggestion:null});
  expect(readAgentEditor('one')?.message).toBe('first request');
  expect(readAgentEditor('two')?.message).toBe('second request');
  const copy=readAgentEditor('one')!;copy.draft.name='Changed';
  expect(readAgentEditor('one')?.draft.name).toBe('Assistant');
});
it('retains the edited catalog revision across navigation without adopting a newer revision', () => {
  rememberAgentEditor({ id: 'revision', baseRevision: 123, draft, message: '', history: [], suggestion: null });
  const restored = readAgentEditor('revision')!;
  expect(restored.baseRevision).toBe(123);
  restored.baseRevision = 456;
  expect(readAgentEditor('revision')?.baseRevision).toBe(123);
});
