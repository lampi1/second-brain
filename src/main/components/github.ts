// Bounded public GitHub adapter for authoring knowledge. No credentials, redirects, installer or moving-ref content.
import type { ComponentCatalog, ComponentEntry, ComponentSource } from '../../shared/components';
import { componentPath } from './bundle';
import { keys, object, text } from '../flows/schema';
export type ComponentFetch = (url: string, init: RequestInit) => Promise<Response>;
export const COMMIT = /^[a-f0-9]{40}$/;
export function sourceOf(value: unknown): ComponentSource {
  const s = object(value, 'source'); keys(s, ['repository', 'ref', 'directory', 'enabled'], 'source');
  const repository = text(s.repository, 'repository', 160), ref = text(s.ref, 'ref', 160), directory = componentPath(s.directory);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository) || !/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(ref) || ref.includes('..') || typeof s.enabled !== 'boolean') throw new Error('Invalid public GitHub source');
  return { repository, ref, directory, enabled: s.enabled };
}
async function bounded(request: ComponentFetch, url: string, max: number): Promise<string> {
  const response = await request(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok || response.status !== 200 || response.redirected) throw new Error(`Component source unavailable (${response.status})`);
  if (Number(response.headers.get('content-length')) > max || !response.body) { await response.body?.cancel(); throw new Error('Component response too large or empty'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > max) throw new Error('Component response too large'); chunks.push(chunk.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
}
interface TreeFile { path: string; mode: string; type: string; sha: string; size?: number }
export class GithubComponents {
  constructor(private readonly request: ComponentFetch = fetch) {}
  async tree(source: ComponentSource, commit: string): Promise<TreeFile[]> {
    if (!COMMIT.test(commit)) throw new Error('An exact commit is required');
    const value = JSON.parse((await bounded(this.request, `https://api.github.com/repos/${source.repository}/git/trees/${commit}?recursive=1`, 8 * 1024 * 1024)).replace(/^\uFEFF/, '')) as { truncated?: boolean; tree?: TreeFile[] };
    if (value.truncated || !Array.isArray(value.tree) || value.tree.length > 30_000) throw new Error('Incomplete or oversized component tree');
    return value.tree.filter(f => f.type === 'blob').map(f => { componentPath(f.path); if (!COMMIT.test(f.sha)) throw new Error('Invalid blob identity'); return f; });
  }
  async catalog(source: ComponentSource): Promise<ComponentCatalog> {
    const value = JSON.parse(await bounded(this.request, `https://api.github.com/repos/${source.repository}/commits/${encodeURIComponent(source.ref)}`, 512 * 1024)) as { sha?: string };
    if (!value.sha || !COMMIT.test(value.sha)) throw new Error('Source did not resolve to a commit');
    const tree = await this.tree(source, value.sha);
    const entries: ComponentEntry[] = tree.filter(f => f.mode === '100644' && f.path.startsWith(`${source.directory}/`) && /\.md$/i.test(f.path) && (!f.size || f.size <= 256 * 1024)).map(f => ({
      path: f.path, sha: f.sha, title: f.path.slice(source.directory.length + 1).replace(/\/SKILL\.md$/, '').replace(/\.md$/, ''),
      kind: /(?:^|\/)agents\//.test(f.path) ? 'agent' : /\/SKILL\.md$/.test(f.path) ? 'skill' : /(?:^|\/)commands\//.test(f.path) ? 'command' : 'reference',
    }));
    return { source, commit: value.sha, fetchedAt: Date.now(), entries };
  }
  async files(source: ComponentSource, commit: string, selected: string): Promise<{ path: string; content: string }[]> {
    componentPath(selected);
    if (!selected.startsWith(`${source.directory}/`)) throw new Error('Component is outside the configured directory');
    const tree = await this.tree(source, commit), prefix = selected.endsWith('/SKILL.md') ? selected.slice(0, -8) : null;
    const ancestors = new Set(['', ...selected.split('/').slice(0, -1).map((_, i, all) => `${all.slice(0, i + 1).join('/')}/`)]);
    const license = (p: string) => { const at = p.lastIndexOf('/') + 1; return ancestors.has(p.slice(0, at)) && /^(?:LICENSE|COPYING)(?:\.[^/]*)?$/i.test(p.slice(at)); };
    const files = tree.filter(f => f.path === selected || (prefix && f.path.startsWith(prefix)) || license(f.path));
    if (!files.some(f => f.path === selected) || files.length > 50 || files.some(f => !['100644', '100755'].includes(f.mode) || f.size === undefined || f.size > 256 * 1024) || files.reduce((n, f) => n + (f.size ?? 0), 0) > 512 * 1024) throw new Error('Component missing, linked or oversized');
    const result = [];
    for (const f of files) {
      const content = await bounded(this.request, `https://raw.githubusercontent.com/${source.repository}/${commit}/${f.path.split('/').map(encodeURIComponent).join('/')}`, 256 * 1024);
      // Verify Git's blob identity as well as the package's independent SHA-256 manifest.
      const { createHash } = await import('node:crypto');
      const bytes = Buffer.from(content), sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (sha !== f.sha) throw new Error('Downloaded component differs from its pinned tree');
      result.push({ path: f.path, content });
    }
    return result;
  }
}
