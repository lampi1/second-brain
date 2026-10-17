// Native browser safety during workspace gestures: nested holds compose with modal visibility and never change tabs.
import { afterEach, expect, it, vi } from 'vitest';
import { measure, registerView, setBlocked, setKnownTabs, suspendViews } from '../../src/renderer/lib/viewports';

afterEach(() => { setKnownTabs([]); setBlocked(false); vi.unstubAllGlobals(); });
it('keeps every native view parked through drag/resize holds and a modal until all blockers release', () => {
  const invoke = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800, sb: { invoke } });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('getComputedStyle',()=>({display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible'}));
  const view = { isConnected: true, offsetParent: {}, dataset: {}, getBoundingClientRect: () => ({ left: 20, top: 30, right: 420, bottom: 330 }) } as unknown as HTMLElement;
  const unregister = registerView('browser-one', view);
  try {
    expect(measure()[0]?.rect).toEqual({ x: 20, y: 30, width: 400, height: 300 });
    const releaseDrag = suspendViews(), releaseResize = suspendViews();
    expect(measure()[0]?.rect).toBe(null);
    releaseDrag(); releaseDrag(); expect(measure()[0]?.rect).toBe(null);
    setBlocked(true); releaseResize(); expect(measure()[0]?.rect).toBe(null);
    setBlocked(false); expect(measure()[0]?.rect).not.toBe(null);
    expect(invoke.mock.calls.every(call => call[0] === 'views:layout')).toBe(true);
  } finally { unregister(); }
});
it('clips native bounds to a scrolling ancestor and hides CSS-invisible content',()=>{
  const invoke=vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('window',{innerWidth:1000,innerHeight:800,sb:{invoke}});vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));
  let visible=true;
  const parent={parentElement:null,clientLeft:0,clientTop:0,clientWidth:200,clientHeight:100,getBoundingClientRect:()=>({left:50,top:60,right:250,bottom:160})};
  const view={parentElement:parent,isConnected:true,offsetParent:{},dataset:{},getBoundingClientRect:()=>({left:20,top:30,right:420,bottom:330})} as unknown as HTMLElement;
  vi.stubGlobal('getComputedStyle',(el:unknown)=>({display:'block',visibility:visible?'visible':'hidden',opacity:'1',overflowX:el===parent?'auto':'visible',overflowY:el===parent?'auto':'visible'}));
  const unregister=registerView('clipped',view);
  try{expect(measure().find(row=>row.tabId==='clipped')?.rect).toEqual({x:50,y:60,width:200,height:100});visible=false;expect(measure().find(row=>row.tabId==='clipped')?.rect).toBeNull();}finally{unregister();}
});
