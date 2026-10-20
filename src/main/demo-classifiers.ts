// The demo's classifier history (SB_DEMO=1), so the Classificatori grid and its detail views show eight weeks of made-up
// work instead of empty cards: the routing ledger's predictions, actuals and known outcomes in the demo brain
// (ops/state/improve/outcomes.jsonl, read by brainmodel/classifiers.ts), the role runs with their launch skills (the
// skills card) and the cost ledger's jobs (userData/jobs.jsonl, the cost-kind card). A fixed pseudo-random sequence and
// dates relative to `now`: the frozen demo draws the same numbers on every run. The "altro" share and the failures
// shrink week by week, so the learning curve has something to show. Generic content only. Used by demo-wiring.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRun } from '../shared/agents';

const DAY = 86400e3;
/** a small deterministic generator (LCG): the same sequence every run */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
const pick = <T,>(r: () => number, xs: readonly [T, number][]): T => {
  const total = xs.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [v, w] of xs) { x -= w; if (x <= 0) return v; }
  return xs[xs.length - 1]![0];
};

// kind → [weight, roles with weights, model, average cost]
const KINDS: [string, number, [string, number][], string, number][] = [
  ['bug-fix', 30, [['artisan', 7], ['scout', 3]], 'claude-opus-5-5', 1.9],
  ['investigation', 20, [['scout', 9], ['strategist', 1]], 'claude-sonnet-5-5', 1.1],
  ['review', 14, [['sentinel', 10]], 'claude-sonnet-5-5', 0.7],
  ['qa-run', 10, [['sentinel', 1]], 'claude-sonnet-5-5', 0.9],
  ['writing', 9, [['artisan', 8], ['herald', 2]], 'claude-haiku-5-5', 0.3],
  ['app-feature', 8, [['artisan', 1]], 'claude-opus-5-5', 3.4],
  ['ops-read', 4, [['scout', 1]], 'claude-haiku-5-5', 0.2],
];
const GOALS: Record<string, string[]> = {
  'bug-fix': ['Correggi il totale ordine che non applica lo sconto', 'Sistema il crash all’apertura del report', 'Fix del rilascio: la build fallisce sui test'],
  investigation: ['Indaga perché il database rallenta la sera', 'Cerca la causa del timeout nei log', 'Analizza gli errori del rilascio di ieri'],
  review: ['Revisiona la PR dell’export fatture', 'Controlla il diff delle licenze'],
  'qa-run': ['Esegui i test case dei rimborsi', 'Verifica la fix in ambiente di test'],
  writing: ['Scrivi le note di rilascio', 'Aggiorna il runbook delle query'],
  'app-feature': ['Aggiungi la colonna data all’export', 'Crea la pagina delle licenze'],
  'ops-read': ['Leggi i log del servizio di test'],
};

export interface DemoClassifierData { runs: AgentRun[] }

/** Writes the demo ledger into the demo brain and the job ledger into userData (when it has none); returns the runs. */
export function writeDemoClassifiers(brainRoot: string, userData: string, now: number, skills: string[]): DemoClassifierData {
  const r = rng(4242);
  const lines: object[] = [], runs: AgentRun[] = [];
  const n = 64;
  for (let k = 0; k < n; k++) {
    const age = (n - k) / n; // 1 = eight weeks ago, → 0 = today
    const at = Math.round(now - age * 55 * DAY - r() * DAY);
    // early on the lexicon missed more requests ("altro"); it learns
    const altro = r() < 0.04 + 0.22 * age;
    const k0 = pick(r, KINDS.map(x => [x, x[1]] as [typeof x, number]));
    const kind = altro ? 'altro' : k0[0];
    const role = pick(r, k0[2]);
    const source = pick(r, [['agent', 64], ['table', 26], ['default', 7], ['override', 3]] as [string, number][]);
    const model = source === 'agent' && role === 'scout' ? 'claude-sonnet-5-5' : k0[3];
    const usd = Math.round(k0[4] * (0.5 + r()) * 1000) / 1000;
    const id = `app:demo-cls-${k}`;
    lines.push({ id, at, domain: 'routing', item: { harness: 'claude', model, effort: 'high', area: 'App', kind, promptChars: 200 }, predicted: { policy: 'routing', version: 3, value: { harness: 'claude', model, effort: 'high', source, reason: null } } });
    // most chats get a verdict; a recognised kind succeeds more often, and both improve with time
    const known = r() < 0.72;
    const ok = r() < (altro ? 0.5 : 0.62 + 0.3 * (1 - age));
    lines.push({ id, domain: 'routing', actual: { usd, minutes: 12, turns: 6, ctxPeak: null, handoffs: 0 }, outcome: known ? { known: true, success: ok, source: 'agent-user', runId: `run-demo-${k}`, at: at + 3600e3 } : { known: false, source: 'measured' } });
    const goals = GOALS[k0[0]] ?? ['Lavoro'];
    const goal = goals[k % goals.length]!;
    // the launch skills: usually what the suggester would pick for the goal's words, sometimes another one
    const fit = skills.find(s => s.split('-').some(w => w.length > 4 && goal.toLowerCase().includes(w.slice(0, 5)))) ?? skills[k % Math.max(1, skills.length)];
    const used = !skills.length ? [] : r() < 0.78 ? (fit ? [fit] : []) : [skills[(k * 7) % skills.length]!];
    runs.push({ runId: `run-demo-${k}`, chatId: `demo-cls-${k}`, agentId: role, version: 1, goal, startedBy: 'orchestrator', startedAt: at, endedAt: at + 3600e3, endReason: 'completed',
      ...(known ? { outcome: { verdict: ok ? 'success' : 'fail', basis: 'human', at: at + 3600e3, by: 'utente' } } : {}),
      counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: usd, tokens: null, tags: { skills: used, app: 'App', repo: null } });
  }
  const dir = path.join(brainRoot, 'ops', 'state', 'improve');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'outcomes.jsonl'), `${lines.map(l => JSON.stringify(l)).join('\n')}\n`);
  // the cost ledger's kinds: "other" shrinks over the weeks too
  const jobs = path.join(userData, 'jobs.jsonl');
  if (!fs.existsSync(jobs)) {
    const JK: [string, number, number][] = [['fix', 28, 1.8], ['research', 20, 1.2], ['feature', 12, 3.1], ['review', 12, 0.8], ['qa', 10, 1.0], ['question', 12, 0.22]];
    const out: string[] = [];
    for (let k = 0; k < 90; k++) {
      const age = (90 - k) / 90, at = Math.round(now - age * 55 * DAY - r() * DAY);
      const j = pick(r, JK.map(x => [x, x[1]] as [typeof x, number]));
      const kind = r() < 0.05 + 0.2 * age ? 'other' : j[0];
      out.push(JSON.stringify({ id: `demo-job-${k}`, at, harness: 'claude', model: null, effort: null, kind, promptChars: 180, actual: { usd: Math.round(j[2] * (0.4 + r() * 1.2) * 1000) / 1000, minutes: 10 + Math.round(r() * 40), tokensIn: null, tokensOut: null, turns: null }, source: 'app' }));
    }
    fs.writeFileSync(jobs, `${out.join('\n')}\n`);
  }
  return { runs };
}
