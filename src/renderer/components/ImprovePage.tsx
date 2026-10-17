// Isolated app proposals with an explicit publication action. Never invokes the legacy promote/update path.
import {useEffect,useRef,useState} from 'react';
import type {AppProposal,ProposalAvailability} from '@shared/improve-proposals';
import {sb} from '../sb';
import {useApp} from '../store/store';
import {sameList} from '../store/state';
import {improveUi,showAppChat,useImprove} from '../store/improve';
import {UpdatePanel} from './UpdatePanel';
import {UpdateRecoveryPanel} from './UpdateRecoveryPanel';
import {ProposalPanel} from './ProposalPanel';
import {proposalBlocks} from '../lib/proposal-availability';
import {ChatTile} from './ChatTile';
import '../styles/improve.css';
import '../styles/proposals.css';

export function ImprovePage(){
  const current=useImprove(value=>value),selected=improveUi.use(value=>value.selected);
  const ids=useApp(state=>state.order.filter(id=>state.chats[id]?.space==='app'&&!state.chats[id]?.closedAt),sameList);
  const selectedOk=useApp(state=>!!selected&&!!state.chats[selected]&&!state.chats[selected]?.closedAt);
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
    }catch{if(alive.current&&capRevision===capSequence.current)setError('Le modifiche non sono disponibili. Puoi riprovare senza perdere il lavoro locale.');}
  };
  useEffect(()=>{
    alive.current=true;
    const off=sb.on('improve:proposals',rows=>{sequence.current++;setProposals(rows);});
    void load();return()=>{alive.current=false;sequence.current++;capSequence.current++;off();};
  },[]);
  return <div className="imp proposal-page" data-testid="improve">
    <section className="imp-card"><header className="imp-card-head"><h2>Migliora la tua app</h2></header><p>Chiedi una modifica, provala e rivedi le verifiche. Solo il pulsante PR condivide i file sul repository.</p><small>Versione in uso: {current?.running==='dev'?'sviluppo':current?.runningAt?new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short'}).format(current.runningAt):'dato non disponibile'}</small></section>
    <UpdateRecoveryPanel/>
    {error&&<p role="alert">{error} <button type="button" className="link-btn" onClick={()=>void load()}>Riprova</button></p>}
    <ProposalPanel proposals={proposals} {...proposalBlocks(availability)}
      onCreate={async()=>{await sb.invoke('improve:proposalCreate',undefined);await load();}}
      onRefresh={async id=>{await sb.invoke('improve:proposalRefresh',{id});await load();}}
      onResume={async id=>{await sb.invoke('improve:proposalResume',{id});await load();}}
      onPublish={async request=>{await sb.invoke('improve:proposalPublish',request);await load();}}/>
    <section className="imp-card" aria-label="Agenti delle modifiche"><h3>Agenti delle modifiche</h3>{ids.length?<ul className="imp-chats">{ids.map(id=><AppAgent key={id} id={id} selected={id===selected}/>)}</ul>:<p>Prepara una modifica per aprire il suo agente nello spazio separato.</p>}</section>
    {selected&&selectedOk&&<div className="imp-open" data-testid="improve-open-chat"><ChatTile chatId={selected}/></div>}
    <UpdatePanel/>
  </div>;
}
function AppAgent({id,selected}:{id:string;selected:boolean}){
  const chat=useApp(state=>state.chats[id]);if(!chat)return null;
  return <li><button type="button" className={`imp-chat${selected?' on':''}`} aria-pressed={selected} onClick={()=>showAppChat(selected?null:id)}>{chat.title}</button></li>;
}
