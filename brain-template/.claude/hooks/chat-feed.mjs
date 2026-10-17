// UserPromptSubmit + Stop + Notification hook (proposal, 2026-10-09 "flusso" #5): the Regia knows what happens in every chat without
// relying on the chats' discipline, and {{OWNER}} can work directly in one chat ("focus") without losing the hub.
// - {{OWNER}} types in a work chat  → feed line "{{OWNER}} → <chat>: <text>", focus = that chat; the chat is told he is there.
// - A work chat ends a turn       → feed line "<chat> → Owner: <first line>" (+ "comando"/"domanda" when it gave one).
// - A work chat waits on a permission prompt → feed line "<chat> → {{OWNER}} (permesso): <message>".
// - {{OWNER}} types in the Regia     → focus = Regia; the Regia receives everything new in the feed since its last turn.
// The Regia = the session whose cwd is the main {{BRAIN_NAME}} checkout. State in <root>/ops/state/ (gitignored):
// chat-feed.jsonl (append-only, trimmed to the last 400 lines), feed-cursor.json (Regia's read position), focus.json.
// Wiring ({{OWNER}}, ~/.claude/settings.json): the same command under "UserPromptSubmit", "Stop" and "Notification".
// Test: echo '<hook json>' | node chat-feed.mjs --root <dir>
import fs from 'node:fs';
import path from 'node:path';
import { parseHookJson } from '../../harness/cursor/hook-input.mjs';
import { mask } from '../../ops/tools/feedback-log.mjs';

const argv = process.argv.slice(2);
const ROOT = argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : '{{BRAIN}}';
const DIR = path.join(ROOT, 'ops', 'state');
const FEED = path.join(DIR, 'chat-feed.jsonl');
const CURSOR = path.join(DIR, 'feed-cursor.json');
const FOCUS = path.join(DIR, 'focus.json');
const MAIN = path.resolve(ROOT).toLowerCase();
const MAX_INJECT = 1800;

// Conservatively omit everything after a credential label before persistence or cross-chat forwarding. This catches
// prose and Markdown labels as well as assignments; arbitrary unlabeled secrets still must never be pasted in chats.
const oneLine = (s, n) => mask(s).replace(/\s+/g, ' ').trim().slice(0, n);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const tail = (file, bytes) => {
  try {
    const fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size; const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
    return buf.toString('utf8').split('\n').slice(1);
  } catch { return []; }
};
// Chat title: the last "custom-title" record of the transcript (the app writes it there); else the worktree folder name.
const titleOf = (transcript, cwd, given) => {
  if (given) return given; // session_title is in the hook input when the chat has a custom title (hooks docs)
  for (const l of tail(transcript, 400_000).reverse()) {
    if (l.includes('"custom-title"')) { try { return JSON.parse(l).customTitle; } catch {} }
  }
  return path.basename(cwd || '?');
};
// Last assistant text of the turn: Stop input field when present, else the transcript tail.
const lastAssistant = (input) => {
  if (input.last_assistant_message) return input.last_assistant_message;
  for (const l of tail(input.transcript_path, 400_000).reverse()) {
    if (!l.includes('"type":"assistant"')) continue;
    try {
      const text = (JSON.parse(l).message?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      if (text.trim()) return text;
    } catch {}
  }
  return '';
};
// A state-only line is written only when the chat's state changes (background-agent wake-ups made pairs of noise lines).
const LAST = path.join(DIR, 'last-state.json');
const append = (entry) => {
  fs.mkdirSync(DIR, { recursive: true });
  const last = readJson(LAST, {});
  if (entry.kind === 'state' && last[entry.chat] === entry.state) return;
  if (entry.state) { last[entry.chat] = entry.state; fs.writeFileSync(LAST, JSON.stringify(last)); }
  fs.appendFileSync(FEED, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  const lines = fs.readFileSync(FEED, 'utf8').split('\n').filter(Boolean);
  if (lines.length > 500) {
    const keep = lines.slice(-400);
    fs.writeFileSync(FEED, `${keep.join('\n')}\n`);
    const c = readJson(CURSOR, { line: 0 });
    fs.writeFileSync(CURSOR, JSON.stringify({ line: Math.max(0, c.line - (lines.length - 400)) }));
  }
};
const say = (context) => console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
const hhmm = iso => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', () => {
  let input; try { input = parseHookJson(raw); } catch { return; } // BOM from Cursor: parsed, then skipped below
  // Cursor imports Claude hooks with a different input: skip it, or every Cursor chat in {{BRAIN_NAME}} looks like the Regia ({{OWNER}}, 2026-10-09).
  if ('cursor_version' in input || 'conversation_id' in input) return;
  const event = input.hook_event_name;
  // The Regia by title (a chat's cwd changes when it cd's elsewhere); without a title, by the main checkout cwd.
  const isRegia = input.session_title ? input.session_title === 'Regia' : path.resolve(input.cwd || '').toLowerCase() === MAIN;
  const fromOwner = p => p && !p.trimStart().startsWith('<') &&
    !/<agent-message|<task-notification|<cross-session-message|Another Claude session sent a message/.test(p);
  // What started this turn (read again at Stop): owner | peer (another chat) | notifica (own background work).
  const ORIGINS = path.join(DIR, 'turn-origin.json');
  const origins = readJson(ORIGINS, {});

  if (event === 'UserPromptSubmit') {
    if (!isRegia && input.session_id) {
      origins[input.session_id] = {
        origin: fromOwner(input.prompt) ? 'owner'
          : /<cross-session-message|Another Claude session sent a message/.test(input.prompt ?? '') ? 'peer' : 'notifica',
        title: input.session_title, // Stop may not carry session_title: reuse the one seen at the start of the turn
      };
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(ORIGINS, JSON.stringify(origins));
    }
    if (!fromOwner(input.prompt)) {
      // A worker message reaches the Regia while {{OWNER}} works in another chat: queue, don't interrupt.
      const focus = isRegia ? readJson(FOCUS, null) : null;
      if (!isRegia) { // a worker woken by the hub, a peer or a notification: it is working
        append({ kind: 'state', state: 'in-lavorazione', chat: titleOf(input.transcript_path, input.cwd, input.session_title), cwd: input.cwd });
        return;
      }
      if (focus && focus.chat !== 'Regia') {
        // Only the fact: what to do in focus is written once in me.md ("Focus").
        say(`Focus: {{OWNER}} is in "${focus.chat}" since ${hhmm(focus.since)}.`);
      }
      return;
    }
    if (!isRegia) {
      const chat = titleOf(input.transcript_path, input.cwd, input.session_title);
      append({ kind: 'owner', state: 'in-lavorazione', chat, cwd: input.cwd, text: oneLine(input.prompt, 300) });
      fs.writeFileSync(FOCUS, JSON.stringify({ chat, cwd: input.cwd, since: new Date().toISOString() }));
      return say(`Focus: {{OWNER}} is in this chat since ${hhmm(new Date().toISOString())}.`);
    }
    const focus = readJson(FOCUS, null);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FOCUS, JSON.stringify({ chat: 'Regia', since: new Date().toISOString() }));
    const lines = fs.existsSync(FEED) ? fs.readFileSync(FEED, 'utf8').split('\n').filter(Boolean) : [];
    const from = readJson(CURSOR, { line: 0 }).line;
    fs.writeFileSync(CURSOR, JSON.stringify({ line: lines.length }));
    const fresh = lines.slice(from).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (!fresh.length) return;
    const talk = fresh.filter(e => e.kind !== 'state');
    let text = talk.map(e => `${hhmm(e.ts)} ${e.kind === 'owner' ? `{{OWNER}} → ${e.chat}` : `${e.chat} → {{OWNER}}${e.tag ? ` (${e.tag})` : ''}`}: ${e.text}`).join('\n');
    if (text.length > MAX_INJECT) text = `(…${talk.length} righe, le più vecchie tagliate)\n${text.slice(-MAX_INJECT)}`;
    const back = focus && focus.chat !== 'Regia' ? `{{OWNER}} is back from focus on "${focus.chat}" (since ${hhmm(focus.since)}). ` : '';
    // Latest state per chat (by cwd = its worktree, the same cwd list_sessions shows) → sidebar groups.
    const latest = new Map();
    for (const e of fresh) if (e.state) latest.set(e.chat, e);
    const LABEL = { 'in-lavorazione': 'In lavorazione', 'aspetta-te': 'Aspetta te', 'turno-finito': 'turno finito' };
    const groups = {};
    for (const e of latest.values()) (groups[LABEL[e.state]] ??= []).push(`${e.chat}${e.tag ? ` (${e.tag})` : ''}`);
    const moves = Object.entries(groups).map(([g, cs]) => `${g}: ${cs.join(', ')}`).join('; ');
    const sidebar = moves ? `\nSidebar, one move_sessions per group (match by title in list_sessions), only for chats not already there: ${moves}. ` +
      '"turno finito" → "In attesa di altri" if its now.md line waits on colleagues/QA, "Finite" if nothing is left.' : '';
    return say(`${back}Since your last turn, in the other chats (chat-feed, automatic):\n${text || '(solo cambi di stato)'}${sidebar}`);
  }

  if (event === 'Notification' && !isRegia && input.notification_type === 'permission_prompt') {
    append({ kind: 'chat', state: 'aspetta-te', chat: titleOf(input.transcript_path, input.cwd, input.session_title), cwd: input.cwd, tag: 'permesso', text: oneLine(input.message, 200) });
  }

  if (event === 'Stop' && !isRegia && !input.stop_hook_active) {
    const msg = lastAssistant(input);
    if (!msg.trim()) return;
    const tag = /```powershell/i.test(msg) ? 'comando' : (/\?\s*$/.test(msg.trim()) ? 'domanda' : '');
    const lines = msg.split('\n').filter(l => l.trim());
    const text = tag === 'domanda' && lines.length > 1 ? `${oneLine(lines[0], 120)} … ${oneLine(lines.at(-1), 160)}` : oneLine(lines[0], 200);
    const turn = origins[input.session_id] ?? {};
    const chat = titleOf(input.transcript_path, input.cwd, input.session_title ?? turn.title);
    // A turn started by the chat's own background work, ending without a question or command: state only, no text line.
    const quiet = turn.origin === 'notifica' && !tag;
    append({ kind: quiet ? 'state' : 'chat', state: tag ? 'aspetta-te' : 'turno-finito', chat, cwd: input.cwd, tag, text });
  }
});
