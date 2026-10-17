// Unsaved editor state survives navigation/profile switches in a bounded memory cache.
// An explicitly applied update may adopt a private local restart copy, then keeps it current to avoid stale replay.
import {validateRecoveryRaster} from './recovery-raster';
import {checkedManifest} from '@shared/agent-manifest';
import {AGENT_SYMBOLS,type AgentDraft} from '@shared/agents';
export interface AgentEditorDraft { id?:string; draft:AgentDraft; message:string; history:{role:'user'|'assistant';text:string}[]; suggestion:AgentDraft|null }
const drafts=new Map<string,AgentEditorDraft>();
let active:string|null=null;
const key=(id?:string)=>id ?? '__new';
export function rememberAgentEditor(state:AgentEditorDraft):void {
  const id=key(state.id); drafts.delete(id); drafts.set(id,structuredClone(state)); active=id;
  while(drafts.size>20) drafts.delete(drafts.keys().next().value!);
  persistAgentRecovery();
}
export function readAgentEditor(id?:string, last=false):AgentEditorDraft|null {
  const value=drafts.get(last ? active ?? '__new' : key(id)); return value ? structuredClone(value) : null;
}
export function forgetAgentEditor(id?:string):void { drafts.delete(key(id)); if(active===key(id)) active=null; persistAgentRecovery(); }

const AGENT_RECOVERY_KEY='sb.update.agent-drafts.v1';
let recoveredAgents=false,agentStorageProblem=false;
export function agentDraftCheckpointProblem():string|null{return agentStorageProblem?'La copia locale delle bozze Agenti non è stata salvata. Libera spazio prima di aggiornare.':null;}
export function agentDraftCheckpoint(){return {version:1,active,entries:[...drafts.entries()]};}
function validDraft(value:unknown):value is AgentDraft{
  try { checkedManifest((value as AgentDraft | null)?.manifest); } catch { return false; }
  const draft=value as AgentDraft;if(!draft||typeof draft.name!=='string'||draft.name.length>80||typeof draft.purpose!=='string'||draft.purpose.length>400||typeof draft.instructions!=='string'||draft.instructions.length>8000||typeof draft.engine!=='string'||draft.engine.length>160||draft.model!==null&&(typeof draft.model!=='string'||draft.model.length>300)||draft.effort!==undefined&&!['low','medium','high','xhigh','max'].includes(draft.effort))return false;
  const avatar=draft.avatar;return !!avatar&&(avatar.kind==='symbol'?AGENT_SYMBOLS.includes(avatar.value):avatar.kind==='image'&&typeof avatar.dataUrl==='string'&&avatar.dataUrl.length<=350000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(avatar.dataUrl));
}
export function validateAgentDraftCopy(value:unknown):ReturnType<typeof agentDraftCheckpoint>{
  const copy=value as ReturnType<typeof agentDraftCheckpoint>;
  if(!copy||copy.version!==1||!Array.isArray(copy.entries)||copy.entries.length>20||copy.active!==null&&typeof copy.active!=='string')throw Error('Copia delle bozze Agenti non valida.');
  const keys=new Set<string>();
  for(const entry of copy.entries){
    if(!Array.isArray(entry)||entry.length!==2)throw Error('Copia delle bozze Agenti non valida.');
    const [id,state]=entry;
    if(typeof id!=='string'||id.length>160||keys.has(id)||!state||state.id!==undefined&&typeof state.id!=='string'||key(state.id)!==id||!validDraft(state.draft)||typeof state.message!=='string'||state.message.length>6000||!Array.isArray(state.history)||state.history.length>1000||state.history.some(line=>!line||!['user','assistant'].includes(line.role)||typeof line.text!=='string'||line.text.length>20000)||state.suggestion!==null&&!validDraft(state.suggestion))throw Error('Copia delle bozze Agenti non valida.');keys.add(id);
  }
  for(const [,state]of copy.entries)for(const draft of [state.draft,state.suggestion])if(draft?.avatar.kind==='image')validateRecoveryRaster(draft.avatar.dataUrl,1024,16,256000);
  if(copy.active!==null&&!keys.has(copy.active))throw Error('Bozza Agente attiva non presente.');return copy;
}
export function restoreAgentDraftCopy(value:unknown):void{
  const copy=validateAgentDraftCopy(value);drafts.clear();for(const [id,state]of copy.entries)drafts.set(id,structuredClone(state));active=copy.active;recoveredAgents=true;persistAgentRecovery();
}
function persistAgentRecovery():void{if(!recoveredAgents)return;try{localStorage.setItem(AGENT_RECOVERY_KEY,JSON.stringify(agentDraftCheckpoint()));agentStorageProblem=false;}catch{agentStorageProblem=true;}}

export function enableAgentDraftRecovery():void{recoveredAgents=true;persistAgentRecovery();}
