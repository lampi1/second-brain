// UserPromptSubmit hook (P-042): when {{OWNER}}'s message looks like a correction or confusion, remind the chat to log it.
// Also the Claude adapter of ops/tools/feedback-log.mjs: praise is appended to ai-wins.md by the hook itself, with no
// injected context (zero model tokens). The transcript is read only for a praise message (~1.4% of his messages).
import fs from 'node:fs';
import path from 'node:path';
import { parseHookJson } from '../../harness/cursor/hook-input.mjs';
import { CORRECTION, CONFUSION, isPositive } from '../../ops/tools/signals-regex.mjs';
import { logPositive } from '../../ops/tools/feedback-log.mjs';

// Last ~400 KB of the transcript, newest line first.
const tail = file => {
  try {
    const fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size; const len = Math.min(400_000, size);
    const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
    return buf.toString('utf8').split('\n').slice(len < size ? 1 : 0).reverse(); // a cut first line is dropped
  } catch { return []; }
};
const json = l => { try { return JSON.parse(l); } catch { return null; } };

let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', () => {
  let input, prompt = '';
  try {
    input = parseHookJson(raw); // BOM from Cursor: parsed, then skipped below
    // Cursor imports Claude hooks with a different input and does not inject on prompt submit: skip it ({{OWNER}}, 2026-10-09).
    if ('cursor_version' in input || 'conversation_id' in input) return;
    prompt = input.prompt ?? '';
  } catch { return; }
  // Only {{OWNER}}'s own messages: skip agent reports and task notifications (same filter as flow-signals).
  if (prompt.trimStart().startsWith('<') || /<agent-message|<task-notification|Another Claude session sent a message/.test(prompt)) return;
  if (isPositive(prompt)) {
    const lines = tail(input.transcript_path);
    const title = input.session_title || json(lines.find(l => l.includes('"custom-title"')))?.customTitle || path.basename(input.cwd || '?');
    const last = lines.map(l => (l.includes('"type":"assistant"') ? json(l) : null))
      .find(o => o && !o.isSidechain && (o.message?.content ?? []).some(c => c.type === 'text' && c.text.trim()));
    logPositive({ harness: 'claude', chat: title, cwd: input.cwd, text: prompt,
      lastAssistant: (last?.message?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n') });
  }
  if (!CORRECTION.test(prompt) && !CONFUSION.test(prompt)) return;
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext:
    'If this message corrects you, or shows {{OWNER}} did not understand or did not see something you sent, then in this turn ' +
    'append one line to {{BRAIN}}/ai-errors.md in its format (date time, chat, area, type, said, true, ' +
    'seen by: how he noticed, with his words) with `node "{{BRAIN}}/ops/tools/mem.mjs" error --text "<line>"`. ' +
    'If it prints SECONDA VOLTA, send the Regia a rule proposal (file + exact text). ' +
    'Not an error (a new request, "ricordati di..."): write nothing.' } }));
});
