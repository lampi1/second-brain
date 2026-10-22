// Request-local postponement: Esc parks only the chosen request; new requests remain eligible for popups.
// Pending data stays in the normal store. Opening the queue makes postponed requests visible again.
// Used by QuestionsWindow, the global layer, and request navigation. The former persisted global quiet flag is retired.
// A Strategist's plan to approve (lib/plan-ask.ts) is postponed the same way, by its key.
import { sb } from '../sb';
import { app } from '../store/store';
import { planAskKeys } from './plan-ask';
import { callQuestions, closeModal, parkQuestions, setLater, ui } from '../store/ui';

const postponed = new Set<string>();
const keyOf = (r: {chatId:string;id:string}) => `${r.chatId}/${r.id}`;
export const requestPostponed = (key:string):boolean => postponed.has(key);
const notify = () => {
  setLater(postponed.size > 0);
  // The queue subscribes to qwin; changing the set must update it even if another request was already postponed.
  ui.set(s => ({...s,qwin:{...s.qwin}}));
};
export function resumeQuestions():void {
  postponed.clear();
  notify();
}

/** Remove the old restart-wide silence; retain only still-open postponed request keys during this session. */
export function startLater():void {
  void sb.invoke('later:set',{on:false}).catch(()=>{});
  app.subscribe(()=>{
    const s=app.get();
    const keys=new Set([...s.pending.map(keyOf),...planAskKeys(s)]);
    let changed=false;
    for(const key of postponed)if(!keys.has(key)){postponed.delete(key);changed=true;}
    if(changed)notify();
  });
}

/** Park one unresolved request, never future requests or the other cards in the queue. */
export function answerLater(key?:string):void {
  const focused=typeof document==='undefined'?null:(document.activeElement as Element|null)?.closest('[data-request-key]')?.getAttribute('data-request-key');
  const pending=app.get().pending;
  const shown=typeof document==='undefined'||!ui.get().qwin.shown?null:document.querySelector('.qwin [data-request-key]')?.getAttribute('data-request-key');
  const chosen=key??shown??focused;
  const target=chosen??pending.find(r=>!postponed.has(keyOf(r)));
  const targetKey=typeof target==='string'?target:target?keyOf(target):null;
  if(targetKey&&(pending.some(r=>keyOf(r)===targetKey)||planAskKeys(app.get()).includes(targetKey)))postponed.add(targetKey);
  parkQuestions();
  notify();
}

/** Explicit navigation opens the actual request above any other dialog, without answering it. */
export function openQueue(key:string|null):void {
  resumeQuestions();
  closeModal();
  void sb.invoke('overlay:focus',{target:'app'}).catch(()=>{});
  callQuestions(key);
}
