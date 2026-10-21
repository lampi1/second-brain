// The demo's evidence layer (SB_DEMO=1, ADR 0109): made-up role runs with the user's corrections over the last twelve
// weeks and six past maintenance changes in the change log, so the Apprendimento page shows every verdict without the
// user's data: a role update that helps (Artisan), a memory merge with no effect (Scout), a role update that made things
// worse (Strategist), a new skill no run has loaded yet, a recent rule still collecting, and an undone skill merge.
// Deterministic (a fixed pattern per role and period, dates relative to `now`). The changes are written once, before the
// brain model service starts (the real migration then adds its own after them). Used by demo-wiring.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRun } from '../../shared/agents';
import { writeLocal } from '../agents/local-store';
import type { StoredChange } from './changes';

const DAY = 86_400_000;
/** [role, days from now (oldest first), corrections pattern before, the day it changes, pattern after] */
const PLAN: [string, number, number[], number, number[]][] = [
  ['artisan', 84, [1, 2, 1, 1, 2, 0, 1, 2], 56, [0, 1, 0, 0, 1, 0, 0, 0]],
  ['scout', 84, [1, 1, 1, 0, 1, 1, 1, 1, 1, 1], 42, [1, 1, 1, 1, 1, 0, 1, 1, 1, 1]],
  ['strategist', 84, [0, 0, 1, 0, 0, 1, 0, 0], 28, [2, 1, 2, 3, 1, 2]],
  ['sentinel', 84, [0, 1, 0, 0], 0, []],
];

export function demoLearningRuns(now: number): AgentRun[] {
  const out: AgentRun[] = [];
  let id = 0;
  for (const [agentId, days, before, change, after] of PLAN) {
    // one run every 14 hours (the Sentinel every 40), older first
    for (let h = days * 24; h > 6; h -= agentId === 'sentinel' ? 40 : 14) {
      const startedAt = now - h * 3600e3, daysAgo = h / 24, i = id++;
      const pattern = daysAgo > change || !after.length ? before : after;
      out.push({ source: 'chat', runId: `r_learn_${i}`, chatId: `demo-learn-${i}`, agentId, version: 1, goal: 'Demo', startedBy: 'orchestrator', startedAt,
        endedAt: startedAt + 50 * 60e3, endReason: 'completed', corrections: { tagged: pattern[i % pattern.length]!, afterReport: 0 },
        counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null });
    }
  }
  return out;
}

/** The six past changes, written once into an empty change log of the demo's userData. */
export function writeDemoChanges(userData: string, now: number): void {
  const file = path.join(userData, 'brain-changes.json');
  if (fs.existsSync(file)) return;
  const at = (d: number) => now - d * DAY;
  const c = (id: string, d: number, x: Omit<StoredChange, 'id' | 'at' | 'files'>, rolledBack?: number): StoredChange =>
    ({ id, at: at(d), files: [], ...x, ...(rolledBack ? { rolledBackAt: at(rolledBack) } : {}) });
  const changes: StoredChange[] = [
    c('demo-l1', 56, { job: 'corrections', kind: 'agent', action: 'update', target: 'artisan', summary: 'Artisan: prima di riportare «fatto» lancia i test della parte toccata', reason: 'Tre correzioni simili in una settimana: «hai detto fatto ma i test erano rossi».', evidence: ['[Reasoning correction] ×3'], seed: { hypothesis: 'fewer', scope: ['artisan'], skill: null } }),
    c('demo-l2', 42, { job: 'merge-memory', kind: 'memory', action: 'merge', target: 'agents/scout/memory.md', summary: 'Memoria di Scout: 6 righe doppie unite', reason: 'Righe quasi uguali sugli stessi ambienti.', evidence: ['agents/scout/memory.md'], seed: { hypothesis: 'not-more', scope: ['scout'], skill: null } }),
    c('demo-l3', 35, { job: 'merge-skills', kind: 'skill', action: 'merge', target: 'controlli-rilascio', summary: 'Skill «controlli-rilascio» unita a «note-di-rilascio»', reason: 'Le due skill descrivevano gli stessi passi.', evidence: ['controlli-rilascio', 'note-di-rilascio'], seed: { hypothesis: 'not-more', scope: [], skill: 'note-di-rilascio', baselineSkill: true } }, 33),
    c('demo-l4', 28, { job: 'corrections', kind: 'agent', action: 'update', target: 'strategist', summary: 'Strategist: piani più brevi, al massimo tre passi', reason: 'Due correzioni: «il piano è troppo lungo».', evidence: ['[Reasoning correction] ×2'], seed: { hypothesis: 'fewer', scope: ['strategist'], skill: null } }),
    c('demo-l5', 10, { job: 'repeated-task', kind: 'skill', action: 'create', target: 'aggiorna-dipendenze', summary: 'Nuova skill «aggiorna-dipendenze» da un lavoro ripetuto 4 volte', reason: 'Quattro lavori simili in tre settimane.', evidence: ['aggiorna-dipendenze'], seed: { hypothesis: 'fewer', scope: [], skill: 'aggiorna-dipendenze' } }),
    c('demo-l6', 4, { job: 'corrections', kind: 'rule', action: 'create', target: 'rules/nomi-branch.md', summary: 'Regola: i branch si chiamano tipo/descrizione-breve', reason: 'Una correzione ripetuta su due ruoli.', evidence: ['rules/nomi-branch.md'], seed: { hypothesis: 'fewer', scope: [], skill: null } }),
  ];
  writeLocal(file, { version: 1, changes });
}
