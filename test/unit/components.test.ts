// Security and authority regression coverage for inert catalog adoption, pinning and concurrent brain changes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundleDiff, bundleOf } from '../../src/main/components/bundle';
import { GithubComponents, sourceOf } from '../../src/main/components/github';
import { ComponentService } from '../../src/main/components/service';
import { componentTools } from '../../src/main/components/tools';
import { FlowService } from '../../src/main/flows/service';
import type { FlowDefinition } from '../../src/shared/flows';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })));
const source = { repository: 'example/catalog', ref: 'main', directory: 'components', enabled: true }, commit = 'a'.repeat(40);
const files = [{ path: 'components/review.md', content: 'Explain the change and cite evidence.' }, { path: 'LICENSE', content: 'Synthetic test license.' }];
const definition = (): FlowDefinition => ({ id: 'sample', title: 'Sample', description: 'A sample.', aliases: [], scope: {}, package: { schema: 1, assets: [], outputs: [], requiredOps: [] }, steps: [{ id: 'read', title: 'Read', kind: 'agent', role: 'scout', tier: 'light', engine: 'test', model: 'test', agentPrompt: 'Read the task.', instructions: 'Review the sample.', inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['result'], timeoutMs: 10000, maxAttempts: 2, effect: 'read-only' }] });
function setup(github = new GithubComponents()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-component-')); dirs.push(dir); let context = 'first';
  const flow = new FlowService({ file: path.join(dir, 'state.json'), contextKey: context });
  const service = new ComponentService(path.join(dir, 'components'), context, () => context, () => flow, github);
  return { dir, service, flow, switchBrain: () => { context = 'second'; } };
}
describe('component manifests', () => {
  it.each(['../bad', '/absolute', 'a//b', 'a/./b', 'a\\b', 'C:/x', '.git/config', 'a./b'])('rejects unsafe path %s', p => expect(() => bundleOf([{ path: p, content: 'hello' }], { path: 'local' })).toThrow());
  it('binds digest to bytes and provenance, independent of file order/time', () => {
    const a = bundleOf(files, { path: 'local' }, 1), b = bundleOf([...files].reverse(), { path: 'local' }, 99);
    expect(a.digest).toBe(b.digest); expect(bundleOf(files, { path: 'other' }).digest).not.toBe(a.digest);
    expect(bundleOf([{ ...files[0]!, content: 'changed' }], { path: 'local' }).digest).not.toBe(a.digest);
    expect(bundleDiff(a, bundleOf([{ ...files[0]!, content: 'changed' }], { path: 'local' }))).toEqual({ added: [], removed: ['LICENSE'], changed: ['components/review.md'], unchanged: 0 });
  });
  it('rejects collisions, oversized files and supplied hash mismatch', () => {
    expect(() => bundleOf([...files, { path: 'license', content: 'x' }], { path: 'x' })).toThrow('Duplicate');
    expect(() => bundleOf([{ path: 'x', content: 'x'.repeat(256 * 1024 + 1) }], { path: 'x' })).toThrow('256');
    expect(() => bundleOf([{ ...files[0], sha256: 'bad' }], { path: 'x' })).toThrow('hash');
  });
});
describe('pinned public GitHub adapter', () => {
  const tree = files.map(f => ({ path: f.path, mode: '100644', type: 'blob', size: Buffer.byteLength(f.content), sha: createHash('sha1').update(`blob ${Buffer.byteLength(f.content)}\0${f.content}`).digest('hex') }));
  it('resolves the ref once, copies pinned content and verifies blob hashes', async () => {
    const request = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.redirect).toBe('error'); expect(init.credentials).toBe('omit'); expect(init.headers).not.toHaveProperty('Authorization');
      if (url.includes('/commits/')) return Response.json({ sha: commit });
      if (url.includes('/git/trees/')) { expect(url).toContain(commit); return Response.json({ tree, truncated: false }); }
      expect(url).toContain(`/${commit}/`); return new Response(files.find(f => url.endsWith(f.path))!.content);
    });
    const github = new GithubComponents(request), catalog = await github.catalog(source);
    expect(catalog.entries).toHaveLength(1); expect(catalog.commit).toBe(commit);
    expect(await github.files(source, commit, files[0]!.path)).toEqual(files);
  });
  it('rejects partial trees, symlink assets, wrong bytes and moving refs', async () => {
    await expect(new GithubComponents(async () => Response.json({ truncated: true, tree })).tree(source, commit)).rejects.toThrow('Incomplete');
    await expect(new GithubComponents(async () => Response.json({ tree: tree.map(f => ({ ...f, mode: '120000' })) })).files(source, commit, files[0]!.path)).rejects.toThrow('linked');
    await expect(new GithubComponents(async url => url.includes('/git/trees/') ? Response.json({ tree }) : new Response('wrong')).files(source, commit, files[0]!.path)).rejects.toThrow('differs');
    await expect(new GithubComponents().tree(source, 'main')).rejects.toThrow('exact commit');
  });
  it('rejects arbitrary origins, traversal and redirects', async () => {
    expect(() => sourceOf({ ...source, repository: 'https://internal.local/repo' })).toThrow();
    expect(() => sourceOf({ ...source, ref: '../../private' })).toThrow();
    await expect(new GithubComponents(async () => new Response('', { status: 302 })).catalog(source)).rejects.toThrow('unavailable');
  });
  it('preserves BOM bytes and every ancestor license', async () => {
    const values = [{ path: 'LICENSE', content: 'root terms' }, { path: 'components/LICENSE.md', content: 'specific terms' }, { path: 'components/review.md', content: '\uFEFFReview carefully.' }];
    const entries = values.map(f => ({ path: f.path, mode: '100644', type: 'blob', size: Buffer.byteLength(f.content), sha: createHash('sha1').update(`blob ${Buffer.byteLength(f.content)}\0${f.content}`).digest('hex') }));
    const github = new GithubComponents(async url => url.includes('/git/trees/') ? Response.json({ tree: entries }) : new Response(values.find(f => url.endsWith(`/${f.path}`))!.content));
    expect(await github.files(source, commit, 'components/review.md')).toEqual(values);
  });
});
describe('component authority', () => {
  it('starts offline and only native user configuration enables a source', async () => {
    const github = new GithubComponents(), spy = vi.spyOn(github, 'catalog'); const { service } = setup(github);
    await service.tick(); expect(spy).not.toHaveBeenCalled();
    await expect(service.perform({ op: 'source', source })).rejects.toThrow('Only the user');
    await expect(service.perform({ op: 'refresh', repository: source.repository })).rejects.toThrow('Enable');
    await service.perform({ op: 'source', source }, true); expect(service.state().sources).toContainEqual(source);
  });
  it('refuses secret material without persisting it', async () => {
    const { service } = setup(); await expect(service.perform({ op: 'local', name: 'local', files: [{ path: '.env', content: 'private=true' }] })).rejects.toThrow('Possible secret');
    expect(service.state().bundles).toEqual([]);
  });
  it('stages inert content and proposes through normal approval without activating', async () => {
    const { service, flow } = setup(), staged = await service.perform({ op: 'local', name: 'sample', files });
    const result = await service.perform({ op: 'propose', digest: staged.bundle!.digest, definition: definition(), expectedRevision: 0, assets: files.map((f, i) => ({ path: f.path, id: `asset-${i}` })), stepIds: ['read'] });
    expect(result.proposal).toEqual({ flowId: 'sample', revision: 1 }); expect(flow.snapshot().active).toEqual({});
    const draft = flow.snapshot().drafts[0]!; expect(draft.status).toBe('proposed'); expect(draft.definition.package!.assets).toHaveLength(3);
    expect(draft.definition.steps[0]!.assets).toHaveLength(3);
  });
  it('requires retaining licenses and still refuses brain runtime references', async () => {
    const { service, flow } = setup(), staged = await service.perform({ op: 'local', name: 'sample', files });
    await expect(service.perform({ op: 'propose', digest: staged.bundle!.digest, definition: definition(), expectedRevision: 0, assets: [{ path: files[0]!.path, id: 'review' }], stepIds: ['read'] })).rejects.toThrow('license');
    const bad = definition(); bad.steps[0]!.instructions = 'Read brain-v2/rules/private.md';
    await expect(service.perform({ op: 'propose', digest: staged.bundle!.digest, definition: bad, expectedRevision: 0, assets: files.map((f, i) => ({ path: f.path, id: `a-${i}` })), stepIds: ['read'] })).rejects.toThrow();
    expect(flow.snapshot().drafts).toEqual([]);
  });
  it('does not store a delayed response after the selected brain changes', async () => {
    const github = new GithubComponents(); let finish!: (c: Awaited<ReturnType<GithubComponents['catalog']>>) => void;
    vi.spyOn(github, 'catalog').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { service, switchBrain, dir } = setup(github); await service.perform({ op: 'source', source }, true);
    const pending = service.perform({ op: 'refresh', repository: source.repository }); switchBrain(); finish({ source, commit, entries: [], fetchedAt: 1 });
    await expect(pending).rejects.toThrow('Brain context changed'); expect(JSON.parse(fs.readFileSync(path.join(dir, 'components/catalog.json'), 'utf8')).catalogs).toEqual([]);
  });
  it('exposes no agent activation/configuration tool and rejects extra fields', async () => {
    const { service } = setup(), tools = componentTools(() => service);
    expect(tools.map(t => t.name).join(' ')).not.toMatch(/approve|activate|source/);
    await expect(tools.find(t => t.name === 'app_component_search')!.run({ contextKey: 'first', query: 'review', op: 'source' })).rejects.toThrow('unknown field');
  });
});
