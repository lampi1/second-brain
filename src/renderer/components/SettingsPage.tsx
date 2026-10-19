// Settings page (rendered by App.tsx): essential settings only, laid out like the Dashboard: a page header with the
// search, a row of section links, then one card per group (icon, title, one-line description, rows of text left and
// control right). Aggiornamenti: AppUpdateSettings.tsx (ADR 0075). Stored technical policies and engine denials are preserved, never enabled by rendering.
// Account actions use existing typed login/secure-storage/trust boundaries; no provider routing matrix or policy wall.
import{useEffect,useState,type ReactNode}from'react';
import { Select } from './Select';
import type{CliStatus,EngineInfo,SecretsStatus}from'@shared/contract';
import{IconBell,IconFolder,IconLink,IconMoon,IconRefresh,IconSearch,IconTerminal,IconUser}from'./Icons';
import{useEngines}from'../lib/engines';
import{matchesSettingsSearch}from'../lib/settings-page';
import{useApp,setSetting}from'../store/store';
import{ui,setPrefs,openModal,toast}from'../store/ui';
import{t}from'../i18n';
import{AppearancePreview}from'./AppearancePreview';
import{RolePreferences}from'./RolePreferences';
import{ProfileSettings}from'./ProfileSettings';
import{holdUpdate}from'../lib/update-barrier';
import { AppConnectorScreen } from '../../modules/onboarding/AppScreen';
import { CodexAutonomy } from './CodexAutonomy';
import { AppUpdateSettings } from './AppUpdateSettings';
import { CloudKeySetting } from './CloudKeySetting';
import'../styles/settings.css';
export function Switch({on,onChange,label,busy,testid}:{on:boolean;onChange:(on:boolean)=>void;label:string;busy?:boolean;testid?:string}){
 return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} className={`st-switch ${on?'on':''}`} onClick={()=>onChange(!on)} data-testid={testid}><span className="st-knob" aria-hidden="true"/></button>;
}
function Row({title,children,description}:{title:string;children:ReactNode;description?:string}){return <div className="st-row"><div className="st-text"><label className="st-title">{title}</label>{description&&<p className="st-desc">{description}</p>}</div><div className="st-ctl">{children}</div></div>;}
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
 if(!settings)return null;
 const groups=[
  {id:'profile',icon:<IconUser size={18}/>,description:t('essential.desc.profile'),title:t('profile.group'),search:[t('profile.name'),t('profile.role'),t('profile.mainWork'),t('profile.replyStyle'),'me.md profilo profile'].join(' '),body:<ProfileSettings/>},
  {id:'update',icon:<IconRefresh size={18}/>,description:t('essential.desc.update'),title:t('update.group'),search:'aggiorna update versione version GitHub',body:<AppUpdateSettings/>},
  {id:'connectors',icon:<IconLink size={18}/>,description:t('essential.desc.connectors'),title:t('connector.group'),search:'GitHub Jira Azure DevOps collegamenti connectors projects',body:<AppConnectorScreen/>},
  {id:'accounts',icon:<IconTerminal size={18}/>,description:t('essential.desc.accounts'),title:t('essential.accounts'),search:engines.map(engine=>engine.name).join(' ')+' '+t('autonomy.title'),body:<>{engines.map(engine=><ToolConnection key={engine.id} engine={engine}/>)}</>},
  {id:'space',icon:<IconFolder size={18}/>,description:t('essential.desc.space'),title:t('essential.space'),search:[t('essential.memory'),t('essential.archive'),'ruolo role Dev QA PO CTO'].join(' '),body:<>
   <RolePreferences/>
   <Row title={t('essential.memory')}><span className="st-value" title={settings.brainRoot??undefined}>{settings.brainRoot||t('essential.memoryEmpty')}</span><button type="button" className="btn btn-ghost btn-m" onClick={()=>void window.sb.invoke('app:pickBrain',undefined).catch(()=>toast(t('essential.error'),'err'))}>{t('essential.pickMemory')}</button></Row>
   <Row title={t('essential.archive')} description={t('essential.archiveHint')}><Select aria-label={t('essential.archive')} value={settings.autoCloseMin} onChange={event=>void setSetting({autoCloseMin:Number(event.target.value)})}>{[...new Set([0,2,5,10,30,settings.autoCloseMin])].sort((a,b)=>a-b).map(count=><option key={count} value={count}>{count?t('essential.minutes',{count}):t('essential.never')}</option>)}</Select></Row>
   <Row title={t('essential.setupTitle')} description={t('essential.setupHint')}><button type="button" className="btn btn-ghost btn-m" onClick={()=>openModal('setup')}>{t('essential.setup')}</button></Row>
  </>},
  {id:'appearance',icon:<IconMoon size={18}/>,description:t('essential.desc.appearance'),title:t('essential.appearance'),search:[t('essential.theme'),t('settings.language'),t('essential.density')].join(' '),body:<>
   <Row title={t('essential.theme')}><Select aria-label={t('essential.theme')} value={prefs.theme} onChange={event=>{const theme=event.target.value;if(theme==='system'||theme==='light'||theme==='dark')setPrefs({theme});}}>{(['system','light','dark']as const).map(value=><option key={value} value={value}>{t(`essential.${value}`)}</option>)}</Select></Row>
   <Row title={t('settings.language')}><Select aria-label={t('settings.language')} value={settings.language} onChange={event=>{const language=event.target.value;if(language==='system'||language==='it'||language==='en')void setSetting({language});}} data-testid="st-language-select">{(['system','it','en']as const).map(value=><option key={value} value={value}>{t(`settings.language.${value}`)}</option>)}</Select></Row>
   <Row title={t('essential.density')}><Select aria-label={t('essential.density')} value={prefs.density} onChange={event=>{const density=event.target.value;if(density==='compact'||density==='comfortable')setPrefs({density});}}>{(['comfortable','compact']as const).map(value=><option key={value} value={value}>{t(`essential.${value}`)}</option>)}</Select></Row>
   <div className="st-row st-row-block"><AppearancePreview/></div>
  </>},
  {id:'notifications',icon:<IconBell size={18}/>,description:t('essential.desc.notifications'),title:t('essential.notifications'),search:t('essential.toasts'),body:<Row title={t('essential.toasts')} description={t('essential.notificationsHint')}><Select aria-label={t('essential.toasts')} value={settings.osToasts} onChange={event=>{const osToasts=event.target.value;if(osToasts==='urgent'||osToasts==='normal'||osToasts==='off')void setSetting({osToasts});}}>{(['urgent','normal','off']as const).map(value=><option key={value} value={value}>{t(value==='off'?'essential.none':`essential.${value}`)}</option>)}</Select></Row>},
 ];
 const matched=groups.filter(group=>matchesSettingsSearch(query,group.title+' '+group.search));
 const jump=(id:string)=>{const target=document.getElementById(`st-section-${id}`);target?.scrollIntoView({block:'start',behavior:'smooth'});target?.focus({preventScroll:true});};
 return <div className="st-page st-essential" data-testid="settings-page">
  <header className="st-hero">
   <div className="st-hero-text"><span className="st-eyebrow">{t('essential.eyebrow')}</span><h1>{t('essential.title')}</h1><p>{t('essential.lead')}</p></div>
   <div role="search" className="st-search">
    <label htmlFor="settings-search" className="sr-only">{t('essential.search')}</label>
    <div className="st-search-line"><span className="st-search-icon" aria-hidden="true"><IconSearch/></span><input id="settings-search" type="search" value={query} placeholder={t('essential.searchHint')} className="st-input" data-testid="st-search" aria-controls="settings-results" onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setQuery('');}}}/>{query&&<button type="button" className="btn btn-subtle btn-m" onClick={()=>setQuery('')}>{t('essential.clear')}</button>}</div>
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
