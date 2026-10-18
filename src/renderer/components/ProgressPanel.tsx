// Optional local milestones. Only a deliberate user confirmation can award a useful result.
import { Select } from './Select';
import {useEffect,useRef,useState} from 'react';
import type {ProgressState} from '@shared/progress';
import type {ChatSummary} from '@shared/contract';
import {connectProgress,MILESTONE_LABELS} from '../lib/progress-bridge';
import {sb} from '../sb';
import {useApp} from '../store/store';
import {focusChat} from '../actions';
import '../styles/progress.css';
export function ProgressPanel(){
  const [state,setState]=useState<ProgressState|null>(null),[problem,setProblem]=useState(''),[notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false),[selected,setSelected]=useState('');
  const bridge=useRef<ReturnType<typeof connectProgress>|null>(null),working=useRef(false),live=useRef(false);
  const candidates=useApp(s=>s.order.map(id=>s.chats[id]).filter((chat):chat is ChatSummary=>!!chat&&chat.state==='idle'&&!chat.lastError&&!!chat.lastText.trim()&&!!chat.lastResult&&!chat.lastResult.isError&&!chat.lastResult.interrupted&&!s.pending.some(request=>request.chatId===chat.id)&&!s.queued[chat.id]?.length));
  useEffect(()=>{
    live.current=true;
    const connection=connectProgress({get:()=>sb.invoke('progress:get',undefined),listen:accept=>sb.on('progress:changed',accept)},(next,earned)=>{
      setState(next);if(earned.length)setNotice(earned.map(id=>MILESTONE_LABELS[id]).join(' · '));
    },()=>setProblem('Traguardi non disponibili. Il lavoro può continuare.'));
    bridge.current=connection;
    return()=>{live.current=false;connection.dispose();bridge.current=null;};
  },[]);
  const run=async(action:()=>Promise<ProgressState>)=>{
    if(working.current||state?.available!==true)return;
    working.current=true;setBusy(true);setProblem('');
    try{await bridge.current?.perform(action);}
    catch{if(live.current)setProblem('Operazione non completata. Nessun risultato viene confermato automaticamente.');}
    finally{working.current=false;if(live.current)setBusy(false);}
  };
  if(!state)return problem?<p role="status">{problem}</p>:null;
  const earned=new Set(state.earned.map(entry=>entry.id));
  if(state.hidden)return <div><button type="button" className="link-btn" disabled={!state.available||busy} onClick={()=>void run(()=>sb.invoke('progress:setHidden',{hidden:false}))}>Mostra i traguardi personali</button>{problem&&<p role="alert">{problem}</p>}</div>;
  const candidate=candidates.find(chat=>chat.id===selected)??candidates[0];
  return <section className="progress-panel" aria-label="Traguardi personali" data-testid="personal-progress">
    <header><b>Il tuo spazio prende forma</b><span>{earned.size} di 3 traguardi</span><button type="button" className="link-btn" disabled={!state.available||busy} onClick={()=>void run(()=>sb.invoke('progress:setHidden',{hidden:true}))}>Nascondi</button></header>
    <ul>{Object.entries(MILESTONE_LABELS).map(([id,label])=><li key={id}><span aria-hidden="true">{earned.has(id as keyof typeof MILESTONE_LABELS)?'✓':'○'}</span> {label}<span className="sr-only">: {earned.has(id as keyof typeof MILESTONE_LABELS)?'raggiunto':'da raggiungere'}</span></li>)}</ul>
    {!state.available&&<p role="status">{state.reason||state.problem||'Traguardi in sola lettura.'}</p>}
    {!earned.has('first-result')&&state.available&&candidate&&<div className="progress-result"><label>Un risultato da rivedere <Select value={candidate.id} disabled={busy} onChange={event=>setSelected(event.target.value)}>{candidates.map(chat=><option key={chat.id} value={chat.id}>{chat.title}</option>)}</Select></label><button type="button" className="link-btn" onClick={()=>focusChat(candidate.id)}>Apri il risultato</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>void run(()=>sb.invoke('progress:confirmResult',{chatId:candidate.id,resultAt:candidate.lastResult!.at}))}>Confermo: ho ottenuto un risultato utile</button></div>}
    <p role="status">{notice}</p>{problem&&<p role="alert">{problem}</p>}
  </section>;
}
