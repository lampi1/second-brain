// Tracks default CDP execution contexts by system-unique id; numeric context ids may be reused after navigation.
// Only CDP events populate this registry. Used by TabCdp and the local-only caller-JavaScript dispatch guard.
export interface BrowserExecutionContext {id:number;uniqueId:string;frameId:string;origin:string;sessionId:string}
export class ExecutionContexts {
  private contexts=new Map<string,BrowserExecutionContext>();
  clear(sessionId?:string):void{for(const [key,value]of this.contexts)if(sessionId===undefined||value.sessionId===sessionId)this.contexts.delete(key);}
  accept(method:string,params:Record<string,unknown>,sessionId:string):void{
    if(method==='Runtime.executionContextsCleared'){this.clear(sessionId);return;}
    if(method==='Runtime.executionContextDestroyed'){
      for(const [key,value]of this.contexts)if(value.sessionId===sessionId&&(typeof params.executionContextUniqueId==='string'?value.uniqueId===params.executionContextUniqueId:value.id===params.executionContextId))this.contexts.delete(key);
      return;
    }
    if(method!=='Runtime.executionContextCreated')return;
    const context=params.context as Record<string,unknown>|undefined;
    const aux=context?.auxData as Record<string,unknown>|undefined;
    if(!context||!aux||aux.isDefault!==true||typeof aux.frameId!=='string'||aux.frameId.length>256||typeof context.uniqueId!=='string'||!context.uniqueId||context.uniqueId.length>256||typeof context.origin!=='string'||context.origin.length>2048||typeof context.id!=='number'||!Number.isFinite(context.id))return;
    for(const [key,value]of this.contexts)if(value.sessionId===sessionId&&value.frameId===aux.frameId)this.contexts.delete(key);
    this.contexts.set(context.uniqueId,{id:context.id,uniqueId:context.uniqueId,origin:context.origin,frameId:aux.frameId,sessionId});
    while(this.contexts.size>512)this.contexts.delete(this.contexts.keys().next().value!);
  }
  defaultFor(frameId:string,sessionId=''):BrowserExecutionContext|null{
    const context=[...this.contexts.values()].find(value=>value.frameId===frameId&&value.sessionId===sessionId);
    return context?{...context}:null;
  }
  current(context:BrowserExecutionContext):boolean{
    const actual=this.contexts.get(context.uniqueId);
    return !!actual&&actual.id===context.id&&actual.frameId===context.frameId&&actual.sessionId===context.sessionId&&actual.origin===context.origin;
  }
}
