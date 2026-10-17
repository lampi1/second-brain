// Native DOM observation and user-intent scope, shared by chat/Regia through the hook.
import {createFollowBottom,rememberFollowState,savedFollowState,type FollowState} from './follow-bottom';
export function observeFollowBottom(el:HTMLDivElement,body:HTMLDivElement,chatId:string|null,signature:string,onChange:(state:FollowState)=>void){
    const follower=createFollowBottom({read:()=>({top:el.scrollTop,height:el.scrollHeight,viewport:el.clientHeight}),write:top=>{el.scrollTop=top;},frame:run=>window.requestAnimationFrame(run),cancel:id=>window.cancelAnimationFrame(id),changed:onChange},signature,savedFollowState(chatId));
    let pointer=false,until=0;
    const intent=()=>{until=performance.now()+400;};
    const wheel=(event:WheelEvent)=>{intent();if(event.deltaY<0)follower.leave();};
    const down=()=>{pointer=true;intent();};const up=()=>{if(!pointer)return;pointer=false;intent();};
    const key=(event:KeyboardEvent)=>{
      if((event.target as Element|null)?.closest('input,textarea,[contenteditable="true"],[role="textbox"]'))return;
      if(['ArrowUp','PageUp','Home','ArrowDown','PageDown','End',' '].includes(event.key)){intent();if(['ArrowUp','PageUp','Home'].includes(event.key)||event.key===' '&&event.shiftKey)follower.leave();}
    };
    const scroll=()=>follower.scrolled(pointer||performance.now()<until);
    const resize=new ResizeObserver(()=>follower.resized());resize.observe(el);resize.observe(body);
    const mutations=new MutationObserver(()=>follower.resized());mutations.observe(body,{childList:true,subtree:true,characterData:true,attributes:true});
    el.addEventListener('scroll',scroll,{passive:true});el.addEventListener('wheel',wheel,{passive:true});el.addEventListener('pointerdown',down,{passive:true});el.addEventListener('keydown',key);
    window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
    return {follower,dispose:()=>{
      rememberFollowState(chatId,follower.snapshot());follower.dispose();resize.disconnect();mutations.disconnect();
      el.removeEventListener('scroll',scroll);el.removeEventListener('wheel',wheel);el.removeEventListener('pointerdown',down);el.removeEventListener('keydown',key);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);
    }};
}
