// Main owns milestones. This bridge suppresses initial/replayed feedback and stale async reads.
import type {AchievementId,ProgressState} from '@shared/progress';
import {t} from '../i18n';
// getters: read at use time, in the language main.tsx set (this table is built at import)
export const MILESTONE_LABELS:Record<AchievementId,string>={
  get 'first-agent'(){return t('appText.progress.firstAgent');},get 'setup-complete'(){return t('appText.progress.setupComplete');},get 'first-result'(){return t('appText.progress.firstResult');},
};
interface Bridge {
  get():Promise<ProgressState>;
  listen(accept:(state:ProgressState)=>void):()=>void;
}
export function connectProgress(api:Bridge,render:(state:ProgressState,earned:AchievementId[])=>void,failed:()=>void){
  let revision=0,active=true,initialized=false;
  const seen=new Set<AchievementId>();
  const accept=(value:ProgressState)=>{
    if(!active)return;
    const state={...value,available:value.available===true}; // Older backends are read-only.
    const fresh:AchievementId[]=[];
    for(const entry of state.earned){if(initialized&&state.available&&!seen.has(entry.id))fresh.push(entry.id);seen.add(entry.id);}
    initialized=true;render(state,fresh);
  };
  const stop=api.listen(state=>{revision++;accept(state);});
  const read=revision;
  void api.get().then(state=>{if(read===revision)accept(state);},()=>{if(active&&read===revision)failed();});
  return {
    apply:(state:ProgressState)=>{revision++;accept(state);},
    perform:async(action:()=>Promise<ProgressState>)=>{const at=revision;const state=await action();if(at===revision){revision++;accept(state);}},
    dispose:()=>{active=false;stop();},
  };
}
