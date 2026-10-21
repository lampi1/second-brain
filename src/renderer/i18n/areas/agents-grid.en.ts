// Role cards of the Agenti catalogue: English labels; parity checked against the Italian source (agents-grid.it.ts).
import type { agentsGridIt } from './agents-grid.it';
export const agentsGridEn: typeof agentsGridIt = {
  'agentsGrid.runs': 'Ended', 'agentsGrid.open': 'Open', 'agentsGrid.success': 'Success', 'agentsGrid.cost': 'Cost',
  'agentsGrid.working': 'Working','agentsGrid.openProfile': 'Edit the role', 'agentsGrid.count': ({ n }) => n === 1 ? '1 role' : `${n} roles`,
  'agentsGrid.workingCount': ({ n }) => `${n} working`,
  'agentsGrid.trialCount': ({ n }) => `${n} on trial`,
  'agentsGrid.level': 'Level', 'agentsGrid.levelShort': ({ n }) => `Lv ${n}`,
  'agentsGrid.levelTitle': ({ n }) => n >= 10 ? 'Legend' : n >= 6 ? 'Master' : ['Recruit', 'Apprentice', 'Practitioner', 'Expert', 'Veteran'][n - 1] ?? 'Recruit',
  'agentsGrid.levelWins': ({ n }) => n === 1 ? '1 verified success' : `${n} verified successes`,
  'agentsGrid.levelNext': ({ left, next }) => left === 1 ? `1 success to Lv ${next}` : `${left} successes to Lv ${next}`,
  'agentsGrid.levelTop': 'Top level',
  'agentsGrid.levelHelpTitle': 'How the level is computed',
  'agentsGrid.levelHelp1': 'The level grows only with this agent\'s verified successful runs: successful by your verdict, by a verified independent review. A failed, unverified or still provisional run does not count, nor does the agent\'s verdict on itself. The Orchestrator has no runs of its own: each run it started that is a verified success counts for it.',
  'agentsGrid.levelHelp2': 'Each level asks 5 successes more than the one before: Lv 2 at 5, Lv 3 at 15, Lv 4 at 30, Lv 5 at 50, Lv 6 at 75 (Lv N needs 5 × N × (N − 1) ÷ 2). Top: Lv 50.',
  'agentsGrid.levelHelp3': 'Titles: Recruit (Lv 1), Apprentice, Practitioner, Expert, Veteran (Lv 5), Master (Lv 6–9), Legend (Lv 10 and up). It is a game, but only on verified data: it says how many runs it got right, not how many it did.',
  'agentsGrid.levelHelpEx': ({ wins, runs, level, next, left }) =>
    `${wins} verified ${wins === 1 ? 'success' : 'successes'} out of ${runs} ${runs === 1 ? 'run' : 'runs'} ended: Lv ${level}` + (next === null ? ', the top.' : `; ${left} more for Lv ${next}.`),
  'agentsGrid.perf': 'Performance',
  'agentsGrid.perfBand': ({ v }) => v >= 0.85 ? 'Excellent' : v >= 0.7 ? 'Good' : v >= 0.5 ? 'Fair' : 'Needs work',
  'agentsGrid.perfWarmup': 'Warming up',
  'agentsGrid.perfWarmupCount': ({ n, min }) => `${n} of ${min} judged`,
  'agentsGrid.perfJudged': ({ n }) => n === 1 ? '1 judged run' : `${n} judged runs`,
  'agentsGrid.perfHelpTitle': 'How the performance is computed',
  'agentsGrid.perfHelp1': 'The average of the verdicts on its runs: success counts 100%, partial 50%, failure 0%. Runs with no verdict do not count. The number below says how many runs it rests on.',
  'agentsGrid.perfHelp2': 'Each verdict weighs by who gave it (you, an independent review × 1, the Orchestrator × 0.6; the agent\'s own report on itself does not count) and by how recent it is: a 30-day-old verdict weighs half of today\'s, a 60-day-old one a quarter.',
  'agentsGrid.perfHelp3': ({ min }) => `It shows after ${min} judged runs; before that the agent is "warming up". Bands: 85% and up excellent, 70–84% good, 50–69% fair, below 50% needs work.`,
  'agentsGrid.perfSources': ({ human, review, facts, orchestrator, self }) =>
    `Verdicts so far: ${human} yours, ${review} from independent reviews, ${facts} from the facts, ${orchestrator} from the Orchestrator` + (self ? `; ${self} only from the agent itself, which do not count.` : '.'),
  'agentsGrid.costHelp': 'The median cost of an ended run: half the runs cost less, half more. Only runs whose engine reports a cost count.',
  'agentsGrid.noRuns': 'No verified success yet: the first one moves it towards Lv 2.',
};
