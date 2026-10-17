// Transcript previews reuse the main-authorized question image loader; no local/file URL enters the DOM.
import {useMemo} from 'react';
import {useApp} from '../store/store';
import {localMessageImages} from '../lib/message-images';
import {AskImages} from './AskImages';
export function MessageImages({chatId,text,id,streaming}:{chatId:string|null;text:string;id:string;streaming?:boolean}){
  const cwd=useApp(state=>chatId?state.chats[chatId]?.cwd:undefined);
  const images=useMemo(()=>streaming?[]:localMessageImages(text,cwd),[text,cwd,streaming]);
  return <AskImages images={images} testBase={'message-'+id}/>;
}
