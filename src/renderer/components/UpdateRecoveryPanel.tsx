// A retained backup is reviewable without replacing newer work or showing unvalidated images.
import { t as auditText } from '../i18n';
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
  return <section className="imp-card" aria-label={auditText('audit.UpdateRecoveryPanel.recoveryCopyPreserved')} data-testid="update-recovery">
    <h3>{auditText('audit.UpdateRecoveryPanel.recoveryPaused')}</h3><p role="status">{problem}</p><p>{auditText('audit.UpdateRecoveryPanel.youCanKeepWorkingLocalChanges')}</p>
    {copy&&<><button type="button" className="btn btn-ghost" onClick={download}>{auditText('audit.UpdateRecoveryPanel.keepALocalCopyForRecovery')}</button><small>{auditText('audit.UpdateRecoveryPanel.itContainsYourDraftsAndPreferences')}</small></>}
    {!!drafts.length&&<details><summary>{auditText('audit.UpdateRecoveryPanel.reviewTheSavedDraftText')}{drafts.length})</summary>{drafts.map(entry=><label key={entry.id} className="field"><span>{auditText('audit.UpdateRecoveryPanel.agent')}{' '}{entry.id}</span><textarea readOnly value={entry.text} rows={4} aria-label={auditText('auditExpression.UpdateRecoveryPanel.text215', { v0: entry.id })}/></label>)}</details>}
    {!copy&&<p>{auditText('audit.UpdateRecoveryPanel.thisVersionCannotReadTheBackup')}</p>}
  </section>;
}
