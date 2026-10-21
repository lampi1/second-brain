// Italian texts of «Lampo», the quick lane beside the Orchestrator (ADR 0105): the column's tabs, the empty state, the
// lane's hint and «Fanne un lavoro».
export const lampoIt = {
  'lampo.tab': 'Lampo',
  'lampo.tabOrchestrator': 'Orchestrator',
  'lampo.tabsLabel': 'Orchestrator o Lampo',
  'lampo.title': 'Lampo',
  'lampo.hint': 'Come un «btw»: vede la chat dell’Orchestrator, risponde al volo, non cambia nulla e non avvia lavori.',
  'lampo.intro': 'Per domande, spiegazioni e letture veloci, anche sul lavoro in corso: vede la chat dell’Orchestrator e risponde subito, con un modello rapido e solo strumenti di lettura. Quando serve un lavoro vero, «Fanne un lavoro» lo passa all’Orchestrator.',
  'lampo.start': 'Apri Lampo',
  'lampo.empty': 'Chiedi qualcosa: risponde in pochi secondi.',
  'lampo.toWork': 'Fanne un lavoro',
  'lampo.toWorkTip': 'Prepara nell’Orchestrator una bozza con la tua ultima domanda e la risposta di Lampo: la mandi tu.',
  'lampo.draft': (p: { question: string; answer: string }) => `Da Lampo. La mia domanda: «${p.question}»${p.answer ? `\nLa sua risposta: «${p.answer}»` : ''}\nFanne un lavoro: `,
};
