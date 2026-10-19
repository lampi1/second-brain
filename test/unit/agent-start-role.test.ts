// The dialog actually mounted by App consumes saved role suggestions, preserving explicit startup and capability denials.
import{createElement}from'react';import{renderToStaticMarkup}from'react-dom/server';import{beforeEach,expect,it,vi}from'vitest';
import type{AgentCatalog,AgentProfile}from'../../src/shared/agents';
const mock=vi.hoisted(()=>({role:undefined as unknown,catalog:null as AgentCatalog|null}));
const pages=['agenti','devops','skill','esplora','fatto','qualita','idee','costi','confronto'].map(id=>({id,label:id}));
vi.mock('../../src/renderer/store/store',()=>({app:{get:()=>({info:{engines:[]}})},createChat:vi.fn(),cliLogin:vi.fn(),useApp:(select:(s:unknown)=>unknown)=>select({info:{brainRoot:'C:/work'},order:['regia'],chats:{regia:{isRegia:true}}})}));
vi.mock('../../src/renderer/store/agents',()=>({useAgents:()=>({catalog:mock.catalog,setup:null,error:null})}));
vi.mock('../../src/renderer/store/ui',()=>({BRAIN_PAGES:['agenti','devops','skill','esplora','fatto','qualita','idee','costi','confronto'].map(id=>({id,label:id})),ui:{use:(select:(s:unknown)=>unknown)=>select({prefs:{newChat:{cwd:'C:/work',permissionMode:''},role:mock.role},newChatRegia:false})},closeModal:vi.fn(),openModal:vi.fn(),setPrefs:vi.fn(),setRegiaTab:vi.fn()}));
vi.mock('../../src/renderer/actions',()=>({focusChat:vi.fn(),go:vi.fn(),regiaId:()=> 'regia'}));
vi.mock('../../src/renderer/components/ui',()=>({Modal:({children}:{children:React.ReactNode})=>children,Keys:()=>null}));
vi.mock('../../src/renderer/components/AgentAvatar',()=>({AgentAvatar:()=>null}));
// the custom Select renders its options only when open: a native one here keeps them in the markup
vi.mock('../../src/renderer/components/Select',async()=>{const{createElement:h}=await import('react');return{Select:({children,value,disabled,'data-testid':testid}:{children?:React.ReactNode;value?:string;disabled?:boolean;'data-testid'?:string})=>h('select',{value,disabled,'data-testid':testid,onChange:()=>{}},children)};});
import{AgentStartDialog}from'../../src/renderer/components/AgentStartDialog';import{rolePreview}from'../../src/renderer/lib/role-preferences';
import{setLang}from'../../src/renderer/i18n';
beforeEach(()=>{const profiles=['general','implementer','researcher','day-planner','reviewer','writer'].map<AgentProfile>(id=>({id:'default-'+id,name:id,purpose:id,instructions:'',engine:'claude',model:null,avatar:{kind:'symbol',value:'briefcase'},createdAt:0,updatedAt:0,role:'',category:'other',tools:null,permissionCeiling:null,origin:{kind:'user'},version:1,activeVersion:1,lastEditedBy:'user',userLocked:true,status:'active'}));mock.catalog={profiles,archived:[],models:[{engine:'claude',label:'Claude',enabled:true,trusted:true,installed:null,authenticated:null,defaultModel:true,models:[],modelSelectable:true,effort:true,source:'unknown',modelReason:null}],problem:null,legacyRouting:{preserved:true,imported:0,remaining:0},imageGeneration:{available:false,reason:'Not configured'}};mock.role=rolePreview(undefined,'dev',{agentIds:profiles.map(p=>p.id),pageIds:pages.map(p=>p.id)}).next;});
it('selects the real Dev primary profile and exposes research and planning in the mounted start dialog',()=>{
 const html=renderToStaticMarkup(createElement(AgentStartDialog));expect(html).toContain('value="default-implementer" selected=""');
 expect(html.indexOf('value="default-implementer"')).toBeLessThan(html.indexOf('value="default-researcher"'));expect(html).toContain('value="default-day-planner"');
});
it('disables startup when the saved profile model is no longer supported, instead of silently choosing another agent',()=>{
 mock.catalog!.profiles.find(p=>p.id==='default-implementer')!.model='removed';
 const html=renderToStaticMarkup(createElement(AgentStartDialog));expect(html).toContain('value="default-implementer" selected=""');expect(html).toMatch(/disabled=""[^>]*data-testid="newchat-create"/);
});
it('renders the mounted start flow and unknown readiness in English without translating persisted profile identities',()=>{
 setLang('en');try{const html=renderToStaticMarkup(createElement(AgentStartDialog));expect(html).toContain('Start an agent');expect(html).toContain('Context and expected result');expect(html).toContain('installation or sign-in needs verification');expect(html).not.toContain('Dettagli e permessi');expect(html).toContain('implementer');}finally{setLang('it');}
});
it('never offers the coordinator preset as a work chat agent, even as the first or a role-suggested profile',()=>{
 const general=mock.catalog!.profiles[0]!;mock.catalog!.profiles.unshift({...general,id:'default-orchestrator',name:'Orchestrator'});
 mock.role=rolePreview(undefined,'dev',{agentIds:mock.catalog!.profiles.map(p=>p.id),pageIds:pages.map(p=>p.id)}).next;
 expect(renderToStaticMarkup(createElement(AgentStartDialog))).not.toContain('default-orchestrator');
 mock.role=undefined;const html=renderToStaticMarkup(createElement(AgentStartDialog));
 expect(html).not.toContain('default-orchestrator');expect(html).toContain('value="default-general" selected=""');
});
