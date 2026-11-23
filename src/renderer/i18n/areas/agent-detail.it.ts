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
  'agentDetail.presets.saved': ({ preset }: { preset: string }) => `${preset} salvato.`,
  'agentDetail.presets.undo': 'Annulla',
  'agentDetail.results': 'Risultati osservati',
  'agentDetail.tools': 'Strumenti',
  'agentDetail.toolsNone': 'Nessuno',
  
  'agentDetail.version': 'Versione',
  'agentDetail.updated': 'Ultima modifica',
  'agentDetail.closeEditor': 'Chiudi senza salvare',
};
