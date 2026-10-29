// English UI texts of the Memoria statistics and the "Manutenzione" button: the same keys as memory.it.ts (typed by
// it), spread into en.ts.
import type { memoryIt } from './memory.it';
type N = { n: number };
type FP = Record<string, string | number>;
const runs = (n: number | string | undefined) => (Number(n) === 1 ? '1 run' : `${n} runs`);
const times = (n: number | string | undefined) => (Number(n) === 1 ? 'once' : `${n} times`);
export const memoryEn: typeof memoryIt = {
  'mm.maint.button': 'Maintenance', 'mm.maint.running': 'Maintenance running…',
  'mm.maint.helpTitle': 'What maintenance does',
  'mm.maint.help1': 'One click and that is all: the app tidies skills, rules and memory, reads its logs and an invisible agent studies your history to propose improvements. It works in the background: you can keep doing other things.',
  'mm.maint.help2': 'Everything arrives as cards in Memoria → Proposte: new skills and rules, what to forget, and the issues to open on GitHub (your yes opens them at once). Ideas about the app also land in Ideas, on the AI\'s side. Nothing changes without your yes.',
  'mm.maint.help3': 'It happens only when you press it: ideas, proposals and the memory cleanup never start by themselves. The research uses tokens, 5 $ at most each time; you get a notice when it ends.',
  'mm.one.tip': 'Maintenance: one click, then it works by itself in the background',
  'mm.one.tipCleanup': 'Tidying skills, rules and memory…',
  'mm.one.tipResearch': (p: { cost: string; cap: string }) => `An agent is looking for improvements: ${p.cost} spent of ${p.cap}. You get a notice when it ends.`,
  'mm.one.liveResearch': (p: { cost: string; cap: string; n: number }) => `Working in the background · ${p.n === 1 ? '1 card' : `${p.n} cards`} so far · ${p.cost} of ${p.cap}`,
  'mm.one.started': 'Maintenance started: it works in the background, you get a notice when it ends.',
  'mm.one.stop': 'Stop',
  'mm.one.last': (p: { at: string; what: string }) => `Last: ${p.at} · ${p.what}`,
  'mm.done.proposals': (p: N) => (p.n === 1 ? '1 proposal' : `${p.n} proposals`),
  'mm.done.ideas': (p: N) => (p.n === 1 ? '1 idea' : `${p.n} ideas`),
  'mm.done.issues': (p: N) => (p.n === 1 ? '1 issue to open' : `${p.n} issues to open`),
  'mm.done.made': (p: { what: string }) => `Maintenance done: ${p.what}`,
  'mm.done.nothing': 'Maintenance done: everything was already in order.',
  'mm.done.failed': 'Maintenance done, but the research failed',
  'mm.done.stopped': 'Maintenance stopped before the end',
  'mm.done.capped': 'Maintenance stopped at the spending cap',
  'mm.done.label': 'Maintenance done', 'mm.done.title': 'Your brain is in order',
  'mm.done.open': 'Open Memoria',

  'mm.openFile': 'Open the file', 'mm.openNamed': (p: { name: string }) => `Open the file of ${p.name}`,
  'mm.lines': 'Lines', 'mm.rule': 'Rule it produced:', 
  'mm.time': 'time', 'mm.times': 'times', 'mm.timesTitle': (p: N) => `Happened ${times(p.n)}`,
  'mm.again': (p: N) => `recurring ×${p.n}`,
  'mm.daysAgo': (p: N) => (p.n === 1 ? 'untouched for 1 day' : `untouched for ${p.n} days`),
  'mm.kind.agent': 'Agents\' memories', 'mm.kind.errors': 'Errors', 'mm.kind.journal': 'Journal', 'mm.kind.knowledge': 'Knowledge',
  'mm.weekday.0': 'Monday', 'mm.weekday.1': 'Tuesday', 'mm.weekday.2': 'Wednesday', 'mm.weekday.3': 'Thursday', 'mm.weekday.4': 'Friday', 'mm.weekday.5': 'Saturday', 'mm.weekday.6': 'Sunday',

  
  
  
  
  
  

  'mm.facts': 'Did you know?', 'mm.factsLead': 'The most curious things your memory\'s numbers say.',
  'mm.factsHelp': 'Computed now from the brain files and the recorded runs, without models or tokens. They show only when the numbers say something (for example an error repeated at least twice).',
  'mm.fact.how': 'How do I know?',
  'mm.fact.repeat.k': 'Recurring error', 'mm.fact.repeat': (p: FP) => `"${p.label}" happened **${times(p.n)}** (${p.agents}). It is the first candidate for a rule.`,
  'mm.fact.repeat.help': 'The largest group of ai-errors.md: lines with the same type and area, or with at least 3 important words in common.',
  'mm.fact.longest.k': 'The longest memory', 'mm.fact.longest': (p: FP) => `**${p.name}** remembers **${p.n} things**: more than any other agent.`,
  'mm.fact.longest.help': 'The list lines of agents/<role>/memory.md, for each role.',
  'mm.fact.oldest.k': 'The oldest memory', 'mm.fact.oldest': (p: FP) => `Since **${p.date}** ${p.owner} remembers: "${p.text}".`,
  'mm.fact.oldest.help': 'The line with the oldest date among the agents\' memories and the shared one.',
  'mm.fact.unusedSkills.k': 'Forgotten skills', 'mm.fact.unusedSkills': (p: FP) => `**${p.n} of ${p.total} skills** never served any run: ${p.names}.`,
  'mm.fact.unusedSkills.help': 'Skills at least 14 days old that no run had. Maybe their name or description does not say when to use them, or they are no longer needed.',
  'mm.fact.bestSkill.k': 'The most useful skill', 'mm.fact.bestSkill': (p: FP) => `**${p.name}**: ${runs(p.n)}, successful in **${p.pct}%** of the verified ones.`,
  'mm.fact.bestSkill.help': 'Among the "useful" skills (at least 2 known outcomes and 70% successful) the one with the most runs.',
  'mm.fact.weekday.k': 'The black day', 'mm.fact.weekday': (p: FP) => `**${p.day}** is the day with the most errors: **${p.n}**.`,
  'mm.fact.weekday.help': 'Errors of ai-errors.md counted by the weekday of their date. Shown only with at least 4 errors and one day ahead of the others.',
  'mm.fact.topWord.k': 'The word of the errors', 'mm.fact.topWord': (p: FP) => `"**${p.word}**" comes back **${times(p.n)}** in the logged errors.`,
  'mm.fact.topWord.help': 'The most frequent word of at least 4 letters in the errors\' text, common words aside.',
  'mm.fact.errorsTrend.k': 'How it is going', 'mm.fact.errorsTrend': (p: FP) => (Number(p.now) < Number(p.before) ? `Errors are falling: **${p.now}** in the last 30 days, ${p.before} in the 30 before.` : Number(p.now) > Number(p.before) ? `Errors are growing: **${p.now}** in the last 30 days, ${p.before} in the 30 before.` : `Errors are steady: **${p.now}** in the last 30 days, as in the 30 before.`),
  'mm.fact.errorsTrend.help': 'Dated errors of the last 30 days against those of the 30 days before.',
  'mm.fact.duplicates.k': 'Duplicates', 'mm.fact.duplicates': (p: FP) => (Number(p.n) === 1 ? '**1 memory** is written the same in several agents: "Unisci i doppioni" puts it once into the shared memory.' : `**${p.n} memories** are written the same in several agents: "Unisci i doppioni" puts them once into the shared memory.`),
  'mm.fact.duplicates.help': 'Identical lines (date, case and punctuation aside) in two or more agents\' memories.',
  'mm.fact.silent.k': 'Agents without memories', 'mm.fact.silent': (p: FP) => `**${p.n}** agents have not written anything yet: ${p.names}.`,
  'mm.fact.silent.help': 'Roles without agents/<role>/memory.md. Not a problem: they write it when they learn something.',
  'mm.fact.busiestDay.k': 'The richest day', 'mm.fact.busiestDay': (p: FP) => `On **${p.date}** the memory grew by **${p.n} lines**: the record.`,
  'mm.fact.busiestDay.help': 'The day with the most new lines across all memory files, errors and journal included. A line without a date counts on the day its file changed.',

  'mm.growth': 'How the memory grows',
  'mm.growthHelp': 'New lines per week (from Monday), by kind, over the last 12 weeks. The date is the one written at the start of the line; a line without a date counts in the week its file last changed. The journal counts every line of every day.',
  'mm.growthFind': (p: { n: number; weeks: number }) => `${p.n} new lines in the last ${p.weeks} weeks.`,
  'mm.growthNone': 'No new line in the last 12 weeks.',
  'mm.perAgent': 'Lines per agent',
  'mm.perAgentHelp': 'The list lines of each agent\'s memory (agents/<role>/memory.md). Agents without the file are not shown.',
  'mm.perAgentFind': (p: { name: string; n: number; silent: number }) => `${p.name} remembers the most (${p.n} lines)${p.silent ? `; ${p.silent} agents have no memory yet` : ''}.`,
  'mm.perAgentEmpty': 'No agent has written its memory yet.',
  
  'mm.skills': 'Useful and useless skills',
  'mm.skillsLead': (p: { useful: number; weak: number; unused: number; total: number }) => `Of ${p.total} skills: ${p.useful} useful, ${p.weak} to review, ${p.unused} never used.`,
  'mm.skillsEmpty': 'No skill in the brain yet.',
  'mm.skillsHelp': 'For each brain skill, the recorded runs that had it (at launch or loaded by the engine) and how they ended. An outcome counts only when known: success, partial or fail, decided by you or a review.',
  'mm.col.skill': 'Skill', 'mm.col.skillHelp': 'The skill\'s name: a click opens its SKILL.md.',
  'mm.col.verdict': 'Verdict', 'mm.col.verdictHelp': 'Useful: at least 5 verified outcomes and 70% successful (a partial counts half). To review: at least 5 verified and below 50%. Unclear: in between. Few data: fewer than 5 verified outcomes. Never used: no run for at least 14 days. New: younger than 14 days.',
  'mm.col.uses': 'Runs', 'mm.col.usesHelp': 'How many runs had the skill.',
  'mm.col.success': 'Successful', 'mm.col.successHelp': 'Successful runs out of runs with a known outcome (success, partial or fail).',
  'mm.col.last': 'Last use', 'mm.col.lastHelp': 'The start of the last run that had it.',
  'mm.col.agents': 'Agents', 'mm.col.agentsHelp': 'How many agents declare it: they get it in every run.',
  'mm.verdict.useful': 'Useful', 'mm.verdict.mixed': 'Unclear', 'mm.verdict.weak': 'To review', 'mm.verdict.few': 'Few data', 'mm.verdict.unused': 'Never used', 'mm.verdict.new': 'New',
  'mm.successTitle': (p: { ok: number; n: number }) => `${p.ok} successful of ${p.n} with a known outcome`,
  'mm.stale': 'Stale files', 'mm.staleLead': (p: { days: number }) => `Memory files untouched for ${p.days} days or more: still true?`,
  'mm.staleHelp': (p: { days: number }) => `Memory files (the journal aside: past days do not go stale) last changed ${p.days} days ago or more, oldest first.`,
  'mm.staleEmpty': (p: { days: number }) => `No file untouched for ${p.days} days: the memory is fresh.`,

  'mm.clean.title': 'The memory is still empty',
  'mm.clean.lead': 'The brain is new: this page fills itself as the agents work. Here is what will appear.',
  'mm.clean.lines': 'The agents\' memories', 'mm.clean.linesText': 'Each agent writes a line when it learns something: you will see it grow week by week.',
  'mm.clean.errors': 'Recurring errors', 'mm.clean.errorsText': 'When you correct an agent the error is logged; those that repeat become rules.',
  'mm.clean.skills': 'Useful and useless skills', 'mm.clean.skillsText': 'For each skill: how often it served, how well and when last.',
  'mm.clean.facts': 'Curious facts', 'mm.clean.factsText': 'The most used memory, the day with the most errors, the forgotten skill.',
  // the one-click maintenance (ADR 0132, 0153)
};
