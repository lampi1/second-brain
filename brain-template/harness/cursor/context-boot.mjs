// Cursor sessionStart hook: gives every Cursor chat the context Claude gets from ~/.claude/CLAUDE.md (+ its @me.md
// import) and the output style "{{OWNER}}", read at runtime from the canonical files (no copies). In the {{BRAIN_NAME}} main
// workspace the chat titled "Orchestrator..." gets its role (a pointer to hub.md); every other chat is told it is a work chat.
// Wired in ~/.cursor/hooks.json (harness/cursor/hooks.json).
// Output: {"additional_context": "..."}; any error → no output (the chat starts without it, never blocked).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseHookJson } from './hook-input.mjs';

process.removeAllListeners('warning'); // node:sqlite "experimental" warning: hooks print only their JSON
const HOME = os.homedir();
const OPS = '{{BRAIN}}';
const read = p => { try { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
const noFrontmatter = t => t.replace(/^---\n[\s\S]*?\n---\n/, '');

let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', async () => {
  let input = {};
  try { input = parseHookJson(raw); } catch {}
  const roots = (input.workspace_roots || [process.env.CURSOR_PROJECT_DIR || '']).map(r => path.resolve(String(r)).toLowerCase());
  const inMain = roots.includes(path.resolve(OPS).toLowerCase());
  const global = read(`${HOME}/.claude/CLAUDE.md`).split('\n').filter(l => !l.startsWith('@')).join('\n').trim();
  const parts = [
    '# {{OWNER}} context ({{BRAIN_NAME}}, loaded by the Cursor sessionStart hook from the canonical files)',
    global,
    read(`${OPS}/me.md`).trim(),
    noFrontmatter(read(`${HOME}/.claude/output-styles/owner.md`)).trim(),
    '## Running in Cursor (not Claude Code)\n' +
      `- The brain is ${OPS}: read its AGENTS.md before any work (routing table, hard rules).\n` +
      '- Production guard: shell commands that touch production are blocked or need approval by the {{BRAIN_NAME}} prod-guard hook; ' +
      'a block is final: give {{OWNER}} the command, never look for another way.\n' +
      '- The brain and its skills name Claude Code tools: the same in both below; where they differ, use the Cursor column.\n\n' +
      // harness/tools.md from "Same in both" to the end of the table (2026-10-10 "un solo modo")
      (read(`${OPS}/harness/tools.md`).match(/^Same in both[\s\S]*?\n\|[^\n]*(?:\n\|[^\n]*)*/m)?.[0] ?? ''),
  ];
  if (inMain && await isRegia(input)) parts.push(REGIA);
  else if (inMain) parts.push('## {{BRAIN_NAME}} main workspace\nYou are a work chat, not the Orchestrator. Only if {{OWNER}} types `/regia` ' +
    '(project skill .cursor/skills/regia) does this chat become the Orchestrator.');
  const text = parts.filter(Boolean).join('\n\n');
  if (text.length > 200) process.stdout.write(JSON.stringify({ additional_context: text }));
});

// The Orchestrator = the {{BRAIN_NAME}} chat whose Cursor title starts with "Orchestrator" (or the older "Regia"; Cursor names a chat started with `/regia`
// after its first message; {{OWNER}} can rename it). A new chat has no title yet: there the `/regia` skill does the same.
// Title read-only from Cursor's composerHeaders (as harness/cursor/chats.mjs); any failure → not the Orchestrator.
const REGIA = '## You are the Orchestrator\nThis chat is {{OWNER}}\'s hub (the Orchestrator). Read ' + `${OPS}/hub.md` + ' now and follow it ' +
  '(role, jobs, decisions, how work chats start in Cursor), with the output style ' +
  `${HOME.replace(/\\/g, '/')}/.claude/output-styles/regia.md. For the state of the other chats use the skill stato.`;
async function isRegia(input) {
  const id = input.conversation_id || input.session_id;
  if (!id) return false;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(process.env.BRAIN_CURSOR_DB || path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb'), { readOnly: true });
    const v = db.prepare('SELECT value FROM composerHeaders WHERE composerId = ?').get(String(id))?.value;
    db.close();
    return /^\s*(regia|orchestrator)\b/i.test(JSON.parse(v || '{}').name || '');
  } catch { return false; }
}
