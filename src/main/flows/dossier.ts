// Host-generated routine dossiers: reconcile pinned definition, observed transitions, reports, tool receipts and gaps.
// The Orchestrator uses the same immutable evidence as the UI; failures and unknown remote outcomes are never inferred successful.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FlowRun, FlowVersion } from '../../shared/flows';
import type { FlowAutomationConfig } from '../../shared/flow-automation';
import { redact } from '../log';
import { renameRetrying } from '../rules/storage';
export interface RoutineDossier {
  schema: 1; run: FlowRun; version: FlowVersion; approvedAutomation?: FlowAutomationConfig;
  writes: unknown[]; deployments: unknown[];
  coverage: { legacy: boolean; unobserved: string[]; unresolved: string[] };
}
function clean(value: unknown): unknown {
  if (typeof value === 'string') return redact(value).replace(/\b((?:password|passwd|pwd|api[_-]?key|secret|access[_-]?token)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[redacted]');
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /(?:password|passwd|pwd|secret|api[_-]?key|token|access[_-]?token|refresh[_-]?token|authorization|connection[_-]?string)/i.test(k) ? '[redacted]' : clean(v)])); return value;
}
export function routineDossier(run: FlowRun, version: FlowVersion, writes: unknown[], deployments: unknown[], approvedAutomation?: FlowAutomationConfig): RoutineDossier {
  return clean({ schema: 1, run, version, ...(approvedAutomation ? { approvedAutomation } : {}), writes, deployments,
    coverage: { legacy: !version.definition.package, unobserved: ['Environment leases coordinate this app. Remote drift observations cover only the approved Azure release definition; direct Azure/QA actions and other release definitions are not atomically locked.', 'Native CLI/user hooks and arbitrary agent shell effects are outside host adapter telemetry.', 'No hidden reasoning is recorded; canonical reports, tool receipts and explicit evidence are the observable record.'],
      unresolved: [...(run.settlementError ? [run.settlementError] : []), ...writes.filter(v => v && typeof v === 'object' && (v as { state?: string }).state === 'pending').map(() => 'External write has an unknown outcome; reconcile before repeating it.'), ...deployments.filter(v => v && typeof v === 'object' && !(v as { released?: boolean }).released && !(v as { releasedAt?: number }).releasedAt).map(v => `Test deployment lease not released: ${String((v as { state?: string }).state ?? 'unknown')}`), ...run.steps.filter(s => s.status === 'blocked').map(s => `${s.stepId}: ${s.reason}`), ...(run.history ?? []).filter(h => h.status === 'pending').map(h => `Work item history pending: ${h.reason ?? h.id}`), ...(run.outputs ?? []).filter(o => o.brainPath && !o.projectedAt).map(o => `Brain output pending: ${o.id}`), ...(run.disposition?.error ? [run.disposition.error] : [])] } }) as RoutineDossier;
}
const quote = (v: unknown): string => String(v ?? '—').replace(/\r/g, '').replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;');
export function dossierMarkdown(d: RoutineDossier): string {
  const run = d.run;
  const lines = [`# ${quote(d.version.definition.title)} · run ${run.id}`, '', `**${run.status}** · v${run.flowVersion} · ${new Date(run.createdAt).toISOString()}`, '', `Definition SHA-256: ${run.definitionDigest}`, '',
    '## Observed outcome', '', ...d.coverage.unresolved.map(p => `- ${quote(p)}`), ...(d.coverage.unresolved.length ? [] : ['No unresolved host-recorded blockers. This is not proof of unobserved effects.']), '', '## Steps', ''];
  for (const [index, step] of run.steps.entries()) {
    const spec = d.version.definition.steps[index]!;
    lines.push(`### ${index + 1}. ${quote(spec.title)} · ${step.status}`, '', `Role/model: ${[spec.role, spec.engine, spec.model, spec.effort, spec.tier].map(quote).join(' / ')}`, `Attempts: ${step.attempts}/${spec.maxAttempts} · timeout ${spec.timeoutMs} ms`, `Chat/run/task: ${[step.chatId, step.chatRunId, step.taskVersion].map(quote).join(' / ')}`, '', quote(step.receipt?.summary ?? step.reason ?? 'No final evidence'), '', ...(step.receipt?.evidence ?? []).map(e => `- ${quote(e)}`), '');
  }
  lines.push('## Host timeline', '', ...(run.trace ?? []).map(e => `- ${new Date(e.at).toISOString()} · ${e.kind} · ${quote(e.stepId)} · ${quote(e.message)}`), '', '## External writes', '', '```json', JSON.stringify(d.writes, null, 2).replace(/`/g, '\\u0060'), '```', '', '## Test deployments and leases', '', '```json', JSON.stringify(d.deployments, null, 2).replace(/`/g, '\\u0060'), '```', '', '## Declared outputs', '', ...(run.outputs ?? []).flatMap(o => [`### ${quote(o.id)}`, '', quote(o.content), '', `SHA-256: ${o.sha256} · destination: ${quote(o.brainPath ?? 'run artifact')}`, '']), '## Coverage limits', '', ...d.coverage.unobserved.map(v => `- ${v}`), '', '## Improve this routine', '', 'Ask the Orchestrator to read this dossier, distinguish evidence from hypotheses, and propose a new package revision. The existing version, grants and recorded results must never be edited in place.', '');
  const block = (title: string, value: unknown) => lines.push(`## ${title}`, '', '```json', JSON.stringify(value, null, 2).replace(/`/g, '\\u0060'), '```', '');
  block('Original approved automation', d.approvedAutomation ?? null);
  block('Run inputs', run.inputs);
  block('Browser writes (agent-reported outcomes, host dispatch counts)', run.browserWrites ?? []);
  block('Command receipts', run.receipts ?? []);
  block('Read-only test database receipts', run.testDbEvidence ?? []);
  block('Work item history delivery', run.history ?? []);
  return lines.join('\n');
}
export function saveDossier(directory: string, dossier: RoutineDossier): { markdown: string; json: string; changed: boolean } {
  fs.mkdirSync(directory, { recursive: true });
  const files = { markdown: path.join(directory, `${dossier.run.id}.md`), json: path.join(directory, `${dossier.run.id}.json`) };
  let changed = false;
  for (const [file, body] of [[files.markdown, `${dossierMarkdown(dossier)}\n[Full evidence and frozen definition (JSON)](${files.json})\n`], [files.json, JSON.stringify(dossier, null, 2)]]) {
    if (fs.existsSync(file!) && fs.readFileSync(file!, 'utf8') === body) continue;
    changed = true; const temp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(temp, body!, { flag: 'wx', mode: 0o600 }); renameRetrying(temp, file!);
  }
  return { ...files, changed };
}
