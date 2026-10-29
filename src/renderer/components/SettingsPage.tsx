// Settings page (rendered by App.tsx; each section's title, description and search words: lib/settings-sections.ts, which the Orchestrator's app map reads too, ADR 0149): essential settings only, laid out like the Dashboard: a page header with the
// search (a group's title, description and keywords; clearing it keeps the focus in the field), a row of section links, then one card per group (icon, title, one-line description, rows of text left and
// control right). Connettori: ConnectorsHub.tsx (accounts and MCP servers, ADR 0086; the tool catalog, ADR 0119). Avanzate: the technical MCP form and import (ConnectorsHub.tsx McpAdvanced, ADR 0119). Ruoli e deleghe: DelegationSettings.tsx (ADR 0083). Aggiornamenti: AppUpdateSettings.tsx (ADR 0075; "impostazioni/update" opens on it). Scrittura: SuggestSettings.tsx (the composer's inline suggestion, ADR 0118). Voce: VoiceSettings.tsx (voice mode, ADR 0152). Stored technical policies and engine denials are preserved, never enabled by rendering.
// Account actions use existing typed login/secure-storage/trust boundaries; no provider routing matrix or policy wall.
import{useEffect,useState,type ReactNode}from'react';
import { Select } from './Select';
import type{CliStatus,EngineInfo,SecretsStatus}from'@shared/contract';
import { isLang, LANGS } from '@shared/contract';
import{IconBell,IconBranch,IconEdit,IconFolder,IconLink,IconMic,IconMoon,IconRefresh,IconSearch,IconSettings,IconTerminal,IconUser}from'./Icons';
import { DelegationSettings } from './DelegationSettings';
import{useEngines}from'../lib/engines';
import{matchesSettingsSearch}from'../lib/settings-page';
import{settingsSections}from'../lib/settings-sections';
import{useApp,setSetting}from'../store/store';
import{ui,setPrefs,openModal,toast}from'../store/ui';
import{t}from'../i18n';
import{AppearancePreview}from'./AppearancePreview';
import{HelpTip}from'./HelpTip';
import{WorkProfilePreferences}from'./WorkProfilePreferences';
import{ProfileSettings}from'./ProfileSettings';
import{holdUpdate}from'../lib/update-barrier';
import { ProjectsFolderSetting } from './ProjectsFolderSetting';
import { BrainShareSetting } from './BrainShareSetting';
import { ConnectorsHub, McpAdvanced } from './ConnectorsHub';
import { CodexAutonomy } from './CodexAutonomy';
import { AppUpdateSettings } from './AppUpdateSettings';
import { CloudKeySetting } from './CloudKeySetting';
import { PulseSettings } from './PulseSettings';
import { TaskReadSettings } from './TaskReadSettings';
import { SuggestSettings } from './SuggestSettings';
import { AwaySettings } from './AwayToggle';
import { VoiceSettings } from './VoiceSettings';
import'../styles/settings.css';
export function Switch({on,onChange,label,busy,testid}:{on:boolean;onChange:(on:boolean)=>void;label:string;busy?:boolean;testid?:string}){
 return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} className={`st-switch ${on?'on':''}`} onClick={()=>onChange(!on)} data-testid={testid}><span className="st-knob" aria-hidden="true"/></button>;
}
function Row({title,children,description,help}:{title:string;children:ReactNode;description?:string;help?:ReactNode}){return <div className="st-row"><div className="st-text">{help?<span className="st-title-line"><label className="st-title">{title}</label>{help}</span>:<label className="st-title">{title}</label>}{description&&<p className="st-desc">{description}</p>}</div><div className="st-ctl">{children}</div></div>;}
function ToolConnection({engine}:{engine:EngineInfo}){
 const roots=useApp(s=>s.settings?.codexAutonomyRoots??[]);
 const enabled=useApp(s=>s.settings?.engineOn[engine.id]===true),policy=useApp(s=>s.settings?.engines[engine.id]===true);
 const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[login,setLogin]=useState<CliStatus|null>(null),[keys,setKeys]=useState<SecretsStatus|null>(null),[key,setKey]=useState('');
 useEffect(()=>key?holdUpdate(t('essential.key')):undefined,[key]);
 const run=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);try{await action();}catch{toast(t('essential.error'),'err');}finally{setBusy(false);}};
 useEffect(()=>{if(!open||engine.key==='none')return;let live=true;void window.sb.invoke('secrets:status',undefined).then(result=>{if(live)setKeys(result);},()=>{if(live)setKeys(null);});return()=>{live=false;};},[open,engine.id,engine.key]);
 const check=()=>run(async()=>{setLogin(await window.sb.invoke('cli:status',{harness:engine.id,checkLogin:true}));});
 return <article className="st-tool" data-testid={`st-tool-${engine.id}`}>
  <div className="st-row"><div className="st-text"><b className="st-title">{engine.name}</b><span className={`st-state ${enabled&&engine.trusted&&policy?'on':''}`}>{enabled&&engine.trusted&&policy?t('essential.available'):t('essential.off')}</span></div><button type="button" className="btn btn-ghost btn-m st-expand" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{t('essential.configure')}</button></div>
  {open&&<div className="st-tool-connection">
   {!policy&&<p className="st-desc">{t('essential.policy')}</p>}
   {!engine.trusted?<><p>{t('essential.trustNeeded')}</p><code>{engine.runs}</code><button type="button" className="btn btn-primary btn-m" disabled={busy} onClick={()=>void run(()=>window.sb.invoke('engines:trust',{engine:engine.id}))}>{t('essential.trust')}</button></>:<button type="button" className={`btn btn-m ${enabled?'btn-ghost':'btn-primary'}`} disabled={busy} onClick={()=>void setSetting({engineOn:{[engine.id]:!enabled}})}>{t(enabled?'essential.disable':'essential.enable')}</button>}
   {engine.kind!=='api'&&<div className="st-inline"><button type="button" className="btn btn-ghost btn-m" disabled={busy||!enabled||!engine.trusted} onClick={()=>void check()}>{t('essential.check')}</button><button type="button" className="btn btn-ghost btn-m" disabled={busy||!enabled||!engine.trusted} onClick={()=>void run(()=>window.sb.invoke('cli:login',{harness:engine.id}))}>{t('essential.signIn')}</button>{login&&<span role="status" className="st-desc">{!login.found?t('essential.notInstalled'):login.loggedIn===true?t('essential.signedIn'):login.loggedIn===false?t('essential.signInNeeded'):t('essential.unknown')}</span>}</div>}
   {engine.key!=='none'&&<div className="st-key"><label>{t('essential.key')}<input className="st-input" type="password" autoComplete="off" spellCheck={false} value={key} disabled={!keys?.available||busy} onChange={event=>setKey(event.target.value)}/></label><button type="button" className="btn btn-primary btn-m" disabled={!keys?.available||busy||!key.trim()} onClick={()=>{const value=key.trim();setKey('');void run(async()=>{setKeys(await window.sb.invoke('secrets:set',{engine:engine.id,key:value}));});}}>{t('common.save')}</button>{keys?.keys[engine.id]&&<><small className="st-desc">{t('essential.keySaved')}</small><button type="button" className="btn btn-danger btn-m" disabled={busy} onClick={()=>void run(async()=>{setKeys(await window.sb.invoke('secrets:delete',{engine:engine.id}));})}>{t('essential.deleteKey')}</button></>}{keys&&!keys.available&&<p role="status" className="st-desc">{t('essential.keyUnavailable')}</p>}</div>}
  </div>}
  {engine.id==='codex'&&<CodexAutonomy roots={roots}/>}
  {engine.id==='cursor'&&open&&<CloudKeySetting/>}
 </article>;
}
export function SettingsPage(){
 const prefs=ui.use(s=>s.prefs),settings=useApp(s=>s.settings),engines=useEngines(),[query,setQuery]=useState('');
 // a link to one card ("impostazioni/update": the restart notice's «Aggiornamenti») scrolls to it once the page is drawn
 const arg=ui.use(s=>s.page==='impostazioni'?s.pageArg:null);
 // a deep link (Task's «Impostazioni di lettura» → notifications, ADR 0101) scrolls to its section, and once more when the
 // sections above it have loaded (the connectors and the update panel grow after the first paint)
 useEffect(()=>{if(!arg||!settings)return;const go=()=>document.getElementById(`st-section-${arg}`)?.scrollIntoView({block:'start'});const id=requestAnimationFrame(go);const again=setTimeout(go,700);return()=>{cancelAnimationFrame(id);clearTimeout(again);};},[arg,!!settings]);
 if(!settings)return null;
 const meta=settingsSections(engines.map(engine=>engine.name));
 const groups=[
  {...meta.profile,icon:<IconUser size={18}/>,body:<ProfileSettings/>},
  {...meta.update,icon:<IconRefresh size={18}/>,body:<AppUpdateSettings/>},
  {...meta.connectors,icon:<IconLink size={18}/>,body:<ConnectorsHub/>},
  {...meta.accounts,icon:<IconTerminal size={18}/>,body:<>{engines.map(engine=><ToolConnection key={engine.id} engine={engine}/>)}</>},
  {...meta.roles,icon:<IconBranch size={18}/>,body:<><AwaySettings/><DelegationSettings/></>},
  {...meta.space,icon:<IconFolder size={18}/>,body:<>
   <WorkProfilePreferences/>
   <Row title={t('essential.memory')}><span className="st-value" title={settings.brainRoot??undefined}>{settings.brainRoot||t('essential.memoryEmpty')}</span><button type="button" className="btn btn-ghost btn-m" onClick={()=>void window.sb.invoke('app:pickBrain',undefined).catch(()=>toast(t('essential.error'),'err'))}>{t('essential.pickMemory')}</button></Row>
   <BrainShareSetting/>
   <ProjectsFolderSetting/>
   <Row title={t('essential.archive')} description={t('essential.archiveHint')}><Select aria-label={t('essential.archive')} data-testid="st-archive-select" value={settings.autoCloseMin} onChange={event=>void setSetting({autoCloseMin:Number(event.target.value)})}>{[...new Set([0,2,5,10,30,settings.autoCloseMin])].sort((a,b)=>a-b).map(count=><option key={count} value={count}>{count?t('essential.minutes',{count}):t('essential.never')}</option>)}</Select></Row>
   <Row title={t('essential.setupTitle')} description={t('essential.setupHint')}><button type="button" className="btn btn-ghost btn-m" onClick={()=>openModal('setup')}>{t('essential.setup')}</button></Row>
  </>},
  {...meta.writing,icon:<IconEdit size={18}/>,body:<SuggestSettings/>},
  {...meta.voice,icon:<IconMic size={18}/>,body:<VoiceSettings/>},
  {...meta.appearance,icon:<IconMoon size={18}/>,body:<>
   <Row title={t('essential.theme')}><Select aria-label={t('essential.theme')} data-testid="st-theme-select" value={prefs.theme} onChange={event=>{const theme=event.target.value;if(theme==='system'||theme==='light'||theme==='dark')setPrefs({theme});}}>{(['system','light','dark']as const).map(value=><option key={value} value={value}>{t(`essential.${value}`)}</option>)}</Select></Row>
   <Row title={t('settings.language')}><Select aria-label={t('settings.language')} value={settings.language} onChange={event=>{const language=event.target.value;if(language==='system'||isLang(language))void setSetting({language});}} data-testid="st-language-select">{(['system',...LANGS]as const).map(value=><option key={value} value={value}>{t(`settings.language.${value}`)}</option>)}</Select></Row>
   <Row title={t('essential.density')}><Select aria-label={t('essential.density')} data-testid="st-density-select" value={prefs.density} onChange={event=>{const density=event.target.value;if(density==='compact'||density==='comfortable')setPrefs({density});}}>{(['comfortable','compact']as const).map(value=><option key={value} value={value}>{t(`essential.${value}`)}</option>)}</Select></Row>
   <div className="st-row st-row-block"><AppearancePreview/></div>
  </>},
  {...meta.notifications,icon:<IconBell size={18}/>,body:<><Row title={t('essential.toasts')} description={t('essential.notificationsHint')} help={<HelpTip title={t('explain.toasts.title')} testid="st-toasts-help"><p>{t('explain.toasts.p1')}</p></HelpTip>}><Select aria-label={t('essential.toasts')} data-testid="st-toasts-select" value={settings.osToasts} onChange={event=>{const osToasts=event.target.value;if(osToasts==='urgent'||osToasts==='normal'||osToasts==='off')void setSetting({osToasts});}}>{(['urgent','normal','off']as const).map(value=><option key={value} value={value}>{t(value==='off'?'essential.none':`essential.${value}`)}</option>)}</Select></Row><PulseSettings/><TaskReadSettings/></>},
  {...meta.advanced,icon:<IconSettings size={18}/>,body:<McpAdvanced/>},
 ];
 const matched=groups.filter(group=>matchesSettingsSearch(query,group.title+' '+group.description+' '+group.search));
 const jump=(id:string)=>{const target=document.getElementById(`st-section-${id}`);target?.scrollIntoView({block:'start',behavior:'smooth'});target?.focus({preventScroll:true});};
 return <div className="st-page st-essential" data-testid="settings-page">
  <header className="st-hero">
   <div className="st-hero-text"><span className="st-eyebrow">{t('essential.eyebrow')}</span><h1>{t('essential.title')}</h1><p>{t('essential.lead')}</p></div>
   <div role="search" className="st-search">
    <label htmlFor="settings-search" className="sr-only">{t('essential.search')}</label>
    <div className="st-search-line"><span className="st-search-icon" aria-hidden="true"><IconSearch/></span><input id="settings-search" type="search" value={query} placeholder={t('essential.searchHint')} className="st-input" data-testid="st-search" aria-controls="settings-results" onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setQuery('');}}}/>{query&&<button type="button" className="btn btn-subtle btn-m" data-testid="st-search-clear" onClick={()=>{setQuery('');document.getElementById('settings-search')?.focus();}}>{t('essential.clear')}</button>}</div>
   </div>
  </header>
  <nav className="st-nav" aria-label={t('essential.sections')}>{matched.map(group=><button type="button" key={group.id} className="st-chip" onClick={()=>jump(group.id)}>{group.icon}<span>{group.title}</span></button>)}</nav>
  {query&&!matched.length&&<p role="status" className="st-empty" data-testid="st-search-empty">{t('essential.empty')}</p>}
  <div id="settings-results" className="st-results">{groups.map(group=><section className="st-group" key={group.id} hidden={!matched.includes(group)} aria-labelledby={`st-section-${group.id}`} data-testid={`st-group-${group.id}`}>
   <header className="st-group-head"><span className="st-group-icon" aria-hidden="true">{group.icon}</span><div><h2 id={`st-section-${group.id}`} tabIndex={-1}>{group.title}</h2><p>{group.description}</p></div></header>
   <div className="st-card">{group.body}</div>
  </section>)}</div>
 </div>;
}
