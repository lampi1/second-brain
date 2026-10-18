// brain-map: the map of {{OWNER}}'s brain ({{BRAIN_NAME}}) read from the real files, for the 3D page of the brain site
// (ops/tools/brain-site.mjs; {{OWNER}} 2026-10-10, "rappresentazione 3d del mio cervello... costantemente aggiornata").
// READ-ONLY, no model, zero tokens. Which pieces exist and how they link is never written by hand: agents from
// .claude/agents frontmatter, notebooks from playbook.mjs, tools and hooks from their header comment, hook wiring from
// ~/.claude/settings.json + .claude/settings.json + harness/cursor/hooks.json, memory and rule files from the map.md
// table, skills from ~/.claude/skills/*/SKILL.md, chats from the inbox boxes, last change from git, use from
// brain-usage.mjs. Hand-written: the pieces' Italian names and sentences (brain-map/labels.mjs, SHORT) and FLOWS ("how
// it works"): every step cites a sentence of a real file and is marked unverified when that sentence is gone, so the
// map never claims what the brain no longer says.
// Usage: node "{{BRAIN}}/ops/tools/brain-map.mjs" [--json] [--no-usage]   (--root/--home: tests)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_ROOT = '{{BRAIN}}';
const HERE = path.dirname(fileURLToPath(import.meta.url));

export const LAYERS = [
  { id: 'persone', label: 'Persone', hint: '{{OWNER}} e i colleghi' },
  { id: 'chat', label: 'Chat', hint: 'la Regia e le chat di lavoro' },
  { id: 'agenti', label: 'Agenti e skill', hint: 'specialisti, i loro taccuini, le skill' },
  { id: 'tool', label: 'Tool e hook', hint: 'script di ops/tools e hook che scattano da soli' },
  { id: 'memoria', label: 'Memoria', hint: 'dove il cervello scrive quello che succede' },
  { id: 'regole', label: 'Regole', hint: 'come devono lavorare gli agenti' },
  { id: 'esterni', label: 'Esterni', hint: 'servizi fuori dal PC e i due programmi (Claude, Cursor)' },
];

// Files of map.md that are rules (how to work), the rest is memory (what happened, what is open).
const RULE_FILES = new Set(['AGENTS.md', 'me.md', 'hub.md', 'code.md', 'rules/qa.md', 'brain-rules.md',
  'review-catalog.md', 'harness/tools.md', 'ops/AGENTS.md', 'ops/hotfix-flow.md', 'routines.md', 'people.md']);

// External services, recognised in a piece's own text (code or instructions): an edge only where the text says so.
export const EXTERNALS = [
  { id: 'ext:devops', label: 'Azure DevOps', what: 'Work item, PR, build e rilasci del team (my-app).', re: /dev\.azure\.com|visualstudio\.com|devops|az (boards|repos|pipelines)|_apis\/(wit|git|build|release)/ },
  { id: 'ext:azure', label: 'Azure', what: 'Le risorse di produzione e test del prodotto (App Service, alert, Resource Graph).', re: /\baz (webapp|resource|monitor|account|rest|graph)\b|management\.azure\.com|Resource Graph|Kudu/ },
  { id: 'ext:appinsights', label: 'App Insights', what: 'Log e metriche delle app (query KQL).', re: /applicationinsights|App Insights|\bKQL\b/ },
  { id: 'ext:proddb', label: 'Database di produzione', what: 'I database di produzione: solo query di lettura, lanciate dopo il suo ok.', re: /database\.windows\.net|ro-query|sqlcmd/ },
  { id: 'ext:mail', label: 'Outlook e Teams', what: 'Posta e chat aziendali, lette dal pannello browser della chat "Posta e chat".', re: /\bOutlook\b|\bTeams\b/ },
  { id: 'ext:transcripts', label: 'Trascrizioni delle chat', what: 'I file delle conversazioni di Claude (~/.claude/projects) e Cursor: da qui si contano costi e uso.', re: /\.claude[\\/'", ]+projects|agent-transcripts|transcript_path|\.jsonl\b/ },
  { id: 'ext:git', label: 'Git', what: 'La storia dei file: {{BRAIN_NAME}} ha un git locale senza remote, i repo di prodotto sono su DevOps.', re: /\bgit (-C \S+ )?(commit|merge|log|add|worktree|diff|status)\b|'git', \[/ },
];

// "How it works": each step = from → to, a verb, and the sentence of a real file that says it.
// New brains have no owner-specific flow assertions. Add verified flows as procedures grow.
export const FLOWS = [];

const norm = s => String(s ?? '').replace(/\s+/g, ' ');
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const rel = (root, f) => path.relative(root, f).replace(/\\/g, '/');

// The purpose comment at the top of a script (// lines, or # lines for .sh/.ps1), joined into one paragraph.
export function header(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (/^#!/.test(line)) continue;
    const m = line.match(/^\s*(?:\/\/|#)\s?(.*)$/);
    if (!m) { if (out.length || line.trim()) break; continue; }
    out.push(m[1]);
  }
  return out.join('\n').trim();
}

export function frontmatter(text) {
  const m = String(text ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return fm;
}

// map.md table rows: [file, holds, readWhen, writeWhen].
export function mapRows(text) {
  const rows = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!/^\|\s*`/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    const file = cells[0].match(/`([^`]+)`/)?.[1];
    if (file) rows.push({ file, holds: cells[1] ?? '', readWhen: cells[2] ?? '', writeWhen: cells[3] ?? '' });
  }
  return rows;
}

// Last commit date of every path in one git call (newest first, so the first date seen wins).
function gitDates(root) {
  const r = spawnSync('git', ['-C', root, 'log', '--format=@%cI', '--name-only', '-n', '3000'], { encoding: 'utf8', maxBuffer: 1e8 });
  const dates = {};
  let cur = null;
  for (const line of (r.stdout ?? '').split('\n')) {
    if (line.startsWith('@')) cur = line.slice(1);
    else if (line && cur && !dates[line]) dates[line] = cur;
  }
  return dates;
}

const node = (id, layer, kind, label, extra = {}) => ({ id, layer, kind, label, ...extra });

// Speaking names ({{OWNER}} 2026-10-13, "nella mappa 3d i nomi devono essere più parlanti"): every piece is labelled by
// what it is or does, in Italian, in 2-4 words; its technical name (file, agent, /skill) stays in `name` for the
// hover detail and the search. LABELS (brain-map/labels.mjs): one Italian name per piece of today's brain (the files'
// own headers are English sentences, too long for a label); a piece not there gets, in order: a `label:` line in its
// frontmatter, the first heading of its markdown file when it is short, its name made readable (humanize).
// The list is this brain's own (optional: a brain without it, e.g. the product template, gets the derived names).
// BOX_AREAS: the area prefixes of this brain's chat titles ("<Area> · <cosa>"), to name a live chat by its mailbox.
const own = await import('./brain-map/labels.mjs').catch(e => { if (e?.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
export const LABELS = own.LABELS ?? {}, BOX_AREAS = own.BOX_AREAS ?? {};
// "my-tool.mjs" → "My tool", "notes/" → "Notes", "/cmd" → "Cmd"; a live chat's box "app-some-work" → "App · some work".
export function humanize(name) {
  const s = String(name ?? '').replace(/\/+$/, '').split('/').pop().replace(/^\//, '').replace(/\.(mjs|js|sh|ps1|md|jsonl?)$/, '')
    .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : String(name ?? '');
}
export function boxLabel(box, areas = BOX_AREAS) {
  const [area, ...rest] = String(box ?? '').split('-');
  return areas[area] && rest.length ? `${areas[area]} · ${rest.join(' ')}` : humanize(box);
}
// The first `# heading` of a markdown text, its part before ":" or "(", when it is a short name (≤ 4 words).
export function headingLabel(text) {
  const h = String(text ?? '').match(/^#\s+(.+)$/m)?.[1];
  const head = h?.split(/:|\s\(|\s[-–]\s/)[0].replace(/[`*]/g, '').trim();
  return head && head.split(/\s+/).length <= 4 && head.length <= 32 ? head : null;
}
// The speaking label of one piece (n = the node as collected, its `label` still the technical name).
export function labelFor(n, text = null) {
  const file = n.id.replace(/^(rule|mem):/, '');
  const known = LABELS[n.id] ?? (/^(rule|mem):/.test(n.id) ? LABELS[file] : undefined);
  if (known) return known;
  if (n.id.startsWith('playbook:')) return `Taccuino: ${LABELS[`agent:${n.id.slice(9)}`] ?? humanize(n.id.slice(9))}`;
  if (n.id.startsWith('chat:box:')) return boxLabel(n.label);
  if (!/^(agent|skill|tool|hook|rule|mem):/.test(n.id)) return n.label; // people, chats, harnesses, services: already named
  const fm = text ? frontmatter(text) : {};
  if (fm.label) return fm.label;
  if (/\.md$/i.test(n.file ?? '') && n.kind !== 'cartella') { const h = headingLabel(text?.replace(/^---[\s\S]*?\r?\n---/, '')); if (h) return h; }
  if (n.id.startsWith('skill:')) return n.label; // "/stato": the command is its name
  return humanize(n.label.replace(/^(stile|taccuino) /, '$1-'));
}
// Two pieces with the same speaking label get their technical name after it, so every label reads apart.
export function uniqueLabels(nodes) {
  const count = {};
  for (const n of nodes) count[n.label.toLowerCase()] = (count[n.label.toLowerCase()] ?? 0) + 1;
  return nodes.map(n => (count[n.label.toLowerCase()] > 1 && n.name && n.name !== n.label ? { ...n, label: `${n.label} (${n.name})` } : n));
}

export function collect({ root = DEFAULT_ROOT, home = os.homedir(), usage = null, inbox = null, playbooks = null, lint = null, recurrence = null } = {}) {
  const nodes = new Map(), edges = [], warnings = [];
  const dates = gitDates(root);
  // playbook.mjs summary() is a list, inbox.mjs list() names a box "box": one shape here
  if (Array.isArray(playbooks)) playbooks = Object.fromEntries(playbooks.map(p => [p.agent, p]));
  if (inbox) inbox = { ...inbox, boxes: (inbox.boxes ?? []).map(b => ({ ...b, who: b.who ?? b.box })) };
  const add = n => { if (!nodes.has(n.id)) nodes.set(n.id, n); return nodes.get(n.id); };
  const modified = (abs) => {
    const r = rel(root, abs);
    if (!r.startsWith('..') && dates[r]) return dates[r];
    try { return fs.statSync(abs).mtime.toISOString(); } catch { return null; }
  };
  // a product rule a fresh brain does not hold (ADR 0072) is read from the app-owned copy this tool runs from
  const doc = r => { const own = path.join(root, r), app = path.resolve(HERE, '..', '..', r); return !fs.existsSync(own) && fs.existsSync(app) ? app : own; };
  const fileNode = (id, layer, kind, label, abs, extra = {}) => add(node(id, layer, kind, label, {
    file: abs.replace(/\\/g, '/'), modified: modified(abs), ...extra }));

  // People and chats
  add(node('owner', 'persone', 'persona', 'Owner', { what: 'Il proprietario del cervello: lavora con le chat, decide, lancia lui i comandi di produzione.', file: `${root}/me.md`, modified: modified(path.join(root, 'me.md')) }));
  if (fs.existsSync(path.join(root, 'people.md'))) add(node('colleghi', 'persone', 'persona', 'Colleghi e QA', { what: 'Colleghi, soprannomi, ruoli e chi taggare su DevOps (people.md).', file: `${root}/people.md`, modified: modified(path.join(root, 'people.md')) }));
  add(node('chat:regia-claude', 'chat', 'regia', 'Regia (Claude)', { what: 'La chat fissa dove {{OWNER}} scrive: apre le chat di lavoro, segue stato e avanzamento, ti dice quale chat ti aspetta, resta libera.', file: doc('hub.md').replace(/\\/g, '/'), modified: modified(doc('hub.md')) }));
  const cursorRegia = path.join(root, '.cursor', 'skills', 'regia', 'SKILL.md');
  if (fs.existsSync(cursorRegia)) fileNode('chat:regia-cursor', 'chat', 'regia', 'Regia (Cursor)', cursorRegia, { what: 'La stessa Regia dentro Cursor, accesa con /regia; legge le chat Cursor con chats.mjs.' });
  add(node('chat:lavoro', 'chat', 'chat', 'Chat di lavoro', { what: 'Una chat per ogni lavoro (fix, QA, produzione, OS): tiene la sua riga in now.md e parla alle altre con inbox.mjs.', file: doc('hub.md').replace(/\\/g, '/'), modified: modified(doc('hub.md')) }));
  for (const b of inbox?.boxes ?? []) {
    if (/^regia$/.test(b.who)) continue;
    add(node(`chat:box:${b.who}`, 'chat', 'chat-viva', b.who, { what: `Chat con una casella di posta: ${b.listening ? 'in ascolto' : 'non in ascolto'}${b.unread ? `, ${b.unread} da leggere` : ''}.`, live: b }));
    edges.push({ from: 'chat:lavoro', to: `chat:box:${b.who}`, kind: 'istanza', label: 'una delle chat di lavoro' });
  }
  for (const [pair, s] of Object.entries(inbox?.stats ?? {})) {
    const [a, b] = pair.split(' -> ');
    const id = w => (/^regia$/.test(w) ? 'chat:regia-claude' : `chat:box:${w}`);
    for (const w of [a, b]) if (!nodes.has(id(w))) add(node(id(w), 'chat', 'chat-viva', w, { what: 'Chat che ha usato la posta tra chat.' }));
    edges.push({ from: id(a), to: id(b), kind: 'posta', label: `${s.sent} messaggi`, weight: s.sent, source: { file: 'ops/state/inbox/inbox.log', text: `${pair}: ${s.sent} inviati, ${s.delivered} consegnati` } });
  }

  // Harnesses
  const claudeSettings = path.join(home, '.claude', 'settings.json');
  add(node('harness:claude', 'esterni', 'harness', 'Claude Code', { what: 'Il programma delle chat Claude (app desktop): esegue gli hook configurati.', ...(fs.existsSync(claudeSettings) ? { file: claudeSettings.replace(/\\/g, '/') } : {}) }));
  add(node('harness:cursor', 'esterni', 'harness', 'Cursor', { what: 'Il secondo programma: stesse regole, adattate da harness/cursor e harness/tools.md.', file: doc('harness/tools.md').replace(/\\/g, '/') }));

  // Agents, notebooks, skills
  const agentsDir = path.join(root, '.claude', 'agents');
  for (const f of (fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir) : []).filter(f => f.endsWith('.md')).sort()) {
    const abs = path.join(agentsDir, f), text = read(abs) ?? '', fm = frontmatter(text);
    const name = fm.name || f.replace(/\.md$/, '');
    const n = fileNode(`agent:${name}`, 'agenti', 'agente', name, abs, { what: fm.description ?? '', fields: Object.fromEntries(Object.entries(fm).filter(([k]) => k !== 'description' && k !== 'name')), text });
    const nb = text.split(/\r?\n/).findIndex(l => /^Notebook:/.test(l) || /playbooks\/[\w-]+\.md/.test(l));
    const pb = path.join(root, 'playbooks', `${name}.md`);
    if (fs.existsSync(pb)) {
      const s = playbooks?.[name];
      fileNode(`playbook:${name}`, 'agenti', 'taccuino', `taccuino ${name}`, pb, { what: `Taccuino di ${name}: punti imparati, letti solo da lui all'avvio.`, playbook: s ?? null });
      edges.push({ from: n.id, to: `playbook:${name}`, kind: 'legge', label: 'legge all\'avvio', source: nb >= 0 ? { file: rel(root, abs), line: nb + 1, text: text.split(/\r?\n/)[nb].slice(0, 200) } : null });
    }
  }
  const skillsDir = path.join(home, '.claude', 'skills');
  for (const s of (fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir) : []).sort()) {
    const abs = path.join(skillsDir, s, 'SKILL.md');
    const text = read(abs); if (text == null) continue;
    const fm = frontmatter(text);
    fileNode(`skill:${s}`, 'agenti', 'skill', `/${fm.name || s}`, abs, { what: fm.description ?? '', text });
  }

  // Tools and hooks
  const toolsDir = path.join(root, 'ops', 'tools');
  for (const f of (fs.existsSync(toolsDir) ? fs.readdirSync(toolsDir) : []).filter(f => /\.(mjs|sh|ps1)$/.test(f) && !/\.test\.mjs$/.test(f)).sort()) {
    const abs = path.join(toolsDir, f), text = read(abs) ?? '';
    fileNode(`tool:${f.replace(/\.(mjs|sh|ps1)$/, '')}`, 'tool', 'tool', f, abs, { what: header(text), text });
  }
  const opsScript = path.join(root, 'ops.sh');
  if (fs.existsSync(opsScript)) fileNode('tool:ops', 'tool', 'tool', 'script ops', opsScript, { what: header(read(opsScript)) || 'Lo script di produzione: lo lancia solo {{OWNER}}.', text: read(opsScript) });
  for (const [dir, prefix, kind] of [['.claude/hooks', 'hook:brain', 'hook'], ['harness/cursor', 'hook:cursor', 'adattatore Cursor']]) {
    const d = path.join(root, dir);
    for (const f of (fs.existsSync(d) ? fs.readdirSync(d) : []).filter(f => f.endsWith('.mjs') && f !== 'test.mjs').sort()) {
      const abs = path.join(d, f), text = read(abs) ?? '';
      fileNode(`${prefix}:${f.replace(/\.mjs$/, '')}`, 'tool', kind, f, abs, { what: header(text), text, events: [] });
    }
  }
  const compareDir = path.join(root, 'harness', 'compare');
  if (fs.existsSync(path.join(compareDir, 'README.md'))) fileNode('tool:compare', 'tool', 'tool', 'confronto A/B', path.join(compareDir, 'README.md'), { what: 'Esperimenti tra Cursor e Claude sullo stesso lavoro: cattura, giudice cieco, report (harness/compare).', text: read(path.join(compareDir, 'README.md')) });

  // Hook wiring: which harness event runs which script.
  const wire = (harness, event, cmd, where) => {
    const m = String(cmd).match(/([\w-]+)\.mjs(?:\s+hook\s+(\w+))?/);
    if (!m) return;
    let id = [...nodes.keys()].find(k => /^hook:(brain|cursor):/.test(k) && k.endsWith(`:${m[1]}`))
      ?? (/harness[\\/]compare[\\/]/.test(cmd) ? 'tool:compare' : `tool:${m[1]}`);
    if (m[2]) { // a tool run as a hook (inbox.mjs hook claude): its own node, so the tool keeps its meaning
      const hid = `hook:${harness === 'harness:claude' ? 'claude' : 'cursor'}:${m[1]}-stop`;
      if (!nodes.has(hid)) add(node(hid, 'tool', 'hook', `${m[1]}.mjs hook ${m[2]}`, { what: `Il tool ${m[1]}.mjs lanciato come hook: ${event}.`, file: nodes.get(`tool:${m[1]}`)?.file, events: [] }));
      edges.push({ from: hid, to: `tool:${m[1]}`, kind: 'usa', label: 'usa' });
      id = hid;
    }
    const n = nodes.get(id); if (!n) { warnings.push(`hook senza script: ${cmd}`); return; }
    (n.events ??= []).push(`${event} (${harness === 'harness:claude' ? 'Claude' : 'Cursor'})`);
    edges.push({ from: harness, to: id, kind: 'hook', label: event, source: { file: where, text: cmd } });
  };
  // Aliases used by FLOWS for hooks wired at user level.
  const hookAlias = { 'hook:claude:compact-now': 'hook:brain:compact-now', 'hook:claude:chat-feed': 'hook:brain:chat-feed', 'hook:claude:correction-catch': 'hook:brain:correction-catch', 'hook:claude:inbox-stop': 'hook:claude:inbox-stop' };
  for (const [file, label] of [[path.join(home, '.claude', 'settings.json'), '~/.claude/settings.json'], [path.join(root, '.claude', 'settings.json'), '.claude/settings.json']]) {
    let s; try { s = JSON.parse(read(file) ?? 'null'); } catch { warnings.push(`${label} non leggibile`); }
    for (const [event, groups] of Object.entries(s?.hooks ?? {})) for (const g of groups) for (const h of g.hooks ?? [])
      wire('harness:claude', g.matcher ? `${event} ${g.matcher}` : event, h.command, label);
  }
  let ch; try { ch = JSON.parse(read(path.join(root, 'harness', 'cursor', 'hooks.json')) ?? 'null'); } catch { warnings.push('harness/cursor/hooks.json non leggibile'); }
  for (const [event, list] of Object.entries(ch?.hooks ?? {})) for (const h of list) wire('harness:cursor', event, h.command, 'harness/cursor/hooks.json');

  // Memory and rules from map.md, output styles and the fixed context.
  for (const r of mapRows(read(path.join(root, 'map.md')))) {
    const abs = path.join(root, r.file);
    const isDir = r.file.endsWith('/');
    const layer = RULE_FILES.has(r.file) ? 'regole' : 'memoria';
    const extra = { what: r.holds.replace(/`/g, ''), readWhen: r.readWhen.replace(/`/g, ''), writeWhen: r.writeWhen.replace(/`/g, ''), exists: fs.existsSync(abs) };
    if (isDir && extra.exists) extra.children = fs.readdirSync(abs).filter(f => !f.startsWith('.')).sort().reverse().slice(0, 60).map(f => ({ name: f, modified: modified(path.join(abs, f)) }));
    if (!extra.exists) warnings.push(`map.md nomina ${r.file}, che non esiste`);
    fileNode(`${layer === 'regole' ? 'rule' : 'mem'}:${r.file}`, layer, isDir ? 'cartella' : 'file', r.file, abs, extra);
  }
  const stylesDir = path.join(home, '.claude', 'output-styles');
  for (const f of (fs.existsSync(stylesDir) ? fs.readdirSync(stylesDir) : []).filter(f => f.endsWith('.md')).sort()) {
    const abs = path.join(stylesDir, f), fm = frontmatter(read(abs));
    fileNode(`rule:style:${f}`, 'regole', 'stile', `stile ${f.replace(/\.md$/, '')}`, abs, { what: fm.description || 'Stile di risposta delle chat.' });
  }
  for (const fx of lint?.fixed ?? []) {
    const id = fx.file.startsWith('{{BRAIN_NAME}}/') ? `rule:${fx.file.slice(9)}` : fx.file.includes('output-styles/') ? `rule:style:${path.basename(fx.file)}` : null;
    if (id && nodes.has(id)) {
      nodes.get(id).fixedChars = fx.chars;
      edges.push({ from: 'harness:claude', to: id, kind: 'contesto', label: 'caricato in ogni chat', source: { file: 'ops/tools/brain-lint.mjs --json', text: `${fx.file}: ${fx.chars} caratteri (${fx.why})` } });
    }
  }

  // Externals: one node each, an edge from every tool/hook/agent/skill whose own text names the service.
  for (const x of EXTERNALS) add(node(x.id, 'esterni', 'servizio', x.label, { what: x.what }));
  const textual = [...nodes.values()].filter(n => n.text);
  for (const n of textual) {
    const lines = n.text.split(/\r?\n/);
    for (const x of EXTERNALS) {
      const i = lines.findIndex(l => x.re.test(l));
      if (i >= 0) edges.push({ from: n.id, to: x.id, kind: 'esterno', label: 'parla con', source: { file: rel(root, n.file), line: i + 1, text: lines[i].trim().slice(0, 200) } });
    }
  }

  // Uses: a tool/hook/agent/skill whose text names a memory/rule file or another tool.
  const targets = [...nodes.values()].filter(n => (n.layer === 'memoria' || n.layer === 'regole') && n.kind !== 'stile')
    .map(n => ({ id: n.id, key: n.label.replace(/\/$/, ''), re: new RegExp(`(^|[^\\w./-])${n.label.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|/|$)`) }))
    .concat([...nodes.values()].filter(n => n.kind === 'tool' && n.id.startsWith('tool:') && n.label.includes('.'))
      .map(n => ({ id: n.id, key: n.label, re: new RegExp(`\\b${n.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) })));
  for (const n of textual) {
    const lines = n.text.split(/\r?\n/);
    for (const t of targets) {
      if (t.id === n.id) continue;
      const i = lines.findIndex(l => t.re.test(l));
      if (i >= 0) edges.push({ from: n.id, to: t.id, kind: n.kind === 'agente' || n.kind === 'skill' ? 'cita' : 'usa', label: n.kind === 'agente' || n.kind === 'skill' ? 'cita' : 'nomina nel codice', source: { file: rel(root, n.file), line: i + 1, text: lines[i].trim().slice(0, 200) } });
    }
  }

  // Flows, verified against the cited sentence.
  const flows = FLOWS.map(f => ({ id: f.id, title: f.title, steps: f.steps.map(([from, to, label, file, quote]) => {
    from = hookAlias[from] && nodes.has(hookAlias[from]) ? hookAlias[from] : from;
    to = hookAlias[to] && nodes.has(hookAlias[to]) ? hookAlias[to] : to;
    const verified = norm(read(path.join(root, file))).includes(norm(quote));
    const ok = nodes.has(from) && nodes.has(to);
    if (!verified) warnings.push(`flusso "${f.title}": la frase "${quote}" non è più in ${file}`);
    if (!ok) warnings.push(`flusso "${f.title}": pezzo mancante ${nodes.has(from) ? to : from}`);
    return { from, to, label, verified: verified && ok, source: { file, text: quote } };
  }) }));
  for (const f of flows) for (const s of f.steps) if (nodes.has(s.from) && nodes.has(s.to))
    edges.push({ from: s.from, to: s.to, kind: 'flusso', label: s.label, flow: f.id, verified: s.verified, source: s.source });

  // Use in the last N days (brain-usage.mjs).
  if (usage) {
    const byKey = { skills: 'skill:', agents: 'agent:', tools: 'tool:' };
    for (const [k, prefix] of Object.entries(byKey)) for (const [name, n] of usage[k] ?? []) {
      const nd = nodes.get(`${prefix}${name}`); if (nd) nd.uses = n;
    }
    for (const [file, n] of usage.files ?? []) { const nd = nodes.get(`mem:${file}`) ?? nodes.get(`rule:${file}`); if (nd) nd.reads = n; }
  }

  // Weak points: only computed, never written by hand.
  const weak = [];
  if (usage) for (const [k, what] of [['skills', 'skill'], ['agents', 'agente'], ['tools', 'script']]) {
    const zero = (usage[k] ?? []).filter(([, n]) => !n).map(([s]) => s);
    if (zero.length) weak.push({ kind: 'mai usati', text: `${what} mai usati in ${usage.days} giorni: ${zero.join(', ')}`, ids: zero.map(z => `${{ skills: 'skill:', agents: 'agent:', tools: 'tool:' }[k]}${z}`) });
  }
  if (lint) {
    if (lint.fixedTotal > 15000) weak.push({ kind: 'contesto fisso', text: `Il contesto fisso è ${lint.fixedTotal.toLocaleString('it-IT')} caratteri, oltre il tetto di 15.000: ogni chat lo rilegge a ogni chiamata.`, ids: (lint.fixed ?? []).map(f => f.file.startsWith('{{BRAIN_NAME}}/') ? `rule:${f.file.slice(9)}` : `rule:style:${path.basename(f.file)}`) });
    for (const o of lint.overBudget ?? []) weak.push({ kind: 'file troppo lungo', text: `${o.file}: ${o.lines} righe (tetto ${o.max})`, ids: [`mem:${o.file}`, `rule:${o.file}`] });
    if (lint.now?.stale?.length) weak.push({ kind: 'fili vecchi', text: `now.md: ${lint.now.stale.length} righe non aggiornate da giorni, ${lint.now.long?.length ?? 0} righe oltre 250 caratteri`, ids: ['mem:now.md'] });
    if (lint.duplicates?.length) weak.push({ kind: 'doppioni', text: `${lint.duplicates.length} frasi quasi uguali in due posti (le regole doppie si separano col tempo)`, ids: [] });
  }
  for (const r of recurrence?.rules ?? []) if (r.again > 0)
    weak.push({ kind: 'errore tornato', text: `${r.date} · ${r.area} · regola ${r.rule.slice(0, 90)}: l'errore (${r.type}) è tornato ${r.again} volte`, ids: ['mem:ai-errors.md'] });
  for (const [agent, s] of Object.entries(playbooks ?? {})) if (s.review?.length) weak.push({ kind: 'taccuino', text: `Taccuino di ${agent}: punti con più voti "dannoso" che "utile": ${s.review.join(', ')}`, ids: [`playbook:${agent}`] });
  for (const b of inbox?.boxes ?? []) if (b.unread && !b.listening) weak.push({ kind: 'posta ferma', text: `${b.who}: ${b.unread} messaggi non letti e la chat non è in ascolto`, ids: [`chat:box:${b.who}`] });
  for (const w of warnings) weak.push({ kind: 'mappa', text: w, ids: [] });

  // Degree for sizing; drop the bulky source text from the output.
  const deg = {};
  const uniq = new Map();
  for (const e of edges) { const k = `${e.from}|${e.to}|${e.kind}`; if (!uniq.has(k) && nodes.has(e.from) && nodes.has(e.to)) uniq.set(k, e); }
  for (const e of uniq.values()) { deg[e.from] = (deg[e.from] ?? 0) + 1; deg[e.to] = (deg[e.to] ?? 0) + 1; }
  // Speaking labels last: the arrows above find the pieces by their technical name (now `name`).
  const out = uniqueLabels([...nodes.values()].map(({ text, ...n }) => {
    const body = text ?? (n.file && /\.md$/i.test(n.file) && n.kind !== 'cartella' ? read(n.file) : null);
    return { ...n, name: n.label, label: labelFor(n, body), file: n.file ? n.file.replace(/\\/g, '/') : undefined, degree: deg[n.id] ?? 0 };
  }));
  return { generated: new Date().toISOString(), root, layers: LAYERS, nodes: out, edges: [...uniq.values()], flows, weak, warnings };
}

// The simple view ({{OWNER}} 2026-10-10: "troppi pallini... rappresentare le cose più importanti... deve essere più
// piacevole"): only the main pieces, the rest folded into one group per kind, each with a short sentence instead of a
// file name. Key tools and memory files are the ones the FLOWS go through (no hand list); notebooks fold into their
// agent, live chats into "Chat di lavoro", hooks into one node per harness, every rule file into "Regole".
// SHORT: one Italian line per main piece for the label; a piece not here gets the first sentence of its own header.
export const SHORT = {
  owner: 'decide e lancia lui la produzione', colleghi: 'QA e colleghi, chi taggare',
  'chat:regia-claude': 'dove scrivi: apre le chat, ti dice come procedono', 'chat:regia-cursor': 'la stessa Regia dentro Cursor',
  'chat:lavoro': 'una chat per ogni lavoro', 'harness:claude': 'le chat Claude e i loro hook', 'harness:cursor': 'le chat Cursor, stesse regole',
  'agent:reviewer': 'controlla un diff prima del merge', 'agent:code-investigator': 'trova la causa di un bug nel codice',
  'agent:prod-log-reader': 'legge log e stato di produzione', 'agent:qa': 'prova i test case del prodotto nel browser',
  'agent:devops-writer': 'scrive bug e commenti DevOps', 'agent:brain-editor': 'cambia le regole quando lo chiedi',
  'agent:flow-optimizer': 'trova dove il flusso perde tempo',
  'tool:mem': 'scrive now, diario ed errori', 'tool:inbox': 'posta tra le chat', 'tool:chat-prompt': 'scrive il prompt di una chat nuova',
  'tool:playbook': 'scrive i taccuini degli specialisti', 'tool:day': 'brief e report della giornata', 'tool:cost': 'quanto costa e dove risparmiare',
  'tool:brain-usage': 'cosa si usa davvero', 'tool:recurrence': "l'errore è tornato dopo la regola?", 'tool:ro-query': 'query di sola lettura in produzione',
  'tool:wt-land': 'porta un worktree in main', 'tool:brain-lint': 'salute del cervello, contesto fisso',
  'mem:now.md': 'i fili aperti, dove sei', 'mem:journal/': 'il diario di ogni giorno', 'mem:ai-errors.md': "ogni errore dell'IA",
  'mem:ai-wins.md': 'le tue lodi, scritte dagli hook', 'mem:proposals.md': 'ogni proposta e il suo esito', 'mem:tests/behavior.md': 'un test per ogni correzione',
  'mem:playbooks/': 'i taccuini degli specialisti', 'ext:devops': 'work item, PR, build', 'ext:azure': 'le risorse del prodotto',
  'ext:appinsights': 'log e metriche', 'ext:proddb': 'DB dei clienti, solo lettura', 'ext:mail': 'posta e chat aziendali',
  'ext:transcripts': 'le conversazioni, per costi e uso', 'ext:git': 'la storia dei file',
  'grp:skill': 'comandi pronti: /stato, /urgente…', 'grp:tool': 'gli altri script di ops/tools', 'grp:hook-claude': 'scattano da soli nelle chat Claude',
  'grp:hook-cursor': 'adattatori e hook di Cursor', 'grp:regole': 'come devono lavorare gli agenti', 'grp:memoria': 'runbook, idee, review, misure…',
};
const firstSentence = s => String(s ?? '').replace(/\s+/g, ' ').split(/(?<=[.:;])\s/)[0].slice(0, 70);
export function simplify(map) {
  const flowIds = new Set(map.flows.flatMap(f => f.steps.flatMap(s => [s.from, s.to])));
  const groups = {
    'grp:skill': { layer: 'agenti', label: 'Skill' }, 'grp:tool': { layer: 'tool', label: 'Altri script' },
    'grp:hook-claude': { layer: 'tool', label: 'Hook Claude' }, 'grp:hook-cursor': { layer: 'tool', label: 'Hook Cursor' },
    'grp:regole': { layer: 'regole', label: 'Regole' }, 'grp:memoria': { layer: 'memoria', label: 'Altra memoria' },
  };
  const to = n => {
    if (n.id.startsWith('playbook:')) return `agent:${n.id.slice(9)}`;
    if (n.id.startsWith('chat:box:')) return 'chat:lavoro';
    if (n.id.startsWith('skill:')) return 'grp:skill';
    if (/^hook:(brain|claude):/.test(n.id)) return 'grp:hook-claude';
    if (n.id.startsWith('hook:cursor:')) return 'grp:hook-cursor';
    if (n.layer === 'regole') return 'grp:regole';
    if (n.id.startsWith('tool:') && !flowIds.has(n.id)) return 'grp:tool';
    if (n.id.startsWith('mem:') && !flowIds.has(n.id)) return 'grp:memoria';
    return n.id;
  };
  const byId = new Map(map.nodes.map(n => [n.id, n]));
  const out = new Map();
  for (const n of map.nodes) {
    const g = to(n);
    if (!out.has(g)) {
      const base = groups[g] ? { id: g, kind: 'gruppo', ...groups[g], members: [] } : { ...(byId.get(g) ?? n), members: [] };
      out.set(g, base);
    }
    if (g !== n.id) out.get(g).members.push({ id: n.id, label: n.label, name: n.name, what: n.what ? firstSentence(n.what) : '', file: n.file, modified: n.modified, uses: n.uses ?? n.reads });
  }
  for (const n of out.values()) {
    n.short = SHORT[n.id] ?? firstSentence(n.what);
    if (n.kind === 'gruppo') {
      n.label = `${n.label} (${n.members.length})`;
      n.what = `${n.short}. Clic per l'elenco.`;
      n.modified = n.members.map(m => m.modified).filter(Boolean).sort().pop() ?? null;
    }
  }
  const edges = new Map();
  for (const e of map.edges) {
    const f = to(byId.get(e.from) ?? { id: e.from }), t = to(byId.get(e.to) ?? { id: e.to });
    if (f === t) continue;
    const k = `${f}|${t}|${e.kind}`;
    const cur = edges.get(k);
    if (cur) { cur.count++; continue; }
    edges.set(k, { ...e, from: f, to: t, count: 1 });
  }
  const flows = map.flows.map(fl => ({ ...fl, steps: fl.steps.map(s => ({ ...s, from: to(byId.get(s.from) ?? { id: s.from }), to: to(byId.get(s.to) ?? { id: s.to }), fromLabel: byId.get(s.from)?.label, toLabel: byId.get(s.to)?.label })) }));
  const deg = {};
  for (const e of edges.values()) { deg[e.from] = (deg[e.from] ?? 0) + 1; deg[e.to] = (deg[e.to] ?? 0) + 1; }
  return { nodes: [...out.values()].map(n => ({ ...n, degree: deg[n.id] ?? 0 })), edges: [...edges.values()], flows };
}

// The map's own proof: every piece with a file points to a file that exists, every arrow whose proof is a file line
// finds that text again in that file (at that line when given). Returns the problems, [] = the map matches the brain.
export function check(map, { root = map.root, home = os.homedir() } = {}) {
  const problems = [];
  const resolve = f => (path.isAbsolute(f) ? f : path.join(root, f));
  for (const n of map.nodes) if (n.file && !fs.existsSync(n.file.replace(/^~/, home))) problems.push(`pezzo ${n.id}: il file ${n.file} non esiste`);
  for (const e of map.edges) {
    const s = e.source;
    if (!s?.file || /\s--json$|^ops\/state\//.test(s.file) || /settings\.json$|hooks\.json$/.test(s.file)) continue; // tool output or settings: checked by their own reader
    const text = read(resolve(s.file));
    if (text == null) { problems.push(`freccia ${e.from} → ${e.to}: il file ${s.file} non esiste`); continue; }
    const hay = s.line ? text.split(/\r?\n/)[s.line - 1] ?? '' : text;
    const needle = norm(s.text.replace(/…$/, '')).trim().slice(0, 120);
    if (!norm(hay).includes(needle)) problems.push(`freccia ${e.from} → ${e.to}: "${needle.slice(0, 60)}" non è ${s.line ? `alla riga ${s.line} di` : 'in'} ${s.file}`);
  }
  return problems;
}

// Helpers that run the other tools (their own output, unchanged).
function runJson(script, args, root) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1e8, timeout: 120000 });
  try { return JSON.parse(r.stdout); } catch { return null; }
}
export async function gather(root = DEFAULT_ROOT, { usage = true } = {}) {
  const imp = async f => import(pathToFileURL(path.join(HERE, f)).href);
  let inbox = null, playbooks = null, recurrence = null;
  try { const m = await imp('inbox.mjs'); const P = m.paths(root); inbox = { boxes: m.list(P), stats: m.stats(P) }; } catch { /* no inbox yet */ }
  try { const m = await imp('playbook.mjs'); playbooks = m.summary(root); } catch { /* no notebooks yet */ }
  try { const m = await imp('recurrence.mjs'); const rows = m.parse(read(path.join(root, 'ai-errors.md')) ?? ''); recurrence = m.recurrence(rows); } catch { /* no errors file */ }
  const lint = runJson('brain-lint.mjs', ['--json', '--root', root], root);
  const use = usage ? runJson('brain-usage.mjs', ['--json', '--days', '30'], root) : null;
  return { inbox, playbooks, recurrence, lint, usage: use };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const root = arg('--root') ?? DEFAULT_ROOT;
  const g = await gather(root, { usage: !argv.includes('--no-usage') });
  const map = collect({ root, home: arg('--home') ?? os.homedir(), ...g });
  if (argv.includes('--json')) console.log(JSON.stringify({ ...map, problems: check(map), simple: simplify(map) }));
  else {
    const by = {}; for (const n of map.nodes) by[n.layer] = (by[n.layer] ?? 0) + 1;
    console.log(`# Mappa del cervello: ${map.nodes.length} pezzi, ${map.edges.length} frecce, ${map.flows.length} flussi`);
    console.log(map.layers.map(l => `${l.label} ${by[l.id] ?? 0}`).join(' · '));
    const bad = map.flows.flatMap(f => f.steps.filter(s => !s.verified));
    console.log(`Flussi: ${map.flows.reduce((a, f) => a + f.steps.length, 0)} passi, ${bad.length} da verificare`);
    const problems = check(map);
    console.log(problems.length ? `Verifica: ${problems.length} problemi\n${problems.map(p => `  ! ${p}`).join('\n')}` : `Verifica: ogni pezzo ha il suo file e ogni freccia ritrova la sua prova`);
    for (const w of map.weak) console.log(`- [${w.kind}] ${w.text}`);
  }
}
