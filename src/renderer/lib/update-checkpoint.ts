// Single-updater renderer adapter. Only private allowlisted UI state crosses this boundary.
import {type UpdateSnapshot} from '@shared/app-update';
import {sb} from '../sb';
import {enableChatDraftRecovery,chatDraftCheckpoint,chatDraftCheckpointProblem,restoreChatDraftCopy,validateChatDraftCopy} from '../components/ChatInput';
import {enableAgentDraftRecovery,agentDraftCheckpoint,agentDraftCheckpointProblem,restoreAgentDraftCopy,validateAgentDraftCopy} from './agent-drafts';
import {checkpointUi,restoreCheckpointUi,toast,ui} from '../store/ui';
import {checkpointWorkspace,readPurposes,restoreCheckpointWorkspace} from '../store/workspace';
import {updateStoreProblem} from '../store/store';
import {createCheckpointCoordinator,adoptUpdateRecovery,validateUpdateSnapshot} from './update-checkpoint-core';
import {freezeForUpdate,releaseUpdate,updateHoldProblem,updateIsFrozen,updateRecovery} from './update-barrier';
import {suspendViews} from './viewports';
let started=false,composing=false;
let releaseViews:(()=>void)|null=null;
function problem():string|null{
  if(composing)return 'Termina la composizione del testo prima di aggiornare.';
  if(ui.get().modal||ui.get().confirm||[...document.querySelectorAll('[role="dialog"]')].some(element=>element.getAttribute('data-testid')!=='update-checkpoint-status'))return 'Completa o chiudi la finestra aperta prima di aggiornare.';
  return updateHoldProblem()??updateStoreProblem()??chatDraftCheckpointProblem()??agentDraftCheckpointProblem();
}
function snapshot():UpdateSnapshot{
  const prefs=checkpointUi();
  const value:UpdateSnapshot={'sb.prefs.v1':prefs['sb.prefs.v1']!,'sb.read.v1':prefs['sb.read.v1']!,'sb.agents.workspace.v1':checkpointWorkspace(),'sb.update.chat-drafts.v1':JSON.stringify(chatDraftCheckpoint()),'sb.update.agent-drafts.v1':JSON.stringify(agentDraftCheckpoint())};
  validateUpdateSnapshot(value);validateRam(value);enableChatDraftRecovery();enableAgentDraftRecovery();const failed=chatDraftCheckpointProblem()??agentDraftCheckpointProblem();if(failed)throw Error(failed);return value;
}
function validateRam(value:UpdateSnapshot):void{
  const chat=JSON.parse(value['sb.update.chat-drafts.v1']),agent=JSON.parse(value['sb.update.agent-drafts.v1']);
  if(chat!==null)validateChatDraftCopy(chat);if(agent!==null)validateAgentDraftCopy(agent);
  const layout=JSON.parse(value['sb.agents.workspace.v1']);
  if(layout!==null&&!readPurposes(layout))throw Error('Disposizione della copia non valida.');
}
function adopt(value:UpdateSnapshot):void{
  const chat=JSON.parse(value['sb.update.chat-drafts.v1']),agent=JSON.parse(value['sb.update.agent-drafts.v1']);
  if(chat!==null)restoreChatDraftCopy(chat);if(agent!==null)restoreAgentDraftCopy(agent);
  restoreCheckpointUi();restoreCheckpointWorkspace();
  const failed=chatDraftCheckpointProblem()??agentDraftCheckpointProblem();if(failed)throw Error(failed);
}
export async function startUpdateCheckpoint():Promise<void>{
  if(started)return;started=true;
  window.addEventListener('compositionstart',()=>{composing=true;},true);window.addEventListener('compositionend',()=>{composing=false;},true);
  const capture=(event:Event)=>{if(updateIsFrozen()){event.preventDefault();event.stopImmediatePropagation();}};
  for(const event of ['pointerdown','click','keydown','beforeinput','paste','drop'])window.addEventListener(event,capture,{capture:true,passive:false});
  const coordinator=createCheckpointCoordinator({
    freeze:id=>{freezeForUpdate(id);releaseViews=suspendViews();},
    release:id=>{releaseViews?.();releaseViews=null;releaseUpdate(id);},
    flush:()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))),
    problem,snapshot,answer:answer=>sb.invoke('update:checkpointAnswer',answer),
  });
  sb.on('update:checkpointRequest',request=>{void coordinator.request(request).catch(()=>toast('Il salvataggio per l’aggiornamento non è stato confermato. L’app resta aperta.','err'));});
  sb.on('update:checkpointRelease',request=>coordinator.release(request.requestId));
  // Load previous adopted copies before React/input/store startup; their writes stay current after recovery.
  let retained:UpdateSnapshot|null=null;
  try{
    for(const [key,validate,restore]of [['sb.update.chat-drafts.v1',validateChatDraftCopy,restoreChatDraftCopy],['sb.update.agent-drafts.v1',validateAgentDraftCopy,restoreAgentDraftCopy]] as const){
      const raw=localStorage.getItem(key);if(raw===null||raw==='null')continue;const value=JSON.parse(raw);validate(value);restore(value);
    }
    let timer:ReturnType<typeof setTimeout>|undefined;
    const recovery=await Promise.race([sb.invoke('update:recovery',undefined),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Recovery timeout')),5000);})]).finally(()=>{if(timer)clearTimeout(timer);});
    if(recovery){retained=validateUpdateSnapshot(recovery.snapshot);adoptUpdateRecovery(retained,localStorage,validateRam,adopt);await sb.invoke('update:recoveryAck',{id:recovery.id});}
  }catch(error){
    const reason=error instanceof Error?error.message.slice(0,300):'La copia non è leggibile in questa versione.';
    updateRecovery.set({problem:reason,copy:retained});
    toast('Ripristino sospeso. Apri Impostazioni → Aggiornamenti per rivedere il motivo e le bozze conservate.','err');
  }
}
