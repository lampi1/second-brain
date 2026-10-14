// The live brain map: which "neurons" are working right now. From what the app sees (its chats with their engine, the
// tools they run with their input, the browser tabs they drive) it computes, for the map's current view: the nodes to
// light (a chat at work, a brain file being read or written, a tool or agent in use, a browser environment), the links
// that pulse while in progress and fade out after (chat → file, Regia → chat for app_send_to_chat or inbox.mjs, chat →
// browser or environment, chat → its engine), the extra nodes the view lacks (each live chat, a brain file not drawn,
// a browser environment) and which chat a lit node opens. Only files inside the brain folder count (a chat reading a
// code repo lights itself, not the map). Pure, DOM-free; unit-tested in test/unit/brain-ui/live.test.ts; fed by the app
// (renderer/lib/liveSource.ts) and drawn by map/BrainMap.tsx + map/engine.ts.
import type { MapEdge, MapNode } from '../types';
import { edgeKey, groupIndex, relFile } from './map';

/** `engine` = the engine's short name ("Claude", "Kimi"), from the app's registry */
export interface LiveChat { id: string; title: string; harness: string; engine: string; state: string; isRegia: boolean; cwd: string }
/** A tool call of a chat: running (endAt null) or finished at endAt. */
export interface LiveTool { chatId: string; id: string; name: string; input: unknown; summary: string; startAt: number; endAt: number | null; error?: boolean }
export interface LiveTab { chatId: string; env: string | null; title: string; url: string }
export interface LiveSnapshot { now: number; chats: LiveChat[]; tools: LiveTool[]; tabs: LiveTab[] }
/** What the app gives the map: the current snapshot and a way to hear when it changes. */
export interface LiveSource { get(): LiveSnapshot; subscribe(fn: () => void): () => void }

/** How long a finished call keeps glowing, fading out. */
export const FADE_MS = 15_000;
/** Kind of the links drawn by the live map. */
export const LIVE_KIND = 'vivo';
export type LiveKind = 'chat' | 'file' | 'tool' | 'agent' | 'browser' | 'service' | 'engine';
export interface Glow { level: number; running: boolean; kind: LiveKind; doing: string[]; chats: string[] }
export interface LinkGlow { level: number; running: boolean }
export interface LiveGraph {
  nodes: MapNode[];
  edges: MapEdge[];
  glow: Map<string, Glow>;
  links: Map<string, LinkGlow>;
  /** node id → the chat a click opens (a live chat, the Regia) */
  chatOf: Map<string, string>;
  /** the chats at work, newest activity first (the legend) */
  working: { id: string; title: string; harness: string; engine: string; doing: string; level: number; running: boolean; isRegia: boolean }[];
  counts: { chats: number; files: number; tools: number };
}

const ACTIVE = new Set(['starting', 'running', 'waiting']);
const READ = new Set(['Read', 'Grep', 'Glob', 'NotebookRead', 'LS']);
const WRITE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const isAbs = (p: string) => /^([a-z]:)?\//i.test(p.replace(/\\/g, '/'));
const base = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? p;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** 1 while running, then down to 0 over FADE_MS after the end. */
export function levelOf(t: Pick<LiveTool, 'endAt'>, now: number): number {
  if (t.endAt == null) return 1;
  return Math.max(0, Math.min(1, 1 - (now - t.endAt) / FADE_MS));
}

/** The file a tool call reads or writes (absolute, with the chat's folder for a relative path), or null. */
export function fileOfTool(t: Pick<LiveTool, 'name' | 'input'>, cwd: string): { path: string; write: boolean } | null {
  if (!READ.has(t.name) && !WRITE.has(t.name)) return null;
  const i = rec(t.input);
  const p = str(i.file_path) || str(i.notebook_path) || str(i.path);
  if (!p) return null;
  const abs = isAbs(p) ? p : `${cwd.replace(/\\/g, '/').replace(/\/+$/, '')}/${p.replace(/^\.\//, '')}`;
  return { path: abs.replace(/\\/g, '/'), write: WRITE.has(t.name) };
}

/** The MCP server of a tool name ("mcp__my-devops__wit_get" → "my-devops"), or null. */
export const mcpServer = (name: string): string | null => /^mcp__([^_]+(?:[-_][^_]+)*?)__/.exec(name)?.[1] ?? null;
/** the app's own control tools (app_state, app_chats…) only the Regia has: never a browser or a service */
const isAppTool = (name: string) => /^mcp__second-brain-app__/i.test(name);
const isBrowserTool = (name: string) => !isAppTool(name) && /^mcp__(second-brain|sb-browser|claude_browser|claude-browser|playwright)[^_]*__/i.test(name) || /^mcp__.*__browser_/i.test(name);
const isSendTool = (name: string) => /app_send_to_chat$/.test(name);

/**
 * The live layer for a view. `viewNodes` are the nodes drawn (the essential view has groups), `allNodes` every node of
 * the brain (to find a file or tool the view folds into a group), `root` the brain folder.
 */
export function liveGraph(s: LiveSnapshot, viewNodes: MapNode[], allNodes: MapNode[], root: string): LiveGraph {
  const now = s.now;
  const inView = new Map(viewNodes.map(n => [n.id, n]));
  const groups = groupIndex(viewNodes);
  const glow = new Map<string, Glow>();
  const links = new Map<string, LinkGlow>();
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const chatOf = new Map<string, string>();

  /** the drawn node standing for a node of the brain (itself, or the group it is folded into) */
  const shown = (id: string): string | null => (inView.has(id) ? id : groups.get(id) ?? null);
  const all = [...viewNodes, ...allNodes];
  const byFile = new Map<string, string>();
  const folders: [string, string][] = [];
  for (const n of all) {
    if (!n.file) continue;
    const abs = norm(isAbs(n.file) ? n.file : `${root}/${n.file}`);
    const id = shown(n.id);
    if (!id || byFile.has(abs)) continue;
    byFile.set(abs, id);
    if (n.kind === 'cartella') folders.push([abs, id]);
  }
  const findBy = (pred: (n: MapNode) => boolean): string | null => {
    for (const n of all) if (pred(n)) { const id = shown(n.id); if (id) return id; }
    return null;
  };
  const engineNode = (harness: string) => findBy(n => n.kind === 'harness' && (n.id === `harness:${harness}` || n.label.toLowerCase() === harness.toLowerCase()));
  const regiaNode = findBy(n => n.kind === 'regia');

  const light = (id: string, kind: LiveKind, level: number, running: boolean, doing: string, chatId: string) => {
    if (level <= 0) return;
    const g = glow.get(id) ?? { level: 0, running: false, kind, doing: [], chats: [] };
    g.level = Math.max(g.level, level);
    g.running ||= running;
    if (doing && !g.doing.includes(doing)) g.doing.push(doing);
    if (!g.chats.includes(chatId)) g.chats.push(chatId);
    glow.set(id, g);
  };
  const link = (from: string, to: string, label: string, level: number, running: boolean) => {
    if (level <= 0 || from === to) return;
    const k = edgeKey(from, to, LIVE_KIND);
    if (!edges.has(k)) edges.set(k, { from, to, kind: LIVE_KIND, label });
    const l = links.get(k) ?? { level: 0, running: false };
    links.set(k, { level: Math.max(l.level, level), running: l.running || running });
  };
  const extra = (n: MapNode) => { if (!inView.has(n.id) && !nodes.has(n.id)) nodes.set(n.id, n); return n.id; };

  const chats = new Map(s.chats.map(c => [c.id, c]));
  const byTitle = new Map(s.chats.map(c => [c.title.toLowerCase(), c]));
  const toolsOf = new Map<string, LiveTool[]>();
  for (const t of s.tools) if (levelOf(t, now) > 0) (toolsOf.get(t.chatId) ?? toolsOf.set(t.chatId, []).get(t.chatId)!).push(t);

  // a chat node: the Regia is the map's own Regia; any other chat at work gets its own neuron in the chat layer
  const chatNode = (c: LiveChat): string => {
    if (c.isRegia && regiaNode) { chatOf.set(regiaNode, c.id); return regiaNode; }
    const id = extra({ id: `live:chat:${c.id}`, layer: 'chat', kind: 'chat-viva', label: c.title, short: `chat su ${c.engine}`, degree: 2, members: [] });
    chatOf.set(id, c.id);
    return id;
  };

  const working: LiveGraph['working'] = [];
  for (const c of s.chats) {
    const ts = (toolsOf.get(c.id) ?? []).sort((a, b) => b.startAt - a.startAt);
    const active = ACTIVE.has(c.state);
    if (!active && !ts.length) continue;
    const chatRunning = c.state === 'running' || c.state === 'starting';
    const chatLevel = active ? 1 : Math.max(...ts.map(t => levelOf(t, now)));
    const cid = chatNode(c);
    const doing = ts[0] ? ts[0].summary || ts[0].name : c.state === 'waiting' ? 'aspetta te' : 'sta pensando';
    light(cid, 'chat', chatLevel, chatRunning, doing, c.id);
    working.push({ id: c.id, title: c.title, harness: c.harness, engine: c.engine, doing, level: chatLevel, running: chatRunning, isRegia: c.isRegia });
    const eng = engineNode(c.harness);
    if (eng && active) { light(eng, 'engine', chatLevel, chatRunning, c.title, c.id); link(eng, cid, `gira su ${c.engine}`, chatLevel, chatRunning); }

    for (const t of ts) {
      const lv = levelOf(t, now), run = t.endAt == null;
      const input = rec(t.input);
      const f = fileOfTool(t, c.cwd);
      if (f) {
        const rel = relFile(f.path, root);
        if (rel == null) continue; // outside the brain: not a neuron
        const n = norm(f.path);
        const id = byFile.get(n) ?? folders.find(([dir]) => n.startsWith(`${dir}/`))?.[1]
          ?? extra({ id: `live:file:${rel}`, layer: 'memoria', kind: 'file-vivo', label: base(rel), short: rel, file: f.path, degree: 1, members: [] });
        light(id, 'file', lv, run, `${f.write ? 'scrive' : 'legge'} ${c.title}`, c.id);
        link(cid, id, f.write ? 'scrive' : 'legge', lv, run);
        continue;
      }
      if (isSendTool(t.name)) {
        const to = chats.get(str(input.chatId));
        if (to) { const tid = chatNode(to); light(tid, 'chat', lv, run, `messaggio da ${c.title}`, to.id); link(cid, tid, 'gli scrive', lv, run); }
        continue;
      }
      if (isAppTool(t.name)) continue;
      if (t.name === 'Bash' || t.name === 'Shell') { // Shell: Cursor's name for a command
        const cmd = str(input.command);
        for (const n of all) {
          if (n.layer !== 'tool' || !n.file) continue;
          const b = base(n.file);
          if (b.length < 4 || !cmd.includes(b)) continue;
          const id = shown(n.id);
          if (id) { light(id, 'tool', lv, run, c.title, c.id); link(cid, id, 'usa', lv, run); }
        }
        // the mail between chats: inbox.mjs send --to "<chat>"
        const to = /inbox\.mjs\s+send\b[^\n]*?--to\s+["']([^"']+)["']/.exec(cmd)?.[1];
        const target = to ? byTitle.get(to.toLowerCase()) : undefined;
        if (target && target.id !== c.id) { const tid = chatNode(target); light(tid, 'chat', lv, run, `posta da ${c.title}`, target.id); link(cid, tid, 'posta', lv, run); }
        continue;
      }
      if (t.name === 'Agent' || t.name === 'Task') {
        const who = str(input.subagent_type).toLowerCase();
        const id = who ? findBy(n => n.layer === 'agenti' && (n.id === `agent:${who}` || (n.name ?? n.label).toLowerCase() === who)) : null;
        if (id) { light(id, 'agent', lv, run, c.title, c.id); link(cid, id, 'chiama', lv, run); }
        continue;
      }
      if (t.name === 'Skill') {
        const sk = str(input.skill || input.command).replace(/^\//, '').toLowerCase();
        const id = sk ? findBy(n => (n.name ?? n.label).toLowerCase() === `/${sk}` || n.id === `skill:${sk}`) ?? (() => { for (const g of viewNodes) if (g.members?.some(m => (m.name ?? m.label).toLowerCase() === `/${sk}` || m.id === `skill:${sk}`)) return g.id; return null; })() : null;
        if (id) { light(id, 'tool', lv, run, c.title, c.id); link(cid, id, 'usa', lv, run); }
        continue;
      }
      if (isBrowserTool(t.name)) {
        const tab = s.tabs.find(x => x.chatId === c.id);
        const env = tab?.env || 'browser';
        const id = extra({ id: `live:env:${env}`, layer: 'esterni', kind: 'ambiente', label: env === 'browser' ? 'Browser' : env, short: tab?.title || 'browser interno', degree: 1, members: [] });
        light(id, 'browser', lv, run, c.title, c.id);
        link(cid, id, 'nel browser', lv, run);
        continue;
      }
      const srv = mcpServer(t.name);
      if (srv) {
        const words = srv.toLowerCase().split(/[-_]/).filter(w => w.length > 3 && !['mcp', 'claude', 'server'].includes(w));
        const id = words.length ? findBy(n => n.layer === 'esterni' && n.kind !== 'harness' && words.some(w => n.id.toLowerCase().includes(w) || n.label.toLowerCase().includes(w))) : null;
        if (id) { light(id, 'service', lv, run, c.title, c.id); link(cid, id, 'usa', lv, run); }
      }
    }
  }
  working.sort((a, b) => Number(b.running) - Number(a.running) || b.level - a.level);
  const kinds = [...glow.values()];
  return {
    // sorted, so the same live set in another order never looks like a new graph to the engine (a new layout)
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: [...edges.values()].sort((a, b) => edgeKey(a.from, a.to, a.kind).localeCompare(edgeKey(b.from, b.to, b.kind))), glow, links, chatOf, working,
    counts: { chats: working.length, files: kinds.filter(g => g.kind === 'file').length, tools: kinds.filter(g => g.kind === 'tool' || g.kind === 'agent' || g.kind === 'service' || g.kind === 'browser').length },
  };
}

/** True while something still needs frames: a call running or a glow fading. */
export const liveMoving = (g: LiveGraph): boolean => [...g.glow.values()].some(x => x.running || x.level < 1) || [...g.links.values()].some(x => x.running || x.level < 1);
