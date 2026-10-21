// Italian texts of «Flash» (was «Lampo»), the quick lane beside the Orchestrator (ADR 0105, 0107): the column's tabs, the
// empty state, the lane's hint, «Fanne un lavoro» and the model chip of both columns (ModelChip).
export const lampoIt = {
  'lampo.tab': 'Flash',
  'lampo.tabOrchestrator': 'Orchestrator',
  'lampo.tabsLabel': 'Orchestrator o Flash',
  'lampo.title': 'Flash',
  'lampo.hint': 'Come un «btw»: vede la chat dell’Orchestrator, solo lettura.',
  'lampo.intro': 'Per domande, spiegazioni e letture veloci, anche sul lavoro in corso: vede la chat dell’Orchestrator e risponde subito, con il suo modello (lo scegli qui sopra o nella sua scheda in Agenti) e solo strumenti di lettura. Quando serve un lavoro vero, «Fanne un lavoro» lo passa all’Orchestrator.',
  'lampo.start': 'Apri Flash',
  'lampo.empty': 'Chiedi qualcosa: risponde in pochi secondi.',
  'lampo.toWork': 'Fanne un lavoro',
  'lampo.toWorkTip': 'Prepara nell’Orchestrator una bozza con la tua ultima domanda e la risposta di Flash: la mandi tu.',
  'lampo.draft': (p: { question: string; answer: string }) => `Da Flash. La mia domanda: «${p.question}»${p.answer ? `\nLa sua risposta: «${p.answer}»` : ''}\nFanne un lavoro: `,
  'lampo.clear': 'Svuota il contesto (come /clear)',
  'lampo.cleared': 'Flash svuotato: riparte da zero.',
  'lampo.clearFailed': (p: { error: string }) => `Flash non svuotato: ${p.error}`,
  'modelChip.tip': (p: { engine: string; model: string }) => `${p.engine} · ${p.model}: clicca per cambiare modello`,
  'modelChip.label': (p: { name: string }) => `Modello di ${p.name}`,
  'modelChip.tier': 'Predefinito',
};
