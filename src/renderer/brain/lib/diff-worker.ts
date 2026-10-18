// jsdiff off the page's thread for the viewer's Compare (FileDiff.tsx): the synchronous diff with a time limit, which
// is fast (jsdiff's async mode waits a timer tick per changed line, so a few hundred lines would hit the limit).
import {structuredPatch} from 'diff';
export interface DiffJob {left:{label:string;text:string};right:{label:string;text:string};timeout:number}
const scope=self as unknown as {onmessage:((e:MessageEvent<DiffJob>)=>void)|null;postMessage:(value:unknown)=>void};
scope.onmessage=({data})=>{
  // undefined (posted as null) = over the time limit
  scope.postMessage(structuredPatch(data.left.label,data.right.label,data.left.text,data.right.text,'','',{context:3,stripTrailingCr:true,timeout:data.timeout})??null);
};
