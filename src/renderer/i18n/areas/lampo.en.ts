// English texts of «Flash» (was «Lampo»), the quick lane beside the Orchestrator (ADR 0105, 0107), and the model chip.
export const lampoEn = {
  'lampo.tab': 'Flash',
  'lampo.tabOrchestrator': 'Orchestrator',
  'lampo.tabsLabel': 'Orchestrator or Flash',
  'lampo.title': 'Flash',
  'lampo.hint': 'Like a «btw»: it sees the Orchestrator’s chat, read only.',
  'lampo.intro': 'For questions, explanations and quick reads, also about the work in progress: it sees the Orchestrator’s chat and answers at once, with its own model (pick it above or on its card in Agents) and read-only tools. When real work is needed, «Make it a job» hands it to the Orchestrator.',
  'lampo.start': 'Open Flash',
  'lampo.empty': 'Ask something: it answers in a few seconds.',
  'lampo.toWork': 'Make it a job',
  'lampo.toWorkTip': 'Drafts your last question and Flash\'s answer in the Orchestrator: you send it.',
  'lampo.draft': (p: { question: string; answer: string }) => `From Flash. My question: «${p.question}»${p.answer ? `\nIts answer: «${p.answer}»` : ''}\nMake it a job: `,
  'modelChip.tip': (p: { engine: string; model: string }) => `${p.engine} · ${p.model}: click to change the model`,
  'modelChip.label': (p: { name: string }) => `${p.name}'s model`,
  'modelChip.tier': 'Default',
};
