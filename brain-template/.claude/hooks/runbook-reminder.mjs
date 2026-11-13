// Stop hook, two parts. Nothing here is shown to {{OWNER}} on an ordinary turn (no systemMessage, 2026-10-06).
// 1. If this turn did operational work (proposed SQL or touched query files) but did not update ops/runbook/*.md /
//    catalog.md / services.md, block the stop once and ask Claude to record it. Memory counts as updated when those
//    files are written with Write/Edit or named in a Bash command (scripted edits).
// 2. Hygiene reminders, written to .claude/hygiene.txt at every stop (overwritten; empty when all is fine; read by the
//    skills `stato` and `opzioni`), never printed:
//    now.md lines > 300 chars or with control characters (e.g. "\r" from an unescaped "%TEMP%\deploy"),
//    now.md lines whose "(updated YYYY-MM-DD)" / "(YYYY-MM-DD)" is older than 7 days,
//    .sql files under ops/ not referenced in ops/catalog.md (exact path, basename or a glob entry like `x/**`).
//    Exception: control characters in now.md (corruption, AGENTS.md hard rule 6) also block the stop once, so the
//    agent that caused them fixes them now.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseHookJson } from '../../harness/cursor/hook-input.mjs';
import { brainRoot } from '../../ops/tools/brain-root.mjs';

const repo = brainRoot(import.meta.url);
let input = {};
try { input = parseHookJson(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); } // Cursor: UTF-8 BOM
// In Cursor a "block" becomes an automatic follow-up with no loop limit: skip repeated runs ({{OWNER}}, 2026-10-09).
if (input.stop_hook_active || input.loop_count > 0) process.exit(0);

let bad = [];
function hygiene() {
  const notes = [];
  try {
    const now = fs.readFileSync(path.join(repo, 'now.md'), 'utf8');
    const lines = now.replace(/\r\n/g, '\n').split('\n');
    const long = [];
    lines.forEach((l, i) => {
      if (l.length > 300) long.push(i + 1);
      if (/[\x00-\x08\x0b-\x1f]/.test(l)) bad.push(i + 1);
    });
    if (long.length) notes.push(`now.md lines > 300 chars: ${long.join(', ')} (move details to runbook/journal, keep topic · where · next step · date)`);
    if (bad.length) notes.push(`now.md lines with control characters (corrupted escape like \\r or \\f): ${bad.join(', ')}`);
    try {
      // local-date cutoff as YYYY-MM-DD string: "> 7 days" without UTC off-by-one
      const c = new Date(); c.setDate(c.getDate() - 7);
      const cutoff = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
      const stale = [];
      lines.forEach((l, i) => {
        const d = [...l.matchAll(/\((?:updated )?(\d{4}-\d{2}-\d{2})\)/g)].pop();
        if (d && d[1] < cutoff) stale.push(i + 1);
      });
      if (stale.length) notes.push(`now.md: ${stale.length} lines not updated for > 7 days (${stale.join(', ')}): refresh or remove closed threads`);
    } catch { /* stale check is best effort */ }
  } catch { /* no now.md */ }
  try {
    const catalog = fs.readFileSync(path.join(repo, 'ops', 'catalog.md'), 'utf8');
    const tokens = [...catalog.matchAll(/`([^`\s]+)`/g)].map(m => m[1]);
    const globs = tokens.filter(t => /[*{]/.test(t)).map(t => new RegExp('^' + t
      .replace(/[.+^$()|[\]\\]/g, '\\$&')
      .replace(/\{([^}]*)\}/g, (_, a) => `(${a.split(',').join('|')})`)
      .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$'));
    const ls = spawnSync('git', ['-C', repo, 'ls-files', '-co', '--exclude-standard', 'ops'], { encoding: 'utf8', timeout: 5000 });
    const missing = (ls.stdout || '').split('\n').filter(f => f.endsWith('.sql')).map(f => f.slice('ops/'.length))
      .filter(f => !catalog.includes(f) && !catalog.includes(`\`${path.posix.basename(f)}\``) && !globs.some(g => g.test(f)));
    if (missing.length) notes.push(`ops/*.sql not in ops/catalog.md: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` (+${missing.length - 5})` : ''}`);
  } catch { /* no catalog */ }
  return notes;
}

const notes = hygiene();
try {
  fs.writeFileSync(path.join(repo, '.claude', 'hygiene.txt'), notes.length ? notes.join('\n') + '\n' : '');
} catch { /* never fail the turn */ }
if (input.stop_hook_active) process.exit(0);

let opsWork = false, memoryUpdated = false;
try {
  if (input.transcript_path) {
    const entries = fs.readFileSync(input.transcript_path, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    // The turn starts at the last genuine user prompt (not a tool result).
    const isPrompt = e => e.type === 'user' && (
      typeof e.message?.content === 'string' ||
      (Array.isArray(e.message?.content) && e.message.content.some(c => c.type === 'text')));
    let start = 0;
    for (let i = entries.length - 1; i >= 0; i--) if (isPrompt(entries[i])) { start = i; break; }

    for (const e of entries.slice(start)) {
      if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
      for (const c of e.message.content) {
        if (c.type === 'text' && /```sql/i.test(c.text)) opsWork = true;
        if (c.type === 'tool_use' && c.name === 'Bash' && /runbook\/|catalog\.md|services\.md|hotfix-flow\.md/.test(String(c.input?.command || ''))) memoryUpdated = true;
        if (c.type === 'tool_use' && ['Write', 'Edit'].includes(c.name)) {
          const p = String(c.input?.file_path || '').replace(/\\/g, '/');
          if (/\/(runbook\/[^/]+|catalog|services|hotfix-flow)\.md$/i.test(p)) memoryUpdated = true;
          else if (/\.(sql|sh|ps1)$/i.test(p)) opsWork = true;
        }
      }
    }
  }
} catch { /* unreadable transcript: only hygiene */ }

const reasons = [];
if (opsWork && !memoryUpdated) reasons.push('{{BRAIN_NAME}}: this turn proposed or changed queries but the operational memory was not updated. ' +
  'If this is a new or changed procedure, add it to its topic file in ops/runbook/ (and new queries to catalog.md, new Azure resources ' +
  'to services.md). If nothing new was learned, reply with one short line saying so and stop.');
// In a worktree copy now.md is not the one agents edit (they write the main one by absolute path): no block there.
const inWorktree = /[\\/]\.claude[\\/]worktrees[\\/]/.test(repo);
if (bad.length && !inWorktree) reasons.push(`{{BRAIN_NAME}}: now.md lines ${bad.join(', ')} contain control characters (a "\\\\" collapsed by Bash, ` +
  'e.g. "\\r" or "\\f"): rewrite those lines with Edit/Write (AGENTS.md hard rule 6), then stop.');
if (reasons.length) console.log(JSON.stringify({ decision: 'block', reason: reasons.join(' ') }));
process.exit(0);
