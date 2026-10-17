import {expect,it,vi} from 'vitest';
import {agentDraftCheckpoint,enableAgentDraftRecovery,rememberAgentEditor,validateAgentDraftCopy} from '../../src/renderer/lib/agent-drafts';
it('preserves valid 8000-character catalog instructions and keeps a captured copy current before any restart',()=>{
  const values=new Map<string,string>();vi.stubGlobal('localStorage',{setItem:(key:string,value:string)=>values.set(key,value)});
  const state={draft:{name:'Planning',purpose:'Plan work',instructions:'x'.repeat(8000),engine:'claude',model:null,avatar:{kind:'symbol' as const,value:'compass' as const}},message:'',history:[],suggestion:null};
  rememberAgentEditor(state);const copy=agentDraftCheckpoint();expect(()=>validateAgentDraftCopy(copy)).not.toThrow();
  enableAgentDraftRecovery();rememberAgentEditor({...state,draft:{...state.draft,name:'Updated work'}});
  expect(values.get('sb.update.agent-drafts.v1')).toContain('Updated work');vi.unstubAllGlobals();
});
