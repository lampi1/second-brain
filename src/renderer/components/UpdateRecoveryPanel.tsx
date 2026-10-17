// A retained backup is reviewable without replacing newer work or showing unvalidated images.
import {updateRecovery} from '../lib/update-barrier';
export function UpdateRecoveryPanel(){
  const {problem,copy}=updateRecovery.use(value=>value);
  if(!problem)return null;
  let drafts:{id:string;text:string}[]=[];
  try{const parsed=copy?JSON.parse(copy['sb.update.chat-drafts.v1']):null;if(Array.isArray(parsed?.entries))drafts=parsed.entries.filter((entry:unknown):entry is {id:string;text:string}=>!!entry&&typeof entry==='object'&&'id'in entry&&typeof entry.id==='string'&&'text'in entry&&typeof entry.text==='string');}catch{/* Invalid backup stays untouched in main. */}
  const download=()=>{
    if(!copy)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(copy,null,2)],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download='second-brain-private-recovery.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="imp-card" aria-label="Ripristino conservato" data-testid="update-recovery">
    <h3>Ripristino sospeso</h3><p role="status">{problem}</p><p>Puoi continuare a lavorare. Le modifiche locali vengono conservate e la copia di sicurezza resta nell’area privata dell’app.</p>
    {copy&&<><button type="button" className="btn btn-ghost" onClick={download}>Conserva una copia locale per il recupero</button><small>Contiene le tue bozze e preferenze. La scelta non sostituisce il lavoro corrente.</small></>}
    {!!drafts.length&&<details><summary>Rivedi il testo delle bozze conservate ({drafts.length})</summary>{drafts.map(entry=><label key={entry.id} className="field"><span>Agente {entry.id}</span><textarea readOnly value={entry.text} rows={4} aria-label={`Bozza conservata ${entry.id}`}/></label>)}</details>}
    {!copy&&<p>Il contenuto della copia non è leggibile in questa versione. Il recupero automatico si è fermato senza cancellarla.</p>}
  </section>;
}
