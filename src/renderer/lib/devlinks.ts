// The Azure DevOps links of one chat, found locally (no model, no tokens) in its messages and tool calls: pull
// requests, work items, test plans, pipelines (builds) and releases, from dev.azure.com and *.visualstudio.com URLs
// and from the ids of the DevOps MCP tools (e.g. my-devops: wit_get_work_item, repo_get_pull_request_by_id, …), whose
// result also gives the title. Why: the user asks "dammi il link alla PR / al bug" many times a day, and each ask makes
// the model re-read the whole chat; the chips in the tile's header answer at once. Pure: used by
// components/ChatLinkChips.tsx (with the cached DevOps data for titles) and test/unit/devlinks.test.ts.
import { DEVOPS_URL_PATTERN } from '@shared/devops-urls';
import type { ChatItem, TasksState } from '@shared/contract';

export type DevLinkKind = 'pr' | 'workitem' | 'testplan' | 'build' | 'release';
export interface DevLink {
  kind: DevLinkKind;
  id: number;
  url: string;
  /** the title when known (tool result or cached DevOps data) */
  title?: string;
  /** work item type when known ("Bug", "Task", "Test Case") */
  type?: string;
  /** the time of the last mention: the list is sorted by it, newest first */
  at: number;
}

const KIND_LABEL: Record<DevLinkKind, string> = { pr: 'PR', workitem: 'Work item', testplan: 'Test plan', build: 'Pipeline', release: 'Release' };
/** What a chip says when the title is unknown: the type and the id. */
export const linkLabel = (l: DevLink): string => `${l.type ?? KIND_LABEL[l.kind]} ${l.id}`;
export const linkKindLabel = (l: DevLink): string => l.type ?? KIND_LABEL[l.kind];

const URL_RE = DEVOPS_URL_PATTERN;

/** One DevOps web URL → its kind and id (null for anything else: API URLs, repos, boards). */
export function parseDevopsUrl(raw: string): { kind: DevLinkKind; id: number; url: string; org: string } | null {
  const url = raw.replace(/[.,;:!?*_~]+$/, '');
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host !== 'dev.azure.com' && !/^[a-z0-9-]+\.visualstudio\.com$/.test(host)) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  const org = host === 'dev.azure.com' ? `https://dev.azure.com/${segs[0] ?? ''}` : `https://${host}`;
  if (host === 'dev.azure.com' && !segs[0]) return null;
  const path = u.pathname.toLowerCase();
  if (path.includes('/_apis/')) return null;
  const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);
  const q = (k: string) => { for (const [key, v] of u.searchParams) if (key.toLowerCase() === k) return v; return null; };
  let m: RegExpMatchArray | null;
  if ((m = path.match(/\/pullrequest\/(\d+)/))) return { kind: 'pr', id: Number(m[1]), url, org };
  if ((m = path.match(/\/_workitems\/edit\/(\d+)/))) return { kind: 'workitem', id: Number(m[1]), url, org };
  const wi = num(q('workitem'));
  if (wi) return { kind: 'workitem', id: wi, url, org };
  const plan = num(q('planid'));
  if (path.includes('/_testplans/') || path.includes('/_testmanagement')) return plan ? { kind: 'testplan', id: plan, url, org } : null;
  const build = num(q('buildid'));
  if (path.includes('/_build') && build) return { kind: 'build', id: build, url, org };
  const release = num(q('releaseid'));
  if (path.includes('/_release') && release) return { kind: 'release', id: release, url, org };
  return null;
}

// ---- the DevOps MCP tools (<team>-devops, azure-devops, ado): ids from the input, title from the result

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};
const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  const lower = new Map(Object.keys(o).map(k => [k.toLowerCase(), k]));
  for (const k of keys) { const real = lower.get(k.toLowerCase()); if (real !== undefined && o[real] !== undefined) return o[real]; }
  return undefined;
};
/** The first JSON string value of a key in a (maybe truncated) JSON text. */
function jsonField(text: string, key: string): string | undefined {
  const re = new RegExp(`"${key.replace(/[.]/g, '\\.')}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = text.match(re);
  if (!m) return undefined;
  try { return str(JSON.parse(`"${m[1]}"`)); } catch { return str(m[1]); }
}

/** The tool's own name when it belongs to a DevOps MCP server ("mcp__my-devops__wit_get_work_item" → "wit_get_work_item"). */
export function devopsToolName(name: string): string | null {
  const m = name.match(/^mcp__([^_]*(?:devops|ado)[^_]*)__(.+)$/i);
  return m ? m[2]!.toLowerCase() : null;
}

interface ToolRef { kind: DevLinkKind; id: number; project?: string; repo?: string; title?: string; type?: string }

/** The objects a DevOps tool call points at (several for a batch read). */
export function toolRefs(name: string, input: unknown, output?: string): ToolRef[] {
  const tool = devopsToolName(name);
  if (!tool || !input || typeof input !== 'object') return [];
  const inp = input as Record<string, unknown>;
  const project = str(pick(inp, 'project'));
  const out = output ?? '';
  if (tool.startsWith('wit_')) {
    const ids = pick(inp, 'ids');
    if (Array.isArray(ids)) {
      const titles = batchTitles(out);
      return ids.map(int).filter((n): n is number => n !== null).map(id => ({ kind: 'workitem' as const, id, project, ...titles.get(id) }));
    }
    const id = int(pick(inp, 'id', 'workItemId'));
    if (!id) return [];
    const ref: ToolRef = { kind: 'workitem', id, project };
    // only a read of this item says its title (an update's result, a comment list, a link: not reliably)
    if (/^wit_get_work_item$|^wit_update_work_item$/.test(tool)) {
      const title = jsonField(out, 'System.Title');
      const type = jsonField(out, 'System.WorkItemType');
      if (title) ref.title = title;
      if (type) ref.type = type;
    }
    return [ref];
  }
  if (tool.startsWith('repo_') && tool.includes('pull_request')) {
    const id = int(pick(inp, 'pullRequestId', 'pullRequest', 'prId'));
    if (!id) return [];
    const ref: ToolRef = { kind: 'pr', id, project, repo: str(pick(inp, 'repositoryId', 'repository', 'repo')) };
    if (tool === 'repo_get_pull_request_by_id') {
      const title = jsonField(out, 'title');
      if (title) ref.title = title;
      const repo = out.match(/"repository"\s*:\s*\{[^{}]*?"name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (repo?.[1]) ref.repo = repo[1];
    }
    return [ref];
  }
  if (tool.startsWith('testplan_')) {
    const id = int(pick(inp, 'planId', 'planid', 'testPlanId'));
    return id ? [{ kind: 'testplan', id, project }] : [];
  }
  if (tool.startsWith('pipelines_') || tool.startsWith('build_')) {
    const id = int(pick(inp, 'buildId', 'buildid'));
    return id ? [{ kind: 'build', id, project }] : [];
  }
  if (tool.startsWith('release_')) {
    const id = int(pick(inp, 'releaseId', 'releaseid'));
    return id ? [{ kind: 'release', id, project }] : [];
  }
  return [];
}

/** id → title/type from a batch read's result (only when it is whole JSON). */
function batchTitles(out: string): Map<number, { title?: string; type?: string }> {
  const map = new Map<number, { title?: string; type?: string }>();
  let data: unknown;
  try { data = JSON.parse(out); } catch { return map; }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { value?: unknown }).value) ? (data as { value: unknown[] }).value : [];
  for (const w of list) {
    if (!w || typeof w !== 'object') continue;
    const id = int((w as { id?: unknown }).id);
    const f = (w as { fields?: Record<string, unknown> }).fields ?? {};
    if (id) map.set(id, { title: str(f['System.Title']), type: str(f['System.WorkItemType']) });
  }
  return map;
}

/** The web URL of a tool ref, from the organization seen in the chat or the cached DevOps data (null when unknown). */
function refUrl(r: ToolRef, org: string | null): string | null {
  if (!org) return null;
  const p = r.project ? `/${encodeURIComponent(r.project)}` : '';
  switch (r.kind) {
    case 'workitem': return `${org}${p}/_workitems/edit/${r.id}`;
    case 'pr': return r.project && r.repo ? `${org}${p}/_git/${encodeURIComponent(r.repo)}/pullrequest/${r.id}` : null;
    case 'testplan': return p ? `${org}${p}/_testPlans/define?planId=${r.id}` : null;
    case 'build': return p ? `${org}${p}/_build/results?buildId=${r.id}` : null;
    case 'release': return p ? `${org}${p}/_releaseProgress?releaseId=${r.id}` : null;
  }
}

/** Titles and types from the Task page's cached data, by "kind:id". */
export function cachedTitles(d: TasksState | null | undefined): Map<string, { title: string; type?: string; url: string }> {
  const map = new Map<string, { title: string; type?: string; url: string }>();
  if (!d) return map;
  const wi = (w: { id: number; title: string; type?: string; url: string } | undefined) => { if (w?.title) map.set(`workitem:${w.id}`, { title: w.title, type: w.type, url: w.url }); };
  const pr = (p: { id: number; title: string; url: string } | undefined) => { if (p?.title) map.set(`pr:${p.id}`, { title: p.title, url: p.url }); };
  for (const n of d.news ?? []) { wi(n.item); pr(n.pr); }
  for (const w of [...(d.assigned ?? []), ...(d.urgent ?? [])]) wi(w);
  for (const p of [...(d.oldReviews ?? []), ...(d.reviews ?? [])]) pr(p);
  for (const p of d.prs ?? []) { pr(p); for (const w of p.workItems ?? []) wi(w); }
  for (const det of Object.values(d.details ?? {})) for (const t of det.tests ?? []) wi({ ...t, type: 'Test Case' });
  return map;
}

/** The organization URL of the cached DevOps data (the first item's link), for tool ids with no URL in the chat. */
function cachedOrg(d: TasksState | null | undefined): string | null {
  const u = d?.prs?.[0]?.url ?? d?.assigned?.[0]?.url ?? d?.news?.[0]?.url ?? d?.reviews?.[0]?.url;
  return u ? parseDevopsUrl(u)?.org ?? null : null;
}

const textOf = (it: ChatItem): string[] => {
  switch (it.kind) {
    case 'user': case 'assistant': return [it.text];
    case 'tool': {
      let inp = '';
      try { inp = typeof it.input === 'string' ? it.input : JSON.stringify(it.input ?? '') ?? ''; } catch { /* cyclic: skip */ }
      return [it.summary, inp, it.output ?? '', ...(it.outputUrls ?? [])];
    }
    default: return [];
  }
};

// Items are immutable (a change replaces the object): each one is scanned once, so a streaming chat (an update every
// ~16 ms) re-scans only the item that changed, then merges.
type Scan = { urls: NonNullable<ReturnType<typeof parseDevopsUrl>>[]; refs: ToolRef[] };
const NONE: Scan = { urls: [], refs: [] };
const scans = new WeakMap<ChatItem, Scan>();
function scan(it: ChatItem): Scan {
  if (it.kind !== 'user' && it.kind !== 'assistant' && it.kind !== 'tool') return NONE;
  let sc = scans.get(it);
  if (sc) return sc;
  sc = { urls: [], refs: it.kind === 'tool' ? toolRefs(it.name, it.input, it.output) : [] };
  for (const text of textOf(it)) for (const m of text.matchAll(URL_RE)) { const p = parseDevopsUrl(m[0]); if (p) sc.urls.push(p); }
  scans.set(it, sc);
  return sc;
}

/** Every DevOps link of a chat, one per object, newest mention first; titles from tool results, else the cache. */
export function extractDevLinks(items: readonly ChatItem[], devops?: TasksState | null): DevLink[] {
  const found = new Map<string, DevLink>();
  let org: string | null = null;
  const pending: { ref: ToolRef; at: number }[] = [];
  // seq breaks ties between mentions with the same time: the later one in the chat is the newer
  let seq = 0;
  const order = new Map<string, number>();
  const put = (l: DevLink) => {
    const key = `${l.kind}:${l.id}`;
    const prev = found.get(key);
    found.set(key, { ...l, url: prev?.url || l.url, title: l.title ?? prev?.title, type: l.type ?? prev?.type, at: Math.max(l.at, prev?.at ?? 0) });
    if (!prev || l.at >= prev.at) order.set(key, ++seq);
  };
  for (const it of items) {
    const sc = scan(it);
    for (const p of sc.urls) {
      org ??= p.org;
      put({ kind: p.kind, id: p.id, url: p.url, at: it.at });
    }
    for (const ref of sc.refs) pending.push({ ref, at: it.at });
  }
  org ??= cachedOrg(devops);
  for (const { ref, at } of pending) {
    const prev = found.get(`${ref.kind}:${ref.id}`);
    const url = prev?.url ?? refUrl(ref, org);
    if (!url) continue;
    put({ kind: ref.kind, id: ref.id, url, at, title: ref.title, type: ref.type });
  }
  const cache = cachedTitles(devops);
  return [...found.values()].map(l => {
    const c = cache.get(`${l.kind}:${l.id}`);
    return c ? { ...l, title: l.title ?? c.title, type: l.type ?? c.type } : l;
  }).sort((a, b) => b.at - a.at || (order.get(`${b.kind}:${b.id}`) ?? 0) - (order.get(`${a.kind}:${a.id}`) ?? 0));
}
