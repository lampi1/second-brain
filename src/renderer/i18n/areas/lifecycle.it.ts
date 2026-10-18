// Agent lifecycle panel (approval queue, version evaluations, Orchestrator feedback): Italian labels, used by
// components/AgentLifecyclePanel.tsx through t(). English counterpart in lifecycle.en.ts (ADR 0057).
export const lifecycleIt={
 'lifecycle.kind.update':'Aggiornamento','lifecycle.kind.create':'Nuovo agente','lifecycle.kind.merge':'Unione di ruoli','lifecycle.kind.model-trial':'Prova di modello',
 'lifecycle.kind.split':'Separazione di un ruolo','lifecycle.kind.keep':'Mantieni versione','lifecycle.kind.revert':'Ripristina versione','lifecycle.kind.retire':'Ritira Agente',
 'lifecycle.metricMissing':'Dato non disponibile','lifecycle.coverageMissing':'non disponibile',
 'lifecycle.metric':(p:{value:string;n:number;coverage:string})=>`${p.value} · n=${p.n} · copertura ${p.coverage}`,
 'lifecycle.compare':'Confronto delle esecuzioni','lifecycle.metricCol':'Metrica','lifecycle.baseline':'Riferimento','lifecycle.evaluated':'Gruppo valutato',
 'lifecycle.success':'Successo','lifecycle.corrections':'Correzioni per esecuzione','lifecycle.cost':'Costo mediano ($)','lifecycle.time':'Tempo mediano (ms)','lifecycle.questions':'Domande per esecuzione',
 'lifecycle.aria':'Ciclo degli agenti','lifecycle.title':'Da approvare',
 'lifecycle.intro':'Le proposte non modificano gli agenti. Esamina i dati e apri l’editor per preparare una modifica.',
 'lifecycle.empty':'Nessuna proposta in attesa.','lifecycle.agents':(p:{ids:string})=>`Agenti: ${p.ids}`,
 'lifecycle.evidence':(p:{n:number})=>`Evidenze (${p.n})`,'lifecycle.evidenceNone':'Confronto calcolato sulle definizioni o sulle metriche riportate.',
 'lifecycle.review':'Esamina proposta','lifecycle.evaluations':'Valutazioni delle versioni',
 'lifecycle.cohorts':(p:{comparable:number;other:number;unknown:number})=>`Richieste comparabili: ${p.comparable} · altre: ${p.other} · classificazione sconosciuta: ${p.unknown}`,
 'lifecycle.otherRuns':'Altre richieste (escluse dalla decisione)',
 'lifecycle.feedback':(p:{n:number})=>`Feedback (${p.n})`,
 'lifecycle.basisReviewed':'Valutazione dell’Orchestrator con una revisione verificata, non conferma dell’utente.',
 'lifecycle.basisOpinion':'Valutazione dell’Orchestrator, non conferma dell’utente.',
 'lifecycle.worked':(p:{text:string})=>`Ha funzionato: ${p.text}`,'lifecycle.failed':(p:{text:string})=>`Da migliorare: ${p.text}`,'lifecycle.notGiven':'Non indicato',
 'lifecycle.gap':(p:{key:string})=>`Lacuna: ${p.key}`,
 'lifecycle.unavailable':'Ciclo degli agenti non disponibile.','lifecycle.loading':'Caricamento delle proposte…','lifecycle.reload':'Ricarica proposte',
};
