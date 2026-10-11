// session-find: "riprendiamo X" / "a che punto eravamo" when the now.md line is old or missing. READ-ONLY.
// Finds the Claude chats (main sessions in ~/.claude/projects/*/*.jsonl, no subagents) and the Cursor chats whose messages contain ALL the
// words, and for each shows, in one call: title, folder, first → last time, how it started (first messages), the
// best-matching point (±2 messages) and how it ended (last messages). Like Hermes' session_search (2026-10-08).
// Usage: node "{{BRAIN}}/ops/tools/session-find.mjs" <words...> [--days 30] [--top 3] [--chars 220]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mask } from './mask.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv.splice(i, 2)[1]) : d; };
const days = opt('--days', 30), top = opt('--top', 3), chars = opt('--chars', 220);
const words = argv.map(w => w.toLowerCase());
if (!words.length) { console.log('Usage: node ops/tools/session-find.mjs <words...> [--days 30] [--top 3] [--chars 220]'); process.exit(1); }

const base = process.env.BRAIN_CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects');
const since = Date.now() - days * 864e5;
const rome = t => new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 16);
const clip = s => { s = mask(s).replace(/\s+/g, ' ').trim(); return s.length > chars ? s.slice(0, chars) + '…' : s; };
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p.type === 'text').map(p => p.text).join(' ') : '';

const hits = [];
for (const dir of fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())) {
  for (const f of fs.readdirSync(path.join(base, dir.name)).filter(f => f.endsWith('.jsonl'))) {
    const file = path.join(base, dir.name, f);
    const st = fs.statSync(file);
    if (st.mtimeMs < since) continue;
    const raw = fs.readFileSync(file, 'utf8');
    const low = raw.toLowerCase();
    if (!words.every(w => low.includes(w))) continue; // cheap pre-filter before parsing
    let title = '', cwd = '';
    const msgs = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type === 'custom-title') title = j.customTitle;
      if ((j.type !== 'user' && j.type !== 'assistant') || j.isSidechain || j.isMeta) continue;
      cwd ||= j.cwd || '';
      const t = textOf(j.message?.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
      if (!t.trim() || /^<(command|local-command)/.test(t.trim())) continue;
      const who = j.type === 'assistant' ? 'AI' : /^<(agent-message|task-notification)|Another Claude session/.test(t.trim()) ? 'agente' : 'Owner';
      msgs.push({ who, t, ts: j.timestamp });
    }
    const scored = msgs.map((m, i) => [i, words.filter(w => m.t.toLowerCase().includes(w)).length]).filter(([, n]) => n);
    const coverage = new Set(msgs.flatMap(m => words.filter(w => m.t.toLowerCase().includes(w))));
    if (coverage.size < words.length) continue; // words only inside tool calls/results
    const best = scored.sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    hits.push({ title, cwd, file, msgs, best, score: scored.length, last: st.mtimeMs });
  }
}

// Cursor chats too (2026-10-10 "un solo modo"): ~/.cursor/projects/<folder>/agent-transcripts/<id>/<id>.jsonl; no
// per-message time (all get the file's), title = {{OWNER}}'s first message (the reader `chats.mjs` has the real titles).
const cursorBase = process.env.BRAIN_CURSOR_PROJECTS || path.join(os.homedir(), '.cursor', 'projects');
const typed = t => [...String(t).matchAll(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/g)].map(m => m[1]).join('\n').trim();
let cdirs = []; try { cdirs = fs.readdirSync(cursorBase); } catch { /* no Cursor */ }
for (const d of cdirs) {
  const tdir = path.join(cursorBase, d, 'agent-transcripts');
  let ids = []; try { ids = fs.readdirSync(tdir); } catch { continue; }
  for (const id of ids) {
    const file = path.join(tdir, id, `${id}.jsonl`);
    let st; try { st = fs.statSync(file); } catch { continue; }
    if (st.mtimeMs < since) continue;
    const raw = fs.readFileSync(file, 'utf8');
    if (!words.every(w => raw.toLowerCase().includes(w))) continue;
    const ts = new Date(st.mtimeMs).toISOString(), msgs = [];
    for (const line of raw.split('\n')) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      const parts = (j.message?.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ');
      const t = j.role === 'user' ? typed(parts) : j.role === 'assistant' ? parts : '';
      // Cursor's automatic turns and mail from other chats arrive as user turns: not {{OWNER}}'s words
      const auto = j.role === 'user' && /^(Briefly inform the user about the task result|Perform any necessary follow-up actions|\[correction-log\]|\[review-confronto\]|\[posta\])/.test(t.trim());
      if (t.trim()) msgs.push({ who: j.role === 'user' ? (auto ? 'agente' : 'Owner') : 'AI', t, ts });
    }
    const scored = msgs.map((m, i) => [i, words.filter(w => m.t.toLowerCase().includes(w)).length]).filter(([, n]) => n);
    if (new Set(msgs.flatMap(m => words.filter(w => m.t.toLowerCase().includes(w)))).size < words.length) continue;
    const best = scored.sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    hits.push({ title: `Cursor · ${clip(msgs.find(m => m.who === 'Owner')?.t || id).slice(0, 60)}`, cwd: d, file, msgs, best, score: scored.length, last: st.mtimeMs });
  }
}

hits.sort((a, b) => b.score - a.score || b.last - a.last);
console.log(`# session-find "${words.join(' ')}" (ultimi ${days} giorni): ${hits.length} chat\n`);
for (const h of hits.slice(0, top)) {
  const m = h.msgs, show = i => `  - ${m[i].who} ${rome(m[i].ts).slice(11)}: ${clip(m[i].t)}`;
  console.log(`## ${h.title || '(senza titolo)'} · ${rome(m[0].ts)} → ${rome(m[m.length - 1].ts)} · ${m.length} messaggi, ${h.score} con le parole`);
  console.log(`cartella: ${h.cwd} · transcript: ${h.file.replace(/\\/g, '/')}`);
  console.log('Inizio:'); for (let i = 0; i < Math.min(2, m.length); i++) console.log(show(i));
  console.log('Punto trovato:'); for (let i = Math.max(0, h.best - 2); i <= Math.min(m.length - 1, h.best + 2); i++) console.log(show(i));
  console.log('Fine:'); for (let i = Math.max(2, m.length - 3); i < m.length; i++) console.log(show(i));
  console.log('');
}
