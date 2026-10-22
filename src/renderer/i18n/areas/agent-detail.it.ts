// A role's own page (components/AgentStudio.tsx) and the browser marker of a strip (ChatTile.tsx), in
// Italian. English counterpart in agent-detail.en.ts (ADR 0057).
export const agentDetailIt = {
  'agentDetail.back': 'Tutti i ruoli',
  'agentDetail.prompt': 'Istruzioni del ruolo',
  'agentDetail.promptHint': 'Ciò che il motore riceve a ogni avvio di questo ruolo, dopo le regole comuni a tutti i ruoli.',
  'agentDetail.promptEmpty': 'Nessuna istruzione scritta per questo ruolo.',
  'agentDetail.promptSize': ({ n }: { n: number }) => n === 1 ? '1 carattere' : `${n} caratteri`,
  'agentDetail.config': 'Configurazione',
  'agentDetail.results': 'Risultati osservati',
  'agentDetail.tools': 'Strumenti',
  'agentDetail.toolsNone': 'Nessuno',
  
  'agentDetail.version': 'Versione',
  'agentDetail.updated': 'Ultima modifica',
  'agentDetail.closeEditor': 'Chiudi senza salvare',
  'agentDetail.browserOn': ({ n }: { n: number }) => n === 1 ? 'Nascondi il browser' : `Nascondi i ${n} browser`,
  'agentDetail.browserOff': ({ n }: { n: number }) => n === 1 ? 'Mostra il browser agganciato' : `Mostra i ${n} browser agganciati`,
};
