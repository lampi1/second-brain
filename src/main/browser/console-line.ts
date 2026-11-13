// Redact console output at the final tool boundary too, including legacy captured script/frame URLs.
// Pure formatter used by BrowserActions.console; it does not write logs or inspect live pages.
import { redact } from '../log';
export function consoleLine(entry:{level:string;text:string;source?:string;frame?:string}):string {
  const source=redact(entry.source ?? '').slice(0,160);
  return redact(`[${entry.level}] ${entry.text}${source && source !== ':' ? ` (${source})` : ''}${entry.frame ? ` [iframe ${entry.frame}]` : ''}`);
}
