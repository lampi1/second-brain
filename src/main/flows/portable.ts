// Portable flow definitions for renderer import/export: no runtime state or approvals cross this boundary.
import { randomUUID } from 'node:crypto';
import type { FlowDefinition, FlowDraft, FlowSnapshot } from '../../shared/flows';
import { redact } from '../log';
import type { FlowService } from './service';
import { identifier, integer, keys, object, validateDefinition } from './schema';

export const FLOW_PORTABLE_MAX_BYTES = 1024 * 1024;
type ExportInput = { flowId: string; version: number; format: 'json' | 'markdown' };
/** Use the host's known-secret registry as well as credential-shaped text. No source text is logged on failure. */
function clean(value: unknown): unknown {
  if (typeof value === 'string') return redact(value)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted]')
    .replace(/\b((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|token)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[redacted]');
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}
/** Explicit definition projection makes future host-only state non-portable by default. */
function portableDefinition(value: FlowDefinition): FlowDefinition {
  const { id, title, description, category, aliases, scope, steps } = value;
  return validateDefinition(clean({ id, title, description, ...(category === undefined ? {} : { category }), aliases, scope,
    steps: steps.map(step => {
      const { id, title, kind, instructions, inputs, action, evidence, timeoutMs, maxAttempts, effect, reviewOf, workspaceInput, adapter, testDbRead, role, tier } = step;
      return { id, title, kind, instructions, inputs, evidence, timeoutMs, maxAttempts, effect,
        ...(action ? { action } : {}), ...(reviewOf ? { reviewOf } : {}), ...(workspaceInput ? { workspaceInput } : {}),
        ...(adapter ? { adapter } : {}), ...(testDbRead ? { testDbRead } : {}), ...(role ? { role } : {}), ...(tier ? { tier } : {}) };
    }) }));
}
const md = (value: string): string => value.replace(/[\\`*_{}[\]<>#|]/g, '\\$&');
function markdown(definition: FlowDefinition, version: number): string {
  const lines = [`# ${md(definition.title)}`, '', `Version: ${version}`, '', md(definition.description), '',
    `- Category: ${md(definition.category ?? '—')}`, `- Scope: ${md([definition.scope.project, definition.scope.areaPath].filter(Boolean).join(' / ') || '—')}`,
    `- When to use: ${definition.aliases.map(md).join('; ') || '—'}`, '', '## Steps', ''];
  for (const [index, step] of definition.steps.entries()) {
    lines.push(`### ${index + 1}. ${md(step.title)}`, '', md(step.instructions), '',
      `- Kind: ${step.kind}`, `- Role: ${step.role ?? 'Orchestrator chooses'}`, `- Tier: ${step.tier ?? 'Role default'}`,
      `- Effect: ${step.effect}`, `- Inputs: ${step.inputs.map(md).join(', ') || '—'}`,
      `- Timeout: ${step.timeoutMs} ms`, `- Maximum attempts: ${step.maxAttempts}`);
    if (step.workspaceInput) lines.push(`- Workspace input: ${md(step.workspaceInput)}`);
    if (step.reviewOf) lines.push(`- Reviews step: ${md(step.reviewOf)}`);
    if (step.action) lines.push(`- Action: ${step.action.kind}: ${md(step.action.ref)}`);
    if (step.adapter) lines.push(`- Adapter: ${step.adapter}`);
    if (step.testDbRead) lines.push('- Test database reads: requested; require a new approved grant');
    lines.push('', 'Required evidence:', ...(step.evidence.length ? step.evidence.map(label => `- ${md(label)}`) : ['- —']), '');
  }
  lines.push('Definition only. Runs, receipts, activation and automatic execution settings are excluded. Recognized credentials are redacted; review free text before sharing.', 'The portable block below imports this document as a new draft.', '');
  return lines.join('\n');
}
const PORTABLE_MARKER = '<!-- second-brain-flow:json:v1 -->';
const portableJson = (definition: FlowDefinition, version: number): string => `${JSON.stringify({ format: 'second-brain-flow', schemaVersion: 1, sourceVersion: version, definition }, null, 2).replace(/`/g, '\\u0060').replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\n`;
function portableMarkdown(definition: FlowDefinition, version: number): string {
  return `${markdown(definition, version)}\n${PORTABLE_MARKER}\n\`\`\`json\n${portableJson(definition, version)}\`\`\`\n`;
}
export function exportFlow(snapshot: FlowSnapshot, input: ExportInput): { filename: string; content: string } {
  keys(object(input, 'export'), ['flowId', 'version', 'format'], 'export');
  const id = identifier(input.flowId, 'flow id'), version = integer(input.version, 'version', 1);
  if (!['json', 'markdown'].includes(input.format)) throw new Error('Unsupported flow export format');
  if (snapshot.storageError) throw new Error('Flow storage unavailable');
  const source = snapshot.versions.find(row => row.definition.id === id && row.version === version);
  if (!source) throw new Error('Flow version unavailable');
  const definition = portableDefinition(source.definition);
  const content = input.format === 'json'
    ? portableJson(definition, version)
    : portableMarkdown(definition, version);
  if (Buffer.byteLength(content, 'utf8') > FLOW_PORTABLE_MAX_BYTES) throw new Error('Flow export exceeds size limit');
  return { filename: `${id}-v${version}.${input.format === 'json' ? 'json' : 'md'}`, content };
}
/** Every import is a fresh proposal; even importing the same file twice cannot replace or activate a flow. */
export function importFlow(service: FlowService, content: string): FlowDraft {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > FLOW_PORTABLE_MAX_BYTES) throw new Error('Flow import exceeds size limit');
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const isMarkdown = !normalized.startsWith('{');
  let json = normalized;
  if (isMarkdown) {
    const parts = normalized.split(PORTABLE_MARKER);
    if (parts.length !== 2 || !parts[1]!.startsWith('\n```json\n') || !parts[1]!.endsWith('\n```')) throw new Error('Invalid portable Markdown');
    json = parts[1]!.slice('\n```json\n'.length, -'\n```'.length);
    if (json.includes('```')) throw new Error('Invalid portable Markdown block');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Invalid flow JSON'); }
  const raw = object(parsed, 'portable flow');
  keys(raw, ['format', 'schemaVersion', 'sourceVersion', 'definition'], 'portable flow');
  if (raw.format !== 'second-brain-flow' || raw.schemaVersion !== 1) throw new Error('Unsupported portable flow format');
  const version = integer(raw.sourceVersion, 'sourceVersion', 1);
  const definition = validateDefinition(raw.definition);
  if (isMarkdown && normalized !== portableMarkdown(definition, version).replace(/\r\n/g, '\n').trim()) throw new Error('Portable Markdown was changed; use an unchanged export or edit the JSON definition');
  return service.propose({ definition: { ...definition, id: `imported-${randomUUID()}` }, expectedRevision: 0 });
}
