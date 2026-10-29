// src/renderer/lib/follow-bottom.ts: a stream list follows its bottom while content grows and stops when the user reads.
import {expect,it} from 'vitest';
import {createFollowBottom,rememberFollowState,savedFollowState,type FollowState} from '../../src/renderer/lib/follow-bottom';
function fixture(previous?:FollowState){
  const metrics={top:0,height:1000,viewport:200};let job:(()=>void)|null=null,state!:FollowState,writes=0;
  const control=createFollowBottom({read:()=>({...metrics}),write:top=>{metrics.top=top;writes++;},frame:run=>{job=run;return 1;},cancel:()=>{job=null;},changed:next=>{state=next;}},'initial',previous);
  return {metrics,control,flush:()=>{const run=job;job=null;run?.();},state:()=>state,writes:()=>writes};
}
it('starts at latest and follows streaming plus asynchronous content growth',()=>{
  const f=fixture();f.flush();expect(f.metrics.top).toBe(800);
  f.metrics.height=1300;f.control.contentChanged('streamed');f.flush();expect(f.metrics.top).toBe(1100);
  f.metrics.height=1800;f.control.resized();f.flush();expect(f.metrics.top).toBe(1600);
});
it('does not interpret resize clamping or its own delayed scroll event as user detachment',()=>{
  const f=fixture();f.flush();f.metrics.viewport=400;f.metrics.top=600;f.control.scrolled(false);f.control.resized();f.flush();expect(f.state().following).toBe(true);
  f.metrics.height=1600;f.control.scrolled(false);f.control.contentChanged('next');f.flush();expect(f.metrics.top).toBe(1200);
});
it('never pulls a reader down on growth/resize and offers an explicit jump with real unseen content',()=>{
  const f=fixture();f.flush();f.control.leave();f.metrics.top=250;f.control.scrolled(true);
  f.metrics.height=1800;f.control.contentChanged('new-message');f.control.resized();f.flush();expect(f.metrics.top).toBe(250);expect(f.state()).toMatchObject({following:false,unseen:true});
  f.control.jump();f.flush();expect(f.metrics.top).toBe(1600);expect(f.state()).toMatchObject({following:true,unseen:false});
});
it('keeps chat identities separate and restores reading across remount/late initial loading',()=>{
  const previous={following:false,top:500,unseen:false,signature:'initial'};rememberFollowState('reader',previous);
  expect(savedFollowState('other')).toBeUndefined();const f=fixture(savedFollowState('reader'));
  f.metrics.height=0;f.flush();expect(f.metrics.top).toBe(0);f.metrics.height=1300;f.control.resized();f.flush();expect(f.metrics.top).toBe(500);expect(f.state().following).toBe(false);
  const copy=savedFollowState('reader')!;copy.top=99;expect(savedFollowState('reader')!.top).toBe(500);
});
it('does not write hidden panels or execute a queued follow after disposal',()=>{
  const f=fixture();f.metrics.viewport=0;f.flush();expect(f.writes()).toBe(0);f.metrics.viewport=200;f.control.resized();f.control.dispose();f.flush();expect(f.writes()).toBe(0);
});
it('reattaches when the user returns to the exact last automatic bottom position',()=>{
  const f=fixture();f.flush();f.control.leave();f.metrics.top=250;f.control.scrolled(true);
  f.metrics.top=800;f.control.scrolled(true);expect(f.state().following).toBe(true);
  f.metrics.height=1500;f.control.contentChanged('after-return');f.flush();expect(f.metrics.top).toBe(1300);
});
it('captures the actual reading position even before its delayed scroll event and preserves it when hidden',()=>{
  const f=fixture();f.flush();f.control.leave();f.metrics.top=350;expect(f.control.snapshot().top).toBe(350);
  f.control.scrolled(true);f.metrics.viewport=0;f.metrics.top=0;f.control.scrolled(false);expect(f.control.snapshot().top).toBe(350);
});
it('does not detach on an upward gesture when the transcript does not overflow',()=>{
  const f=fixture();f.metrics.height=100;f.flush();f.control.leave();expect(f.state().following).toBe(true);
  f.metrics.height=900;f.control.resized();f.flush();expect(f.metrics.top).toBe(700);
});
