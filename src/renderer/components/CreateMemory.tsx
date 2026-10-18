// Explicit local first-run creation through the main-only picker/helper. Never configures hooks, accounts or trust.
// Prefilled from the first interview's answers (initial), so name, role and language are not asked twice.
import { t as auditText } from '../i18n';
import { Select } from './Select';
import {useEffect,useRef,useState} from 'react';
import type {BrainCreationCapability,CreatedBrain} from '@shared/brain-create';
import {sb} from '../sb';
import {refreshInfo} from '../store/store';
import {toast} from '../store/ui';
import {useAgents} from '../store/agents';
import {memoryCreationMessage,validMemoryFolder} from '../lib/memory-creation';

export function CreateMemory({onBusy,initial}:{onBusy:(busy:boolean)=>void;initial?:{name:string;role:string;language:string}}){
  const {catalog}=useAgents();
  const [capability,setCapability]=useState<BrainCreationCapability|null>(null),[problem,setProblem]=useState<string|null>(null);
  const [name,setName]=useState(initial?.name.trim()??''),[role,setRole]=useState(initial?.role.trim()??''),[folderName,setFolderName]=useState(auditText('cmp.createMemory.defaultFolder')),[language,setLanguage]=useState<'it'|'en'>(/^en/i.test(initial?.language.trim()??'')?'en':'it'),[engine,setEngine]=useState('');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null),[created,setCreated]=useState<CreatedBrain|null>(null);
  const active=useRef(false),working=useRef(false),revision=useRef(0);
  const load=async()=>{
    const version=++revision.current;
    try{const value=await sb.invoke('app:brainCreation',undefined);if(active.current&&version===revision.current){setCapability(value);setProblem(null);}}
    catch{if(active.current&&version===revision.current)setProblem(auditText('cmp.createMemory.unverified'));}
  };
  useEffect(()=>{active.current=true;void load();return()=>{active.current=false;revision.current++;};},[]);
  const choices=catalog?.models.filter(choice=>choice.enabled&&choice.trusted)??[];
  const chosen=choices.find(choice=>choice.engine===engine)??choices[0];
  const create=async()=>{
    if(working.current||!capability?.available||!chosen||!name.trim()||!validMemoryFolder(folderName))return;
    working.current=true;setBusy(true);onBusy(true);setProblem(null);setNotice(null);
    try{
      const result=await sb.invoke('app:createBrain',{name:name.trim(),role:role.trim(),folderName,language,harness:chosen.engine});
      await refreshInfo();
      if(active.current){setCreated(result);setNotice(memoryCreationMessage(result));}
      else if(result)toast(memoryCreationMessage(result)+' '+result.root,result.connected?'ok':'info');
    }catch(error){
      const detail=error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''):String(error);
      if(active.current)setProblem(detail||auditText('cmp.createMemory.failed'));
      else toast(auditText('cmp.createMemory.failedDetail', { detail }),'err');
    }finally{working.current=false;if(active.current)setBusy(false);onBusy(false);}
  };
  return <details className="create-memory" data-testid="create-memory" data-capability={capability ? capability.available ? 'available' : 'unavailable' : 'loading'}><summary>{auditText('audit.CreateMemory.createANewPersonalMemory')}</summary>
    <p>{auditText('audit.CreateMemory.aNewLocalFolderForYour')}</p>
    {!capability?.available&&<p role="status">{capability?.reason||auditText('cmp.createMemory.checking')}</p>}
    {problem&&<p role="alert">{problem} <button type="button" className="link-btn" onClick={()=>void load()}>{auditText('audit.CreateMemory.checkAvailabilityAgain')}</button></p>}
    {capability?.available&&<fieldset disabled={busy}>
      <label className="field"><span>{auditText('audit.CreateMemory.yourName')}</span><input value={name} maxLength={80} onChange={event=>setName(event.target.value)} data-testid="create-memory-name"/></label>
      <label className="field"><span>{auditText('audit.CreateMemory.yourRoleOptional')}</span><input value={role} maxLength={240} onChange={event=>setRole(event.target.value)}/></label>
      <label className="field"><span>{auditText('audit.CreateMemory.newFolderName')}</span><input value={folderName} maxLength={64} onChange={event=>setFolderName(event.target.value)} aria-invalid={!validMemoryFolder(folderName)} data-testid="create-memory-folder"/><small>{auditText('audit.CreateMemory.aSimpleNameWithoutAPath')}</small></label>
      <label className="field"><span>{auditText('audit.CreateMemory.memoryLanguage')}</span><Select value={language} onChange={event=>setLanguage(event.target.value==='en'?'en':'it')}><option value="it">Italiano</option><option value="en">English</option></Select></label>
      <label className="field"><span>{auditText('audit.CreateMemory.initialEngine')}</span><Select value={chosen?.engine??''} onChange={event=>setEngine(event.target.value)}>{choices.map(choice=><option key={choice.engine} value={choice.engine}>{choice.label}</option>)}</Select><small>{auditText('audit.CreateMemory.noAccountsAreConnectedAndNo')}</small></label>
      {!chosen&&<p role="status">{auditText('audit.CreateMemory.chooseAnAvailableEngineInSettings')}</p>}
      <button type="button" className="btn btn-ghost" disabled={!name.trim()||!validMemoryFolder(folderName)||!chosen||busy} onClick={()=>void create()} data-testid="create-memory-start">{busy?auditText('auditExpression.CreateMemory.text32'):auditText('auditExpression.CreateMemory.text33')}</button>
    </fieldset>}
    {notice&&<p role="status">{notice}</p>}{created&&<p>{auditText('audit.CreateMemory.path')}{' '}<code>{created.root}</code></p>}
  </details>;
}
