// Acquisition uses fake GitHub responses and tiny fixtures only. Successful preparation still must cross the existing
// stage-update verifier; no real request, model, app, active release or global configuration is touched.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateAcquirer } from '../../src/main/update/download';
import type { extractUpdateZip } from '../../src/main/update/extract';
import { fixtureZip } from './zip-fixture';
// @ts-expect-error unchanged plain JS stage verifier is the integration boundary
import { stageUpdate,RELEASE_WRITER_PROTOCOL } from '../../scripts/update.mjs';

const roots: string[] = [];
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(native = false,writerProtocol=RELEASE_WRITER_PROTOCOL) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-acquire-'))); roots.push(root);
  const cacheRoot = path.join(root, 'cache'), id = '1.2.3-aaaaaaa', version = '1.2.3', source = 'a'.repeat(40);
  const rel = { id, version,writerProtocol, electron: '1.0.0', claudeEngine: 'engines/claude/1.0.0/claude.exe' };
  const files: Record<string, string> = Object.fromEntries(['release.mjs', 'update.mjs', 'icon.ico', 'LICENSE', `releases/${id}/package.json`, `releases/${id}/out/main/index.js`, 'electron/1.0.0/electron.exe', rel.claudeEngine].map(name => [name, `fixture ${name}`]));
  files[`releases/${id}/release.json`] = JSON.stringify(rel);
  const payload = { schema: 1,writerProtocol, id, version, source, clean: true, electron: '1.0.0', files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, sha(value)])) };
  const payloadText = JSON.stringify(payload);
  const archive = fixtureZip([...Object.entries(files).map(([name, data]) => ({ name, data, deflate: true })), { name: 'payload.json', data: payloadText }]);
  const wrapperName = `second-brain-${id}-windows-x64-setup.json`, archiveName = `second-brain-${id}-windows-x64-update.zip`;
  const wrapper = { id, version, source, clean: true, arch: 'x64', update: { archive: archiveName, sha256: sha(archive), payloadManifestSha256: sha(payloadText) } };
  const metadata = { draft: false, prerelease: false, tag_name: `v${version}`, published_at: '2026-10-17T00:00:00Z', body: 'Useful release notes', assets: [] as { name: string; state: string; size: number; digest: string }[] };
  let wrapperBytes = Buffer.alloc(0);
  const seal = () => {
    wrapperBytes = Buffer.from(JSON.stringify(wrapper));
    metadata.assets = [{ name: wrapperName, state: 'uploaded', size: wrapperBytes.length, digest: `sha256:${sha(wrapperBytes)}` }, { name: archiveName, state: 'uploaded', size: archive.length, digest: `sha256:${sha(archive)}` }];
  };
  seal();
  const overrides = new Map<string, () => Response>();
  const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.redirect).toBe('manual'); expect(init?.credentials).toBe('omit');
    expect(JSON.stringify(init?.headers)).not.toMatch(/authorization|cookie/i);
    const url = String(input);
    if (overrides.has(url)) return overrides.get(url)!();
    if (url === 'https://api.github.com/repos/lampi1/second-brain/releases/latest') return new Response(JSON.stringify(metadata));
    if (url === `https://github.com/lampi1/second-brain/releases/download/v${version}/${wrapperName}`) return new Response(wrapperBytes);
    if (url === `https://github.com/lampi1/second-brain/releases/download/v${version}/${archiveName}`) {
      // Multiple writes must preserve archive bytes; no accidental per-chunk truncation or buffering the full payload.
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(archive.subarray(0, 70)); controller.enqueue(archive.subarray(70, 160)); controller.enqueue(archive.subarray(160)); controller.close(); } }));
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  });
  const extract = vi.fn<typeof extractUpdateZip>(async (_archive, destination) => {
    for (const [name, text] of [...Object.entries(files), ['payload.json', payloadText]]) {
      const file = path.join(destination, name!); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text!);
    }
  });
  const acquirer = new UpdateAcquirer({ cacheRoot, fetch: fakeFetch, ...(native ? {} : { extract }) });
  return { root, cacheRoot, id, version, source, payload, payloadText, files, archive, archiveName, wrapperName, wrapper, metadata, seal, fakeFetch, overrides, extract, acquirer,
    wrapperUrl: `https://github.com/lampi1/second-brain/releases/download/v${version}/${wrapperName}`,
    archiveUrl: `https://github.com/lampi1/second-brain/releases/download/v${version}/${archiveName}` };
}
describe('published update acquisition', () => {
  it('acquires a candidate without touching active state, then the existing stage verifier accepts it', async () => {
    const f = fixture();
    const active = path.join(f.root, 'stable'); fs.mkdirSync(active);
    const state=JSON.stringify({writerProtocol:RELEASE_WRITER_PROTOCOL,current:'old',previous:null,bad:[],history:[]});
    fs.writeFileSync(path.join(active, 'current.json'),state);
    const candidate = await f.acquirer.prepareLatest('1.2.2');
    expect(candidate).toMatchObject({ id: f.id, version: f.version, source: f.source, changes: 'Useful release notes' });
    expect(fs.readFileSync(path.join(active, 'current.json'), 'utf8')).toContain('old');
    expect(fs.readdirSync(active)).toEqual(['current.json']);
    const staged = stageUpdate(active, candidate!.payloadDir, candidate!.manifestSha256);
    expect(staged.id).toBe(f.id);
    expect(fs.readFileSync(path.join(active,'current.json'),'utf8')).toBe(state);
    expect(fs.readFileSync(path.join(active, 'current.json'), 'utf8')).toContain('old');
    f.acquirer.discard(candidate!);
    expect(fs.readdirSync(f.cacheRoot)).toEqual([]);
    expect(fs.existsSync(path.join(active, 'staged', `${f.id}.json`))).toBe(true);
  });
  it.skipIf(process.platform !== 'win32')('runs real native extraction for a fake published archive and can stage its exact bytes', async () => {
    const f = fixture(true), candidate = await f.acquirer.prepareLatest('1.2.2');
    const stable = path.join(f.root, 'stable');
    expect(stageUpdate(stable, candidate!.payloadDir, candidate!.manifestSha256).id).toBe(f.id);
    f.acquirer.discard(candidate!);
  });
  it('still refuses an active legacy root without silently migrating or changing its state',async()=>{
    const f=fixture(),candidate=await f.acquirer.prepareLatest('1.2.2'),active=path.join(f.root,'legacy');
    fs.mkdirSync(active);const state=JSON.stringify({current:'old',previous:null,bad:[],history:[]});fs.writeFileSync(path.join(active,'current.json'),state);
    expect(()=>stageUpdate(active,candidate!.payloadDir,candidate!.manifestSha256)).toThrow('legacy release root requires offline migration');
    expect(fs.readFileSync(path.join(active,'current.json'),'utf8')).toBe(state);expect(fs.readdirSync(active)).toEqual(['current.json']);
    f.acquirer.discard(candidate!);
  });
  it('still refuses a verified payload with an incompatible writer protocol before staging assets',async()=>{
    const f=fixture(false,RELEASE_WRITER_PROTOCOL+1),candidate=await f.acquirer.prepareLatest('1.2.2'),active=path.join(f.root,'stable');
    expect(()=>stageUpdate(active,candidate!.payloadDir,candidate!.manifestSha256)).toThrow('incompatible release writer protocol');
    expect(fs.readdirSync(active)).toEqual([]);f.acquirer.discard(candidate!);
  });
  it.each(['1.2.3', '1.3.0', '2.0.0'])('does not download equal/older release for installed %s', async installed => {
    const f = fixture(); expect(await f.acquirer.prepareLatest(installed)).toBeNull();
    expect(f.fakeFetch).toHaveBeenCalledTimes(1); expect(fs.existsSync(f.cacheRoot)).toBe(false);
  });
  it.each(['draft', 'prerelease', 'version', 'digest', 'source', 'dirty', 'arch'])('rejects untrusted %s metadata', async kind => {
    const f = fixture();
    if (kind === 'draft') f.metadata.draft = true;
    if (kind === 'prerelease') f.metadata.prerelease = true;
    if (kind === 'version') f.metadata.tag_name = 'v9.0.0';
    if (kind === 'source') f.wrapper.source = 'b'.repeat(40);
    if (kind === 'dirty') f.wrapper.clean = false;
    if (kind === 'arch') f.wrapper.arch = 'arm64';
    f.seal(); if (kind === 'digest') f.metadata.assets[0]!.digest = '';
    await expect(f.acquirer.prepareLatest('1.2.2')).rejects.toThrow(); expect(f.extract).not.toHaveBeenCalled();
  });
  it.each(['https://evil.example/payload.zip', 'http://objects.githubusercontent.com/payload.zip', 'https://github.com/other/repo/releases/download/v1/asset.zip', 'https://objects.githubusercontent.com:8443/asset', 'https://<user>:<password>@objects.githubusercontent.com/a'])('rejects redirect %s before requesting it', async target => {
    const f = fixture(); f.overrides.set(f.archiveUrl, () => new Response(null, { status: 302, headers: { location: target } }));
    await expect(f.acquirer.prepareLatest('1.2.2')).rejects.toThrow();
    expect(f.fakeFetch.mock.calls.some(call => String(call[0]) === target)).toBe(false);
    expect(fs.readdirSync(f.cacheRoot)).toEqual([]);
  });
  it('follows one allowed asset CDN redirect without carrying authentication or cookies', async () => {
    const f = fixture(), cdn = 'https://release-assets.githubusercontent.com/fake-fixture/payload.zip?sig=fixture';
    f.overrides.set(f.archiveUrl, () => new Response(null, { status: 302, headers: { location: cdn } }));
    f.overrides.set(cdn, () => new Response(new Uint8Array(f.archive)));
    const candidate = await f.acquirer.prepareLatest('1.2.2'); expect(candidate?.id).toBe(f.id); f.acquirer.discard(candidate!);
  });
  it.each(['archive', 'payload', 'extra'])('rejects tampered %s and cleans only its own private reservation', async kind => {
    const f = fixture();
    if (kind === 'archive') f.overrides.set(f.archiveUrl, () => new Response('wrong bytes'));
    else {
      const normal = f.extract.getMockImplementation()!;
      f.extract.mockImplementationOnce(async (...args) => {
        await normal(...args);
        fs.writeFileSync(path.join(args[1], kind === 'payload' ? 'payload.json' : 'extra.txt'), 'tampered');
      });
    }
    await expect(f.acquirer.prepareLatest('1.2.2')).rejects.toThrow();
    expect(fs.readdirSync(f.cacheRoot)).toEqual([]);
    expect(fs.existsSync(path.join(f.root, 'stable'))).toBe(false);
  });
  it('aborts without requesting anything and rejects an overlapping preparation', async () => {
    const f = fixture(), aborted = new AbortController(); aborted.abort();
    await expect(f.acquirer.prepareLatest('1.2.2', { signal: aborted.signal })).rejects.toThrow();
    expect(f.fakeFetch).not.toHaveBeenCalled();
    let finish!: (response: Response) => void;
    f.fakeFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.acquirer.prepareLatest('1.2.2');
    await expect(f.acquirer.prepareLatest('1.2.2')).rejects.toThrow(/already running/);
    finish(new Response(null, { status: 404 })); await expect(pending).resolves.toBeNull();
  });
  it('refuses linked cache paths and oversized metadata before extraction', async () => {
    const f = fixture(), target = path.join(f.root, 'target'); fs.mkdirSync(target);
    fs.symlinkSync(target, f.cacheRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(f.acquirer.prepareLatest('1.2.2')).rejects.toThrow(/Linked/);
    expect(fs.readdirSync(target)).toEqual([]);
    const g = fixture();
    g.overrides.set(g.wrapperUrl, () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)));
    await expect(g.acquirer.prepareLatest('1.2.2')).rejects.toThrow(/size limit/);
  });
  it('cancels the response reader even if opening the new archive file fails', async () => {
    const f = fixture(); let cancelled = false;
    f.overrides.set(f.archiveUrl, () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } })));
    vi.spyOn(fsp, 'open').mockRejectedValueOnce(new Error('fixture EACCES'));
    await expect(f.acquirer.prepareLatest('1.2.2')).rejects.toThrow('fixture EACCES');
    expect(cancelled).toBe(true); expect(fs.readdirSync(f.cacheRoot)).toEqual([]);
  });
  it('cancels an interrupted body and removes the private partial download', async () => {
    const f = fixture(), controller = new AbortController(); let cancelled = false;
    f.overrides.set(f.archiveUrl, () => new Response(new ReadableStream({ start(stream) { stream.enqueue(f.archive.subarray(0, 70)); queueMicrotask(() => controller.abort()); }, cancel() { cancelled = true; } })));
    await expect(f.acquirer.prepareLatest('1.2.2', { signal: controller.signal })).rejects.toThrow(/cancelled/);
    expect(cancelled).toBe(true); expect(fs.readdirSync(f.cacheRoot)).toEqual([]);
    expect(f.extract).not.toHaveBeenCalled();
  });
  it('caps a streaming archive body at its declared GitHub asset size', async () => {
    const f = fixture(); f.overrides.set(f.archiveUrl, () => new Response(new Uint8Array(Buffer.concat([f.archive, Buffer.from('extra')]))));
    await expect(f.acquirer.prepareLatest('1.2.2')).rejects.toThrow(/size limit/);
    expect(f.extract).not.toHaveBeenCalled(); expect(fs.readdirSync(f.cacheRoot)).toEqual([]);
  });
  it('never accepts arbitrary discard paths and native cleanup unlinks nested junctions without following them', async () => {
    const f = fixture(), candidate = await f.acquirer.prepareLatest('1.2.2');
    const victim = path.join(f.root, 'keep'); fs.mkdirSync(victim); fs.writeFileSync(path.join(victim, 'keep.txt'), 'keep');
    expect(() => f.acquirer.discard({ ...candidate!, payloadDir: victim })).toThrow(/own/);
    fs.symlinkSync(victim, path.join(candidate!.payloadDir, 'cache-link'), process.platform === 'win32' ? 'junction' : 'dir');
    f.acquirer.discard(candidate!);
    expect(fs.readFileSync(path.join(victim, 'keep.txt'), 'utf8')).toBe('keep');
    expect(fs.readdirSync(f.cacheRoot)).toEqual([]);
  });
});
