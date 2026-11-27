// Role cards of the Agenti catalogue: English labels; parity checked against the Italian source (agents-grid.it.ts).
import type { agentsGridIt } from './agents-grid.it';
export const agentsGridEn: typeof agentsGridIt = {
  'agentsGrid.runs': 'Ended', 'agentsGrid.open': 'Open', 'agentsGrid.cost': 'Cost',
  'agentsGrid.working': 'Working','agentsGrid.openProfile': 'Edit the role', 'agentsGrid.count': ({ n }) => n === 1 ? '1 role' : `${n} roles`,
  'agentsGrid.workingCount': ({ n }) => `${n} working`,
  'agentsGrid.trialCount': ({ n }) => `${n} on trial`,
  'agentsGrid.level': 'Level', 'agentsGrid.levelShort': ({ n }) => `Lv ${n}`,
  'agentsGrid.levelTitle': ({ n }) => n >= 100 ? 'Myth' : n >= 75 ? 'Legend' : n >= 50 ? 'Grandmaster' : n >= 35 ? 'Master' : n >= 20 ? 'Veteran' : n >= 10 ? 'Expert' : n >= 5 ? 'Practitioner' : n >= 2 ? 'Apprentice' : 'Recruit',
  'agentsGrid.levelWins': ({ n }) => n === 1 ? '1 verified success' : `${n} verified successes`,
  'agentsGrid.levelXp': ({ n }) => `${n} XP`,
  'agentsGrid.levelNext': ({ left, next }) => `${left} XP to Lv ${next}`,
  'agentsGrid.levelTop': 'Top level',
  'agentsGrid.levelHelpTitle': 'How the level is computed',
  'agentsGrid.levelHelp1': 'The level grows only with verified successful runs: your verdict, an independent review, the app\'s receipts (the project\'s tests passed after the last change). Never with the agent\'s verdict on itself, never with silence.',
  'agentsGrid.levelHelp2': 'A successful run is worth 1 to 5 XP by its size: turns, working time, files changed, delegated chats. Lv 2 at 6 XP (about 3 runs), Lv 10 at 202, Lv 50 at 3,037, Lv 100 (the top) at 9,358. At a typical pace (4 verified runs a day): a week to Lv 5, a month to Lv 10, about 4 years to Lv 100.',
  'agentsGrid.levelHelp3': 'Titles: Recruit (Lv 1), Apprentice (2–4), Practitioner (5–9), Expert (10–19), Veteran (20–34), Master (35–49), Grandmaster (50–74), Legend (75–99), Myth (100).',
  'agentsGrid.levelHelpOrchestrator': 'Orchestrator: earns with the runs it started that are verified successes, plus 1 XP for a plan approved with no change. Half the XP when the task went to another role or was redone.',
  'agentsGrid.levelHelpEx': ({ xp, wins, runs, level, next, left }) =>
    `${xp} XP from ${wins} verified ${wins === 1 ? 'success' : 'successes'} out of ${runs} ${runs === 1 ? 'run' : 'runs'} ended: Lv ${level}` + (next === null ? ', the top.' : `; ${left} XP more for Lv ${next}.`),
  // the user's pats and whacks on the role's little person (ADR 0297)
  'agentsGrid.success': 'Success',
  'agentsGrid.successFew': ({ n, min }: { n: number; min: number }) => `Too few verified outcomes: ${n} of ${min}`,
  'agentsGrid.successNote': ({ n, min }: { n: number; min: number }) => `verified: ${n} of ${min} needed`,
  'agentsGrid.successHelp': ({ min }: { min: number }) => `The share of ended jobs with a verified outcome, yours or an independent review's, that succeeded; a partial counts half. Below ${min} verified outcomes no percentage: only how many of ${min}. Different from Performance, which also weighs the Orchestrator's and reviewers' votes.`,
  'agentsGrid.costHelp': 'The median cost of an ended run: half the runs cost less, half more. Only runs whose engine reports a cost count.',
  'agentsGrid.medianTime': 'Time',
  'agentsGrid.medianTimeFull': 'Median execution time',
  'agentsGrid.noRuns': 'No verified success yet: the first one moves it towards Lv 2.',
};
