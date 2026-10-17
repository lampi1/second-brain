// State consumer for the single main pipeline. Ready packages still require main's explicit application capability.
import {useEffect,useRef,useState} from 'react';
import type {AppUpdateState} from '@shared/app-update';
import {sb} from '../sb';
import {blockedUpdate,connectUpdateView} from '../lib/update-view';
import {PreparedUpdateCard} from './PreparedUpdateCard';
export function UpdatePanel(){
  const [state,setState]=useState<AppUpdateState|null>(null),[problem,setProblem]=useState<string|null>(null);
  const bridge=useRef<ReturnType<typeof connectUpdateView>|null>(null);
  useEffect(()=>{
    const connection=connectUpdateView({get:()=>sb.invoke('update:get',undefined),listen:accept=>sb.on('update:state',accept)},state=>{setState(state);setProblem(null);},()=>setProblem('Stato degli aggiornamenti non verificabile. L’applicazione resta disabilitata.'));
    bridge.current=connection;return()=>{connection.dispose();bridge.current=null;};
  },[]);
  const update=state?blockedUpdate(state,problem):null;
  return <section aria-label="Aggiornamenti" data-testid="app-updates">
    {update?<PreparedUpdateCard update={update} apply={async id=>{const current=bridge.current;if(!current)throw Error('Update view disconnected');await current.perform(()=>sb.invoke('update:apply',{id}));}}/>:<div className="imp-card"><h3>Aggiornamenti</h3><p role="status">{problem??(!state?'Verifica dello stato…':state.checking?'Preparazione e verifiche in background…':state.reason??(state.available?'Nessun aggiornamento preparato.':'Aggiornamenti non disponibili in questa installazione.'))}</p></div>}
    {problem&&<button type="button" className="btn btn-ghost" onClick={()=>void bridge.current?.refresh()}>Rileggi lo stato degli aggiornamenti</button>}
  </section>;
}
