// A role's own page (components/AgentStudio.tsx) and the browser marker of a strip (ChatTile.tsx), in
// Italian. English counterpart in agent-detail.en.ts (ADR 0057).
export const agentDetailIt = {
  'agentDetail.prompt': 'Istruzioni del ruolo',
  'agentDetail.promptEmpty': 'Nessuna istruzione scritta per questo ruolo.',
  'agentDetail.promptSize': ({ n }: { n: number }) => n === 1 ? '1 carattere' : `${n} caratteri`,
  'agentDetail.codeMode': 'Code Mode',
  'agentDetail.codeMode.hint': 'Le nuove chat di questo ruolo lavorano con uno script: più letture, ricerche e tool in una sola chiamata (run_code), in un sandbox. Ogni chiamata passa dalle stesse regole dei permessi; un’azione da Esegui ferma lo script e ti lascia il solito bottone.',
  'agentDetail.codeMode.partial': 'Su questo motore è parziale: il ruolo riceve l’indicazione di usare run_code e l’app rifiuta i tool nativi che approva lei; i tool che il motore approva da sé restano.',
  'agentDetail.fast': 'Fast',
  'agentDetail.fast.hint': 'Le nuove chat Cursor di questo ruolo partono in modalità veloce del modello.',
  'agentDetail.presets.saved': ({ preset }: { preset: string }) => `${preset} salvato.`,
  'agentDetail.presets.undo': 'Annulla',
  
};
