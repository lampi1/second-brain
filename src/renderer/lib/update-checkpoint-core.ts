// Renderer-only transaction protocol. Release identity, filesystem backup and activation remain main-owned.
import {UPDATE_CHECKPOINT_MAX_BYTES,UPDATE_SNAPSHOT_KEYS,type UpdateCheckpointAnswer,type UpdateCheckpointRequest,type UpdateSnapshot} from '@shared/app-update';
import {t} from '../i18n';
export function validateUpdateSnapshot(value:unknown,maxBytes=UPDATE_CHECKPOINT_MAX_BYTES):UpdateSnapshot{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(t('appText.checkpoint.invalid'));
  const record=value as Record<string,unknown>,keys=Object.keys(record);
  if(keys.length!==UPDATE_SNAPSHOT_KEYS.length||keys.some(key=>!UPDATE_SNAPSHOT_KEYS.includes(key as typeof UPDATE_SNAPSHOT_KEYS[number])))throw Error(t('appText.checkpoint.extraFields'));
  for(const key of UPDATE_SNAPSHOT_KEYS){if(typeof record[key]!=='string')throw Error(t('appText.checkpoint.incomplete'));try{JSON.parse(record[key] as string);}catch{throw Error(t('appText.checkpoint.unreadable'));}}
  if(new TextEncoder().encode(JSON.stringify(record)).byteLength>Math.min(maxBytes,UPDATE_CHECKPOINT_MAX_BYTES))throw Error(t('appText.checkpoint.tooBig'));
  return record as UpdateSnapshot;
}
interface CheckpointHooks{
  freeze(requestId:string):void;
  release(requestId:string):void;
  flush():Promise<void>;
  problem():string|null;
  snapshot():UpdateSnapshot;
  answer(value:UpdateCheckpointAnswer):Promise<void>;
}
export function createCheckpointCoordinator(hooks:CheckpointHooks){
  let current:string|null=null,generation=0;
  const seen=new Set<string>();
  return {
    async request(request:UpdateCheckpointRequest):Promise<void>{
      if(seen.has(request.requestId))return; // Duplicate deliveries never capture a later, different draft.
      seen.add(request.requestId);
      if(current){await hooks.answer({requestId:request.requestId,problem:t('appText.checkpoint.busy')});return;}
      current=request.requestId;const at=++generation;hooks.freeze(current);
      const live=()=>current===request.requestId&&generation===at;
      try{
        const before=hooks.problem();if(before)throw Error(before);
        await hooks.flush();if(!live())return;
        const problem=hooks.problem();if(problem)throw Error(problem);
        if(!Number.isFinite(request.maxBytes)||request.maxBytes<1)throw Error(t('appText.checkpoint.badLimit'));
        const snapshot=validateUpdateSnapshot(hooks.snapshot(),request.maxBytes);
        if(live())await hooks.answer({requestId:request.requestId,snapshot});
      }catch(error){
        if(live())await hooks.answer({requestId:request.requestId,problem:error instanceof Error?error.message:t('appText.checkpoint.notCompleted')});
      }
      // Main must explicitly release after failure/timeout; an ACK is not permission to resume edits.
    },
    release(requestId:string){if(current!==requestId)return;current=null;generation++;hooks.release(requestId);},
  };
}

/** Write all namespaces before adoption/ACK. Refuse conflicting newer local state; retain main backup on any error. */
export function adoptUpdateRecovery(snapshot:UpdateSnapshot,storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,validate:(value:UpdateSnapshot)=>void,adopt:(value:UpdateSnapshot)=>void):void{
  validateUpdateSnapshot(snapshot);validate(snapshot);
  const before=new Map<string,string|null>();
  for(const key of UPDATE_SNAPSHOT_KEYS){const current=storage.getItem(key);before.set(key,current);if(current!==null&&current!==snapshot[key])throw Error(t('appText.checkpoint.newerLocal'));}
  const written:string[]=[];
  try{
    for(const key of UPDATE_SNAPSHOT_KEYS){written.push(key);storage.setItem(key,snapshot[key]);}
    for(const key of UPDATE_SNAPSHOT_KEYS)if(storage.getItem(key)!==snapshot[key])throw Error(t('appText.checkpoint.notConfirmed'));
    adopt(snapshot);
  }catch(error){
    for(const key of written.reverse()){try{const old=before.get(key);if(old==null)storage.removeItem(key);else storage.setItem(key,old);}catch{/* Main retains the complete backup; no ACK is sent. */}}
    throw error;
  }
}
