// Chat reader for the Orchestrator (skill `stato`, in Claude Code and in Cursor alike, 2026-10-10 "un solo modo"): which
// Claude and Cursor chats are open, where, and whether they wait for {{OWNER}}. Read-only.
//   node chats.mjs list [--days N] [--all] [--ws <folder words>]   chats updated in the last N days (default 3), newest first
//   node chats.mjs read <chat> [--n N]                             last N messages (default 12); <chat> = id start or title words
// Claude sources: ~/.claude/projects/<folder>/<session>.jsonl (main sessions only; subagents live in subfolders): title =
// last `custom-title`, folder = `cwd`, a turn ends with a `system` `stop_hook_summary` record.
// Cursor sources (verified 09/10 on {{OWNER}}'s PC, Cursor 3.23):
// - titles and state: table composerHeaders (+ the `status` field of cursorDiskKV composerData:<id>) in
//   %APPDATA%/Cursor/User/globalStorage/state.vscdb, opened READ-ONLY in place (13+ GB, too big to copy; read-only
//   opens never write it). Only named fields leave the DB: it also holds encryption keys, never printed.
// - messages: ~/.cursor/projects/<folder>/agent-transcripts/<id>/<id>.jsonl (the hooks' transcript_path).
// DB unreadable → titles from the first message of each transcript. Secrets-looking text is masked in the output.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mask } from '../../ops/tools/mask.mjs';
import { brainRoot } from '../../ops/tools/brain-root.mjs';

process.removeAllListeners('warning'); // node:sqlite is "experimental" in Node 22: keep its warning out of the output
const argv = process.argv.slice(2);
const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const DB = process.env.BRAIN_CURSOR_DB || path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
const PROJECTS = process.env.BRAIN_CURSOR_PROJECTS || path.join(os.homedir(), '.cursor', 'projects');
const CLAUDE = process.env.BRAIN_CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects');
const one = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const t = one(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const when = ms => (ms ? new Date(ms).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?');

// {{OWNER}}'s typed text and Cursor's own automatic turns (see correction-log.mjs).
const typed = t => [...String(t).matchAll(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/g)].map(m => m[1]).join('\n').trim();
const AUTO = /^(Briefly inform the user about the task result|Perform any necessary follow-up actions|\[correction-log\]|\[review-confronto\]|\[posta\])/;

function transcripts() {
  const map = new Map();
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS); } catch { return map; }
  for (const d of dirs) {
    const base = path.join(PROJECTS, d, 'agent-transcripts');
    let ids = [];
    try { ids = fs.readdirSync(base); } catch { continue; }
    for (const id of ids) {
      const f = path.join(base, id, `${id}.jsonl`);
      try { map.set(id, { file: f, mtime: fs.statSync(f).mtimeMs, folder: d }); } catch { /* no main transcript */ }
    }
  }
  return map;
}
const rowsOf = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

async function headers() {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(DB, { readOnly: true });
    try {
      const hs = db.prepare('SELECT composerId, lastUpdatedAt, isArchived, isSubagent, value FROM composerHeaders').all().map(r => {
        let v = {};
        try { v = JSON.parse(r.value); } catch { /* header without JSON */ }
        return { id: r.composerId, at: r.lastUpdatedAt, archived: !!r.isArchived, subagent: !!r.isSubagent, name: v.name || '', subtitle: v.subtitle || '',
          unread: !!v.hasUnreadMessages, blocking: !!v.hasBlockingPendingActions, folder: v.workspaceIdentifier?.uri?.fsPath || '', worktree: !!v.isWorktree };
      });
      const st = db.prepare("SELECT json_extract(value, '$.status') AS s FROM cursorDiskKV WHERE key = ?");
      return { hs, status: id => { try { return st.get(`composerData:${id}`)?.s || ''; } catch { return ''; } } };
    } finally { /* statements are used after return: closed at process exit */ }
  } catch { return null; }
}

// State for the Orchestrator: "in corso" / "aspetta te" / "finito" (+ why).
function state(h, rows) {
  if (h?.blocking) return 'aspetta te (approvazione)';
  const lastRow = rows.at(-1);
  if (lastRow?.role === 'assistant' && (lastRow.message?.content || []).at(-1)?.name === 'AskQuestion') return 'aspetta te (domanda)'; // open question: no turn_ended yet
  const s = h?.statusText === 'none' ? '' : h?.statusText || '';
  if (s === 'generating') return 'in corso';
  if (s === 'aborted' || s === 'error') return `fermo (${s === 'error' ? 'errore' : 'interrotto'})`;
  let lastText = '', lastRaw = '', lastTool = '';
  for (const r of rows) if (r.role === 'assistant') for (const c of r.message?.content || []) {
    if (c.type === 'text' && one(c.text)) { lastText = one(c.text); lastRaw = String(c.text); lastTool = ''; }
    if (c.type === 'tool_use') lastTool = c.name;
  }
  const ended = rows.at(-1)?.type === 'turn_ended';
  if (!ended && !s) return 'in corso (?)';
  if (lastTool === 'AskQuestion') return 'aspetta te (domanda)';
  if (/```powershell[\s\S]*```\s*$/.test(lastRaw.trim())) return 'aspetta te (comando da lanciare)';
  if (/\?\s*(\*\*)?$/.test(lastText)) return 'aspetta te (domanda)';
  return h?.unread ? 'finito, da leggere' : 'finito';
}

// ---------- Claude chats
const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p.type === 'text').map(p => p.text).join('\n') : '');
const clean = t => String(t).replace(/<system-reminder[\s\S]*?<\/system-reminder(?:\s+id="[^"]*")?>/g, '').trim();
// Transcripts reach tens of MB (771 MB in all, review 10/10): title and folder come from a string scan, the state from
// the last rows only; a whole file is parsed only by `read`, and only for the chat it shows.
const jstr = s => { try { return JSON.parse(`"${s}"`); } catch { return s; } };
// The app's live feed runs `list` every 15 s: reading every transcript in full each time cost 32 s, 5 s of CPU and
// 370 MB a run on 15/10 (99 files, 396 MB). A cache keeps each file's title and folder with the offset scanned so far:
// a run scans only the bytes added since, and the state comes from the tail. A file rewritten (shorter, or longer: a
// compaction that grew back) is scanned again: the 64 bytes before the offset (the end of a row with its uuid) must match.
const CACHE = process.env.BRAIN_CHATS_CACHE || path.join(brainRoot(import.meta.url), 'ops', 'state', 'chats-cache.json');
const CACHE_DAYS = 31; // `read` looks back 30 days by title
function loadCache() { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; } }
function saveCache(c) {
  const old = Date.now() - CACHE_DAYS * 864e5;
  for (const [k, v] of Object.entries(c)) if (!(v.mtime >= old)) delete c[k];
  try { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); const tmp = `${CACHE}.${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(c)); fs.renameSync(tmp, CACHE); } catch { /* read-only: next run scans again */ }
}
function readRange(fd, from, to) {
  const b = Buffer.alloc(Math.max(0, to - from));
  let n = 0;
  while (n < b.length) { const r = fs.readSync(fd, b, n, b.length - n, from + n); if (!r) break; n += r; }
  return b.subarray(0, n);
}
/** Title (last custom-title) and folder (first cwd) of a transcript, scanning only what was appended since the cache. */
function scanHead(cache, file, fd, st) {
  let e = cache[file];
  const mark = e && e.scanned <= st.size ? readRange(fd, Math.max(0, e.scanned - 64), e.scanned).toString('latin1') : null;
  if (!e || mark !== e.mark) e = { scanned: 0, name: '', cwd: '' }; // new, or rewritten
  const chunk = readRange(fd, e.scanned, st.size);
  const end = chunk.lastIndexOf(10) + 1; // whole lines only: a line being written is scanned next run
  const text = chunk.subarray(0, end).toString('utf8');
  let name = e.name;
  for (const m of text.matchAll(/"customTitle":"((?:[^"\\]|\\.)*)"/g)) name = jstr(m[1]);
  const cwd = e.cwd || jstr(text.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1] ?? '');
  const scanned = e.scanned + end;
  cache[file] = { scanned, mark: readRange(fd, Math.max(0, scanned - 64), scanned).toString('latin1'), name, cwd, mtime: st.mtimeMs };
  return { name, cwd };
}
/** The file's last rows, reading back from the end (256 KB, then 4x) until they hold an assistant row with text: from
 *  there on claudeState sees what it would see in the whole file (last message, last stop, last answer's text). */
function tailRows(fd, size) {
  for (let want = 256 << 10; ; want *= 4) {
    const from = Math.max(0, size - want);
    const buf = readRange(fd, from, size);
    const rows = buf.subarray(from > 0 ? buf.indexOf(10) + 1 : 0).toString('utf8').split('\n') // the first line is cut
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (from === 0 || rows.some(r => r.type === 'assistant' && !r.isSidechain && textOf(r.message?.content).trim())) return rows;
  }
}
function claudeChats({ since = 0, idPrefix = '', titleQ = '' } = {}) {
  const out = [];
  const cache = loadCache();
  let dirs = [];
  try { dirs = fs.readdirSync(CLAUDE, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(CLAUDE, d.name)).filter(f => f.endsWith('.jsonl') && f.startsWith(idPrefix)); } catch { continue; }
    for (const f of files) {
      const file = path.join(CLAUDE, d.name, f);
      let st; try { st = fs.statSync(file); } catch { continue; }
      const mtime = st.mtimeMs;
      if (mtime < since) continue;
      let fd; try { fd = fs.openSync(file, 'r'); } catch { continue; }
      try {
        const { name, cwd } = scanHead(cache, file, fd, st);
        if (titleQ && !name.toLowerCase().includes(titleQ)) continue;
        const tail = tailRows(fd, st.size);
        if (!tail.some(r => r.type === 'user' || r.type === 'assistant')) continue;
        const wt = cwd.split(/[\\/]\.claude[\\/]worktrees[\\/]/); // a worktree shows its repo ({{BRAIN_NAME}}), not its random name
        out.push({ harness: 'Claude', id: f.slice(0, -6), at: mtime, name, folder: wt[0], worktree: wt.length > 1, file, rows: tail });
      } catch { continue; } finally { fs.closeSync(fd); }
    }
  }
  saveCache(cache);
  return out;
}

// Same states as Cursor: open AskUserQuestion, a dead turn (API error, interrupted), a turn still running (no
// stop_hook_summary after the last message), then the last answer (question or PowerShell command for {{OWNER}}).
function claudeState(rows) {
  const msgs = rows.filter(r => (r.type === 'user' || r.type === 'assistant') && !r.isSidechain && !r.isMeta);
  const last = msgs.at(-1);
  const pendingAsk = last?.type === 'assistant' && (last.message?.content || []).some(c => c.type === 'tool_use' && c.name === 'AskUserQuestion');
  if (pendingAsk) return 'aspetta te (domanda)';
  if (last?.isApiErrorMessage) return 'fermo (errore)';
  if (last?.type === 'user' && /^\[Request interrupted/.test(textOf(last.message?.content).trim())) return 'fermo (interrotto)';
  const lastMsgAt = rows.lastIndexOf(last), lastStop = rows.findLastIndex(r => r.type === 'system' && r.subtype === 'stop_hook_summary');
  if (lastStop < lastMsgAt) return Date.now() - Date.parse(last?.timestamp || 0) < 10 * 60e3 ? 'in corso' : 'in corso (?)';
  const lastText = [...msgs].reverse().find(r => r.type === 'assistant' && textOf(r.message?.content).trim());
  const raw = textOf(lastText?.message?.content).trim();
  if (/```powershell[\s\S]*```\s*$/.test(raw)) return 'aspetta te (comando da lanciare)';
  if (/\?\s*(\*\*)?$/.test(one(raw))) return 'aspetta te (domanda)';
  return 'finito';
}

function claudeMessages(rows) {
  const msgs = [];
  for (const r of rows) {
    // a message typed while the chat was busy is queued as an attachment (review 10/10: 17 in one Orchestrator)
    const queued = r.type === 'attachment' && r.attachment?.type === 'queued_command' ? String(r.attachment.prompt ?? '') : null;
    if (queued === null && ((r.type !== 'user' && r.type !== 'assistant') || r.isSidechain || r.isMeta)) continue;
    const content = queued ?? r.message?.content;
    if (queued !== null || r.type === 'user') {
      if (Array.isArray(content) && content.some(c => c.type === 'tool_result')) continue;
      const t = clean(textOf(content));
      if (!t || /^<(command|local-command)/.test(t)) continue;
      msgs.push(/^(<cross-session-message|<agent-message|<task-notification|Another Claude session)/.test(t) ? `· (messaggio da un'altra chat o agente) ${cut(t.replace(/<[^>]+>/g, ' '), 300)}` : `Owner: ${cut(t, 600)}`);
    } else {
      const parts = (content || []).map(c => (c.type === 'text' ? cut(c.text, 600) : c.type === 'tool_use' ? `[${c.name}]` : '')).filter(Boolean);
      if (parts.length) msgs.push(`Agente: ${parts.join(' ')}`);
    }
  }
  return msgs;
}

const line = c => `- ${c.harness} · ${mask(cut(c.name || '(senza titolo)', 60))} · ${path.basename(c.folder || '') || c.folder}${c.worktree ? ' (worktree)' : ''} · ${when(c.at)} · ${c.state} · id ${c.id.slice(0, 8)}`;

async function list() {
  const days = Number(opt('--days', 3));
  const since = argv.includes('--all') ? 0 : Date.now() - days * 864e5;
  const ws = (opt('--ws', '') || '').toLowerCase();
  const tr = transcripts();
  const db = await headers();
  let chats;
  if (db) {
    chats = db.hs.filter(h => !h.archived && !h.subagent && h.at >= since).map(h => ({ ...h, statusText: db.status(h.id), t: tr.get(h.id) }));
  } else {
    chats = [...tr].filter(([, t]) => t.mtime >= since).map(([id, t]) => {
      const first = rowsOf(t.file).map(r => (r.role === 'user' ? typed((r.message?.content || []).map(c => c.text || '').join('\n')) : '')).find(x => x && !AUTO.test(x));
      return { id, at: t.mtime, name: cut(first, 50), folder: t.folder, t };
    });
  }
  chats = chats.map(c => ({ ...c, harness: 'Cursor', state: state(c, c.t ? rowsOf(c.t.file) : []) }))
    .concat(claudeChats({ since }).map(c => ({ ...c, state: claudeState(c.rows) })))
    .filter(c => !ws || (c.folder || '').toLowerCase().includes(ws)).sort((a, b) => b.at - a.at);
  const out = [`Chat Claude e Cursor aggiornate negli ultimi ${argv.includes('--all') ? 'tutti i' : days} giorni: ${chats.length}${db ? '' : ' (Cursor: titoli dal primo messaggio, database non leggibile)'}`];
  for (const c of chats) out.push(line(c));
  console.log(out.join('\n'));
}

async function read(which) {
  const n = Number(opt('--n', 12));
  const tr = transcripts();
  const db = await headers();
  const q = one(which).toLowerCase();
  const isId = q.length >= 8 && /^[0-9a-z-]+$/.test(q);
  let id = isId ? [...tr.keys()].find(k => k.startsWith(q)) : undefined; // an id start (as `list` prints it)
  let cursorHit;
  if (!id && db) {
    const hits = db.hs.filter(h => h.name.toLowerCase().includes(q) && tr.has(h.id)).sort((a, b) => b.at - a.at);
    cursorHit = hits.find(h => !h.archived && !h.subagent) || hits[0]; // the chats `list` shows come first
  }
  // Claude chat by id start, or by title in the last 30 days; a title in both tools → the live, newest one (review 10/10:
  // "orchestrator" matched an older Cursor chat while the Claude Orchestrator was active)
  const cl = id ? undefined : claudeChats(isId ? { idPrefix: q } : { since: Date.now() - 30 * 864e5, titleQ: q }).sort((a, b) => b.at - a.at)[0];
  if (cursorHit && !(cl && (cursorHit.archived || cursorHit.subagent || cl.at > cursorHit.at))) id = cursorHit.id;
  if (!id) {
    if (cl) {
      const rows = rowsOf(cl.file);
      const msgs = claudeMessages(rows);
      console.log(mask([line({ ...cl, state: claudeState(rows) }).slice(2), `Ultimi ${Math.min(n, msgs.length)} di ${msgs.length} messaggi:`, ...msgs.slice(-n)].join('\n')));
      return;
    }
  }
  if (!id) {
    // `list` reads the headers, `read` the transcript: Cursor writes a chat's transcript later (seen 10/10: the Orchestrator
    // was listed at 15:21, its transcript appeared at 15:35), so say which one is missing instead of "not found".
    const listed = db?.hs.filter(h => (q.length >= 8 && h.id.startsWith(q)) || h.name.toLowerCase().includes(q)).sort((a, b) => b.at - a.at)[0];
    console.log(listed
      ? `La chat "${mask(listed.name || '(senza titolo)')}" (id ${listed.id.slice(0, 8)}) c'è, ma Cursor non ha ancora scritto la sua trascrizione su disco: riprova tra qualche minuto.`
      : `Nessuna chat Claude o Cursor trovata per "${which}" (usa l'id di \`list\` o parole del titolo).`);
    process.exitCode = 1; return;
  }
  const h = db?.hs.find(x => x.id === id);
  const rows = rowsOf(tr.get(id).file);
  const msgs = [];
  for (const r of rows) {
    if (r.role === 'user') {
      const t = typed((r.message?.content || []).map(c => c.text || '').join('\n'));
      if (t) msgs.push(AUTO.test(t) ? '· (turno automatico di Cursor)' : `Owner: ${cut(t, 600)}`);
    } else if (r.role === 'assistant') {
      const parts = (r.message?.content || []).map(c => (c.type === 'text' ? cut(c.text, 600) : c.type === 'tool_use' ? `[${c.name}]` : '')).filter(Boolean);
      if (parts.length) msgs.push(`Agente: ${parts.join(' ')}`);
    }
  }
  const head = `Cursor · ${h?.name || '(senza titolo)'} · ${path.basename(h?.folder || tr.get(id).folder)} · ${when(h?.at || tr.get(id).mtime)} · ${state(h && { ...h, statusText: db.status(id) }, rows)} · id ${id.slice(0, 8)}`;
  console.log(mask([head, `Ultimi ${Math.min(n, msgs.length)} di ${msgs.length} messaggi:`, ...msgs.slice(-n)].join('\n')));
}

if (argv[0] === 'list') await list();
else if (argv[0] === 'read' && argv[1]) await read(argv.slice(1).filter((a, i, all) => a !== '--n' && all[i - 1] !== '--n').join(' '));
else console.log('usage: node chats.mjs list [--days N] [--all] [--ws <folder>] | read <id or title words> [--n N]');
