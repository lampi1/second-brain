// Impara (ADR 0185): the page, the blackboard player, the checks, the end with «Explain it yourself».
import type { imparaIt } from './impara.it';
export const imparaEn: typeof imparaIt = {
  'brainPages.nav.impara': 'News',
  'brainPages.impara.subtitle': 'Curated multi-edition newspaper with sources, topic filters and direct deep-dive via the Orchestrator.',
  'impara.learn': 'Learn',
  'impara.remove': 'Delete',
  'impara.removed': 'Lesson deleted.',
  'impara.ask': 'Question',
  'impara.from': ({ from }: { from: string }) => `${from} · will go in the subject`,
  'impara.fromTask': 'From the Task page',
  'impara.askWorkItem': ({ id, title, type, project }: { id: number; title: string; type: string; project: string }) => `I want to understand work item #${id} «${title}» (${type}, ${project}): what it asks, why it matters and how it is done.`,
  'impara.learnRecord': 'Understand it',
  'impara.learnRecordTip': 'A lesson about this, in Impara: start it with one click',
  // the public topics from the user's files, searched on the web (ADR 0206)
};
