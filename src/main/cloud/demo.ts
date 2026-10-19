// The demo's cloud agents (SB_DEMO=1, ADR 0080): the real CloudService over fake providers and a fake git, so the
// Grindhouse shows cloud strips (one per engine, in the demo's areas) and every button answers, with no CLI, no
// network and no token. Frozen (SB_DEMO_FREEZE=1): fixed times, no stream. Used by demo-wiring.ts.
import path from 'node:path';
import type { CloudAgent, CloudMessage, CloudState } from '../../shared/cloud';
import type { Exec } from './exec';
import type { CloudProvider, StartInput } from './provider';
import { CloudService } from './service';

const MIN = 60_000;

/** The seeded agents at a given "now". */
export function demoCloudAgents(now: number): CloudAgent[] {
  const msgs: CloudMessage[] = [
    { id: 'd1', kind: 'user', text: 'Rendi il checkout più veloce: il totale si ricalcola a ogni tasto.', at: now - 26 * MIN },
    { id: 'd2', kind: 'assistant', text: 'Ho trovato il ricalcolo in CartTotal: lo sposto su un debounce e tengo in cache gli sconti.', at: now - 22 * MIN },
    { id: 'd3', kind: 'tool', text: 'npm test -- cart', at: now - 9 * MIN },
    { id: 'd4', kind: 'assistant', text: 'I test del carrello passano. Ora aggiorno lo snapshot del riepilogo ordine.', at: now - 2 * MIN },
  ];
  return [
    { id: 'bc-demo-checkout', engine: 'cursor', by: 'agent', title: 'Shop · Checkout più veloce', status: 'running', url: 'https://cursor.com/agents?id=bc-demo-checkout',
      repo: 'alfa/alfa-shop', branch: 'cursor/checkout-veloce-a1b2', cwd: 'C:\\progetti\\alfa-shop', updatedAt: now - 2 * MIN, runId: 'run-demo-1', costUsd: 1.37,
      summary: 'Sta spostando il ricalcolo del totale su un debounce; test del carrello verdi.', messages: msgs },
    { id: 'task_e_demo_payments', engine: 'codex', by: 'user', title: 'Shop · Test pagamenti', status: 'done', url: 'https://chatgpt.com/codex/tasks/task_e_demo_payments',
      repo: 'alfa/alfa-shop', cwd: 'C:\\progetti\\alfa-shop', updatedAt: now - 48 * MIN, summary: '12 test aggiunti per i rimborsi e le carte scadute, tutti verdi.' },
    { id: 'session_demo_refunds', engine: 'claude', by: 'user', title: 'E2E · Rimborsi parziali', status: 'unknown', url: 'https://claude.ai/code/session_demo_refunds',
      repo: 'alfa/alfa-e2e', cwd: 'C:\\progetti\\alfa-e2e', updatedAt: now - 15 * MIN },
  ];
}

/** git as the demo's folders would answer: every folder is a GitHub checkout of alfa/<name> on a pushed main. */
const demoGit: Exec = (_cli, args) => {
  const cwd = args[1] ?? '';
  const name = path.win32.basename(cwd) || path.basename(cwd) || 'demo';
  const out = (stdout: string) => Promise.resolve({ code: 0, stdout, stderr: '' });
  if (args.includes('--show-toplevel')) return out(cwd);
  if (args.includes('get-url')) return out(`https://github.com/alfa/${name}.git`);
  if (args.includes('--abbrev-ref')) return out('main');
  return out('');
};

function fake(engine: CloudAgent['engine'], now: () => number): CloudProvider {
  return {
    engine,
    readiness: () => Promise.resolve({ ok: true }),
    start: (i: StartInput) => Promise.resolve({ id: `${engine}-demo-${Math.round(now() / 1000)}`, engine, by: 'user', title: i.title, status: engine === 'claude' ? 'unknown' : 'queued',
      url: engine === 'cursor' ? 'https://cursor.com/agents' : engine === 'codex' ? 'https://chatgpt.com/codex' : 'https://claude.ai/code', repo: i.repo.repo, updatedAt: now() }),
    followUp: () => Promise.resolve({ status: engine === 'claude' ? 'unknown' : 'running' }),
    stop: () => Promise.resolve({ status: 'stopped' }),
    applyIn: () => Promise.resolve(),
  };
}

export function demoCloud(d: { emit(state: CloudState): void; now: () => number }): CloudService {
  const s = new CloudService({
    file: null, emit: d.emit, exec: demoGit, http: () => Promise.reject(new Error('demo: nessuna rete')),
    cursorKey: () => null, engineOn: () => true, budget: () => ({ limitUsd: null, localTodayUsd: 0 }), addSpend: () => {}, visible: () => false, now: d.now,
    providers: { cursor: fake('cursor', d.now), codex: fake('codex', d.now), claude: fake('claude', d.now) },
  });
  s.store.data.agents = demoCloudAgents(d.now());
  s.store.data.spend = { day: '', usd: 0 };
  return s;
}
