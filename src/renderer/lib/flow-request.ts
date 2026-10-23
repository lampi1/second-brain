// Scoped, question-first requests for the existing Orchestrator. The catalog never starts runs or invents company workflows.
export type FlowRequestKind = 'create' | 'refine' | 'start';
export function flowRequest(kind: FlowRequestKind, flow?: { id: string; name: string; version?: number }): string {
  const target = flow ? `Flusso ${JSON.stringify(flow.name)} (id ${JSON.stringify(flow.id)}${flow.version ? `, versione ${flow.version}` : ''}).` : '';
  const action = kind === 'create' ? 'Voglio definire insieme un flusso riutilizzabile per il mio lavoro.'
    : kind === 'refine' ? 'Voglio rivedere insieme questa definizione, senza modificare la versione approvata.'
    : 'Vorrei avviare questo flusso. Prima verifica che sia adatto al mio caso e chiarisci ciò che manca.';
  return [action, target,
    'Leggi prima il mio brain e i riferimenti pertinenti. Non inventare processi aziendali, configurazioni, script o flussi di esempio.',
    'Guidami con lo strumento nativo delle domande, una decisione essenziale alla volta: Sì, No e risposta libera Altro. Chiarisci ambito, trigger, condizioni di uscita, passaggi, script già esistenti e riferimenti mancanti. Testi brevi; dettagli e report consultabili.',
    kind === 'start' ? 'Avvia solo tu tramite il motore dei flussi, dopo aver raccolto input e consenso necessari. Mantieni visibili i blocchi e le evidenze mancanti.' : 'Presenta la definizione completa come bozza nel motore dei flussi. L’attivazione della versione esatta richiede la mia approvazione nella finestra Domande. Non avviare esecuzioni.',
    'Nessuna operazione di produzione. Usa solo adattatori esplicitamente disponibili; dichiarane i limiti.'
  ].filter(Boolean).join('\n\n');
}
