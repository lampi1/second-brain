// Consume main update state without letting stale reads or rejected actions restore an actionable package.
import type {AppUpdateState,PreparedAppUpdate} from '@shared/app-update';
import {t} from '../i18n';
const phases=['preparing','ready','applying','applied','failed','restored'];
export function validUpdateState(value:unknown):value is AppUpdateState{
  const state=value as AppUpdateState;if(!state||typeof state.available!=='boolean'||typeof state.checking!=='boolean'||state.reason!==undefined&&typeof state.reason!=='string'||state.checkedAt!==null&&!Number.isFinite(state.checkedAt))return false;
  const update=state.update;if(update===null)return true;
  return !!update&&typeof update.id==='string'&&typeof update.version==='string'&&Array.isArray(update.changes)&&update.changes.every(line=>typeof line==='string')&&phases.includes(update.phase)&&(update.blocked===null||typeof update.blocked==='string');
}
export function blockedUpdate(state:AppUpdateState,problem:string|null):PreparedAppUpdate|null{
  return state.update?{...state.update,blocked:problem||(!state.available?state.reason||t('appText.updateView.unavailable'):state.update.blocked)}:null;
}
export function connectUpdateView(api:{get():Promise<AppUpdateState>;listen(accept:(state:AppUpdateState)=>void):()=>void},render:(state:AppUpdateState)=>void,failed:()=>void){
  let revision=0,active=true;
  const accept=(value:AppUpdateState)=>{if(!active)return;if(!validUpdateState(value)){failed();return;}render(value);};
  const stop=api.listen(state=>{revision++;accept(state);});
  const refresh=async()=>{const at=++revision;try{const state=await api.get();if(at===revision)accept(state);}catch{if(active&&at===revision)failed();}};
  void refresh();
  return {refresh,perform:async(action:()=>Promise<AppUpdateState>)=>{const at=revision;try{const state=await action();if(at===revision){revision++;accept(state);}}catch(error){if(active){revision++;failed();}throw error;}},dispose:()=>{active=false;stop();}};
}
