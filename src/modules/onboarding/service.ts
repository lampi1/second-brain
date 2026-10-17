// Main-only transactional connector installer. The host owns trust, secure snapshots and official harness sessions.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import type { Applied, Change, Connection, Discovery, Harness, OnboardingPort, Plan, Request } from './contract';
import { CATALOG_VERSION, compatibility, providerEndpoint } from './catalog';
import { configAfter, configPaths, semanticDiff } from './config';
import { discoverLocal } from './discovery';
import { LocalFiles } from './local';
export interface Host {
  home?: string; // defaults to os.homedir(), never a hard-coded user path
  backupRoot: string; // app private userData, NEVER project or brain
  roots?: string[];
  cliPaths?: Partial<Record<Harness, string>>;
  // Required OS-encrypted snapshots. Never substitute plaintext on machines without secure storage.
  protect(text: string): Buffer;
  unprotect(bytes: Buffer): string;
  // Must enforce confirmed project trust, organization policy and installed harness compatibility.
  allow(project: string, harness: Harness): Promise<boolean>;
  // Only initialize/capabilities/tools-list; host adapter must return provider-identity-checked evidence.
  probe?: (harness: Harness, provider: Request['provider'], endpoint: string) => Promise<Connection>;
}
interface Image { harness: Harness; file: string; before: string | null; after: string }
interface Operation { plan: Plan; images: Image[]; status: 'planned' | 'applying' | 'applied' | 'undoing' | 'undone' | 'conflict'; published: number; restored: string[] }
const hash = (value: string | null) => value === null ? 'absent' : createHash('sha256').update(value).digest('hex');
export class OnboardingService implements OnboardingPort {
  private readonly operations = new Map<string, Operation>();
  private busy = false;
  constructor(private readonly host: Host, private readonly local = new LocalFiles()) {}
  discover(): Promise<Discovery> { return discoverLocal({ ...this.host, home: this.host.home ?? os.homedir() }, this.local); }
  async prepare(request: Request): Promise<Plan> {
    if (!request || !Array.isArray(request.harnesses) || !request.harnesses.length || request.harnesses.some(h => !Object.hasOwn(configPaths, h))) throw new Error('Choose supported tools');
    await this.local.check(request.project);
    if (!(await fs.stat(request.project)).isDirectory()) throw new Error('Choose a project folder');
    const project = path.resolve(request.project), endpoint = providerEndpoint(request.provider, request.organization);
    const images: Image[] = [], changes: Change[] = [], pending: string[] = [];
    for (const harness of [...new Set(request.harnesses)]) {
      const incompatible = compatibility(request.provider, harness);
      if (incompatible) { pending.push(`${harness}: ${incompatible}`); continue; }
      if (!await this.host.allow(project, harness)) { pending.push(`${harness}: project trust, installation or company policy needs confirmation`); continue; }
      const file = path.join(project, configPaths[harness]);
      const before = await this.local.read(file);
      const after = configAfter(harness, request.provider, endpoint, before);
      if (Buffer.byteLength(after, 'utf8') > 256 * 1024) throw new Error('Generated configuration is too large; no file changed');
      images.push({ harness, file, before, after });
      changes.push({ harness, path: file, beforeHash: hash(before), diff: semanticDiff(harness, request.provider, endpoint) });
    }
    const plan: Plan = { id: randomUUID(), project, provider: request.provider, endpoint, changes, pending, login: 'official-harness', catalogVersion: CATALOG_VERSION };
    this.operations.set(plan.id, { plan, images, status: 'planned', published: 0, restored: [] });
    return structuredClone(plan); // renderer cannot mutate the authorized operation
  }
  private operation(id: string): Operation {
    const operation = this.operations.get(id);
    if (!operation) throw new Error('Plan expired; prepare a new preview');
    return operation;
  }
  private async journal(op: Operation): Promise<void> {
    const directory = path.join(this.host.backupRoot, op.plan.id);
    await this.local.check(directory, true);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const manifest = { version: 1, id: op.plan.id, status: op.status, published: op.published, restored: op.restored, images: op.images.map(i => ({ harness: i.harness, path: i.file, existed: i.before !== null, beforeHash: hash(i.before), afterHash: hash(i.after) })) };
    await this.publish(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  }
  private async publish(file: string, contents: string | Buffer, expectedHash?: string): Promise<void> {
    await this.local.check(file, true);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = path.join(path.dirname(file), `.onboarding-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
      await this.local.check(file, true);
      if (expectedHash !== undefined && hash(await this.local.read(file)) !== expectedHash) throw new Error('Concurrent edit preserved; prepare another preview');
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  private async restore(image: Image): Promise<void> {
    if (hash(await this.local.read(image.file)) !== hash(image.after)) throw new Error('Concurrent edit preserved; undo needs review');
    if (image.before === null) await fs.unlink(image.file);
    else await this.publish(image.file, image.before, hash(image.after));
  }
  async apply(id: string): Promise<Applied> {
    if (this.busy) throw new Error('Another connection is being changed');
    const op = this.operation(id);
    if (op.status !== 'planned') throw new Error('This plan was already used');
    if (!op.images.length) throw new Error('No compatible tools selected; configuration remains unchanged');
    this.busy = true;
    try {
      for (const image of op.images) {
        if (!await this.host.allow(op.plan.project, image.harness)) throw new Error('Trust or policy changed; prepare a new preview');
        if (hash(await this.local.read(image.file)) !== hash(image.before)) throw new Error('Configuration changed; prepare a new preview');
      }
      // Protect ALL before-images before the first publication. Missing secure storage stops everything.
      const snapshots = op.images.map(i => this.host.protect(JSON.stringify({ before: i.before })));
      if (snapshots.some(b => !Buffer.isBuffer(b) || !b.length)) throw new Error('Secure backup unavailable');
      op.status = 'applying'; await this.journal(op);
      for (let i = 0; i < snapshots.length; i++) await this.publish(path.join(this.host.backupRoot, id, `${i}.snapshot`), snapshots[i]!);
      for (const image of op.images) {
        if (hash(await this.local.read(image.file)) !== hash(image.before)) throw new Error('Configuration changed during connection');
        await this.publish(image.file, image.after, hash(image.before)); op.published++;
        if (await this.local.read(image.file) !== image.after) throw new Error('Configuration verification failed');
        await this.journal(op);
      }
      op.status = 'applied'; await this.journal(op);
    } catch (error) {
      let conflict = false;
      for (const image of op.images.slice(0, op.published).reverse()) { try { await this.restore(image); } catch { conflict = true; } }
      op.status = conflict ? 'conflict' : 'undone';
      await this.journal(op).catch(() => { /* previous journal retains recovery evidence */ });
      throw new Error(conflict ? 'Connection interrupted; concurrent changes preserved; review secure backup' : error instanceof Error ? error.message : 'Connection interrupted; changes rolled back');
    } finally { this.busy = false; }
    return { id, project: op.plan.project, provider: op.plan.provider, connections: await this.test(id) };
  }
  async test(id: string): Promise<Connection[]> {
    const op = this.operation(id);
    if (op.status !== 'applied') throw new Error('Apply the preview before testing');
    return Promise.all(op.images.map(async image => {
      try {
        if (hash(await this.local.read(image.file)) !== hash(image.after)) return { harness: image.harness, status: 'pending' as const, checkedAt: new Date().toISOString(), detail: 'Configuration changed; prepare another preview' };
      } catch { return { harness: image.harness, status: 'failed' as const, checkedAt: new Date().toISOString(), detail: 'Configuration check failed; backup and undo remain available' }; }
      if (this.host.probe) {
        try { return await this.host.probe(image.harness, op.plan.provider, op.plan.endpoint); }
        catch { return { harness: image.harness, status: 'failed' as const, checkedAt: new Date().toISOString(), detail: 'Read-only harness connection check failed' }; }
      }
      return { harness: image.harness, status: 'pending' as const, checkedAt: new Date().toISOString(), detail: 'Saved. Official harness login and provider verification are still required' };
    }));
  }
  async current(): Promise<Applied | null> {
    const op = [...this.operations.values()].reverse().find(o => o.status === 'applied' || o.status === 'undoing');
    if (!op) return null;
    return { id: op.plan.id, project: op.plan.project, provider: op.plan.provider, connections: op.status === 'applied' ? await this.test(op.plan.id) : op.images.map(i => ({ harness: i.harness, status: 'pending', checkedAt: new Date().toISOString(), detail: 'Undo interrupted; retry Undo to complete restoration' })) };
  }
  async undo(id: string): Promise<void> {
    if (this.busy) throw new Error('Another connection is being changed');
    const op = this.operation(id);
    if (op.status !== 'applied' && op.status !== 'undoing') throw new Error('Operation is not ready to undo');
    this.busy = true;
    try {
      // Preflight every target before restoring any; later edits are preserved for explicit review.
      for (const image of op.images) if (hash(await this.local.read(image.file)) !== hash(op.restored.includes(image.file) ? image.before : image.after)) throw new Error('Concurrent edit preserved; undo needs review');
      op.status = 'undoing'; await this.journal(op);
      for (const image of [...op.images].reverse()) {
        if (op.restored.includes(image.file)) continue;
        await this.restore(image); op.restored.push(image.file); await this.journal(op);
      }
      op.status = 'undone'; await this.journal(op);
    } finally { this.busy = false; }
  }
}
