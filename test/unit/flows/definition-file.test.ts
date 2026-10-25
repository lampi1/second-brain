// File transport must accept large definitions while preserving validation, exact approvals and brain confinement.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { FlowDefinition } from '../../../src/shared/flows';
import { appControlTools } from '../../../src/main/appctl/tools';
import { FLOW_DEFINITION_FILE_MAX_BYTES, FLOW_DEFINITION_READ_ATTEMPTS, readDefinitionFile } from '../../../src/main/flows/definition-file';
import { digest } from '../../../src/main/flows/schema';
import { FlowService } from '../../../src/main/flows/service';
import { flowBrainContextKey } from '../../../src/main/flows/context';
import { flowTools } from '../../../src/main/flows/tools';
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function definition(large = false): FlowDefinition {
  return { id: 'example-routine', title: 'Example routine', description: 'A portable user-authored routine.', aliases: [], scope: {},
    steps: Array.from({ length: large ? 6 : 1 }, (_, i) => ({ id: `step-${i}`, title: `Step ${i}`, kind: 'agent', instructions: large ? 'Inspect the evidence. '.repeat(700).trim() : 'Inspect the evidence.', inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['result'], timeoutMs: 60000, maxAttempts: 2, effect: 'read-only', role: 'scout', tier: 'mid', engine: 'claude', model: 'sonnet', agentPrompt: 'Inspect and report evidence.' })),
    package: { schema: 1, assets: [], outputs: [], requiredOps: [] } };
}
function setup() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flow-file-'))); dirs.push(dir);
  const root = path.join(dir, 'brain'), file = path.join(root, 'reviews', 'routine.json');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(definition()));
  const contextKey = flowBrainContextKey(root), service = new FlowService({ file: path.join(dir, 'state.json'), contextKey });
  const brainRoot = vi.fn(() => root);
  const tool = flowTools({ ownerId: 'owner', service: () => service, resolveBinding: () => null, brainRoot }).find(t => t.name === 'app_flow_propose')!;
  const args = { contextKey, expectedRevision: 0, definitionPath: 'reviews/routine.json' };
  return { dir, root, file, service, tool, brainRoot, args };
}
it.each(['relative', 'absolute'])('proposes a >88k definition by %s file path with a compact receipt and exact immutable approval', async mode => {
  const f = setup(), d = definition(true), json = JSON.stringify(d); expect(json.length).toBeGreaterThan(88000);
  fs.writeFileSync(f.file, json);
  const receipt = await f.tool.run({ ...f.args, definitionPath: mode === 'absolute' ? f.file : f.args.definitionPath });
  expect(receipt).toMatchObject({ flowId: d.id, revision: 1, status: 'proposed', digest: digest(d), stepCount: 6 });
  expect(JSON.stringify(receipt).length).toBeLessThan(1000);
  expect(f.service.snapshot()).toMatchObject({ active: {}, runs: [] });
  expect(f.service.snapshot().drafts[0]!.definition).toEqual(d);
  fs.writeFileSync(f.file, JSON.stringify({ ...d, title: 'Changed later' }));
  f.service.decideDefinition({ id: d.id, expectedRevision: 1, answer: 'yes' });
  expect(f.service.snapshot().versions[0]!.definition).toEqual(d);
});
it('keeps inline proposals backward compatible and permits file-only arguments in the client-compatible object schema', async () => {
  const f = setup(), d = definition();
  expect(await f.tool.run({ contextKey: f.args.contextKey, expectedRevision: 0, definition: d })).toMatchObject({ definition: d, revision: 1, status: 'proposed' });
  expect(f.brainRoot).not.toHaveBeenCalled();
  expect(f.tool.inputSchema).toMatchObject({ type: 'object', required: ['contextKey', 'expectedRevision'], properties: { definition: { type: 'object' }, definitionPath: { type: 'string' } } });
  expect(f.tool.inputSchema).not.toHaveProperty('oneOf');
});
it('requires exactly one source, current context and valid revision before touching a file', () => {
  const f = setup();
  expect(() => f.tool.run({ ...f.args, definition: definition() })).toThrow('exactly one');
  expect(() => f.tool.run({ contextKey: f.args.contextKey, expectedRevision: 0 })).toThrow('exactly one');
  expect(() => f.tool.run({ ...f.args, contextKey: 'previous-brain' })).toThrow('context changed');
  expect(() => f.tool.run({ ...f.args, expectedRevision: -1 })).toThrow('expectedRevision');
  expect(() => f.tool.run({ ...f.args, approved: true })).toThrow('unknown field');
  expect(f.brainRoot).not.toHaveBeenCalled(); expect(f.service.snapshot().drafts).toEqual([]);
});
it('rejects a stale draft revision and never activates or grants from file metadata', () => {
  const f = setup(); f.tool.run(f.args);
  expect(() => f.tool.run(f.args)).toThrow('Draft changed');
  fs.writeFileSync(f.file, JSON.stringify({ ...definition(), approved: true, devopsWrite: { ops: ['comment'] } }));
  expect(() => f.tool.run({ ...f.args, expectedRevision: 1 })).toThrow('unknown field');
  expect(f.service.snapshot()).toMatchObject({ active: {}, runs: [] });
  expect(f.service.snapshot().drafts).toHaveLength(1);
});
it.each(['field-limit', 'brain-instructions', 'brain-asset', 'asset-hash', 'unknown-step'] as const)('preserves the same %s rejection as inline proposals', kind => {
  const f = setup(), d = definition();
  if (kind === 'field-limit') d.steps[0]!.instructions = 'x'.repeat(16001);
  if (kind === 'brain-instructions') d.steps[0]!.instructions = 'Read rules/example.md';
  if (kind === 'brain-asset') d.package!.assets = [{ id: 'notes', kind: 'checklist', content: 'Read rules/example.md', sha256: '' }];
  if (kind === 'asset-hash') d.package!.assets = [{ id: 'notes', kind: 'checklist', content: 'Review evidence.', sha256: '0'.repeat(64) }];
  if (kind === 'unknown-step') Object.assign(d.steps[0]!, { arbitraryPermission: true });
  let message = '';
  try { f.service.propose({ definition: d, expectedRevision: 0 }); } catch (e) { message = (e as Error).message; }
  expect(message).toBeTruthy(); fs.writeFileSync(f.file, JSON.stringify(d));
  expect(() => f.tool.run(f.args)).toThrow(message); expect(f.service.snapshot().drafts).toEqual([]);
});
it('runs the same model and role-tier checks after file loading', () => {
  const f = setup(), validateModels = vi.fn(() => { throw new Error('Model unavailable'); });
  const models = new FlowService({ file: path.join(f.dir, 'models.json'), contextKey: f.args.contextKey, validateModels });
  const tiers = new FlowService({ file: path.join(f.dir, 'tiers.json'), contextKey: f.args.contextKey, tierMax: () => 'light' });
  for (const [service, reason] of [[models, 'Model unavailable'], [tiers, 'exceeds']] as const) {
    const tool = flowTools({ ownerId: 'owner', service: () => service, resolveBinding: () => null, brainRoot: f.brainRoot }).find(t => t.name === 'app_flow_propose')!;
    expect(() => tool.run(f.args)).toThrow(reason); expect(service.snapshot().drafts).toEqual([]);
  }
  expect(validateModels).toHaveBeenCalledOnce();
});
it('confines absolute and relative paths to the selected brain, including sibling-prefix and alternate-stream tricks', () => {
  const f = setup(), sibling = path.join(f.dir, 'brain-other'); fs.mkdirSync(sibling);
  const outside = path.join(sibling, 'routine.json'); fs.copyFileSync(f.file, outside);
  for (const input of [outside, '../brain-other/routine.json', 'reviews/../reviews/routine.json', 'reviews/routine.json:stream.json', 'reviews/routine.txt', 'file:///etc/routine.json']) {
    expect(() => readDefinitionFile(f.root, input, f.args.contextKey)).toThrow();
  }
  expect(() => readDefinitionFile(null, f.file, f.args.contextKey)).toThrow('Connect a brain');
});
it('rejects symbolic links, linked parents, hard links and non-regular JSON paths', () => {
  const f = setup(), other = path.join(f.dir, 'outside'); fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'routine.json'), JSON.stringify(definition()));
  fs.symlinkSync(other, path.join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => readDefinitionFile(f.root, 'linked/routine.json', f.args.contextKey)).toThrow('links');
  fs.symlinkSync(f.file, path.join(f.root, 'linked-file.json'), 'file');
  expect(() => readDefinitionFile(f.root, 'linked-file.json', f.args.contextKey)).toThrow('links');
  fs.linkSync(path.join(other, 'routine.json'), path.join(f.root, 'hard.json'));
  expect(() => readDefinitionFile(f.root, 'hard.json', f.args.contextKey)).toThrow('single-link');
  fs.mkdirSync(path.join(f.root, 'directory.json'));
  expect(() => readDefinitionFile(f.root, 'directory.json', f.args.contextKey)).toThrow('regular');
});
it('bounds bytes before parsing, accepts UTF-8 BOM and rejects invalid JSON/encoding without echoing contents', () => {
  const f = setup(); fs.writeFileSync(f.file, '\uFEFF' + JSON.stringify(definition())); expect(readDefinitionFile(f.root, f.file, f.args.contextKey)).toEqual(definition());
  fs.writeFileSync(f.file, Buffer.alloc(FLOW_DEFINITION_FILE_MAX_BYTES + 1, 32)); expect(() => readDefinitionFile(f.root, f.file, f.args.contextKey)).toThrow('1 MiB');
  for (const content of ['private-source-marker { broken', Buffer.from([0xff, 0xfe, 0x7b]), 'null', '[]']) {
    fs.writeFileSync(f.file, content);
    expect(() => readDefinitionFile(f.root, f.file, f.args.contextKey)).toThrow(/UTF-8 JSON|expected object/);
    try { readDefinitionFile(f.root, f.file, f.args.contextKey); } catch (e) { expect(String(e)).not.toContain('private-source-marker'); expect(String(e)).not.toContain(f.root); }
  }
  fs.unlinkSync(f.file); expect(() => readDefinitionFile(f.root, f.file, f.args.contextKey)).toThrow('exists and is readable');
});
it('rejects file replacement between checking and opening without reading the replacement', () => {
  const f = setup(), open = fs.openSync; let replaced = false;
  vi.spyOn(fs, 'openSync').mockImplementation((file, flags, mode) => {
    if (file === f.file && !replaced) { replaced = true; fs.renameSync(f.file, f.file + '.old'); fs.writeFileSync(f.file, JSON.stringify(definition(true))); }
    return open(file, flags, mode);
  });
  const read = vi.spyOn(fs, 'readSync');
  expect(() => readDefinitionFile(f.root, f.file, f.args.contextKey)).toThrow('changed while opening'); expect(read).not.toHaveBeenCalled();
});
it('rejects mutation after the bounded read and always closes the descriptor', () => {
  const f = setup(), stat = fs.fstatSync; let checked = false;
  vi.spyOn(fs, 'fstatSync').mockImplementation((fd, options) => {
    if (checked) fs.appendFileSync(f.file, ' ');
    checked = true;
    return stat(fd, options);
  });
  const close = vi.spyOn(fs, 'closeSync');
  expect(() => readDefinitionFile(f.root, f.file, f.args.contextKey)).toThrow('changed while reading'); expect(close).toHaveBeenCalled();
});
it('rejects a parent swapped to an outside junction after realpath even when restored before the next component check', () => {
  const f = setup(), parent = path.dirname(f.file), held = path.join(f.root, 'held'), outside = path.join(f.dir, 'outside');
  fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'routine.json'), JSON.stringify({ ...definition(), title: 'Outside brain' }));
  const realpath = fs.realpathSync, lstat = fs.lstatSync; let swapped = false;
  vi.spyOn(fs, 'realpathSync').mockImplementation((file, options) => {
    const result = realpath(file, options);
    if (file === f.file && !swapped) {
      fs.renameSync(parent, held); fs.symlinkSync(outside, parent, process.platform === 'win32' ? 'junction' : 'dir'); swapped = true;
    }
    return result;
  });
  vi.spyOn(fs, 'lstatSync').mockImplementation((file, options) => {
    if (file === parent && swapped) { fs.unlinkSync(parent); fs.renameSync(held, parent); swapped = false; }
    return lstat(file, options);
  });
  const read = vi.spyOn(fs, 'readSync');
  expect(() => readDefinitionFile(f.root, f.file, f.args.contextKey)).toThrow(/directory changed|links/); expect(read).not.toHaveBeenCalled();
});
it('rejects a swapped ancestor above the selected brain instead of snapshotting the outside directories', () => {
  const f = setup(), held = f.dir + '-held', outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flow-file-outside-')));
  dirs.push(outside); fs.mkdirSync(path.join(outside, 'brain', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'brain', 'reviews', 'routine.json'), JSON.stringify({ ...definition(), title: 'Outside brain' }));
  let swapped = false;
  const restore = () => { if (swapped) { fs.unlinkSync(f.dir); fs.renameSync(held, f.dir); swapped = false; } };
  const redirect = () => { if (!swapped) { fs.renameSync(f.dir, held); fs.symlinkSync(outside, f.dir, process.platform === 'win32' ? 'junction' : 'dir'); swapped = true; } };
  const realpath = fs.realpathSync;
  vi.spyOn(fs, 'realpathSync').mockImplementation((file, options) => {
    if (file === f.file) restore();
    const result = realpath(file, options);
    if (file === f.file || file === f.root) redirect();
    return result;
  });
  const read = vi.spyOn(fs, 'readSync');
  try { expect(() => readDefinitionFile(f.root, f.file, f.args.contextKey)).toThrow(/links|directory changed/); expect(read).not.toHaveBeenCalled(); }
  finally { restore(); }
});
it.each([false, true])('retries incidental ancestor metadata only, with a fixed attempt bound (continuous=%s)', continuous => {
  const f = setup(), realpath = fs.realpathSync; let changes = 0, attempts = 0;
  vi.spyOn(fs, 'realpathSync').mockImplementation((file, options) => {
    if (file === f.root) attempts++;
    const result = realpath(file, options);
    if (file === f.file && (continuous || changes === 0)) fs.writeFileSync(path.join(f.dir, `unrelated-${++changes}.txt`), 'unrelated file');
    return result;
  });
  // Windows may expose directory timestamps at a later checkpoint; count complete attempts, not per-path checks.
  if (continuous) { expect(() => readDefinitionFile(f.root, f.file, f.args.contextKey)).toThrow('directory changed'); expect(attempts).toBe(FLOW_DEFINITION_READ_ATTEMPTS); expect(changes).toBeGreaterThanOrEqual(attempts); }
  else { expect(readDefinitionFile(f.root, f.file, f.args.contextKey)).toEqual(definition()); expect(changes).toBe(1); }
});
it('rejects a root switched after authenticating the context, before opening or reading any definition', () => {
  const f = setup(), other = setup();
  f.brainRoot.mockReturnValue(other.root);
  const open = vi.spyOn(fs, 'openSync'), read = vi.spyOn(fs, 'readSync');
  expect(() => f.tool.run(f.args)).toThrow('Brain context changed');
  expect(open).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  expect(f.service.snapshot().drafts).toEqual([]);
});
it('never trusts a different canonical brain when retrying incidental metadata changes', () => {
  const f = setup(), other = setup(), realpath = fs.realpathSync; let changed = false;
  vi.spyOn(fs, 'realpathSync').mockImplementation((file, options) => {
    if (file === f.root && changed) return realpath(other.root, options);
    const result = realpath(file, options);
    if (file === f.file && !changed) { changed = true; fs.writeFileSync(path.join(f.dir, 'noise.txt'), 'unrelated'); }
    return result;
  });
  const read = vi.spyOn(fs, 'readSync');
  expect(() => f.tool.run(f.args)).toThrow('Brain context changed'); expect(read).not.toHaveBeenCalled();
});
it('accepts a user-configured root alias only when it still resolves to the authenticated canonical brain', () => {
  const f = setup(), alias = path.join(f.dir, 'alias');
  fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  expect(readDefinitionFile(alias, 'reviews/routine.json', f.args.contextKey)).toEqual(definition());
});
it('uses the live brain only on an authenticated Orchestrator mount and rechecks caller revocation', () => {
  const f = setup(); let closed = false;
  type Deps = Parameters<typeof appControlTools>[0];
  const deps = { chats: { list: () => [{ id: 'owner', isOrchestrator: true, ...(closed ? { closedAt: 1 } : {}) }] }, browser: {}, brain: { info: () => ({ brainRoot: f.root }) },
    flows: { service: () => f.service, resolveBinding: () => null }, window: () => null, emitUi: () => {}, version: 'test' } as unknown as Deps;
  expect(appControlTools(deps).find(t => t.name === 'app_flow_propose')).toBeUndefined();
  const tool = appControlTools(deps, 'owner').find(t => t.name === 'app_flow_propose')!;
  expect(tool.run(f.args)).toMatchObject({ flowId: 'example-routine', status: 'proposed' });
  closed = true;
  expect(() => tool.run({ ...f.args, expectedRevision: 1 })).toThrow('Authenticated Orchestrator');
});
