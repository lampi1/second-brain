// The essential renderer removes redundant controls without mutating protected policy or starting tools on render.
import fs from'node:fs';
import{beforeEach,expect,it,vi}from'vitest';
import{renderToStaticMarkup}from'react-dom/server';
import{createElement}from'react';
import{schema,defaults}from'../../src/main/brain/settings-schema';
import{settingSurface}from'../../src/shared/settings-surface';
import{setLang}from'../../src/renderer/i18n';
const mock=vi.hoisted(()=>({state:{} as Record<string,unknown>,ui:{prefs:{theme:'system',density:'comfortable',appearance:{version:1,preset:'standard',templates:{agents:'grid'}}}},setSetting:vi.fn()}));
vi.mock('../../src/renderer/store/store',()=>({useApp:(select:(state:Record<string,unknown>)=>unknown)=>select(mock.state),setSetting:mock.setSetting}));
// The app is client-only: supply an explicit frozen preference seed for SSR, without altering production stores.
vi.mock('../../src/renderer/store/ui',()=>({BRAIN_PAGES:[],ui:{use:(select:(state:typeof mock.ui)=>unknown)=>select(mock.ui)},setPrefs:vi.fn(),savePrefs:vi.fn(),openModal:vi.fn(),toast:vi.fn()}));
vi.mock('../../src/renderer/store/agents',()=>({useAgents:()=>({catalog:null,error:null})}));
// Aggiornamenti (ADR 0075): no state yet and no GitHub check on render
vi.mock('../../src/renderer/store/source',()=>({useSource:(select:(state:null)=>unknown)=>select(null),checkSource:vi.fn(),askUpdateNow:vi.fn(),dismissLaunch:vi.fn()}));
vi.mock('../../src/renderer/components/UpdatePanel',()=>({UpdatePanel:()=>null}));
// Task's reading settings (Settings → Notifiche, ADR 0101): no first read yet, no reader started on render
vi.mock('../../src/renderer/store/tasks',()=>({useTasks:(select:(state:null)=>unknown)=>select(null),setTasks:vi.fn(),EVERY_CHOICES:[5,15,30,60]}));
vi.mock('../../src/renderer/components/UpdateRecoveryPanel',()=>({UpdateRecoveryPanel:()=>null}));
import{SettingsPage}from'../../src/renderer/components/SettingsPage';
beforeEach(()=>{mock.setSetting.mockClear();mock.state={settings:{...defaults(),engineOn:{claude:false},engines:{claude:false}},info:{engines:[{id:'claude',name:'Claude Code',kind:'claude',trusted:true,key:'none'}]}};setLang('it');});
it('inventories every current schema setting without changing protection or defaults',()=>{
 const definitions=schema(),before=JSON.stringify(definitions),inventory=definitions.map(def=>({key:def.key,protected:def.protected,...settingSurface(def.key)}));
 expect(inventory.length).toBeGreaterThan(20);expect(new Set(inventory.map(row=>row.key)).size).toBe(inventory.length);
 expect(inventory.every(row=>['essential','derived','retired','technical'].includes(row.surface))).toBe(true);
 expect(settingSurface('engines.claude').surface).toBe('derived');expect(settingSurface('codexAutonomyRoots').surface).toBe('essential');
 expect(JSON.stringify(schema())).toBe(before);
 if(process.env.SB_SETTINGS_INVENTORY)fs.writeFileSync(process.env.SB_SETTINGS_INVENTORY,JSON.stringify(inventory,null,2));
});
it('renders four essential groups with no model routing, per-engine policy wall or settings mutation',()=>{
 const before=JSON.stringify(mock.state),html=renderToStaticMarkup(createElement(SettingsPage));
 expect(html).toContain('Account e strumenti');expect(html).toContain('Aggiornamenti');expect(html).toContain('Il mio spazio');expect(html).toContain('Aspetto e lingua');expect(html).toContain('Notifiche');
 expect(html).not.toContain('Gli Orchestrator possono usare');expect(html).not.toContain('Instradamento modelli');expect(html).not.toContain('brainrules');
 expect(mock.setSetting).not.toHaveBeenCalled();expect(JSON.stringify(mock.state)).toBe(before);
});
it('renders the essential surface and appearance controls in English',()=>{
 setLang('en');const html=renderToStaticMarkup(createElement(SettingsPage));
 expect(html).toContain('Accounts and tools');expect(html).toContain('Appearance and language');expect(html).toContain('Appearance and layout');expect(html).not.toContain('Aspetto e disposizione');setLang('it');
});
