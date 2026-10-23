// Real proposal modal components with deterministic synthetic state for visual inspection. Every application write is refused.
import { createRoot } from 'react-dom/client';
import type { AppInfo, Bridge, ChatSummary, TasksState } from '@shared/contract';
import type { WorkThread } from '@shared/workflows';
import './styles/tokens.css';
import './styles/app.css';
const at = Date.parse('2026-10-23T13:30:00Z');
const rows: WorkThread[] = [
  { id: 'preview-search', version: 4, title: 'Ricerca accessibile', profile: 'feature', priority: 'normal', chatIds: ['artisan'], stage: 'plan', status: 'approval', summary: 'Aggiungere navigazione da tastiera e annunci dei risultati.', waitingOn: 'Te', nextAction: 'Implementare il piano approvato in un worktree isolato', evidence: 'Mockup verificato con dati di esempio', proposal: { id: 'preview-plan', text: 'Procedere con navigazione da tastiera e annunci dei risultati?' }, cycles: 0, createdAt: at, updatedAt: at, events: [{ at, stage: 'mockup', kind: 'approved', text: 'Mockup approvato; decisione conservata nello stesso filo.' }, { at, stage: 'plan', kind: 'proposed', text: 'Implementazione, review indipendente e verifiche mirate.' }] },
  { id: 'preview-support', version: 2, title: 'Supporto · esportazione ordini', profile: 'bugfix', priority: 'support', chatIds: ['sentinel'], stage: 'review', status: 'active', summary: 'Correzione preparata. La review indipendente sta verificando il risultato.', waitingOn: 'Sentinel', nextAction: 'Eseguire i check del repository dopo la review', evidence: 'Modifiche isolate e pronte alla verifica', cycles: 1, createdAt: at + 1, updatedAt: at, events: [{ at, stage: 'develop', kind: 'completed', text: 'Patch preparata. Esito finale ancora da verificare.' }] },
];
const taskData: TasksState = { enabled: true, everyMin: 30, sound: false, running: false, at, qaAt: at - 90 * 60_000, nextAt: null, error: null, qaError: 'Il servizio QA non risponde', news: [], assigned: [], urgent: [], oldReviews: [], reviews: [], unread: 0, details: {}, repoDirs: {},
  prs: [{ id: 42, title: 'Correggere esportazione ordini', repo: 'demo-store', project: 'demo', author: null, createdAt: '', url: 'https://example.com/pr/42', target: 'main', draft: false, autoComplete: true, reviewers: [{ name: 'Reviewer', vote: -5, label: 'Modifiche richieste', required: true }], build: { result: 'succeeded', status: 'completed', number: '18', url: 'https://example.com/build/18', at: null }, workItems: [], activeThreads: 1 }],
  qa: [{ pr: { id: 42, title: 'Esportazione ordini', repo: 'demo-store', project: 'demo', author: null, createdAt: '', url: 'https://example.com/pr/42' }, plans: [], bugs: [], totals: { total: 8, done: 6, passed: 5, failed: 1, blocked: 0, missing: 2, notApplicable: 0, other: 0, byPerson: [], bugs: 1, openBugs: 1 } }],
};
window.sb = { invoke: (channel: string) => {
  if (channel === 'work:list') return Promise.resolve(rows);
  if (channel === 'work:lessons') return Promise.resolve([{ id: 'preview-lesson', agentId: 'artisan', rule: 'Verificare la navigazione da tastiera prima di chiudere una modifica alla ricerca.', evidence: 'run-demo-verified', createdAt: at, status: 'pending', target: 'role', assessment: { state: 'supported', reason: 'Una run conclusa con review indipendente documenta la correzione.', checkedAt: at, proposalHash: 'preview', causal: false, sources: [{ runId: 'run-demo-verified', verdict: 'success', basis: 'reviewed-evidence', endedAt: at, outcomeAt: at, projectRoot: 'demo', fingerprint: 'preview' }] } }]);
  if (channel === 'tasks:get') return Promise.resolve(taskData);
  if (channel === 'learning:evidence') return Promise.resolve({ run: { runId: 'run-demo-verified', agentId: 'artisan', goal: 'Verificare la navigazione da tastiera dei risultati di ricerca — esempio', startedAt: at, endedAt: at, report: { summary: 'Nel caso di esempio, la verifica ha individuato un risultato senza focus.', verified: 'yes', verdict: 'success' } }, reviews: [] });
  return Promise.reject(new Error('Anteprima: nessuna azione applicativa consentita'));
}, on: () => () => {} } as unknown as Bridge;
const { app } = await import('./store/store');
const { tasks } = await import('./store/tasks');
const { RecapButton } = await import('./components/WorkCockpit');
const { QuestionsWindow } = await import('./components/QuestionsWindow');
app.set(s => ({ ...s, info: { brainRoot: '/demo' } as AppInfo, chats: Object.fromEntries([
  { id: 'orchestrator', title: 'Orchestrator', isOrchestrator: true, state: 'idle', pending: 0 },
  { id: 'artisan', title: 'Artisan · ricerca', state: 'idle', pending: 0 },
  { id: 'sentinel', title: 'Sentinel · verifica esportazione', state: 'running', pending: 0 },
].map(c => [c.id, c as ChatSummary])) }));
tasks.set(taskData);
document.body.style.overflow = 'auto';
document.documentElement.dataset.theme = 'dark';
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 1200, margin: '0 auto', padding: 28 }}>
  <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}><div><h1 style={{ fontSize: 20 }}>second-brain</h1><p style={{ color: 'var(--text-3)', fontSize: 12 }}>Anteprima dei componenti reali · dati di esempio · azioni disabilitate</p></div><RecapButton /></header>
  <QuestionsWindow />
</main>);
