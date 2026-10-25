// Brain-scoped inert component staging and draft conversion. Native user approval remains solely in FlowService.
import fs from 'node:fs';
import path from 'node:path';
import type { ComponentBundle, ComponentOperation, ComponentResult, ComponentSource, ComponentState } from '../../shared/components';
import type { FlowService } from '../flows/service';
import { identifier, integer, keys, object, text } from '../flows/schema';
import { atomicWrite } from '../rules/storage';
import { bundleDiff, bundleOf, hash } from './bundle';
import { GithubComponents, sourceOf } from './github';
import { readDefinitionFile } from '../flows/definition-file';
const DEFAULT: ComponentSource = { repository: 'davila7/claude-code-templates', ref: 'main', directory: 'cli-tool/components', enabled: false };
export class ComponentService {
  private data: ComponentState;
  private busy = false;
  private checked = 0;
  constructor(private readonly directory: string, private readonly context: string, private readonly live: () => string, private readonly flows: () => FlowService, private readonly github = new GithubComponents(), private readonly brainRoot?: () => string | null) {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'catalog.json');
    if (!fs.existsSync(file)) this.data = { sources: [DEFAULT], catalogs: [], bundles: [] };
    else {
      if (fs.statSync(file).size > 12 * 1024 * 1024) throw new Error('Component catalog exceeds storage limit');
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as ComponentState;
      if (!Array.isArray(raw.sources) || raw.sources.length > 10 || !Array.isArray(raw.catalogs) || raw.catalogs.length > 10 || !Array.isArray(raw.bundles) || raw.bundles.length > 100) throw new Error('Invalid component catalog');
      this.data = { sources: raw.sources.map(sourceOf), catalogs: raw.catalogs, bundles: raw.bundles.map(b => this.verify(b)) };
    }
  }
  private assert(): void { if (this.live() !== this.context) throw new Error('Brain context changed; reopen component catalog'); }
  private save(): void { this.assert(); const data = JSON.stringify(this.data); if (Buffer.byteLength(data) > 12 * 1024 * 1024) throw new Error('Component catalog full'); atomicWrite(this.directory, 'catalog.json', data); }
  private verify(bundle: ComponentBundle): ComponentBundle { const checked = bundleOf(bundle.files, bundle.origin, bundle.createdAt); if (checked.digest !== bundle.digest) throw new Error('Stored component manifest changed'); return checked; }
  state(): ComponentState { this.assert(); return structuredClone(this.data); }
  private source(repository: string): ComponentSource { const s = this.data.sources.find(s => s.repository === repository); if (!s?.enabled) throw new Error('Enable this source in the component dialog first'); return s; }
  private bundle(digest: string): ComponentBundle { if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid bundle digest'); const b = this.data.bundles.find(b => b.digest === digest); if (!b) throw new Error('Unknown staged bundle'); return this.verify(b); }
  /** No model calls; refresh at most daily, retry unavailable sources at most hourly. */
  async tick(now = Date.now()): Promise<void> {
    if (this.busy || now - this.checked < 3_600_000) return; this.checked = now;
    for (const source of this.data.sources.filter(s => s.enabled)) {
      const catalog = this.data.catalogs.find(c => c.source.repository === source.repository);
      if (!catalog || now - catalog.fetchedAt >= 86_400_000) try { await this.perform({ op: 'refresh', repository: source.repository }); } catch { /* explicit refresh reports the error; preserve last good snapshot */ }
    }
  }
  async perform(input: ComponentOperation, nativeUser = false): Promise<ComponentResult> {
    this.assert(); const raw = object(input, 'component operation');
    const fields: Record<ComponentOperation['op'], string[]> = { state: [], source: ['source'], refresh: ['repository'], search: ['query', 'limit'], stage: ['repository', 'commit', 'path'], local: ['files', 'name'], inspect: ['digest', 'previous'], propose: ['digest', 'definition', 'definitionPath', 'expectedRevision', 'assets', 'stepIds'] };
    if (!(input.op in fields)) throw new Error('Unknown component operation'); keys(raw, ['op', ...fields[input.op]], 'component operation');
    if (input.op === 'state') return { state: this.state() };
    if (input.op === 'search') {
      const words = text(input.query, 'query', 500, true).toLowerCase().split(/\s+/).filter(Boolean), limit = integer(input.limit ?? 12, 'limit', 1, 30);
      const matches = this.data.catalogs.filter(c => this.data.sources.some(s => s.repository === c.source.repository && s.enabled)).flatMap(c => c.entries.map(e => ({ ...e, repository: c.source.repository, commit: c.commit })))
        .map(entry => ({ entry, score: words.reduce((n, w) => n + (entry.title.toLowerCase().includes(w) ? 1 : 0), 0) })).filter(r => !words.length || r.score > 0)
        .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path)).slice(0, limit).map(r => r.entry);
      return { matches };
    }
    if (input.op === 'inspect') { const bundle = this.bundle(input.digest); return { bundle, ...(input.previous ? { diff: bundleDiff(this.bundle(input.previous), bundle) } : {}) }; }
    if (this.busy) throw new Error('A component update is already in progress'); this.busy = true;
    const previous = structuredClone(this.data);
    try {
      if (input.op === 'source') {
        if (!nativeUser) throw new Error('Only the user can configure component sources');
        const source = sourceOf(input.source), rest = this.data.sources.filter(s => s.repository !== source.repository);
        if (rest.length >= 10) throw new Error('At most ten component sources');
        this.data.sources = [...rest, source]; this.data.catalogs = this.data.catalogs.filter(c => c.source.repository !== source.repository); this.checked = 0;
      } else if (input.op === 'refresh') {
        const source = structuredClone(this.source(input.repository)), catalog = await this.github.catalog(source); this.assert();
        this.data.catalogs = [...this.data.catalogs.filter(c => c.source.repository !== source.repository), catalog];
      } else if (input.op === 'stage' || input.op === 'local') {
        const source = input.op === 'stage' ? this.source(input.repository) : undefined;
        if (input.op === 'stage' && !this.data.catalogs.some(c => c.source.repository === input.repository && c.commit === input.commit && c.entries.some(e => e.path === input.path))) throw new Error('Select a component from the pinned catalog first');
        const files = input.op === 'stage' ? await this.github.files(source!, input.commit, input.path) : input.files;
        this.assert(); const bundle = bundleOf(files, input.op === 'stage' ? { repository: input.repository, commit: input.commit, path: input.path } : { path: text(input.name, 'bundle name', 120) });
        if (bundle.findings.some(f => f.severity === 'block')) throw new Error('Possible secret in component bundle; remove it before staging');
        if (!this.data.bundles.some(b => b.digest === bundle.digest)) { if (this.data.bundles.length >= 100) throw new Error('Component staging is full'); this.data.bundles.push(bundle); }
        this.save(); return { bundle };
      } else if (input.op === 'propose') {
        const bundle = this.bundle(input.digest);
        if (bundle.findings.some(f => f.severity === 'block')) throw new Error('Blocked component cannot be adopted');
        if (!Array.isArray(input.assets) || !input.assets.length || input.assets.length > 49 || !Array.isArray(input.stepIds) || !input.stepIds.length) throw new Error('Select assets and target steps');
        if (Object.hasOwn(input, 'definition') === Object.hasOwn(input, 'definitionPath')) throw new Error('Supply exactly one of definition or definitionPath');
        const definition = input.definitionPath === undefined ? structuredClone(input.definition!) : readDefinitionFile(this.brainRoot?.(), input.definitionPath, this.context);
        if (!definition.package) throw new Error('Component adoption requires a sealed routine package');
        const selected = input.assets.map(value => { const a = object(value, 'asset'); keys(a, ['id', 'path'], 'asset'); const f = bundle.files.find(f => f.path === a.path); if (!f) throw new Error('Asset is not in the reviewed bundle'); return { id: identifier(a.id, 'asset id'), kind: 'reference' as const, content: f.content, sha256: f.sha256, source: { path: `${bundle.origin.repository ?? 'local'}@${bundle.origin.commit ?? bundle.digest}/${f.path}`, sha256: f.sha256 } }; });
        for (const file of bundle.files.filter(f => /(?:^|\/)(?:LICENSE|COPYING)(?:\.[^/]*)?$/i.test(f.path))) if (!input.assets.some(a => a.path === file.path)) throw new Error('Include the bundled license when adopting component content');
        const manifest = { id: `component-${bundle.digest.slice(0, 12)}`, kind: 'reference' as const, content: JSON.stringify({ digest: bundle.digest, origin: bundle.origin, license: bundle.license, files: input.assets, findings: bundle.findings }, null, 2), sha256: '' };
        manifest.sha256 = hash(manifest.content); this.assert();
        definition.package.assets.push(...selected, manifest);
        const ids = [...selected.map(a => a.id), manifest.id];
        for (const id of input.stepIds) { const step = definition.steps.find(s => s.id === id); if (!step) throw new Error('Unknown target step'); step.assets = [...new Set([...(step.assets ?? []), ...ids])]; }
        const draft = this.flows().propose({ definition, expectedRevision: integer(input.expectedRevision, 'expectedRevision') });
        return { proposal: { flowId: draft.definition.id, revision: draft.revision } };
      }
      this.save(); return { state: this.state() };
    } catch (error) { this.data = previous; throw error; } finally { this.busy = false; }
  }
}
