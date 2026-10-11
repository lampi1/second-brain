// brain-usage: what of the brain is really used, to prune instead of adding (brain-rules.md 3). READ-ONLY.
// Counts, over the Claude transcripts of the last N days (~/.claude/projects, subagents included): skills launched
// (Skill tool + /slash commands), subagents launched (Agent/Task subagent_type), {{BRAIN_NAME}} files read (Read tool,
// main checkout and worktrees) and ops/tools scripts run (Bash/PowerShell commands naming ops/tools/<name>.mjs).
// Lists skills, agents, tools and brain files with their count; 0 = candidate to prune or merge, {{OWNER}} decides in maintenance (git is the archive). Single rules (lines) are not countable: a file never read
// on demand is the signal. Like Hermes' curator (2026-10-08), without automatic archiving.
// Usage: node "{{BRAIN}}/ops/tools/brain-usage.mjs" [--days 30] [--json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const i = process.argv.indexOf('--days');
const days = i > 0 ? Number(process.argv[i + 1]) : 30;
const since = Date.now() - days * 864e5;
const home = os.homedir();
const ROOT = '{{BRAIN}}';
const base = path.join(home, '.claude', 'projects');
const skills = {}, agents = {}, reads = {}, tools = {};
const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };

const files = [];
const walk = (d, depth) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name);
  if (e.isDirectory() && depth < 3) walk(p, depth + 1);
  else if (e.name.endsWith('.jsonl') && fs.statSync(p).mtimeMs >= since) files.push(p);
} };
walk(base, 0);

const brainRel = p => {
  const m = String(p).replace(/\\/g, '/').match(/\/{{BRAIN_NAME}}\/(?:\.claude\/worktrees\/[^/]+\/)?(.+)$/i);
  return m && !m[1].startsWith('.claude/worktrees/') ? m[1] : null;
};
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.includes('"tool_use"') && !line.includes('command-name')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.timestamp && Date.parse(j.timestamp) < since) continue;
    const c = j.message?.content;
    if (typeof c === 'string') { for (const m of c.matchAll(/<command-name>\/?([\w:-]+)<\/command-name>/g)) inc(skills, m[1]); continue; }
    for (const p of Array.isArray(c) ? c : []) {
      if (p.type === 'text' && j.type === 'user') for (const m of p.text.matchAll(/<command-name>\/?([\w:-]+)<\/command-name>/g)) inc(skills, m[1]);
      if (p.type !== 'tool_use') continue;
      if (p.name === 'Skill') inc(skills, String(p.input?.skill || p.input?.command || '?').replace(/^\//, ''));
      if ((p.name === 'Agent' || p.name === 'Task') && p.input?.subagent_type) inc(agents, p.input.subagent_type);
      if (p.name === 'Read') { const r = brainRel(p.input?.file_path); if (r) inc(reads, r); }
      if (p.name === 'Bash' || p.name === 'PowerShell') for (const t of new Set([...String(p.input?.command ?? '').matchAll(/ops[\\/]tools[\\/]([\w.-]+?)\.(?:mjs|sh|ps1)\b/g)].map(m => m[1]))) inc(tools, t);
    }
  }
}

// What exists
const list = (d, f) => (fs.existsSync(d) ? fs.readdirSync(d) : []).filter(f);
const allSkills = list(path.join(home, '.claude', 'skills'), s => fs.existsSync(path.join(home, '.claude', 'skills', s, 'SKILL.md')));
const allAgents = list(path.join(ROOT, '.claude', 'agents'), s => s.endsWith('.md')).map(s => s.replace(/\.md$/, ''));
const brainFiles = [
  ...list(ROOT, s => s.endsWith('.md')),
  ...list(path.join(ROOT, 'rules'), s => s.endsWith('.md')).map(s => `rules/${s}`),
  'ops/AGENTS.md',
  ...list(path.join(ROOT, 'ops', 'runbook'), s => s.endsWith('.md')).map(s => `ops/runbook/${s}`),
];
const allTools = list(path.join(ROOT, 'ops', 'tools'), s => /\.(mjs|sh|ps1)$/.test(s) && !/\.test\.mjs$/.test(s)).map(s => s.replace(/\.(mjs|sh|ps1)$/, ''));
const always = new Set(['AGENTS.md', 'CLAUDE.md', 'me.md']); // loaded in every chat: never "unused"
const rows = (names, counts) => names.map(n => [n, counts[n] || 0]).sort((a, b) => b[1] - a[1]);
const report = {
  days, transcripts: files.length,
  skills: rows(allSkills, skills), agents: rows(allAgents, agents), tools: rows(allTools, tools),
  files: rows(brainFiles.filter(f => !always.has(f)), reads),
  other: { skills: Object.keys(skills).filter(s => !allSkills.includes(s)).map(s => [s, skills[s]]) },
};
if (process.argv.includes('--json')) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }

const show = (title, r) => {
  const zero = r.filter(([, n]) => !n).map(([k]) => k);
  console.log(`\n## ${title}\n${r.filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ') || '(nessuno)'}`);
  console.log(`- mai usati in ${days} giorni (${zero.length}): ${zero.join(', ') || 'nessuno'}`);
};
console.log(`# Uso del cervello, ultimi ${days} giorni (${files.length} transcript, letture col tool Read)`);
show('Skill', report.skills);
show('Agenti', report.agents);
show('Script di ops/tools lanciati', report.tools);
show('File di {{BRAIN_NAME}} letti (esclusi i sempre caricati: AGENTS.md, CLAUDE.md, me.md)', report.files);
if (report.other.skills.length) console.log(`\nAltri comandi /: ${report.other.skills.map(([k, n]) => `${k} ${n}`).join(' · ')}`);
console.log('\nCandidati da togliere o accorpare = "mai usati"; decide {{OWNER}} in manutenzione (git è l\'archivio).');
