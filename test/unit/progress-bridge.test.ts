import {expect,it,vi} from 'vitest';
import type {ProgressState} from '../../src/shared/progress';
import {connectProgress} from '../../src/renderer/lib/progress-bridge';
const state=(earned:ProgressState['earned']=[],available=true):ProgressState=>({version:1,available,hidden:false,earned});
it('ignores a stale initial read after an authoritative event and does not celebrate initial/replayed awards',async()=>{
  let resolve!:(state:ProgressState)=>void,accept!:(state:ProgressState)=>void;
  const render=vi.fn(),failed=vi.fn(),stop=vi.fn();
  const connection=connectProgress({get:()=>new Promise(done=>{resolve=done;}),listen:next=>{accept=next;return stop;}},render,failed);
  const setup=state([{id:'setup-complete',at:1}]);accept(setup);resolve(state());await Promise.resolve();
  expect(render).toHaveBeenCalledTimes(1);expect(render).toHaveBeenLastCalledWith(setup,[]);
  accept(setup);expect(render).toHaveBeenLastCalledWith(setup,[]);
  const custom=state([...setup.earned,{id:'first-agent',at:2}]);accept(custom);expect(render).toHaveBeenLastCalledWith(custom,['first-agent']);
  connection.apply(custom);expect(render).toHaveBeenLastCalledWith(custom,[]);connection.dispose();accept(state());expect(stop).toHaveBeenCalledOnce();expect(failed).not.toHaveBeenCalled();
});
it('keeps old or disabled capability read-only without announcing milestones',async()=>{
  const render=vi.fn();const old=state([{id:'first-result',at:2}]);delete (old as Partial<ProgressState>).available;
  const connection=connectProgress({get:async()=>old,listen:()=>()=>{}},render,vi.fn());await Promise.resolve();
  expect(render).toHaveBeenLastCalledWith({...old,available:false},[]);connection.dispose();
});
it('does not replace a newer event with an older action response',async()=>{
  let accept!:(value:ProgressState)=>void,finish!:(value:ProgressState)=>void;
  const render=vi.fn();const connection=connectProgress({get:async()=>state(),listen:next=>{accept=next;return()=>{};}},render,vi.fn());await Promise.resolve();
  const pending=connection.perform(()=>new Promise(done=>{finish=done;}));
  const newer=state([{id:'first-result',at:4}]);accept(newer);finish(state());await pending;
  expect(render).toHaveBeenLastCalledWith(newer,['first-result']);connection.dispose();
});
