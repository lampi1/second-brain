// Archived routine trees retain their data but cannot resume, fork or retry outbox delivery after startup.
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions } from '../../../src/main/chats/session';

const roots: string[] = [], managers: ChatManager[] = [];
const sessionId = (first: string) => [first, '2222', '4333', '8444', '555555555555'].join('-');
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); vi.useRealTimers(); for (const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true}); });
function fixture(extra: Record<string, unknown> = {}, child = false) {
 const root=fs.mkdtempSync(path.resolve('.review-data-')); roots.push(root);
 const parent={id:'old-routine',harness:'claude',cwd:root,title:'Old routine',createdAt:1000,sessionId:sessionId('11111111'),routine:{runId:'old-run',stepId:'step'},...extra};
 const rows=[parent,...(child?[{id:'old-child',harness:'claude',cwd:root,title:'Routine child',createdAt:1001,sessionId:sessionId('22222222'),parentId:parent.id,working:true}]:[])];
 fs.writeFileSync(path.join(root,'chats.json'),JSON.stringify({version:2,chats:rows}));
 const starts:SessionOptions[]=[];
 const m=new ChatManager({userData:root,emitter:{emit(){}},claudeHome:path.join(root,'home'),coldEveryMs:0,runEveryMs:0,childResultsMs:10,sessionFactory:(_h,o,s)=>{
  starts.push(o);return {harness:'claude',sessionId:null,pid:null,root:null,alive:true,busy:false,start(){s.changed({state:'idle'});},send(){},close:async()=>{s.changed({state:'closed'});s.exit({code:0,error:null});},killNow(){},interrupt:async()=>{},answer:()=>true,rename:async()=>{},setModel:async()=>{},setEffort:async()=>{},setPermissionMode:async()=>{},contextUsage:async()=>null,usage:async()=>null} as unknown as HarnessSession;
 }}); managers.push(m); return {m,starts,root,parent};
}
it('refuses a generic fork of a restored routine transcript',async()=>{
 const f=fixture(); expect(f.m.summary(f.parent.id)?.closedAt).toBeTruthy();
 await expect(f.m.create({harness:'claude',cwd:f.root,resumeSessionId:f.parent.sessionId,fork:true,prompt:'Continue the work'})).rejects.toThrow('Archived routine');
 expect(f.starts).toHaveLength(0);
});
it('keeps archived routine outboxes inert',async()=>{
 vi.useFakeTimers(); const f=fixture({heldResults:[{title:'Child',message:'Routine result'}]});
 const send=vi.spyOn(f.m,'send'); f.m.resumeInterrupted();
 await vi.advanceTimersByTimeAsync(100); expect(send).not.toHaveBeenCalled(); expect(f.starts).toHaveLength(0);
});
it('never resumes an interrupted routine descendant',async()=>{
 const f=fixture({},true); expect(f.m.resumeInterrupted()).toBe(0);
 expect(f.starts).toHaveLength(0); expect(f.m.summary('old-child')?.routineArchived).toBe(true);
});
it('never changes archived work through stale checks, assignments, handoffs or continuations', async () => {
 const run = { runId:'r_000000000001',chatId:'old-routine',agentId:'artisan',version:1,goal:'Old routine',startedBy:'orchestrator',startedAt:1000,costUsd:null,tokens:null,counters:{questions:0,permissions:0,commands:0,reopened:0,contextPeak:null} };
 const f=fixture({run,working:false}); const restored=f.m.summary('old-routine')?.run;
 expect(restored?.runId).toBe(run.runId); const before=JSON.stringify(restored);
 expect(f.m.staleRuns(Date.now()+86400000)).toBe(0);
 await expect(f.m.assignTask('old-routine', 'Continue')).rejects.toThrow('Archived routine');
 await expect(f.m.handoff('old-routine')).rejects.toThrow('Archived routine');
 await expect(f.m.continueChat('old-routine')).rejects.toThrow('Archived routine');
 await expect(f.m.set('old-routine', { workStatus: 'completed' })).rejects.toThrow('Archived routine');
 expect(() => f.m.markRun('old-routine', 'success')).toThrow('Archived routine');
 expect(f.starts).toHaveLength(0);
 expect(JSON.stringify(f.m.summary('old-routine')?.run)).toBe(before);
});
