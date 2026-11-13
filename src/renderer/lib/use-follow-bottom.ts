// React lifecycle only; DOM observation and intent handling are independently testable.
import {useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {observeFollowBottom} from './observe-follow-bottom';
export function useFollowBottom(viewport:RefObject<HTMLDivElement|null>,content:RefObject<HTMLDivElement|null>,chatId:string|null,signature:string){
  const control=useRef<ReturnType<typeof observeFollowBottom>|null>(null);
  const [state,setState]=useState({following:true,unseen:false});
  useLayoutEffect(()=>{
    const el=viewport.current,body=content.current;if(!el||!body)return;
    const observed=observeFollowBottom(el,body,chatId,signature,next=>setState(old=>old.following===next.following&&old.unseen===next.unseen?old:{following:next.following,unseen:next.unseen}));
    control.current=observed;
    return()=>{observed.dispose();control.current=null;};
  },[chatId]);
  useLayoutEffect(()=>{control.current?.follower.contentChanged(signature);},[signature]);
  return {...state,jump:()=>control.current?.follower.jump()};
}
