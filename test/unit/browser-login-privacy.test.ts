// Host-filled documents remain private across SPA changes; a clean navigation cannot revive them through Back.
import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isReady: () => true, commandLine: { getSwitchValue: () => '', appendSwitch: () => {} } }, BrowserWindow: class {}, WebContentsView: class {}, screen: {}, session: {} }));
import { BrowserTabs, type Tab } from '../../src/main/browser/tabs';
import { browserTools } from '../../src/main/browser/tools';
import type { BrowserActions } from '../../src/main/browser/actions';
import type { CallCtx } from '../../src/main/mcp/server';
it('withholds reads until the host-filled document is gone, then clears navigation history', async () => {
  const tabs = Object.assign(Object.create(BrowserTabs.prototype), { loginSecrets: new WeakMap(), captureVersion: 0, hostLoginAllowed: () => true }) as BrowserTabs;
  let safe = false;
  const clear = vi.fn(), evaluate = vi.fn(async () => safe);
  const tab = { net: { clear: vi.fn() }, console: [], wc: { mainFrame:{url:'https://qa.example.com/login'}, executeJavaScriptInIsolatedWorld:evaluate, navigationHistory:{ clear } } } as unknown as Tab;
  tabs.protectLogin(tab, 'privacy-fixture', 'https://qa.example.com');
  await expect(tabs.assertLoginReadable(tab)).rejects.toThrow('protected'); expect(clear).not.toHaveBeenCalled();
  safe = true; await tabs.assertLoginReadable(tab); expect(clear).toHaveBeenCalledOnce();
  await tabs.assertLoginReadable(tab); expect(evaluate).toHaveBeenCalledTimes(2);
});
it('browser_login without a saved site credential opens an actual login handoff', async () => {
  const open = vi.fn((request) => ({ ...request, id:'handoff', state:'done', at:1 }));
  const tab = {id:'t1',owner:'worker',env:'routine-fixture',wc:{getURL:()=> 'https://qa.example.com/login',getTitle:()=> 'Login',isDestroyed:()=>false}} as unknown as Tab;
  const policy = {targets:['https://qa.example.com'],dispatch:vi.fn()};
  const tabs = { routinePolicy:()=>policy,assertRoutine:()=>policy,tabFor:()=>tab,tabs:new Map([['t1',tab]]),setLastAction:vi.fn(),handoffs:{list:()=>[],open,delivered:vi.fn()},credentials:{lookup:vi.fn()} } as unknown as BrowserTabs;
  const tool = browserTools(tabs,{} as BrowserActions,()=>({group:'g',owner:'worker',chatId:'worker'})).find(t=>t.name==='browser_login')!;
  const output=await tool.run({}, {signal:new AbortController().signal,progress:()=>false} as unknown as CallCtx);
  expect(open).toHaveBeenCalledWith(expect.objectContaining({kind:'login',chatId:'worker'}));
  expect(output).toContain('done'); expect(policy.dispatch).not.toHaveBeenCalled();
});
it('a concurrent login handoff withholds captured pixels before evidence is saved', async () => {
  let privacy=0;
  const tab={owner:'worker'} as Tab,policy={targets:['https://qa.example.com'],dispatch:vi.fn()};
  const saveShot=vi.fn(), preview=vi.fn();
  const tabs={routinePolicy:()=>policy,tabFor:()=>tab,assertRoutine:()=>policy,assertLoginReadable:async()=>{},capturePrivacyVersion:()=>privacy} as unknown as BrowserTabs;
  const actions={screenshot:async()=>{privacy++;return {};},saveShot,preview} as unknown as BrowserActions;
  const tool=browserTools(tabs,actions,()=>({group:'g',owner:'worker',chatId:'worker'})).find(t=>t.name==='screenshot')!;
  await expect(tool.run({save_to:'proof.png'},{} as CallCtx)).rejects.toThrow('privacy changed');
  expect(saveShot).not.toHaveBeenCalled();expect(preview).not.toHaveBeenCalled();
});
it('an in-flight text read cannot return after its routine binding is revoked', async () => {
  let revoked=false;
  const tab={owner:'worker'} as Tab,policy={targets:['https://qa.example.com'],dispatch:vi.fn()};
  const tabs={routinePolicy:()=>revoked?{...policy,reason:'paused'}:policy,tabFor:()=>tab,assertRoutine:()=>policy,assertLoginReadable:async()=>{}} as unknown as BrowserTabs;
  const actions={text:async()=>{revoked=true;return 'private fixture body';}} as unknown as BrowserActions;
  const tool=browserTools(tabs,actions,()=>({group:'g',owner:'worker',chatId:'worker'})).find(t=>t.name==='get_page_text')!;
  await expect(tool.run({},{} as CallCtx)).rejects.toThrow('authorization changed');
});
it('host login refuses pre-existing same-session tabs and popup openers', () => {
  const tab={group:'g'} as Tab,other={group:'g'} as Tab;
  const tabs=Object.assign(Object.create(BrowserTabs.prototype),{tabsOf:()=>[tab,other]}) as BrowserTabs;
  expect(tabs.hostLoginAllowed(tab)).toBe(false);
  Object.assign(tabs,{tabsOf:()=>[tab]});expect(tabs.hostLoginAllowed(tab)).toBe(true);
  tab.openedBy='opener';expect(tabs.hostLoginAllowed(tab)).toBe(false);
});
it('ordinary login handoffs keep popups; routine login handoffs deny them', () => {
  let handler!: (d: {url:string}) => {action:string};
  const tab={id:'t',owner:'worker',group:'g',agent:false,wc:{on:vi.fn(),once:vi.fn(),setWindowOpenHandler:(fn:typeof handler)=>{handler=fn;}}} as unknown as Tab;
  let routine=false;
  const tabs=Object.assign(Object.create(BrowserTabs.prototype),{tabs:new Map([['t',tab]]),loginSecrets:new WeakMap(),tabsOf:()=>[tab],routineAccess:()=>routine?{targets:['https://qa.example.com'],dispatch:vi.fn()}:null,handoffs:{list:()=>[{tabId:'t',kind:'login',state:'open'}]}}) as BrowserTabs;
  (tabs as unknown as {wire(t:Tab):void}).wire(tab);
  expect(handler({url:'https://qa.example.com/login'}).action).toBe('allow');
  routine=true;expect(handler({url:'https://qa.example.com/login'}).action).toBe('deny');
});
