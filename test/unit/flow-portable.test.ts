// Portable flow regression tests: exact immutable selection, bounded input and fresh proposals without execution authority.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { FlowDefinition } from '../../src/shared/flows';
import { exportFlow, importFlow, FLOW_PORTABLE_MAX_BYTES } from '../../src/main/flows/portable';
import { FlowService } from '../../src/main/flows/service';
import { addRedaction } from '../../src/main/log';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function service() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-portable-')); dirs.push(dir);
  return new FlowService({ file: path.join(dir, 'flows.json'), contextKey: 'portable-test', now: () => 10 });
}
const definition: FlowDefinition = { id: 'document-review', title: 'Document review', description: 'Review selected work.', aliases: ['review document'], scope: {}, steps: [{ id: 'review', title: 'Review', kind: 'agent', role: 'sentinel', tier: 'mid', instructions: 'Inspect the selected document.', workspaceInput: 'workspace', inputs: ['workspace'], evidence: ['report'], timeoutMs: 5000, maxAttempts: 1, effect: 'read-only' }] };
function activate(target: FlowService, revision = 0, title = 'Document review') {
  const draft = target.propose({ definition: { ...definition, title }, expectedRevision: revision });
  target.decideDefinition({ id: definition.id, expectedRevision: draft.revision, answer: 'yes' });
}
it('exports the selected immutable version with readable role, tier and evidence, excluding runs and grants', () => {
  const target = service(); activate(target); activate(target, 1, 'New definition');
  target.start({ flowId: definition.id, flowVersion: 2, subjectKey: 'private-subject', scope: {}, inputs: { workspace: '/private/runtime' } }, 'private-owner');
  const snapshot = target.snapshot();
  const json = exportFlow(snapshot, { flowId: definition.id, version: 1, format: 'json' });
  const parsed = JSON.parse(json.content);
  expect(parsed).toEqual({ format: 'second-brain-flow', schemaVersion: 1, sourceVersion: 1, definition });
  expect(json.filename).toBe('document-review-v1.json');
  for (const value of ['private-subject', '/private/runtime', 'private-owner', 'activatedAt', 'definitionDigest', 'runs', 'active', 'automation']) expect(json.content).not.toContain(value);
  const md = exportFlow(snapshot, { flowId: definition.id, version: 2, format: 'markdown' });
  for (const text of ['# New definition', 'Version: 2', 'Role: sentinel', 'Tier: mid', 'Required evidence:', '- report']) expect(md.content).toContain(text);
  expect(md.filename).toBe('document-review-v2.md');
  expect(() => exportFlow(snapshot, { flowId: definition.id, version: 3, format: 'json' })).toThrow('unavailable');
});
it('creates fresh inert drafts on repeat import and leaves existing activation and history untouched', () => {
  const target = service(); activate(target);
  const exported = exportFlow(target.snapshot(), { flowId: definition.id, version: 1, format: 'json' });
  const first = importFlow(target, exported.content), second = importFlow(target, exported.content);
  expect(first.definition.id).not.toBe(definition.id); expect(second.definition.id).not.toBe(first.definition.id);
  expect(first).toMatchObject({ status: 'proposed', revision: 1 });
  expect(first.definition.steps).toEqual(definition.steps);
  const snapshot = target.snapshot();
  expect(snapshot.active).toEqual({ [definition.id]: 1 }); expect(snapshot.versions).toHaveLength(1); expect(snapshot.runs).toEqual([]);
  expect(() => target.start({ flowId: first.definition.id, flowVersion: 1, subjectKey: 'test', scope: {}, inputs: {} }, 'o')).toThrow();
  target.decideDefinition({ id: first.definition.id, expectedRevision: first.revision, answer: 'yes' });
  expect(target.snapshot().active[first.definition.id]).toBe(1);
});
it('rejects unknown envelope/definition/step authority, malformed JSON, unsupported formats and oversized input without mutations', () => {
  const source = service(); activate(source);
  const exported = JSON.parse(exportFlow(source.snapshot(), { flowId: definition.id, version: 1, format: 'json' }).content);
  const target = service();
  for (const content of ['{broken', '{}', JSON.stringify({ ...exported, schemaVersion: 2 }), JSON.stringify({ ...exported, active: true }), JSON.stringify({ ...exported, runs: [] }), JSON.stringify({ ...exported, definition: { ...definition, grants: ['all'] } }), JSON.stringify({ ...exported, definition: { ...definition, steps: [{ ...definition.steps[0], approved: true }] } }), 'x'.repeat(FLOW_PORTABLE_MAX_BYTES + 1)]) expect(() => importFlow(target, content)).toThrow();
  expect(target.snapshot().drafts).toEqual([]);
});
it('redacts registered secrets, password assignments, URL credentials and key blocks in both export formats', () => {
  const target = service();
  const known = ['example', 'registered', 'credential'].join('-'); addRedaction(known);
  const credentialUrl = ['https://', 'reader', ':', 'sample-pass', '@', 'example.com/resource'].join('');
  const keyBlock = ['-----BEGIN', 'PRIVATE KEY-----\nsample private material\n-----END', 'PRIVATE KEY-----'].join(' ');
  const instructions = `Inspect. ${known} password="sample phrase" token=sample-value ${credentialUrl}\n${keyBlock}`;
  target.propose({ definition: { ...definition, steps: [{ ...definition.steps[0]!, instructions }] }, expectedRevision: 0 });
  target.decideDefinition({ id: definition.id, expectedRevision: 1, answer: 'yes' });
  for (const format of ['json', 'markdown'] as const) {
    const exported = exportFlow(target.snapshot(), { flowId: definition.id, version: 1, format }).content;
    for (const secret of [known, 'sample phrase', 'sample-value', 'sample-pass', 'sample private material']) expect(exported).not.toContain(secret);
    expect(exported).toContain('redacted');
    if (format === 'json') expect(importFlow(service(), exported).status).toBe('proposed');
  }
});
it('round-trips combined DevOps writes and requested test DB reads without transferring target grants', () => {
  const target = service();
  const combined = { ...definition, steps: [{ ...definition.steps[0]!, effect: 'external-write' as const, adapter: 'devops-write' as const, testDbRead: true as const }] };
  target.propose({ definition: combined, expectedRevision: 0 }); target.decideDefinition({ id: definition.id, expectedRevision: 1, answer: 'yes' });
  const json = exportFlow(target.snapshot(), { flowId: definition.id, version: 1, format: 'json' });
  const imported = importFlow(service(), json.content);
  expect(imported.definition.steps[0]).toMatchObject({ adapter: 'devops-write', testDbRead: true });
  expect(imported.status).toBe('proposed'); expect(json.content).not.toContain('targetIds');
  expect(exportFlow(target.snapshot(), { flowId: definition.id, version: 1, format: 'markdown' }).content).toContain('Test database reads: requested; require a new approved grant');
});
it('imports the readable Markdown export as a fresh inert draft, including Windows line endings', () => {
  const source = service(); activate(source);
  const exported = exportFlow(source.snapshot(), { flowId: definition.id, version: 1, format: 'markdown' });
  const target = service();
  const draft = importFlow(target, exported.content.replace(/\n/g, '\r\n'));
  expect(draft.definition).toEqual({ ...definition, id: draft.definition.id });
  expect(draft.status).toBe('proposed'); expect(target.snapshot().active).toEqual({}); expect(target.snapshot().runs).toEqual([]);
});
it('rejects tampered readable text, duplicate blocks, trailing payloads, malformed fences and hidden execution fields in Markdown', () => {
  const source = service(); activate(source);
  const exported = exportFlow(source.snapshot(), { flowId: definition.id, version: 1, format: 'markdown' }).content;
  const target = service();
  for (const content of [exported.replace('# Document review', '# Different title'), exported + exported, exported + '\n```json\n{}\n```', exported.replace('```json', '```javascript'), exported.replace('"schemaVersion": 1,', '"schemaVersion": 1, "active": true,'), exported.replace('<!-- second-brain-flow:json:v1 -->', '')]) expect(() => importFlow(target, content)).toThrow();
  expect(target.snapshot().drafts).toEqual([]);
});
it('round-trips Markdown definitions containing code fences and marker-like instructional text', () => {
  const source = service();
  const instructions = 'Review this code:\n```sql\nSELECT 1\n```\nTreat <!-- second-brain-flow:json:v1 --> as plain example text.';
  source.propose({ definition: { ...definition, steps: [{ ...definition.steps[0]!, instructions }] }, expectedRevision: 0 }); source.decideDefinition({ id: definition.id, expectedRevision: 1, answer: 'yes' });
  const exported = exportFlow(source.snapshot(), { flowId: definition.id, version: 1, format: 'markdown' });
  expect(importFlow(service(), exported.content).definition.steps[0]!.instructions).toBe(instructions);
});
it('preserves original CRLF prose when importing its unchanged Markdown export', () => {
  const source = service();
  const original = { ...definition, description: 'Review selected work.\r\nPreserve its original text.', steps: [{ ...definition.steps[0]!, instructions: 'Inspect the document.\r\nRecord the result.' }] };
  source.propose({ definition: original, expectedRevision: 0 }); source.decideDefinition({ id: definition.id, expectedRevision: 1, answer: 'yes' });
  const exported = exportFlow(source.snapshot(), { flowId: definition.id, version: 1, format: 'markdown' });
  const imported = importFlow(service(), exported.content);
  expect(imported.definition.description).toBe(original.description);
  expect(imported.definition.steps[0]!.instructions).toBe(original.steps[0]!.instructions);
});
