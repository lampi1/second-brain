// Per-transcript follow state: geometry changes are not evidence that the user chose to read above.
export interface ScrollMetrics{top:number;height:number;viewport:number}
export interface FollowState{following:boolean;top:number;unseen:boolean;signature:string}
interface Port{read():ScrollMetrics;write(top:number):void;frame(run:()=>void):number;cancel(frame:number):void;changed(state:FollowState):void}
const memory=new Map<string,FollowState>();
export function savedFollowState(id:string|null):FollowState|undefined{const state=id?memory.get(id):undefined;return state?{...state}:undefined;}
export function rememberFollowState(id:string|null,state:FollowState):void{if(!id)return;memory.delete(id);memory.set(id,{...state});while(memory.size>200)memory.delete(memory.keys().next().value!);}
export function createFollowBottom(port:Port,signature:string,previous?:FollowState){
  const state:FollowState=previous?{...previous,unseen:previous.unseen||!previous.following&&previous.signature!==signature,signature}:{following:true,top:0,unseen:false,signature};
  let frame=0,disposed=false,lastWrite:number|null=null,restore=previous&&!previous.following?previous.top:null;
  const notify=()=>port.changed({...state});
  const write=(top:number)=>{port.write(top);lastWrite=port.read().top;state.top=lastWrite;};
  const measure=()=>{
    frame=0;if(disposed)return;
    const size=port.read();if(size.viewport<=0)return; // Hidden/docked panels wait for a visible resize.
    const max=Math.max(0,size.height-size.viewport);
    if(state.following)write(max);
    else if(restore!==null){write(Math.min(restore,max));if(max>=restore)restore=null;}
    else state.top=size.top;
    notify();
  };
  const schedule=()=>{if(!disposed&&!frame)frame=port.frame(measure);};
  notify();schedule();
  return {
    resized:schedule,
    contentChanged(next:string){if(state.signature!==next){state.signature=next;if(!state.following)state.unseen=true;}schedule();},
    leave(){const size=port.read();if(state.following&&size.height<=size.viewport+1)return;restore=null;state.following=false;state.top=size.top;notify();},
    scrolled(userInitiated:boolean){
      if(disposed)return;
      const size=port.read();if(size.viewport<=0)return;state.top=size.top;
      if(userInitiated&&size.height-size.top-size.viewport<24){restore=null;state.following=true;state.unseen=false;notify();return;}
      if(lastWrite!==null&&Math.abs(size.top-lastWrite)<1)return; // Delayed event of our own write, even after growth.
      if(userInitiated){restore=null;state.following=size.height-size.top-size.viewport<24;if(state.following)state.unseen=false;notify();}
      else if(state.following)schedule();
    },
    jump(){restore=null;state.following=true;state.unseen=false;notify();schedule();},
    snapshot:()=>{const size=port.read();return {...state,top:restore??(size.viewport>0?size.top:state.top)};},
    dispose(){disposed=true;if(frame)port.cancel(frame);frame=0;},
  };
}
