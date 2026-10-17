// One main-owned controller factory used by live and isolated demo services; native review alone confirms memory.
import path from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import type { LanguageMode } from '../../shared/contract';
import { systemLang } from '../lang';
import { SectionController } from './controller';
export function createDataSections(userData: string, window: () => BrowserWindow | null, language: () => LanguageMode) {
  return new SectionController(path.join(userData, 'data-sections'), async (text, kind) => {
    const win = window();
    if (!win || win.isDestroyed()) return false;
    const en = language() === 'en' || (language() !== 'it' && systemLang() === 'en');
    const response = await dialog.showMessageBox(win, {
      type: 'question', title: en ? 'Review personal context' : 'Rivedi il contesto personale',
      message: kind === 'source' ? (en ? 'Prepare this exact context in the Regia draft? Nothing will be sent automatically.' : 'Prepari questo contesto nella bozza della Regia? Nulla verrà inviato automaticamente.') : (en ? 'Save these details as shared AI context? An empty list clears the memory.' : 'Salvi questi dati come contesto condiviso delle IA? Una lista vuota cancella la memoria.'),
      detail: text, buttons: en ? ['Cancel', 'Confirm'] : ['Annulla', 'Conferma'], defaultId: 0, cancelId: 0, noLink: true,
    });
    return response.response === 1;
  });
}
