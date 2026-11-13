// Caller JavaScript requires a literal loopback address or the exact localhost name.
// Broader project host aliases remain usable by standard browser tools, never by this admission guard.
export function localScriptOrigin(value:string):boolean{
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);}
  catch{return false;}
}
