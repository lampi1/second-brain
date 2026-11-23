// A role's own page (components/AgentStudio.tsx) and the browser marker of a strip (ChatTile.tsx), in
// Italian. English counterpart in agent-detail.en.ts (ADR 0057).
export const agentDetailIt = {
  'agentDetail.back': 'Tutti i ruoli',
  'agentDetail.prompt': 'Istruzioni del ruolo',
  'agentDetail.promptHint': 'Ciò che il motore riceve a ogni avvio di questo ruolo, dopo le regole comuni a tutti i ruoli.',
  'agentDetail.promptEmpty': 'Nessuna istruzione scritta per questo ruolo.',
  'agentDetail.promptSize': ({ n }: { n: number }) => n === 1 ? '1 carattere' : `${n} caratteri`,
  'agentDetail.config': 'Configurazione',
  'agentDetail.presets.hint': 'Chi delega sceglie Minimo, Base o Massimo per il compito; senza scelta, Base. Base è il modello e l’effort del ruolo; Minimo e Massimo vuoti = come Base.',
  'agentDetail.presets.baseOnly': 'L’Orchestrator non riceve deleghe: solo Base, il suo modello e il suo effort.',
  'agentDetail.codeMode': 'Code Mode',
  'agentDetail.codeMode.hint': 'Le nuove chat di questo ruolo lavorano con uno script: più letture, ricerche e tool in una sola chiamata (run_code), in un sandbox. Ogni chiamata passa dalle stesse regole dei permessi; un’azione da Esegui ferma lo script e ti lascia il solito bottone.',
  'agentDetail.codeMode.partial': 'Su questo motore è parziale: il ruolo riceve l’indicazione di usare run_code e l’app rifiuta i tool nativi che approva lei; i tool che il motore approva da sé restano.',
  'agentDetail.fast': 'Fast',
  'agentDetail.fast.hint': 'Le nuove chat Cursor di questo ruolo partono in modalità veloce del modello.',
  'agentDetail.presets.saved': ({ preset }: { preset: string }) => `${preset} salvato.`,
  'agentDetail.presets.undo': 'Annulla',
  'agentDetail.results': 'Risultati osservati',
  'agentDetail.tools': 'Strumenti',
  'agentDetail.toolsNone': 'Nessuno',
  
  'agentDetail.version': 'Versione',
  'agentDetail.updated': 'Ultima modifica',
  'agentDetail.closeEditor': 'Chiudi senza salvare',
};
