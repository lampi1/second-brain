// Impara (ADR 0185): the page, the blackboard player, the checks, the end with «Spiegalo tu».
export const imparaIt = {
  'brainPages.nav.impara': 'Giornale',
  'brainPages.impara.subtitle': 'Il tuo giornale multi-edizione con fonti selezionate, filtri per argomento e approfondimento diretto con l’Orchestrator.',
  'impara.learn': 'Impara',
  'impara.remove': 'Elimina',
  'impara.removed': 'Lezione eliminata.',
  'impara.ask': 'Domanda',
  'impara.from': ({ from }: { from: string }) => `${from} · andrà nella materia`,
  'impara.fromTask': 'Dalla pagina Task',
  'impara.askWorkItem': ({ id, title, type, project }: { id: number; title: string; type: string; project: string }) => `Voglio capire il work item #${id} «${title}» (${type}, ${project}): cosa chiede, perché serve e come si fa.`,
  'impara.learnRecord': 'Capiscila',
  'impara.learnRecordTip': 'Una lezione su questo, in Impara: la prepari con un clic',
  // the public topics from the user's files, searched on the web (ADR 0206)
};
