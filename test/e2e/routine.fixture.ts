// Fixture for routine.spec.ts: the Routine page with four routines (an automatic bugfix with trigger filters and a
// self-healing check, a licence move with a prod step waiting for «Esegui», a deploy-prod example that only ever runs
// dry, release notes paused) and runs in every state; isolated demo data, no secrets, nothing runs.
import type { FlowSnapshot, FlowStep } from '../../src/shared/flows';

const base = { inputs: [] as string[], evidence: ['result'], timeoutMs: 600_000, maxAttempts: 3 };
const agent = (id: string, title: string, role: FlowStep['role'], extra: Partial<FlowStep> = {}): FlowStep =>
  ({ ...base, id, title, kind: 'agent', instructions: `${title}: lavoro di prova.`, inputs: ['repo'], workspaceInput: 'repo', effect: 'code', role, ...extra });
const command = (id: string, title: string, kind: 'script' | 'query', ref: string, hash: string, extra: Partial<FlowStep> = {}): FlowStep =>
  ({ ...base, id, title, kind: 'check', instructions: `${title}.`, action: { kind, ref, hash }, effect: 'read-only', env: 'test', ...extra });
const H = (c: string) => c.repeat(64);

export function routineSnapshot(now = Date.now()): FlowSnapshot {
  const bugfix = { id: 'bugfix', title: 'Bugfix automatico', description: 'Prende i bug marcati, li corregge, apre la PR e aggiorna il work item.', aliases: [], scope: {}, steps: [
    agent('analyze', 'Analisi', 'scout', { effect: 'read-only', engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' }),
    agent('fix', 'Correzione', 'artisan', { model: 'claude-opus-5-5', effort: 'high' }),
    command('verify', 'Verifica', 'script', 'run-tests.ps1', H('9c1e'), { args: { Filter: '{{work-item-id}}', Env: 'test' }, onFail: { goto: 'fix' } }),
    agent('review', 'Revisione PR', 'sentinel', { reviewOf: 'fix', effect: 'read-only' }),
    agent('update', 'Aggiorna work item', 'herald', { effect: 'external-write', adapter: 'devops-write', model: 'claude-haiku-5-5', effort: 'low' }),
  ] };
  const licences = { id: 'licenze', title: 'Spostamento licenze', description: 'Sposta una lista di licenze tra team: prima in test, poi in prod (lo esegui tu).', aliases: [], scope: {},
    params: [{ name: 'from', label: 'Da', type: 'string' as const, required: true }, { name: 'to', label: 'A', type: 'string' as const, required: true }, { name: 'list', label: 'Lista', type: 'file' as const }],
    steps: [
      command('test-move', 'Sposta in test', 'script', 'move-licenses.ps1', H('2be4'), { args: { Env: 'test', From: '{{from}}', To: '{{to}}', List: '{{attachment:licenze.csv}}' } }),
      command('prod-move', 'Sposta in produzione', 'script', 'move-licenses.ps1', H('2be4'), { env: 'prod', effect: 'production', maxAttempts: 1, args: { Env: 'prod', From: '{{from}}', To: '{{to}}', List: '{{attachment:licenze.csv}}' } }),
      command('check', 'Controllo finale', 'query', 'licenze-check.sql', H('51ab'), { args: { server: 'test-sql', database: 'Licenze' } }),
    ] };
  const deploy = { id: 'deploy-prod', title: 'Deploy prod', description: 'Query pre-deploy, migrazioni DB e release Azure. Gira solo a vuoto.', aliases: [], scope: {}, steps: [
    command('pre', 'Controllo pre-deploy', 'query', 'pre-deploy-check.sql', H('51ab'), { env: 'prod', effect: 'production', args: { server: 'prod-sql', database: 'Air' } }),
    command('migrate', 'Migrazioni DB', 'query', 'migrazioni.sql', H('7d0c'), { env: 'prod', effect: 'production', args: { server: 'prod-sql', database: 'Air' } }),
    command('smoke', 'Smoke test', 'script', 'smoke.ps1', H('a1d4'), { args: { Env: 'test', Build: '20261024.3' } }),
    command('release', 'Release Azure', 'script', 'azure-release.ps1', H('e3f9'), { env: 'prod', effect: 'production', args: { Project: 'Air', Build: '20261024.3' } }),
  ] };
  const notes = { id: 'note', title: 'Note di rilascio', description: 'Scrive le note di rilascio dalle PR della settimana.', aliases: [], scope: {}, steps: [agent('write', 'Scrivi le note', 'scribe' as never, { effect: 'read-only' })] };
  const version = (definition: typeof bugfix, v: number) => ({ definition, version: v, draftRevision: v, digest: `d-${definition.id}`, activatedAt: now - 86_400_000 });
  const steps = (ids: string[], done: number, extra: Record<number, object> = {}) => ids.map((stepId, i) => ({ stepId, status: i < done ? 'completed' as const : 'pending' as const, attempts: i < done ? 1 : 0,
    ...(i < done ? { receipt: { id: `r-${stepId}`, stepId, kind: 'agent-report' as const, at: now - 600_000, summary: 'fatto, con evidenze', evidence: ['result: ok'] } } : {}), ...extra[i] }));
  const item = (id: number) => ({ 'work-item-id': String(id), 'work-item-revision': '3', 'work-item-url': `https://dev.azure.com/ex/Air/_workitems/edit/${id}`, repo: 'C:/demo/air' });
  const rule = { id: 'rule-bugfix', revision: 3, approvedRevision: 3, status: 'enabled' as const, ownerOrchestratorId: 'orc', createdAt: now - 864e5, updatedAt: now - 3600e3, approvedAt: now - 3600e3, failures: 0,
    lastCheckAt: now - 120_000, nextCheckAt: now + 60_000, lastResult: 'DevOps: 40 elementi controllati, 1 novità.',
    config: { flowId: 'bugfix', flowVersion: 7, scope: {}, inputs: { repo: 'C:/demo/air' }, priority: 'normal' as const,
      trigger: { kind: 'devops' as const, everyMinutes: 5, organization: 'demo-org', project: 'Air', areaPath: 'Air\\Backend', workItemType: 'Bug', states: ['Active'], includeExisting: false, includeTags: ['ai-ok'], excludeTags: ['ai-needs-human'], maxPerHour: 4 },
      devopsWrite: { organization: 'demo-org', projects: ['Air'], ops: ['comment', 'tags'] as never, fields: [] } } };
  const notesRule = { ...rule, id: 'rule-note', status: 'paused' as const, config: { flowId: 'note', flowVersion: 3, scope: {}, inputs: { repo: 'C:/demo/air' }, priority: 'normal' as const, trigger: { kind: 'interval' as const, everyMinutes: 10080 } } };
  const queuedTitles = ['Bug 48240 · Timeout sul login', 'Bug 48238 · Totale IVA errato', 'Bug 48231 · PDF fattura arrotonda', 'Bug 48229 · Filtro date vuoto', 'Bug 48226 · Export lento', 'Bug 48220 · Logo sfocato'];
  const events = queuedTitles.map((title, i) => ({ id: `ev-${i}`, ruleId: 'rule-bugfix', ruleRevision: 3, sourceKey: `devops:${i}`, subjectKey: `auto:rule-bugfix:3:${H(String(i))}`, title, inputs: {}, createdAt: now - (i + 1) * 300_000, updatedAt: now - 300_000, status: 'pending' as const, attempts: 0 }));
  return {
    contextKey: 'routine-fixture', drafts: [],
    active: { bugfix: 7, licenze: 2, 'deploy-prod': 1, note: 3 },
    versions: [version(bugfix, 7), version(licences as never, 2), version(deploy, 1), version(notes, 3)],
    runs: [
      { id: 'run-prod', revision: 6, flowId: 'licenze', flowVersion: 2, definitionDigest: 'd-licenze', ownerOrchestratorId: 'app', subjectKey: 'item:1', scope: {}, title: '#48102 Spostare licenze Team Air → Team Fly',
        inputs: { ...item(48102), from: 'Team Air', to: 'Team Fly' }, status: 'approval', currentStep: 1, createdAt: now - 1_200_000, updatedAt: now - 360_000,
        attachments: [{ name: 'licenze.csv', sha256: H('3f9a'), size: 1480, lines: 37, at: now - 1_200_000 }],
        awaitingUser: { stepId: 'prod-move', command: 'pwsh -NoProfile -NonInteractive -File move-licenses.ps1 -Env prod -From "Team Air" -To "Team Fly" -List licenze.csv', at: now - 360_000 },
        steps: [{ stepId: 'test-move', status: 'completed', attempts: 1, receipt: { id: 'rc1', stepId: 'test-move', kind: 'check', at: now - 400_000, summary: 'script move-licenses.ps1 · exit 0: 37 licenze su 37 spostate in test', evidence: [] } },
          { stepId: 'prod-move', status: 'approval', attempts: 0, decisionPending: true }, { stepId: 'check', status: 'pending', attempts: 0 }] },
      { id: 'run-heal', revision: 9, flowId: 'bugfix', flowVersion: 7, definitionDigest: 'd-bugfix', ownerOrchestratorId: 'orc', subjectKey: `auto:rule-bugfix:3:${H('a')}`, scope: {}, title: '#48213 Login SSO fallisce su Edge dopo il redirect',
        inputs: item(48213), status: 'active', currentStep: 1, createdAt: now - 1_800_000, updatedAt: now - 20_000,
        heal: [{ at: now - 200_000, stepId: 'verify', action: 'goto', to: 'fix', attempt: 1, reason: 'Lo script run-tests.ps1 è finito con exit 1: 146/148 test, cookie di sessione perso su Edge' }],
        steps: steps(['analyze', 'fix', 'verify', 'review', 'update'], 1, { 1: { status: 'running', attempts: 2, startedAt: now - 180_000, chatId: 'w2' }, 2: { attempts: 1 } }) },
      { id: 'run-two', revision: 3, flowId: 'bugfix', flowVersion: 7, definitionDigest: 'd-bugfix', ownerOrchestratorId: 'orc', subjectKey: `auto:rule-bugfix:3:${H('b')}`, scope: {}, title: '#48190 Export CSV tronca le righe oltre 10k',
        inputs: item(48190), status: 'active', currentStep: 0, createdAt: now - 120_000, updatedAt: now - 60_000,
        steps: steps(['analyze', 'fix', 'verify', 'review', 'update'], 0, { 0: { status: 'running', attempts: 1, startedAt: now - 120_000, chatId: 'w3' } }) },
      { id: 'run-done', revision: 14, flowId: 'bugfix', flowVersion: 7, definitionDigest: 'd-bugfix', ownerOrchestratorId: 'orc', subjectKey: `auto:rule-bugfix:3:${H('c')}`, scope: {}, title: '#48150 Totale carrello errato',
        inputs: item(48150), status: 'completed', currentStep: 5, createdAt: now - 7_200_000, updatedAt: now - 720_000,
        heal: [{ at: now - 4_000_000, stepId: 'verify', action: 'goto', to: 'fix', attempt: 1, reason: 'exit 1' }],
        receipts: [{ id: 'rx1', stepId: 'verify', kind: 'script', ref: 'run-tests.ps1', command: 'pwsh -NoProfile -NonInteractive -File run-tests.ps1 -Env test -Filter 48150', args: { Env: 'test', Filter: '48150' }, sha256: H('9c1e'), env: 'test', startedAt: now - 1_500_000, endedAt: now - 1_380_000, exitCode: 0, output: '148/148 test passati', by: 'runner' }],
        steps: steps(['analyze', 'fix', 'verify', 'review', 'update'], 5) },
      { id: 'run-old', revision: 4, flowId: 'licenze', flowVersion: 2, definitionDigest: 'd-licenze', ownerOrchestratorId: 'app', subjectKey: 'item:0', scope: {}, title: '#47990 Licenze Team Sky',
        inputs: item(47990), status: 'cancelled', currentStep: 1, createdAt: now - 90_000_000, updatedAt: now - 86_000_000, cancellation: { at: now - 86_000_000, reason: 'Annullata da te', by: 'user', expectedRevision: 3 },
        steps: steps(['test-move', 'prod-move', 'check'], 1) },
    ] as FlowSnapshot['runs'],
    automation: { revision: 5, paused: false, background: false, rules: [rule, notesRule] as never, events: events as never },
    engines: [{ id: 'claude', name: 'Claude', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] }, { id: 'codex', name: 'Codex', models: ['gpt-5-codex'] }, { id: 'cursor', name: 'Cursor', models: ['cursor-auto'] }],
    runner: { owner: 'here', active: 3 },
    roles: {
      scout: { name: 'Scout', avatar: { kind: 'character', value: 'scout' }, tier: 'mid', tierMax: 'top', model: null, models: { mid: 'claude-sonnet-5-5' } },
      artisan: { name: 'Artisan', avatar: { kind: 'character', value: 'artisan' }, tier: 'top', tierMax: 'top', model: null, models: { top: 'claude-opus-5-5' } },
      sentinel: { name: 'Sentinel', avatar: { kind: 'character', value: 'sentinel' }, tier: 'top', tierMax: 'top', model: null, models: { top: 'claude-opus-5-5' } },
      herald: { name: 'Herald', avatar: { kind: 'character', value: 'herald' }, tier: 'light', tierMax: 'mid', model: null, models: { light: 'claude-haiku-5-5' } },
    },
  };
}
