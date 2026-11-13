// Count in-flight renderer actions without proxying or mutating Electron's frozen contextBridge object.
import type {Bridge} from '@shared/contract';
export function trackBridge(raw:Bridge,change:(delta:number)=>void):Bridge{
  return {
    invoke(channel,arg){
      change(1);
      try{return raw.invoke(channel,arg).finally(()=>change(-1));}
      catch(error){change(-1);throw error;}
    },
    on(channel,listener){return raw.on(channel,listener);},
  };
}
