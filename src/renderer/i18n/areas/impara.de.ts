// Impara (ADR 0185): die Seite, die Tafel, die Fragen, das Ende mit «Erklär es selbst».
import type { imparaIt } from './impara.it';
export const imparaDe: typeof imparaIt = {
  'brainPages.nav.impara': 'Zeitung',
  'brainPages.impara.subtitle': 'Kuratierte Multi-Ausgaben-Zeitung mit Quellen, Themenfiltern und direkter Vertiefung über den Orchestrator.',
  'impara.learn': 'Lernen',
  'impara.remove': 'Löschen',
  'impara.removed': 'Lektion gelöscht.',
  'impara.ask': 'Frage',
  'impara.from': ({ from }: { from: string }) => `${from} · kommt in das Fach`,
  'impara.fromTask': 'Von der Task-Seite',
  'impara.askWorkItem': ({ id, title, type, project }: { id: number; title: string; type: string; project: string }) => `Ich will das Work Item #${id} «${title}» (${type}, ${project}) verstehen: was es verlangt, warum und wie man es umsetzt.`,
  'impara.learnRecord': 'Verstehen',
  'impara.learnRecordTip': 'Eine Lektion dazu in Impara: mit einem Klick starten',
  // the public topics from the user's files, searched on the web (ADR 0206)
};
