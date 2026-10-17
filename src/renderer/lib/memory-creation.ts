// User-facing validation/status only; main owns the destination picker, template verification and no-overwrite write.
import type {CreatedBrain} from '@shared/brain-create';
export function validMemoryFolder(name:string):boolean {
  return /^[\p{L}\p{N} ._-]{1,64}$/u.test(name)&&!/[. ]$/.test(name)&&!/^\.{1,2}$/.test(name)&&!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name);
}
export function memoryCreationMessage(result:CreatedBrain|null):string{
  return result===null?'Creazione annullata. Nessuna cartella è stata creata o collegata.':result.connected?'Memoria creata e collegata.':'Cartella creata e conservata. La memoria scelta nel frattempo resta collegata.';
}
