// Unit tests of the live brain map (src/renderer/brain/lib/live.ts): which neurons light up for what the chats are
// doing now (a brain file read or written, a tool script, an agent, the browser, a message to another chat, the
// engine), the fade after a call ends, files outside the brain left out, the essential view's groups, the chat a lit
// node opens and the legend's list of chats at work.
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../../../src/renderer/brain/types';
import { FADE_MS, fileOfTool, levelOf, liveGraph, liveMoving, mcpServer, type LiveChat, type LiveSnapshot, type LiveTool } from '../../../src/renderer/brain/lib/live';
import { edgeKey } from '../../../src/renderer/brain/lib/map';

const ROOT = 'C:/brains/demo';
const N = (id: string, layer: string, kind: string, label: string, file?: string, extra: Partial<MapNode> = {}): MapNode => ({ id, layer, kind, label, file: file ? `${ROOT}/${file}` : undefined, degree: 1, members: [], ...extra });
const VIEW: MapNode[] = [
  N('chat:regia', 'chat', 'regia', 'Regia', 'hub.md'),
  N('harness:claude', 'esterni', 'harness', 'Claude', 'AGENTS.md'),
  N('harness:cursor', 'esterni', 'harness', 'Cursor', 'AGENTS.md'),
  N('mem:now', 'memoria', 'file', 'now.md', 'now.md'),
  N('mem:journal', 'memoria', 'cartella', 'Diario', 'journal'),
  N('tool:mem', 'tool', 'tool', 'mem.mjs', 'ops/tools/mem.mjs'),
  N('agent:reviewer', 'agenti', 'agente', 'reviewer', 'agents/reviewer.md'),
  N('ext:devops', 'esterni', 'servizio', 'DevOps', 'ops/AGENTS.md'),
  { id: 'grp:skill', layer: 'agenti', kind: 'gruppo', label: 'Skill (2)', degree: 1, members: [{ id: 'skill:stato', label: '/stato' }, { id: 'skill:explain', label: '/explain' }] },
];
const ALL: MapNode[] = [...VIEW, N('skill:stato', 'agenti', 'skill', '/stato', 'skills/stato.md')];
const NOW = 1_000_000;
const chat = (o: Partial<LiveChat> & Pick<LiveChat, 'id'>): LiveChat => ({ title: o.id, harness: 'claude', state: 'running', isRegia: false, cwd: ROOT, ...o });
const tool = (o: Partial<LiveTool> & Pick<LiveTool, 'chatId' | 'name'>): LiveTool => ({ id: `${o.chatId}-${o.name}-${Math.random()}`, input: {}, summary: '', startAt: NOW - 1000, endAt: null, ...o });
const snap = (chats: LiveChat[], tools: LiveTool[] = [], tabs: LiveSnapshot['tabs'] = []): LiveSnapshot => ({ now: NOW, chats, tools, tabs });
const g = (s: LiveSnapshot) => liveGraph(s, VIEW, ALL, ROOT);

describe('levels', () => {
  it('1 while running, fading to 0 after the end', () => {
    expect(levelOf({ endAt: null }, NOW)).toBe(1);
    expect(levelOf({ endAt: NOW - FADE_MS / 2 }, NOW)).toBeCloseTo(0.5);
    expect(levelOf({ endAt: NOW - FADE_MS - 1 }, NOW)).toBe(0);
  });
  it('the file of a tool call, relative paths against the chat folder', () => {
    expect(fileOfTool({ name: 'Read', input: { file_path: 'C:\\brains\\demo\\now.md' } }, 'C:/x')).toEqual({ path: 'C:/brains/demo/now.md', write: false });
    expect(fileOfTool({ name: 'Edit', input: { file_path: './ideas.md' } }, 'C:\\brains\\demo')).toEqual({ path: 'C:/brains/demo/ideas.md', write: true });
    expect(fileOfTool({ name: 'Bash', input: { command: 'ls' } }, ROOT)).toBeNull();
    expect(mcpServer('mcp__my-devops__wit_get_work_item')).toBe('my-devops');
    expect(mcpServer('Read')).toBeNull();
  });
});

describe('liveGraph', () => {
  it('a working chat gets its own neuron, linked to its engine, and opens on click', () => {
    const l = g(snap([chat({ id: 'fix', title: 'Fix totale' })]));
    expect(l.nodes.map(n => n.id)).toEqual(['live:chat:fix']);
    expect(l.glow.get('live:chat:fix')).toMatchObject({ level: 1, running: true, kind: 'chat' });
    expect(l.glow.get('harness:claude')?.running).toBe(true);
    expect(l.links.get(edgeKey('harness:claude', 'live:chat:fix', 'vivo'))?.running).toBe(true);
    expect(l.chatOf.get('live:chat:fix')).toBe('fix');
    expect(l.working[0]).toMatchObject({ id: 'fix', title: 'Fix totale', running: true });
  });
  it('the Regia lights the map\'s own Regia; idle chats with nothing recent stay dark', () => {
    const l = g(snap([chat({ id: 'r', isRegia: true, state: 'waiting' }), chat({ id: 'old', state: 'idle' })]));
    expect(l.glow.get('chat:regia')).toMatchObject({ level: 1, running: false });
    expect(l.chatOf.get('chat:regia')).toBe('r');
    expect(l.nodes).toHaveLength(0);
    expect(l.working.map(w => w.id)).toEqual(['r']);
  });
  it('reading and writing brain files light them (a folder for files inside it); a new file gets a neuron; outside files never', () => {
    const l = g(snap([chat({ id: 'c' })], [
      tool({ chatId: 'c', name: 'Read', input: { file_path: `${ROOT}/now.md` } }),
      tool({ chatId: 'c', name: 'Edit', input: { file_path: `${ROOT}/journal/2026-10-11.md` }, endAt: NOW - 1000 }),
      tool({ chatId: 'c', name: 'Write', input: { file_path: `${ROOT}/notes/x.md` } }),
      tool({ chatId: 'c', name: 'Read', input: { file_path: 'C:/progetti/shop/Order.cs' } }),
    ]));
    expect(l.glow.get('mem:now')).toMatchObject({ kind: 'file', running: true });
    expect(l.links.get(edgeKey('live:chat:c', 'mem:now', 'vivo'))?.running).toBe(true);
    expect(l.glow.get('mem:journal')?.running).toBe(false);
    expect(l.glow.get('mem:journal')!.level).toBeLessThan(1);
    expect(l.nodes.find(n => n.id === 'live:file:notes/x.md')).toMatchObject({ layer: 'memoria', label: 'x.md' });
    expect([...l.glow.keys()].some(k => k.includes('Order.cs'))).toBe(false);
    expect(l.counts.files).toBe(3);
  });
  it('tools, agents, skills (through their group), services and the browser', () => {
    const l = g(snap([chat({ id: 'c' })], [
      tool({ chatId: 'c', name: 'Bash', input: { command: 'node C:/brains/demo/ops/tools/mem.mjs now me --text x' } }),
      tool({ chatId: 'c', name: 'Agent', input: { subagent_type: 'reviewer' } }),
      tool({ chatId: 'c', name: 'Skill', input: { skill: 'stato' } }),
      tool({ chatId: 'c', name: 'mcp__my-devops__wit_get_work_item', input: {} }),
      tool({ chatId: 'c', name: 'mcp__second-brain__navigate', input: {} }),
    ], [{ chatId: 'c', env: 'test-2', title: 'Clienti', url: 'https://x' }]));
    for (const id of ['tool:mem', 'agent:reviewer', 'grp:skill', 'ext:devops', 'live:env:test-2']) expect(l.glow.get(id)?.running, id).toBe(true);
    expect(l.links.has(edgeKey('live:chat:c', 'live:env:test-2', 'vivo'))).toBe(true);
    expect(l.counts.tools).toBe(5);
  });
  it('an agent or skill with a speaking label is still found by its technical name', () => {
    const view: MapNode[] = [N('agent:rev-2', 'agenti', 'agente', 'Revisore del codice', 'agents/rev.md', { name: 'rev' }),
      { id: 'grp:skill', layer: 'agenti', kind: 'gruppo', label: 'Skill (1)', degree: 1, members: [{ id: 'skill:dir-name', label: 'Stato di tutto', name: '/stato-x' }] }];
    const l = liveGraph(snap([chat({ id: 'c' })], [tool({ chatId: 'c', name: 'Agent', input: { subagent_type: 'rev' } }), tool({ chatId: 'c', name: 'Skill', input: { skill: 'stato-x' } })]), view, view, ROOT);
    expect(l.glow.get('agent:rev-2')?.running).toBe(true);
    expect(l.glow.get('grp:skill')?.running).toBe(true);
  });
  it('a message to another chat (app_send_to_chat, inbox.mjs) links the two chats', () => {
    const l = g(snap([chat({ id: 'r', isRegia: true }), chat({ id: 'qa', title: 'QA · Rimborsi', state: 'idle' })], [
      tool({ chatId: 'r', name: 'mcp__second-brain-app__app_send_to_chat', input: { chatId: 'qa', text: 'vai' } }),
    ]));
    expect(l.links.get(edgeKey('chat:regia', 'live:chat:qa', 'vivo'))?.running).toBe(true);
    expect(l.chatOf.get('live:chat:qa')).toBe('qa');
    const m = g(snap([chat({ id: 'w', title: 'Lavoro' }), chat({ id: 'r', title: 'Regia', isRegia: true, state: 'idle' })], [
      tool({ chatId: 'w', name: 'Bash', input: { command: 'node inbox.mjs send --to "Regia" --from "Lavoro" --text "pronto"' }, endAt: NOW - 2000 }),
    ]));
    expect(m.links.get(edgeKey('live:chat:w', 'chat:regia', 'vivo'))?.running).toBe(false);
  });
  it("the app's own tools are no browser; Cursor's Shell counts as a command; the live set comes sorted", () => {
    const l = g(snap([chat({ id: 'r', isRegia: true }), chat({ id: 'c', harness: 'cursor' })], [
      tool({ chatId: 'r', name: 'mcp__second-brain-app__app_state', input: {} }),
      tool({ chatId: 'c', name: 'Shell', input: { command: 'node ops/tools/mem.mjs now me' } }),
      tool({ chatId: 'c', name: 'Write', input: { file_path: `${ROOT}/b.md` }, startAt: NOW - 10 }),
      tool({ chatId: 'c', name: 'Write', input: { file_path: `${ROOT}/a.md` }, startAt: NOW - 5 }),
    ]));
    expect([...l.glow.keys()].some(k => k.startsWith('live:env:'))).toBe(false);
    expect(l.glow.get('tool:mem')?.running).toBe(true);
    expect(l.nodes.map(n => n.id)).toEqual(['live:chat:c', 'live:file:a.md', 'live:file:b.md']);
    const keys = l.edges.map(e => edgeKey(e.from, e.to, e.kind));
    expect(keys).toEqual([...keys].sort());
  });
  it('after the fade nothing is lit and nothing moves', () => {
    const l = g(snap([chat({ id: 'c', state: 'idle' })], [tool({ chatId: 'c', name: 'Read', input: { file_path: `${ROOT}/now.md` }, endAt: NOW - FADE_MS - 10 })]));
    expect(l.glow.size).toBe(0);
    expect(liveMoving(l)).toBe(false);
    expect(liveMoving(g(snap([chat({ id: 'c' })])))).toBe(true);
  });
});
