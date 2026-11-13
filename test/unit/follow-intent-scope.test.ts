// src/renderer/lib/observe-follow-bottom.ts: only the list's own pointer gestures count as reading intent.
import {expect,it,vi} from 'vitest';
import {observeFollowBottom} from '../../src/renderer/lib/observe-follow-bottom';
it('does not treat a mosaic resize pointerup elsewhere as reading intent and observes intrinsic content',()=>{
  const events=new EventTarget(),target=new EventTarget();let top=0,height=1000,viewport=200;
  const el=Object.assign(target,{get scrollTop(){return top;},set scrollTop(value:number){top=value;}});
  Object.defineProperties(el,{scrollTop:{get:()=>top,set:(value:number)=>{top=value;}},scrollHeight:{get:()=>height},clientHeight:{get:()=>viewport}});
  const body={} as HTMLDivElement,jobs=new Map<number,()=>void>();let next=0,resize!:()=>void;const observe=vi.fn(),disconnect=vi.fn();
  Object.assign(events,{requestAnimationFrame:function(this:unknown,run:()=>void){if(this!==events)throw TypeError('Illegal invocation');jobs.set(++next,run);return next;},cancelAnimationFrame:function(this:unknown,id:number){if(this!==events)throw TypeError('Illegal invocation');jobs.delete(id);}});vi.stubGlobal('window',events);
  vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){resize=callback;}observe=observe;disconnect=disconnect;});
  vi.stubGlobal('MutationObserver',class{observe=vi.fn();disconnect=disconnect;});
  const flush=()=>{const work=[...jobs.values()];jobs.clear();work.forEach(run=>run());};
  const observed=observeFollowBottom(el as unknown as HTMLDivElement,body,'intent-scope','initial',()=>{});
  try{
    expect(observe).toHaveBeenCalledWith(body);expect(observe).toHaveBeenCalledWith(el);flush();expect(top).toBe(800);
    viewport=400;top=600;height=1300;events.dispatchEvent(new Event('pointerup'));el.dispatchEvent(new Event('scroll'));resize();flush();
    expect(top).toBe(900);expect(observed.follower.snapshot().following).toBe(true);
    height=1600;resize();flush();expect(top).toBe(1200);
  }finally{observed.dispose();vi.unstubAllGlobals();}
});
