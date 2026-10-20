// Read-only history of a Claude Code session from its transcript (~/.claude/projects/<cwd slug>/<sessionId>.jsonl),
// so a tile resumed after a restart, or a session resumed/forked from the terminal or the desktop app, shows its past.
// Why read the file: a resumed CLI does not replay old turns on stdout. The format is internal to Claude Code and
// changes between versions, so this reader is lenient: unknown lines are skipped, only the tail (default 4 MB) is
// read, and nothing is ever written. Used by manager.ts (history, title, restored cost baseline).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem } from '../../shared/contract';
import { sysEn, type SysCode } from '../../shared/sys';
import { diffFor, diffFromResult, resultText, toolSummary } from './claude-map';
import { lastLine, trimInput } from './session';
import { coldUserText } from './handoff';
import { withoutEstimateLine } from '../../shared/task-estimate';

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/** The project folder name Claude Code uses for a cwd: every non-alphanumeric character becomes '-'. */
export function cwdSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

/** Path of a session's transcript, or null. The id must look like a CLI session id (never a path). */
export function findTranscript(sessionId: string, cwd: string | null, home = claudeHome()): string | null {
  if (!/^[0-9a-zA-Z-]{8,64}$/.test(sessionId)) return null;
  const projects = path.join(home, 'projects');
  const file = `${sessionId}.jsonl`;
  const has = (dir: string): string | null => { const p = path.join(projects, dir, file); return fs.existsSync(p) ? p : null; };
  if (cwd) { const p = has(cwdSlug(cwd)); if (p) return p; }
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(projects); } catch { return null; }
  if (cwd) { const slug = cwdSlug(cwd).toLowerCase(); for (const d of dirs) if (d.toLowerCase() === slug) { const p = has(d); if (p) return p; } }
  for (const d of dirs) { const p = has(d); if (p) return p; } // other project (moved folder, long-path slug)
  return null;
}

export interface History { items: ChatItem[]; title: string | null; costTotalUsd: number | null; lastText: string }

/** The last bytes of a file as complete lines. */
function tailLines(file: string, maxBytes: number): { lines: string[]; whole: boolean } {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // partial first line
    return { lines, whole: start === 0 };
  } finally { fs.closeSync(fd); }
}

/** The transcript's last lines within maxBytes, widened (x4, up to 64 MB) while one huge line fills a quarter of the
 *  window or more: a pasted screenshot is one line of up to ~5 MB of base64 and would push the conversation out. */
function historyLines(file: string, maxBytes: number): string[] {
  let budget = maxBytes;
  for (;;) {
    const t = tailLines(file, budget);
    if (t.whole || t.lines.length >= 400 || budget >= 64 * 1024 * 1024 || !t.lines.some(l => l.length >= budget / 4)) return t.lines;
    budget *= 4;
  }
}

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** User text as typed (a cold continuation's note left out): slash commands shown as "/name args", injected reminders
 *  dropped. A system result (interrupted, a command's output) carries sysCode when it is a fixed frame, or a plain
 *  system text when it is the command's own output (passthrough). */
export function userText(raw: string): { text: string; system?: string; sysCode?: SysCode } | null {
  // a cold continuation's first message (ADR 0031): only the user's part, the note stays behind the divider
  const t = withoutEstimateLine(coldUserText(raw.replace(REMINDER, '').trim())).trim();
  if (!t) return null;
  if (/^\[Request interrupted/.test(t)) return { text: '', sysCode: 'interrupted' };
  const cmd = t.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (cmd) {
    const args = t.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    return { text: `${cmd[1]?.trim() ?? ''}${args ? ` ${args}` : ''}` };
  }
  const out = t.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (out) {
    const content = out[1]?.trim();
    return content ? { text: '', system: content } : { text: '', sysCode: 'commandNoOutput' };
  }
  if (/^<(local-command|command-message|bash-|user-memory)/.test(t)) return null;
  return { text: t };
}

/** Items of a transcript (main thread only), at most maxItems, oldest first. */
export function readHistory(file: string, opts: { cwd?: string; maxItems?: number; maxBytes?: number } = {}): History {
  const maxItems = opts.maxItems ?? 2000;
  const items: ChatItem[] = [];
  const tools = new Map<string, { idx: number; input: unknown }>();
  let title: string | null = null, cost: number | null = null;
  let lines: string[] = [];
  try { lines = historyLines(file, opts.maxBytes ?? 4 * 1024 * 1024); } catch { return { items, title, costTotalUsd: cost, lastText: '' }; }
  for (const line of lines) {
    if (!line.trim()) continue;
    let m: Obj;
    try { m = o(JSON.parse(line)); } catch { continue; }
    if (m.type === 'custom-title' && s(m.customTitle)) { title = s(m.customTitle); continue; }
    if (m.type === 'cost-state' && typeof m.totalCostUSD === 'number') { cost = m.totalCostUSD; continue; }
    if (m.isSidechain === true || m.isMeta === true || m.isCompactSummary === true) continue;
    const at = Date.parse(s(m.timestamp)) || 0;
    const uuid = s(m.uuid) || `${items.length}`;
    if (m.type === 'system' && m.subtype === 'compact_boundary') { items.push({ kind: 'system', id: `h-${uuid}`, at, text: sysEn('compactedPlain'), level: 'info', code: 'compactedPlain' }); continue; }
    if (m.type !== 'user' && m.type !== 'assistant') continue;
    const content = o(m.message).content;
    if (m.type === 'user') {
      if (typeof content === 'string') {
        const u = userText(content);
        if (u?.sysCode) items.push({ kind: 'system', id: `h-${uuid}`, at, text: sysEn(u.sysCode), level: 'info', code: u.sysCode });
        else if (u?.system) items.push({ kind: 'system', id: `h-${uuid}`, at, text: u.system, level: 'info' });
        else if (u?.text) items.push({ kind: 'user', id: `h-${uuid}`, at, text: u.text });
        continue;
      }
      const texts: string[] = [];
      let images = 0;
      for (const raw of Array.isArray(content) ? content : []) {
        const b = o(raw);
        if (b.type === 'text') texts.push(s(b.text));
        else if (b.type === 'image') images++;
        else if (b.type === 'tool_result') {
          const t = tools.get(s(b.tool_use_id));
          const prev = t ? items[t.idx] : undefined;
          if (!t || prev?.kind !== 'tool') continue;
          const diff = diffFromResult(prev.name, t.input, m.toolUseResult, opts.cwd);
          items[t.idx] = { ...prev, status: b.is_error === true ? 'error' : 'ok', output: resultText(b.content, 2000), ...(diff ? { diff } : {}) };
          tools.delete(s(b.tool_use_id));
        }
      }
      const u = texts.length ? userText(texts.join('\n')) : null;
      if (u?.sysCode) items.push({ kind: 'system', id: `h-${uuid}`, at, text: sysEn(u.sysCode), level: 'info', code: u.sysCode });
      else if (u?.system) items.push({ kind: 'system', id: `h-${uuid}`, at, text: u.system, level: 'info' });
      else if (u?.text || images) items.push({ kind: 'user', id: `h-${uuid}`, at, text: u?.text ?? '', ...(images ? { images } : {}) });
      continue;
    }
    let i = 0;
    for (const raw of Array.isArray(content) ? content : []) {
      const b = o(raw);
      const id = `h-${uuid}-${i++}`;
      if (b.type === 'text' && s(b.text).trim()) items.push({ kind: 'assistant', id, at, text: s(b.text) });
      else if (b.type === 'thinking' && s(b.thinking).trim()) items.push({ kind: 'thinking', id, at, text: s(b.thinking) });
      else if (b.type === 'tool_use') {
        const name = s(b.name) || 'tool';
        const diff = diffFor(name, b.input, opts.cwd);
        const item: ToolItem = { kind: 'tool', id: `t-${s(b.id) || id}`, at, name, summary: toolSummary(name, b.input, opts.cwd), input: trimInput(b.input, 2000), status: 'running', ...(diff ? { diff } : {}) };
        tools.set(s(b.id), { idx: items.length, input: b.input });
        items.push(item);
      }
    }
  }
  // a tool with no result in the transcript was cut off (session closed mid-call)
  for (const t of tools.values()) { const it = items[t.idx]; if (it?.kind === 'tool') items[t.idx] = { ...it, status: 'error', output: 'senza risultato' }; }
  const kept = items.length > maxItems ? items.slice(-maxItems) : items;
  const lastA = [...kept].reverse().find(x => x.kind === 'assistant');
  return { items: kept, title, costTotalUsd: cost, lastText: lastA && lastA.kind === 'assistant' ? lastLine(lastA.text) : '' };
}
