// English texts of «Lampo», the quick lane beside the Orchestrator (ADR 0105).
export const lampoEn = {
  'lampo.tab': 'Lampo',
  'lampo.tabOrchestrator': 'Orchestrator',
  'lampo.tabsLabel': 'Orchestrator or Lampo',
  'lampo.title': 'Lampo',
  'lampo.hint': 'Like a «btw»: it sees the Orchestrator’s chat, answers on the spot, changes nothing and starts no work.',
  'lampo.intro': 'For questions, explanations and quick reads, also about the work in progress: it sees the Orchestrator’s chat and answers at once, with a fast model and read-only tools. When real work is needed, «Make it a job» hands it to the Orchestrator.',
  'lampo.start': 'Open Lampo',
  'lampo.empty': 'Ask something: it answers in a few seconds.',
  'lampo.toWork': 'Make it a job',
  'lampo.toWorkTip': 'Drafts your last question and Lampo\'s answer in the Orchestrator: you send it.',
  'lampo.draft': (p: { question: string; answer: string }) => `From Lampo. My question: «${p.question}»${p.answer ? `\nIts answer: «${p.answer}»` : ''}\nMake it a job: `,
};
