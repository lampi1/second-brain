// Cursor stop hook: the Cursor side of Claude's correction-catch (P-042). Cursor cannot inject text when {{OWNER}} sends a
// message (beforeSubmitPrompt has no context output), so at the end of the turn this hook reads the chat transcript and,
// if {{OWNER}}'s last message is a correction or shows he did not understand (same regexes as correction-catch and
// flow-signals: ops/tools/signals-regex.mjs) and the turn did not already log it with mem.mjs, it returns a follow-up
// asking the chat to log the error in ai-errors.md (format and "SECONDA VOLTA" rule: that file's header).
// The Claude hook skips Cursor input, so each correction is caught by one hook only. Wired in harness/cursor/hooks.json.
// Also the Cursor adapter of ops/tools/feedback-log.mjs: when {{OWNER}}'s last message is praise, the hook itself appends
// one line to ai-wins.md (no follow-up, zero model tokens); the chat title is read from Cursor's DB only then.
// Never blocks: any error → no output, exit 0. Handled messages: ops/state/cursor-corrections.json (gitignored).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseHookJson } from './hook-input.mjs';
import { CORRECTION, CONFUSION, isPositive } from '../../ops/tools/signals-regex.mjs';
import { logPositive } from '../../ops/tools/feedback-log.mjs';
import { brainRoot } from '../../ops/tools/brain-root.mjs';

const OPS = brainRoot(import.meta.url);
const STATE = process.env.BRAIN_CORRECTIONS_FILE || path.join(OPS, 'ops', 'state', 'cursor-corrections.json');
const MEM = 'node "{{BRAIN}}/ops/tools/mem.mjs" error --text "<line>"';

// {{OWNER}}'s typed text: the <user_query> blocks, minus the turns Cursor or our hooks write there themselves (the
// automatic turn after a background task, our own follow-up). Subagent tasks have no <user_query>.
const typed = text => [...String(text).matchAll(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/g)].map(m => m[1]).join('\n').trim();
// (the second text: seen in {{OWNER}}'s Grok test, 09/10). Keep in sync with AUTO in chats.mjs.
const notOwner = t => /^(\[correction-log\]|\[review-confronto\]|\[posta\]|Briefly inform the user about the task result|Perform any necessary follow-up actions)/.test(t);
// Only one stop hook may return a follow-up: two at once is undocumented in Cursor, so the review-comparison hand-over
// (harness/compare/deliver.mjs) runs here too, when there is no correction to log.

// Each handled message once (the stop hook fires again after automatic turns): key = chat + line index + text.
let seen = null;
const firstTime = key => {
  if (!seen) { try { seen = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { seen = []; } }
  if (seen.includes(key)) return false;
  seen = [...seen, key].slice(-500);
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(seen));
  return true;
};
const textOf = r => (r?.message?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
// Chat title from Cursor's DB (read-only, same table as chats.mjs), else the first words of the chat.
const titleOf = (id, rows) => {
  try {
    process.removeAllListeners('warning'); // node:sqlite is "experimental" in Node 22
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const db = new DatabaseSync(process.env.BRAIN_CURSOR_DB || path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb'), { readOnly: true });
    const v = db.prepare('SELECT value FROM composerHeaders WHERE composerId = ?').get(id)?.value;
    db.close();
    const name = v && JSON.parse(v).name;
    if (name) return name;
  } catch { /* no DB: fallback */ }
  const first = rows.map(r => (r.role === 'user' ? typed(textOf(r)) : '')).find(Boolean) || '?';
  return `Cursor: ${first.split(/\s+/).slice(0, 6).join(' ')}`;
};

function check(input) {
  if ((input.loop_count ?? 0) > 0 || input.status !== 'completed') return null; // our own follow-up turn, or aborted
  const file = input.transcript_path || process.env.CURSOR_TRANSCRIPT_PATH;
  if (!file || /[\\/]subagents[\\/]/.test(file)) return null;
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  let last = -1, msg = '';
  rows.forEach((r, i) => {
    if (r.role !== 'user') return;
    const t = typed((r.message?.content || []).map(c => c.text || '').join('\n'));
    if (t && !notOwner(t)) { last = i; msg = t; }
  });
  if (last < 0 || msg.startsWith('<')) return null;
  if (!rows.slice(0, last).some(r => r.role === 'assistant')) return null; // first message of a chat: nothing to judge yet
  const id = input.conversation_id || path.basename(file, '.jsonl');
  if (isPositive(msg) && firstTime(crypto.createHash('sha1').update(`praise\n${id}\n${last}\n${msg}`).digest('hex').slice(0, 16)))
    logPositive({ harness: 'cursor', chat: titleOf(id, rows), cwd: (input.workspace_roots || [])[0], text: msg,
      lastAssistant: textOf(rows.slice(0, last).reverse().find(r => r.role === 'assistant' && textOf(r).trim())) });
  if (!(CORRECTION.test(msg) || CONFUSION.test(msg))) return null;
  const after = rows.slice(last + 1).flatMap(r => (r.role === 'assistant' ? r.message?.content || [] : []));
  const cmd = c => String(c.input?.command ?? JSON.stringify(c.input || {}));
  if (after.some(c => c.type === 'tool_use' && /mem\.mjs["']?\s+error\b/.test(cmd(c)))) return null; // already logged
  // line index in the key: the same words typed again later in the chat are a new correction
  const key = crypto.createHash('sha1').update(`${input.conversation_id || file}\n${last}\n${msg}`).digest('hex').slice(0, 16);
  if (!firstTime(key)) return null;
  const quote = msg.length > 200 ? `${msg.slice(0, 199)}…` : msg;
  return {
    followup_message: `[correction-log] {{OWNER}}'s last message may correct you or show he did not understand: "${quote}". ` +
      'If it does, append one line to {{BRAIN}}/ai-errors.md in the format of its header (date time, ' +
      `chat, area, type, said, true, seen by: how he noticed, with his words) with \`${MEM}\`; if it prints SECONDA ` +
      'VOLTA, propose the rule as that header says. If it is not an error (a new request, "ricordati di..."), write ' +
      'nothing. Either way reply in one short line and do not redo the rest of the turn.',
  };
}

let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', async () => {
  let input = {}, out = null;
  try { input = parseHookJson(raw); out = check(input); } catch { /* never block */ }
  // No correction to log: hand Opus' frozen review to this chat if one is ready (harness/compare/deliver.mjs; loaded
  // lazily so a broken compare script can never break this hook).
  if (!out) try { out = (await import('../compare/deliver.mjs')).deliver(input); } catch { /* never block */ }
  // Nothing else to say: mail from other chats (ops/tools/inbox.mjs; queued again if Cursor would drop it).
  if (!out) try { out = await (await import('../../ops/tools/inbox.mjs')).hookDeliver('cursor', input); } catch { /* never block */ }
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
});
