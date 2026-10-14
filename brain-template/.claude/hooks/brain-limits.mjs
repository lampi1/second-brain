// PreToolUse hook (Edit|Write|MultiEdit), wired by {{OWNER}} in ~/.claude/settings.json (P-057; brain-rules.md 3).
// Hard limits of the brain, like Hermes' memory: a write that makes things worse is refused with the numbers.
//  1. Fixed context (me.md, AGENTS.md, CLAUDE.md of {{BRAIN_NAME}} or a worktree of it, ~/.claude/CLAUDE.md, output styles):
//     refused when it GROWS and the total is over the budget (15k chars, same count as ops/tools/brain-lint.mjs).
//  2. now.md ({{BRAIN_NAME}} or a worktree): any change to its "- " lines is refused, with the ops/tools/mem.mjs command
//     to use instead (mem.mjs checks length and control characters); header-only edits pass (2026-10-10).
// Edits that shorten always pass (so an urgent chat can always trim). Exit 2 = block, reason on stderr; any error =
// exit 0 (never breaks a write it does not understand).
import fs from 'node:fs';
import { parseHookJson } from '../../harness/cursor/hook-input.mjs';
import os from 'node:os';
import path from 'node:path';

const BUDGET = 15000, NOW_MAX = 250, HUB_BUDGET = 8500;
const home = os.homedir().replace(/\\/g, '/');
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const norm = s => (s ?? '').replace(/\r\n/g, '\n');
const block = msg => { console.error(msg); process.exit(2); };

try {
  const input = parseHookJson(fs.readFileSync(0, 'utf8')); // Cursor runs this hook too, with a UTF-8 BOM
  const ti = input.tool_input || {};
  const file = String(ti.file_path || '').replace(/\\/g, '/');
  const brain = file.match(/^(.*\/{{BRAIN_NAME}}(?:\/\.claude\/worktrees\/[^/]+)?)\/(me\.md|AGENTS\.md|CLAUDE\.md|now\.md|hub\.md)$/i);
  const styles = `${home}/.claude/output-styles/`.toLowerCase();
  const isStyle = file.toLowerCase().startsWith(styles) && file.toLowerCase().endsWith('.md');
  const isUserClaude = file.toLowerCase() === `${home}/.claude/CLAUDE.md`.toLowerCase();
  if (!brain && !isStyle && !isUserClaude) process.exit(0);

  // Text after the tool call
  const before = read(file) ?? '';
  let after = before;
  const apply = (oldS, newS, all) => {
    if (!after.includes(oldS)) { // the Edit tool also matches with LF when the file has CRLF
      const lf = norm(after);
      if (!lf.includes(oldS)) process.exit(0); // the tool itself will fail
      after = lf;
    }
    after = all ? after.split(oldS).join(newS) : after.replace(oldS, () => newS);
  };
  if (input.tool_name === 'Write') after = String(ti.content ?? '');
  else if (input.tool_name === 'Edit') apply(String(ti.old_string ?? ''), String(ti.new_string ?? ''), ti.replace_all);
  else if (input.tool_name === 'MultiEdit') for (const e of ti.edits || []) apply(String(e.old_string ?? ''), String(e.new_string ?? ''), e.replace_all);
  else process.exit(0);
  const b = norm(before), a = norm(after);

  if (brain && /^now\.md$/i.test(brain[2])) {
    // Thread lines ("- " bullets) are written only by ops/tools/mem.mjs ({{OWNER}}, 2026-10-10: 250 hand edits of now.md
    // in 4 days, merge conflicts on worktree copies); an edit of the header text alone still passes.
    const bullets = t => t.split('\n').filter(l => l.startsWith('- '));
    const same = bullets(a).join('\n') === bullets(b).join('\n');
    if (!same || input.tool_name === 'Write')
      block('now.md lines are written only with mem.mjs (always the main checkout, worktrees too): ' +
        'node "{{BRAIN}}/ops/tools/mem.mjs" now me --label "<your chat label>" --text "<where · state · next step>" ' +
        '(adds or replaces your own line); other lines: now set --match "<words>" --text "<line>" | now add --section "<heading>" | now del --match "<words>". ' +
        'Text with backslashes: write it to a file with Write and pass --file.');
    if (a.split('\n').some(l => l.length > NOW_MAX && !b.split('\n').includes(l)))
      block(`now.md: a header line over ${NOW_MAX} chars; shorten it, then retry.`);
    process.exit(0);
  }

  if (brain && /^hub\.md$/i.test(brain[2])) { // the Regia's own file: its own cap (2026-10-13)
    if (a.length > b.length && a.length > HUB_BUDGET)
      block(`hub.md ${b.length} → ${a.length} chars, budget ${HUB_BUDGET}: shorten or move to harness/ first (brain-rules.md 3), then retry.`);
    process.exit(0);
  }

  // Fixed context: same files and count as brain-lint (default output style only; a selected-only style counts itself)
  const root = brain ? brain[1] : '{{BRAIN}}';
  const style = (read(`${home}/.claude/settings.json`) || '').match(/"outputStyle"\s*:\s*"([^"]+)"/)?.[1]?.toLowerCase();
  const fixed = [`${home}/.claude/CLAUDE.md`, `${root}/CLAUDE.md`, `${root}/me.md`, `${root}/AGENTS.md`];
  for (const s of fs.existsSync(styles) ? fs.readdirSync(styles) : [])
    if (isStyle ? `${styles}${s}`.toLowerCase() === file.toLowerCase() : s.replace(/\.md$/i, '').toLowerCase() === style) fixed.push(`${styles}${s}`); // one style per chat
  const total = [...new Set(fixed.map(p => p.toLowerCase()))].reduce((n, p) => n + norm(read(p)).length, 0);
  const delta = a.length - b.length;
  if (delta > 0 && total + delta > BUDGET)
    block(`Fixed context ${total} → ${total + delta} chars, budget ${BUDGET} (over by ${total + delta - BUDGET}): this edit adds ${delta}. ` +
      `First shorten or move to a file read on demand at least ${delta} chars (brain-rules.md 3), then retry; edits that shorten always pass.`);
} catch {
  // fail open
}
process.exit(0);
