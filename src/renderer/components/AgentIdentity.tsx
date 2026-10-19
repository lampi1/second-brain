// Progressive agent details. The real profile name/avatar live in the compact header, never duplicated as a role label.
// Work declarations prevent automatic close; provider observations and user-confirmed success remain separate facts.
import { Select } from './Select';
import type{ChatSummary}from'@shared/contract';
import {useCallback,useRef,useState}from'react';
import{setChat}from'../store/store';
import{go}from'../actions';
import{t,locale}from'../i18n';
import {Popover}from'./ui';
import'../styles/agent-identity.css';
export function AgentIdentity({chat}:{chat:ChatSummary}){
 const anchor=useRef<HTMLButtonElement>(null),[open,setOpen]=useState(false);
 const close=useCallback(()=>{setOpen(false);anchor.current?.focus();},[]);
 const children=chat.agentChildren;
 const summary=!children||children.coverage==='unknown'?t('product.teamUnknown'):children.coverage==='complete'&&children.active!==null&&children.total!==null?t('product.teamComplete',{active:children.active,total:children.total}):t('product.teamPartial',{active:children.observedActive,total:children.observedTotal});
 return <div className="agent-identity agent-team-details" data-testid={`agent-identity-${chat.id}`}>
  <button ref={anchor} type="button" className="link-btn" aria-expanded={open} onClick={()=>setOpen(v=>!v)} data-testid={`agent-team-${chat.id}`}>{t('product.details')}{children?.observedActive?` · ${children.observedActive}`:''}</button>
  <Popover anchor={anchor} open={open} onClose={close} width={340} kind="dialog" label={t('product.details')}>
  <div className="agent-detail-content">
   {chat.agent?.purpose&&<p>{chat.agent.purpose}</p>}
   <button type="button" className="link-btn" onClick={()=>go({page:'agenti'})}>{t('product.profiles')}</button>
   <label>{t('product.workDeclare')}<Select value={chat.work?.status??''} onChange={e=>{const status=e.target.value;if(status==='assigned'||status==='waiting-mail'||status==='completed')void setChat(chat.id,{workStatus:status});}}>
    <option value="" disabled>{t('product.workUnset')}</option><option value="assigned">{t('product.workAssigned')}</option><option value="waiting-mail">{t('product.workWaiting')}</option><option value="completed">{t('product.workCompleted')}</option>
   </Select></label>
   <p>{t('product.model')}: {chat.model||t('product.notReported')}</p>
   <b>{summary}</b><p>{t('product.teamExplain')}</p>
   {children?.observedAt?<small>{new Intl.DateTimeFormat(locale(),{timeStyle:'short'}).format(children.observedAt)}</small>:null}
   {children?.children.length?<ul>{children.children.slice(0,100).map(child=><li key={child.key}><b>{child.task||t('product.noTask')}</b> · {t(`product.${child.state}`)}<small>{t('product.parent')}: {child.parentNativeId===null?t('product.notReported'):children.children.find(candidate=>candidate.nativeId===child.parentNativeId)?.task||t('product.parentMissing')}{child.source==='replay'?` · ${t('product.replayed')}`:''}</small></li>)}</ul>:<p>{children?.coverage==='complete'?t('product.teamEmpty'):t('product.teamIncomplete')}</p>}
  </div>
  </Popover>
 </div>;
}
