// Host origin and policy boundaries for routine browser tools, including URL tricks and queued revocation.
import { expect, it, vi } from 'vitest';
import { assertBrowserOrigin } from '../../src/main/browser/routine-policy';
import { browserWorkerPolicy } from '../../src/main/browser/worker-policy';
import { claudeTools, claudeMcp } from '../../src/main/agents/tool-policy';
import { browserTools } from '../../src/main/browser/tools';
import type { BrowserTabs, Tab } from '../../src/main/browser/tabs';
import type { BrowserActions } from '../../src/main/browser/actions';
import type { CallCtx } from '../../src/main/mcp/server';
const policy = {targets:['https://qa.example.com'],dispatch:vi.fn()};
it.each(['https://qa.example.com.evil.test','http://qa.example.com','https://qa.example.com:444','https://user:secret@qa.example.com','https://other.example.com','javascript:alert(1)'])('refuses origin outside browserTargets: %s', url=>expect(()=>assertBrowserOrigin(policy,url)).toThrow(/browserTargets/));
it('matches exact origin and rechecks live revocation',()=>{expect(()=>assertBrowserOrigin(policy,'https://qa.example.com/path')).not.toThrow();expect(()=>assertBrowserOrigin({...policy,reason:'paused'},'https://qa.example.com')).toThrow('paused');});
it('narrows actual native tools; no shell, edits, web, connectors or native subagents',()=>{
 const p=browserWorkerPolicy(null);expect(p.tools?.allow).toEqual(['read','browser']);
 expect(claudeTools(p.tools!)).not.toEqual(expect.arrayContaining(['Bash','Agent','Task','WebFetch','Write']));expect(claudeTools(p.tools!)).not.toContain('Bash');expect(claudeTools(p.tools!)).not.toContain('Agent');expect(claudeMcp(p.tools!)).toMatchObject({strict:true,connectors:false});
 expect(()=>browserWorkerPolicy({tools:{allow:['read','browser-read']},ceiling:null})).toThrow(/lacks/);
});
it('the actual browser tool rejects cross-origin navigation before creating a tab or dispatching',async()=>{
 const create=vi.fn();const tabs={routinePolicy:()=>policy,create} as unknown as BrowserTabs;
 const tool=browserTools(tabs,{} as BrowserActions,()=>({group:'chat:c',owner:'c',chatId:'c'})).find(t=>t.name==='navigate')!;
 await expect(tool.run({url:'https://other.example.com'},{signal:new AbortController().signal} as CallCtx)).rejects.toThrow(/outside approved browserTargets/);expect(create).not.toHaveBeenCalled();
});
it('the actual click tool rejects a tab on an unapproved origin',async()=>{
 const tab={wc:{getURL:()=> 'https://other.example.com'}} as unknown as Tab;
 const tabs={routinePolicy:()=>policy,tabFor:()=>tab,assertRoutine:()=>{assertBrowserOrigin(policy,tab.wc.getURL());return policy;}} as unknown as BrowserTabs;
 const click=vi.fn(), tools=browserTools(tabs,{click} as unknown as BrowserActions,()=>({group:'chat:c',owner:'c',chatId:'c'}));
 await expect(tools.find(t=>t.name==='click')!.run({ref:'e1'},{} as CallCtx)).rejects.toThrow(/browserTargets/);expect(click).not.toHaveBeenCalled();
});

it('ordinary read calls do not serialize ahead of the action needed to satisfy wait_for', async () => {
 let finish!: () => void;
 const tab = {} as Tab;
 const tabs = { routinePolicy: () => null, tabFor: () => tab } as unknown as BrowserTabs;
 const actions = { waitFor: () => new Promise<string>(resolve => { finish = () => resolve('ready'); }), act: async (_t: Tab, _s: string, fn: () => Promise<string>) => fn(), click: async () => { finish(); return 'clicked'; } } as unknown as BrowserActions;
 const list = browserTools(tabs, actions, () => ({ group:'normal', owner:'ordinary', chatId:'ordinary' }));
 const wait = list.find(t => t.name === 'wait_for')!.run({ text: 'ready' }, {} as CallCtx);
 await Promise.resolve(); await list.find(t => t.name === 'click')!.run({ ref:'e1' }, {} as CallCtx);
 await expect(wait).resolves.toBe('ready');
});
