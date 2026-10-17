// Acquires ONLY a newer published Windows payload from the fixed public product repository. Main supplies cache and
// installed version; renderer never supplies URLs/paths. The existing release CLI still owns stage/verify/apply.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractUpdateZip } from './extract';

const REPO = 'lampi1/second-brain';
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const JSON_MAX = 2 * 1024 * 1024;
const ZIP_MAX = 1536 * 1024 * 1024;
const CACHE_MAX = 4 * 1024 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const SEMVER = /^(0|[1-9]\d{0,6})\.(0|[1-9]\d{0,6})\.(0|[1-9]\d{0,6})$/;
const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
type Json = Record<string, unknown>;
const object = (value: unknown): Json => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid update metadata.'); return value as Json; };
const parse = (bytes: Buffer): Json => object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const abort = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('Update preparation cancelled.'); };
const portable = (name: string) => name.length > 0 && name.length <= 500 && name.split('/').every(part => /^[A-Za-z0-9._+ -]+$/.test(part) && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));

export interface AcquiredUpdate {
  id: string; version: string; source: string; changes: string; releaseUrl: string;
  payloadDir: string; manifestSha256: string;
}
export interface UpdateAcquirerOptions {
  cacheRoot: string;
  fetch?: typeof fetch; // dependency injection for offline fixtures, never IPC input
  extract?: typeof extractUpdateZip;
}
interface Asset { name: string; size: number; digest: string }
function asset(value: unknown): Asset {
  const a = object(value);
  if (typeof a.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(a.name) || !Number.isSafeInteger(a.size) || Number(a.size) <= 0 || a.state !== 'uploaded' || typeof a.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(a.digest)) throw new Error('Release asset is not verifiable.');
  return { name: a.name, size: Number(a.size), digest: a.digest.slice(7) };
}
function canonicalDirectory(root: string): string {
  if (!path.isAbsolute(root) || /^(?:\\\\|\/\/)/.test(root)) throw new Error('A local main-owned update cache is required.');
  const resolved = path.resolve(root);
  let parent = resolved;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  if (!same(fs.realpathSync.native(parent), parent)) throw new Error('Linked update cache is not permitted.');
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  if (!same(fs.realpathSync.native(resolved), resolved)) throw new Error('Linked update cache is not permitted.');
  return resolved;
}
function inventory(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || !same(fs.realpathSync.native(file), file)) throw new Error('Linked update payload is not permitted.');
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(path.relative(root, file).split(path.sep).join('/'));
      else throw new Error('Special update file is not permitted.');
      if (files.length > 25000) throw new Error('Update file limit exceeded.');
    }
  };
  walk(root); return files.sort();
}

export class UpdateAcquirer {
  private busy = false;
  private prepared = new Map<string, { cache: string; work: string; dev: number; ino: number }>();
  constructor(private readonly options: UpdateAcquirerOptions) {}

  /** Main calls this only after stage-update has committed its own verified marker, or to discard a candidate. */
  discard(candidate: AcquiredUpdate): void {
    const record = this.prepared.get(candidate.payloadDir);
    if (!record) throw new Error('This acquisition does not own the cache candidate.');
    this.removeOwned(record);
    this.prepared.delete(candidate.payloadDir);
  }

  private removeOwned(record: { cache: string; work: string; dev: number; ino: number }): void {
    if (!fs.existsSync(record.work)) return;
    const stat = fs.lstatSync(record.work);
    // Checked absolute targets stay inside this exact cache; no arbitrary caller path or replaced root is deleted.
    if (path.dirname(record.work) !== record.cache || !/^acquire-/.test(path.basename(record.work)) || stat.isSymbolicLink() || stat.dev !== record.dev || stat.ino !== record.ino || !same(fs.realpathSync.native(record.cache), record.cache) || !same(fs.realpathSync.native(record.work), record.work)) throw new Error('Update cache ownership changed; preserve it.');
    fs.rmSync(record.work, { recursive: true, force: true });
  }

  private cacheBytes(cache: string): number {
    let bytes = 0, entries = 0;
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (++entries > 75000) throw new Error('Update cache entry limit exceeded.');
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink() || !same(fs.realpathSync.native(file), file)) throw new Error('Linked update cache is not permitted.');
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile()) bytes += fs.statSync(file).size;
        else throw new Error('Special update cache file is not permitted.');
        if (bytes > CACHE_MAX) throw new Error('Update cache size limit exceeded.');
      }
    };
    walk(cache); return bytes;
  }

  private async response(url: string, limit: number, signal: AbortSignal, allowMissing = false): Promise<Response | null> {
    const initial = new URL(url);
    let current = initial;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const allowed = current.protocol === 'https:' && !current.username && !current.password && !current.port && !current.hash && current.href.length < 16384 &&
        (initial.href === LATEST ? current.href === LATEST : ((current.hostname === 'github.com' && current.pathname === initial.pathname) || ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(current.hostname)));
      if (!allowed) throw new Error('Update redirect is outside the trusted distribution hosts.');
      abort(signal);
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(initial.href === LATEST ? 20000 : 5 * 60 * 1000)]);
      const response = await (this.options.fetch ?? fetch)(current.href, { redirect: 'manual', credentials: 'omit', signal: requestSignal,
        headers: { Accept: initial.href === LATEST ? 'application/vnd.github+json' : 'application/octet-stream', 'X-GitHub-Api-Version': '2026-03-10' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = response.headers.get('location');
        await response.body?.cancel();
        if (!target || redirects === 3) throw new Error('Update redirect limit exceeded.');
        current = new URL(target, current); continue;
      }
      if (allowMissing && response.status === 404) { await response.body?.cancel(); return null; }
      if (response.status !== 200 || Number(response.headers.get('content-length') ?? 0) > limit || !response.body) { await response.body?.cancel(); throw new Error('Update download failed or exceeded its size limit.'); }
      return response;
    }
    throw new Error('Update redirect limit exceeded.');
  }

  private async read(response: Response, max: number, signal: AbortSignal, file?: string): Promise<{ bytes: Buffer; sha256: string; size: number }> {
    const reader = response.body!.getReader();
    let output: Awaited<ReturnType<typeof fsp.open>> | null = null;
    const chunks: Buffer[] = [], hash = createHash('sha256'); let size = 0;
    try {
      output = file ? await fsp.open(file, 'wx', 0o600) : null;
      while (true) {
        abort(signal);
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > max) throw new Error('Update download exceeded its size limit.');
        hash.update(value);
        if (output) await output.writeFile(value); else chunks.push(Buffer.from(value));
      }
      return { bytes: Buffer.concat(chunks), sha256: hash.digest('hex'), size };
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); await output?.close(); }
  }

  async prepareLatest(installedVersion: string, options: { signal?: AbortSignal } = {}): Promise<AcquiredUpdate | null> {
    if (this.busy) throw new Error('Update preparation is already running.');
    if (!this.options.extract && process.platform !== 'win32') throw new Error('Update acquisition currently supports Windows only.');
    if (!SEMVER.test(installedVersion)) throw new Error('Installed stable version is invalid.');
    this.busy = true;
    const signal = AbortSignal.any([AbortSignal.timeout(10 * 60 * 1000), ...(options.signal ? [options.signal] : [])]);
    let reservation: { cache: string; work: string; dev: number; ino: number } | null = null;
    try {
      const response = await this.response(LATEST, JSON_MAX, signal, true);
      if (!response) return null;
      const release = parse((await this.read(response, JSON_MAX, signal)).bytes);
      if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v') || !SEMVER.test(release.tag_name.slice(1)) || typeof release.published_at !== 'string' || !Number.isFinite(Date.parse(release.published_at)) || !Array.isArray(release.assets) || release.assets.length > 100) throw new Error('No verifiable published stable release.');
      const version = release.tag_name.slice(1), latest = version.split('.').map(Number), installed = installedVersion.split('.').map(Number);
      const first = latest.findIndex((n, i) => n !== installed[i]);
      if (first < 0 || latest[first]! < installed[first]!) return null;
      const candidates = release.assets.filter(value => /^second-brain-[A-Za-z0-9][A-Za-z0-9._-]{0,127}-windows-x64-setup\.json$/.test(String(object(value).name)));
      if (candidates.length !== 1) throw new Error('Exactly one Windows update manifest is required.');
      const wrapperAsset = asset(candidates[0]);
      if (wrapperAsset.size > JSON_MAX) throw new Error('Update manifest exceeded its size limit.');
      const assetUrl = (name: string) => `https://github.com/${REPO}/releases/download/${release.tag_name}/${name}`;
      const wrapperResponse = await this.response(assetUrl(wrapperAsset.name), JSON_MAX, signal);
      const wrapperBytes = await this.read(wrapperResponse!, JSON_MAX, signal);
      if (wrapperBytes.size !== wrapperAsset.size || wrapperBytes.sha256 !== wrapperAsset.digest) throw new Error('Update manifest SHA-256 mismatch.');
      const wrapper = parse(wrapperBytes.bytes), update = object(wrapper.update);
      if (typeof wrapper.id !== 'string' || !wrapper.id.startsWith(`${version}-`) || !/^[a-f0-9]{7,40}$/.test(wrapper.id.slice(version.length + 1)) || wrapper.version !== version || wrapper.arch !== 'x64' || wrapper.clean !== true || typeof wrapper.source !== 'string' || !/^[a-f0-9]{40}$/.test(wrapper.source) || !wrapper.source.startsWith(wrapper.id.slice(version.length + 1)) || wrapperAsset.name !== `second-brain-${wrapper.id}-windows-x64-setup.json` || update.archive !== `second-brain-${wrapper.id}-windows-x64-update.zip` || typeof update.sha256 !== 'string' || !SHA.test(update.sha256) || typeof update.payloadManifestSha256 !== 'string' || !SHA.test(update.payloadManifestSha256)) throw new Error('Update provenance does not match its published stable release.');
      const zipAssets = release.assets.filter(value => object(value).name === update.archive);
      if (zipAssets.length !== 1) throw new Error('Exactly one update archive is required.');
      const zipAsset = asset(zipAssets[0]);
      if (zipAsset.size > ZIP_MAX || zipAsset.digest !== update.sha256) throw new Error('Update archive metadata mismatch or size limit.');
      const cache = canonicalDirectory(this.options.cacheRoot);
      if (this.cacheBytes(cache) > CACHE_MAX - zipAsset.size - 2 * 1024 * 1024 * 1024) throw new Error('Update cache has no room for another bounded preparation.');
      const work = fs.mkdtempSync(path.join(cache, 'acquire-'));
      const reserved = fs.lstatSync(work);
      reservation = { cache, work, dev: reserved.dev, ino: reserved.ino };
      const archive = path.join(work, 'payload.zip'), payloadDir = path.join(work, 'payload');
      fs.mkdirSync(payloadDir, { mode: 0o700 });
      const zipResponse = await this.response(assetUrl(zipAsset.name), ZIP_MAX, signal);
      const downloaded = await this.read(zipResponse!, zipAsset.size, signal, archive);
      if (downloaded.size !== zipAsset.size || downloaded.sha256 !== zipAsset.digest) throw new Error('Update archive SHA-256 mismatch.');
      abort(signal);
      await (this.options.extract ?? extractUpdateZip)(archive, payloadDir, signal);
      abort(signal);
      const names = inventory(payloadDir), manifestFile = path.join(payloadDir, 'payload.json');
      if (!names.includes('payload.json') || fs.statSync(manifestFile).size > 8 * 1024 * 1024) throw new Error('Payload manifest is missing or too large.');
      const manifestBytes = fs.readFileSync(manifestFile);
      if (digest(manifestBytes) !== update.payloadManifestSha256) throw new Error('Payload manifest SHA-256 mismatch.');
      const payload = parse(manifestBytes), files = object(payload.files);
      if (payload.schema !== 1 || payload.id !== wrapper.id || payload.version !== version || payload.source !== wrapper.source || payload.clean !== true || !Object.entries(files).every(([name, sha]) => portable(name) && typeof sha === 'string' && SHA.test(sha)) || JSON.stringify(names) !== JSON.stringify(['payload.json', ...Object.keys(files)].sort())) throw new Error('Payload inventory or provenance mismatch.');
      // NOT READY/APPLIED: main must run the one release CLI stage-update, which verifies asset hashes/layout and
      // commits its staged marker. Main owns consent/checkpoints/quiescence; this acquisition never touches them.
      const result = { id: wrapper.id, version, source: wrapper.source, changes: typeof release.body === 'string' ? release.body.slice(0, 20000) : '', releaseUrl: `https://github.com/${REPO}/releases/tag/${release.tag_name}`, payloadDir, manifestSha256: update.payloadManifestSha256 };
      this.prepared.set(payloadDir, reservation);
      reservation = null;
      return result;
    } catch (error) {
      if (reservation) this.removeOwned(reservation);
      throw error;
    } finally { this.busy = false; }
  }
}
