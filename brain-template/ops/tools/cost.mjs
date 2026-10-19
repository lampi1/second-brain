// cost: what the brain costs and where to save (routines.md "Revisione" 2b, P-094; {{OWNER}} 2026-10-10, "mi sappia anche
// suggerire dove posso risparmiare"). READ-ONLY on transcripts.
// Claude: every API response in ~/.claude/projects/**/*.jsonl (subagents counted under their parent chat), priced from
// its `usage` at its model's real list price (prices.mjs, the one table harness/models.json; 2026-10-13: the old
// weights, Sonnet ×0.7, Haiku ×0.2, one cache-read ratio for all, were stale). Most of the cost is re-reading the
// context at every call: cost ≈ calls × chat length.
// Cursor: totals from its usage export CSV (Cursor dashboard → Usage → Export CSV, newest in ~/Downloads); the CSV has
// no chat id, so Cursor is split only by day and model.
// Usage: node "{{BRAIN}}/ops/tools/cost.mjs" [--since AAAA-MM-GG | --days 7] [--until AAAA-MM-GG]
//          [--top 8] [--cursor <csv> | --no-cursor] [--json]      (--root: tests only)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { priceUsage, cacheReadPerToken, registry } from './prices.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LONG = 400_000, TARGET = 200_000; // a call over LONG tokens of context is "long"; saving = what is over TARGET
const romeDay = t => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

/** $ of one API response at its model's list price. */
export const usdOf = (u, model = '') => priceUsage(u, model).usd;
const ctxOf = u => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

// Kind of work of one tool call (what a script or a habit could replace).
export function kind(name, input = {}) {
  const cmd = String(input.command ?? '').replace(/^cd [^;&]+[;&]+\s*/, '');
  const fp = String(input.file_path ?? '').replace(/\\/g, '/');
  if (/(^|\/)(now\.md|ai-errors\.md)$|\/journal\/\d{4}-/.test(fp) || /mem\.mjs|now\.md|ai-errors\.md|journal\/\d{4}-/.test(cmd)) return 'memoria (now, errori, diario)';
  if (/spawn_task/.test(name)) return 'aprire chat';
  if (/ccd_sidebar|set_session_title|archive_session|list_sessions/.test(name)) return 'barra delle chat';
  if (/list_events|ListAgents|session_mgmt__send_message|search_session|SendMessage/.test(name)) return 'coordinare chat';
  if (name === 'AskUserQuestion') return 'pannelli';
  if (/Browser|computer|browser_batch|javascript_tool|navigate|form_input|read_page|get_page_text|tabs_|find$/.test(name)) return 'browser';
  if (/devops/.test(name) || /az (pipelines|repos|boards)|devops-me|my-tasks|wait-devops|ado-qa/.test(cmd)) return 'DevOps';
  if (/sqlcmd|ro-query/.test(cmd)) return 'SQL';
  if (/{{BRAIN_NAME}}/.test(String(input.command ?? '')) && /git (-C \S+ )?(merge|cherry-pick)|checkout --(ours|theirs)/.test(cmd)) return 'worktree → main';
  if (/dotnet |npm |npx |test\.mjs|playwright/.test(cmd)) return 'build e test';
  if (/^(az |curl )|kudu|appi-query|app-health|azure-status/.test(cmd)) return 'Azure e log';
  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') return 'scrivere file';
  if (/^(Read|Grep|Glob)$/.test(name) || /^(git (show|log|diff|grep|status|blame)|grep|rg|sed -n|cat|head|tail|ls|find|wc)\b/.test(cmd)) return 'leggere';
  if (name === 'Agent' || name === 'Task') return 'lanciare sotto-agenti';
  if (/Web(Fetch|Search)/.test(name)) return 'web';
  if (name === 'Bash' || name === 'PowerShell') return 'altri comandi';
  return 'altri tool';
}

// One record per API response. Sessions: <projects>/<dir>/<id>.jsonl; subagents: <projects>/<dir>/<id>/subagents/*.jsonl.
export function scan(root, fromMs, toMs) {
  const msgs = new Map(), chats = new Map();
  const files = [];
  const walk = (dir, chat) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(e.name) ? e.name : chat);
      else if (e.name.endsWith('.jsonl')) files.push([p, chat ?? e.name.slice(0, -6), !chat]);
    }
  };
  walk(root);
  for (const [file, chat, main] of files) {
    if (fs.statSync(file).mtimeMs < fromMs) continue;
    const c = chats.get(chat) ?? { id: chat, title: '', folder: '', first: '' };
    chats.set(chat, c);
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (main && j.type === 'custom-title') c.title = j.customTitle;
      if (main && !c.folder && j.cwd) c.folder = j.cwd;
      if (main && !c.first && j.type === 'user' && typeof j.message?.content === 'string') c.first = j.message.content.replace(/\s+/g, ' ').slice(0, 50);
      if (j.type !== 'assistant' || !j.message) continue;
      const t = Date.parse(j.timestamp);
      if (!(t >= fromMs && t < toMs)) continue;
      const id = j.message.id ?? `${file}:${j.uuid}`;
      let m = msgs.get(id);
      if (!m) msgs.set(id, m = { chat, day: romeDay(t), t, model: j.message.model ?? '', usage: null, kinds: [], tools: new Set() });
      // the lines of one response may carry partial usage: keep the one with the most output
      const nu = j.message.usage;
      if (nu && (!m.usage || (nu.output_tokens ?? 0) > (m.usage.output_tokens ?? 0))) m.usage = nu;
      // Claude Code sometimes rewrites the same lines later in the file: each tool call counts once
      for (const x of j.message.content ?? []) if (x.type === 'tool_use' && !m.tools.has(x.id ?? x)) { m.tools.add(x.id ?? x); m.kinds.push(kind(x.name, x.input)); }
    }
  }
  return { msgs: [...msgs.values()].filter(m => m.usage), chats };
}

const add = (o, k, usd, calls = 0) => { const r = (o[k] ??= { usd: 0, calls: 0 }); r.usd += usd; r.calls += calls; };
const area = title => (title.match(/^(A|B|Prod|OS|Pers|Regia)\b/)?.[1]) ?? (title ? 'altro' : 'senza titolo');

export function summarize({ msgs, chats }, cursorRows = [], fixedChars = 0) {
  const S = { total: 0, calls: 0, responses: msgs.length, byDay: {}, byModel: {}, byKind: {}, byArea: {}, chats: {}, long: 0, longSave: 0,
    unpriced: [], cursor: { total: 0, byDay: {}, byModel: {} } };
  const unpriced = new Set();
  for (const m of msgs) {
    const { usd, priced } = priceUsage(m.usage, m.model), ctx = ctxOf(m.usage);
    if (!priced && m.model && m.model !== '<synthetic>') unpriced.add(m.model);
    const c = chats.get(m.chat) ?? { title: '' };
    S.total += usd; S.calls += m.kinds.length;
    add(S.byDay, m.day, usd, m.kinds.length);
    add(S.byModel, m.model.replace(/^claude-/, '') || '?', usd, m.kinds.length);
    add(S.byArea, area(c.title), usd, m.kinds.length);
    const ks = m.kinds.length ? m.kinds : ['testo e ragionamento'];
    for (const k of ks) add(S.byKind, k, usd / ks.length, m.kinds.length ? 1 : 0);
    const ch = (S.chats[m.chat] ??= { title: c.title || c.first || m.chat.slice(0, 8), folder: c.folder ?? '', usd: 0, calls: 0, ctxMax: 0, from: m.t, to: m.t, longSave: 0 });
    ch.usd += usd; ch.calls += m.kinds.length; ch.ctxMax = Math.max(ch.ctxMax, ctx); ch.from = Math.min(ch.from, m.t); ch.to = Math.max(ch.to, m.t);
    if (ctx > LONG) {
      const save = (ctx - TARGET) * cacheReadPerToken(m.model); // what re-reading the part over TARGET cost
      S.long += usd; S.longSave += save; ch.longSave += save;
    }
  }
  S.unpriced = [...unpriced].sort();
  S.fixed = { chars: fixedChars, usd: (fixedChars / 4) * cacheReadPerToken(registry().defaultModel) * msgs.length };
  for (const r of cursorRows) {
    const d = romeDay(r.at);
    S.cursor.total += r.cost; add(S.cursor.byDay, d, r.cost, 1); add(S.cursor.byModel, r.model || '?', r.cost, 1);
  }
  return S;
}

// Where to save, ranked by $ (only what the data shows).
export function advice(S) {
  const out = [];
  const chats = Object.values(S.chats);
  const longChats = chats.filter(c => c.longSave > 0).sort((a, b) => b.longSave - a.longSave);
  if (S.longSave > 0) out.push({ usd: S.longSave, text: `Chat lunghe: ${longChats.length} chat oltre ${LONG / 1000}k token di contesto; ripartire (chat nuova o /clear) a ~${TARGET / 1000}k avrebbe risparmiato ~${f$(S.longSave)}. Le più care: ${longChats.slice(0, 3).map(c => `${c.title} ${f$(c.longSave)}`).join(', ')}` });
  const regia = chats.filter(c => /^(Regia|Orchestrator)/i.test(c.title));
  const regiaUsd = regia.reduce((n, c) => n + c.usd, 0);
  if (regiaUsd > 0.15 * S.total) out.push({ usd: regia.reduce((n, c) => n + c.longSave, 0), text: `Orchestrator: ${pct(regiaUsd, S.total)} della spesa (${f$(regiaUsd)}): l’Orchestrator resta "libero" solo se fa poche chiamate e riparte spesso` });
  const k = S.byKind;
  const mem = k['memoria (now, errori, diario)'];
  if (mem && mem.calls > 50) out.push({ usd: mem.usd / 2, text: `Memoria a mano: ${mem.calls} chiamate, ${f$(mem.usd)}; con un solo comando mem.mjs per riga si dimezzano` });
  const br = k.browser;
  if (br && br.usd > 0.05 * S.total) out.push({ usd: br.usd / 2, text: `Browser: ${br.calls} chiamate, ${f$(br.usd)} (${pct(br.usd, S.total)}); i passi fissi di QA vanno in script (E2E)` });
  if (S.fixed.usd > 0) out.push({ usd: S.fixed.usd / 4, text: `Contesto fisso del cervello: ${(S.fixed.chars / 1000).toFixed(1)}k caratteri, ~${f$(S.fixed.usd)} nel periodo: pesa poco, accorciarlo non è la leva` });
  return out.sort((a, b) => b.usd - a.usd);
}

const f$ = v => `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 0 : 2)} $`;
const pct = (a, b) => `${b ? Math.round((100 * a) / b) : 0}%`;
const fmtK = n => `${Math.round(n / 1000)}k`;
const rows = (o, top = 99) => Object.entries(o).sort((a, b) => b[1].usd - a[1].usd).slice(0, top);

const romeStamp = t => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(t));
export function render(S, { from, to, top = 8, cursorFile }) {
  const L = [];
  const days = Object.keys(S.byDay).length || 1;
  L.push(`# Costi del cervello ${from} → ${to} (Claude${cursorFile ? ' + Cursor' : ''})`, '');
  L.push(`Claude: ${f$(S.total)} a listino API (${f$(S.total / days)} al giorno), ${S.calls} chiamate a tool, ${S.calls ? (S.total / S.calls).toFixed(3) : 0} $ a chiamata.`);
  if (cursorFile) L.push(`Cursor: ${f$(S.cursor.total)} (export ${path.basename(cursorFile)}${S.cursor.downloaded ? `, scaricato il ${romeStamp(S.cursor.downloaded)}, ultima riga del ${S.cursor.lastRow ? romeStamp(S.cursor.lastRow) : '?'}` : ''}; per modello: ${rows(S.cursor.byModel).map(([k, v]) => `${k} ${f$(v.usd)}`).join(', ') || 'nessuna riga nel periodo'}).`);
  if (S.unpriced.length) L.push(`Modelli fuori listino (harness/models.json), contati al prezzo di ${registry().defaultModel}: ${S.unpriced.join(', ')}.`);
  L.push('', '## Dove risparmiare (in ordine di $)');
  advice(S).forEach((a, i) => L.push(`${i + 1}. ${a.text}.`));
  L.push('', '## Per giorno');
  for (const [d, v] of Object.entries(S.byDay).sort()) L.push(`- ${d}: ${f$(v.usd)}, ${v.calls} chiamate${S.cursor.byDay[d] ? ` · Cursor ${f$(S.cursor.byDay[d].usd)}` : ''}`);
  L.push('', `## Chat più care (top ${top})`);
  for (const [, c] of rows(S.chats, top)) L.push(`- ${c.title}: ${f$(c.usd)}, ${c.calls} chiamate, contesto max ${fmtK(c.ctxMax)}, ${Math.round((c.to - c.from) / 6e4)} min`);
  L.push('', '## Per area (titolo della chat)');
  L.push(rows(S.byArea).map(([k, v]) => `${k} ${f$(v.usd)}`).join(' · '));
  L.push('', '## Per tipo di lavoro (costo delle chiamate)');
  for (const [k, v] of rows(S.byKind, 12)) L.push(`- ${k}: ${f$(v.usd)}, ${v.calls} chiamate`);
  L.push('', `Modelli: ${rows(S.byModel).map(([k, v]) => `${k} ${f$(v.usd)}`).join(', ')}.`);
  return L.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const today = romeDay(Date.now());
  const from = arg('--since') ?? romeDay(Date.now() - (Number(arg('--days') ?? 7) - 1) * 864e5);
  const to = arg('--until') ?? today;
  const fromMs = Date.parse(`${from}T00:00:00+02:00`) - 864e5, toMs = Date.parse(`${to}T23:59:59+02:00`) + 864e5; // ±1 day, then exact by Rome day
  const root = arg('--root') ?? path.join(os.homedir(), '.claude', 'projects');
  const scanned = scan(root, fromMs, toMs);
  scanned.msgs = scanned.msgs.filter(m => m.day >= from && m.day <= to);
  let cursorRows = [], cursorFile = null, cursorInfo = null;
  if (!argv.includes('--no-cursor')) {
    const { readUsageCsv, newestExport } = await import('../../harness/compare/cursor-usage.mjs');
    cursorFile = arg('--cursor') ?? newestExport();
    if (cursorFile) {
      const all = readUsageCsv(cursorFile);
      // how fresh the Cursor numbers are: when the CSV was downloaded and its newest row (Cursor costs stop there)
      cursorInfo = { file: path.basename(cursorFile), downloaded: fs.statSync(cursorFile).mtime.toISOString(),
        lastRow: (t => (t ? new Date(t).toISOString() : null))(all.reduce((m, r) => Math.max(m, new Date(r.at).getTime() || 0), 0)) };
      cursorRows = all.filter(r => { const d = romeDay(r.at); return d >= from && d <= to; });
    }
  }
  let fixedChars = 0;
  if (!arg('--root')) { try { fixedChars = JSON.parse(spawnSync(process.execPath, [path.join(HERE, 'brain-lint.mjs'), '--json'], { encoding: 'utf8' }).stdout).fixedTotal ?? 0; } catch {} }
  const S = summarize(scanned, cursorRows, fixedChars);
  if (cursorInfo) Object.assign(S.cursor, cursorInfo);
  if (argv.includes('--json')) console.log(JSON.stringify({ from, to, ...S, advice: advice(S) }, null, 1));
  else console.log(render(S, { from, to, top: Number(arg('--top') ?? 8), cursorFile }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
