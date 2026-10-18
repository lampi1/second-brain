// Isolated app proposals with an explicit publication action. Never invokes the legacy promote/update path.
import { t as auditText } from '../i18n';
import {useEffect,useRef,useState} from 'react';
import type {AppProposal,ProposalAvailability} from '@shared/improve-proposals';
import {sb} from '../sb';
import {useImprove} from '../store/improve';
import {UpdatePanel} from './UpdatePanel';
import {UpdateRecoveryPanel} from './UpdateRecoveryPanel';
import {ProposalPanel} from './ProposalPanel';
import {proposalBlocks} from '../lib/proposal-availability';
import '../styles/improve.css';
import '../styles/proposals.css';

export function ImprovePage(){
  const current=useImprove(value=>value);
  const [proposals,setProposals]=useState<AppProposal[]>([]),[availability,setAvailability]=useState<ProposalAvailability|null>(null),[error,setError]=useState<string|null>(null);
  const sequence=useRef(0),capSequence=useRef(0),alive=useRef(false);
  const load=async()=>{
    const revision=++sequence.current;
    const capRevision=++capSequence.current;
    try{
      const capability=await sb.invoke('improve:proposalAvailability',undefined);
      if(alive.current&&capRevision===capSequence.current)setAvailability(capability);
      const rows=await sb.invoke('improve:proposals',undefined);
      if(alive.current&&revision===sequence.current){setProposals(rows);setError(null);}
    }catch{if(alive.current&&capRevision===capSequence.current)setError(auditText('cmp.improve.unavailable'));}
  };
  useEffect(()=>{
    alive.current=true;
    const off=sb.on('improve:proposals',rows=>{sequence.current++;setProposals(rows);});
    void load();return()=>{alive.current=false;sequence.current++;capSequence.current++;off();};
  },[]);
  return <div className="imp proposal-page" data-testid="improve">
    <section className="imp-card"><header className="imp-card-head"><h2>{auditText('audit.ImprovePage.improveYourApp')}</h2></header><p>{auditText('audit.ImprovePage.requestAChangeTryItAnd')}</p><small>{auditText('audit.ImprovePage.currentVersion')}{' '}{current?.running==='dev'?auditText('auditExpression.ImprovePage.text65'):current?.runningAt?new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short'}).format(current.runningAt):auditText('auditExpression.ImprovePage.text66')}</small></section>
    <UpdateRecoveryPanel/>
    {error&&<p role="alert">{error} <button type="button" className="link-btn" onClick={()=>void load()}>{auditText('audit.ImprovePage.retry')}</button></p>}
    <ProposalPanel proposals={proposals} {...proposalBlocks(availability)}
      onCreate={async()=>{await sb.invoke('improve:proposalCreate',undefined);await load();}}
      onRefresh={async id=>{await sb.invoke('improve:proposalRefresh',{id});await load();}}
      onResume={async id=>{await sb.invoke('improve:proposalResume',{id});await load();}}
      onPublish={async request=>{await sb.invoke('improve:proposalPublish',request);await load();}}/>
    <UpdatePanel/>
  </div>;
}
