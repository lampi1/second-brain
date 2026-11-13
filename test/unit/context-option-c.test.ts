// Long context is passive on every engine; explicit manual handoff status and the coordinator's own path remain.
import{createElement}from'react';
import{renderToStaticMarkup}from'react-dom/server';
import{afterEach,expect,it,vi}from'vitest';
import type{ChatSummary}from'../../src/shared/contract';
vi.mock('../../src/renderer/actions',()=>({focusChat:vi.fn(),reopenChat:vi.fn()}));
vi.mock('../../src/renderer/store/store',()=>({useApp:()=>undefined}));
import{ContextMeter,ContextNotice}from'../../src/renderer/components/ContextBar';
import{defaults}from'../../src/main/brain/settings-schema';
import{continuityStep,type ColdView}from'../../src/main/chats/continuity';
import{setLang}from'../../src/renderer/i18n';
afterEach(()=>setLang('it'));
it.each(['claude','cursor','codex'])('never renders a length-only resume notice on %s',harness=>{
 const chat={id:'test',harness,contextTokens:350_000,contextMaxTokens:475_000,contextEstimated:false}as ChatSummary;
 const props={chat,warn:200_000,onDismiss:()=>{}};
 expect(renderToStaticMarkup(createElement(ContextNotice,props))).toBe('');
 const meter=renderToStaticMarkup(createElement(ContextMeter,{chat,warn:200_000}));expect(meter).toContain('350k');expect(meter).not.toContain('<button');
});
it('keeps only the actual in-progress manual handoff status, localized',()=>{
 const chat={id:'test',harness:'codex',handoffBusy:true}as ChatSummary;
 setLang('en');const text=renderToStaticMarkup(createElement(ContextNotice,{chat}));expect(text).toContain('Preparing the handoff.');expect(text).not.toContain('<button');
});
it('disables cold notes by default without changing the Claude limit or Orchestrator day compaction',()=>{
 const settings=defaults();expect(settings.contextHandoff).toBe(false);expect(settings.compactWindowTokens).toBe(200_000);expect(settings.orchestratorDayCompact).toBe(true);
 const now=Date.UTC(2026,9,17,12),lastTurnAt=now-50*60_000;
 const view:ColdView&{ctxSince:number;askedOn:undefined}={harness:'claude',isOrchestrator:false,state:'idle',pending:0,background:0,busy:false,alive:true,handoffTurn:false,contextTokens:250_000,lastTurnAt,lastCallAt:lastTurnAt,noteAt:0,ctxSince:now-24*60*60_000,askedOn:undefined};
 const options={cold:settings.contextHandoff,day:settings.orchestratorDayCompact===true,idleMs:50*60_000};
 expect(continuityStep(view,now,options)).toBe(null);expect(continuityStep({...view,isOrchestrator:true},now,options)).toBe('compact');
});
