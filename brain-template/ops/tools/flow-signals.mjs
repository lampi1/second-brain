// Digest of workflow signals from Claude Code transcripts (~/.claude/projects/*/*.jsonl), for the flow-optimizer agent.
// READ-ONLY (except --forced --record), no LLM, harness-independent seed: everything it reports is counted from the jsonl, never guessed.
// Usage: node ops/tools/flow-signals.mjs [--since 2026-10-06] [--until 2026-10-07] [--max-msg 220] [--forced] [--json]
//        dates = midnight Europe/Rome; default since = 7 days ago.
// Output (markdown): sessions (title, cwd, human/peer msgs), {{OWNER}}'s messages (incl. the ones queued while an agent
// works: correction/confusion candidates, bare "ok"-style replies), permission denials and {{OWNER}}'s own rejections with
// the denied input (subagents included), tool errors by signature, waits (gaps > 15 min between an assistant turn
// ending on a question/wait and the next message from {{OWNER}} or a peer).
// --forced: only the main metric, "interventi forzati" per day (things {{OWNER}} did because he had to, not because he
// chose to): ok/push typed in a chat that is not the hub, corrections, "non ho capito", nudges to a stuck chat,
// commands handed to him to run, his permission rejections, long texts he had to read before answering. Regex
// candidates, one category per message; the trend matters more than the absolute number. Each day shows the models
// used (a model change must not pass for a better brain). --forced --record appends one JSON line per day to
// measures.jsonl (date, metric, value, breakdown, model, brain = {{BRAIN_NAME}} commit, tests): the only write of this script.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CORRECTION, CONFUSION } from './signals-regex.mjs';

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const romeMidnight = d => { // 'YYYY-MM-DD' → epoch ms of 00:00 in Europe/Rome
  const utc = Date.parse(`${d}T00:00:00Z`);
  const local = Date.parse(new Date(utc).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(' ', 'T') + 'Z');
  return utc - (local - utc);
};
const since = romeMidnight(arg('--since') ?? new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10));
const until = arg('--until') ? romeMidnight(arg('--until')) : Infinity;
const maxMsg = Number(arg('--max-msg') ?? 220);
const root = path.join(os.homedir(), '.claude', 'projects');

const BARE = /^\s*(fatto|ok|okay|si|sì|vai|via|push|procedi|continua|ok vai|sì vai|si vai|yes)\s*[.!]?\s*$/i;
const WAITY = /(\?\s*$|aspetto|attendo|in attesa|fammi sapere|quando hai fatto|dimmi quando)/i;
const DENIAL = /denied|not allowed|Permission to use|blocked|doesn't want to proceed|was rejected/i;

const short = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, maxMsg);
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x?.type === 'text').map(x => x.text).join(' ') : '';
const hhmm = t => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const day = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

const sessions = [], errors = {}, denials = [], msgs = { correction: [], confusion: [], bare: 0, total: 0 }, waits = [];
const NUDGE = /(vai avanti|continua|sei ferm|è ferm|perch[ée] (sei|è|si è) ferm|riprendi|ci sei\?|a che punto sei|ti sei bloccat|sblocca)/i;
const PUSHY = /^\s*(push|pusha|ok push|sì push|si push)\b/i;
const LONG = 1500; // chars of the last assistant text before {{OWNER}} answered
const FORCED_KINDS = ['ok_fuori_regia', 'correzione', 'non_capito', 'sollecito', 'comando', 'rifiuto_permesso', 'testo_lungo'];
const forced = {}; // day → { kind: count, human: n, examples: { kind: [..] } }
const models = {}, modelIds = new Set(); // day → { model: assistant messages } (main sessions)
const bump = (t, kind, ex) => {
  const d = (forced[day(t)] ??= { human: 0, examples: {} });
  d[kind] = (d[kind] ?? 0) + 1;
  if (ex) (d.examples[kind] ??= []).length < 3 && d.examples[kind].push(`${hhmm(t)} ${ex}`);
};

// Main transcripts (<project>/<session>.jsonl) and subagent ones (<project>/<session>/subagents/*.jsonl: errors/denials only).
const files = [];
for (const dir of fs.readdirSync(root)) {
  const full = path.join(root, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  for (const f of fs.readdirSync(full)) {
    const p = path.join(full, f);
    if (f.endsWith('.jsonl')) files.push({ p, dir, sub: false });
    else if (fs.existsSync(path.join(p, 'subagents')))
      for (const g of fs.readdirSync(path.join(p, 'subagents')).filter(g => g.endsWith('.jsonl')))
        files.push({ p: path.join(p, 'subagents', g), dir, sub: true });
  }
}

for (const { p, dir, sub } of files) {
  if (fs.statSync(p).mtimeMs < since) continue;
  const s = { title: '', cwd: '', human: 0, peer: 0, notif: 0, first: 0, last: 0 };
  let lastAssistant = null; // { t, text }
  let lastLen = 0; const humanMsgs = [], cmdIds = new Set(); // for --forced
  const toolInputs = {}, seen = new Map(); // kind|text → last time
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'custom-title') s.title = o.customTitle;
    if (o.type === 'agent-name' && !s.title) s.title = o.agentName;
    const t = Date.parse(o.timestamp ?? '');
    if (!t || t < since || t >= until) continue;
    if (o.cwd) s.cwd = o.cwd;
    if (o.isSidechain && !sub) continue;
    s.first ||= t; s.last = t;
    const name = sub ? `${s.title || dir} (subagent)` : s.title || dir;
    const c = o.message?.content;
    if (o.type === 'assistant') {
      if (Array.isArray(c)) for (const x of c) if (x?.type === 'tool_use') toolInputs[x.id] = `${x.name} ${short(JSON.stringify(x.input ?? {}))}`;
      const txt = textOf(c);
      if (txt) lastAssistant = { t, text: txt };
      const mid = o.message?.id ?? `${p}:${t}`, model = o.message?.model;
      if (!sub && model && model !== '<synthetic>' && !modelIds.has(mid)) { modelIds.add(mid); const m = (models[day(t)] ??= {}); m[model] = (m[model] ?? 0) + 1; }
      if (txt && !sub) { lastLen = txt.length; if (/```powershell/i.test(txt) && !cmdIds.has(o.message?.id ?? t)) { cmdIds.add(o.message?.id ?? t); bump(t, 'comando', `· ${s.title || dir}`); } }
      continue;
    }
    // A message reaches the session either as a user line or, if typed while the agent works, as a queued_command attachment.
    const queued = o.type === 'attachment' && o.attachment?.type === 'queued_command' ? o.attachment : null;
    if (o.type !== 'user' && !queued) continue;
    if (Array.isArray(c)) for (const x of c) if (x?.type === 'tool_result' && x.is_error) {
      const body = short(typeof x.content === 'string' ? x.content : JSON.stringify(x.content ?? ''));
      const sig = body.slice(0, 70);
      errors[sig] = (errors[sig] ?? 0) + 1;
      if (DENIAL.test(body)) denials.push(`${day(t)} ${hhmm(t)} · ${name} · ${toolInputs[x.tool_use_id] ?? '?'} · ${body.slice(0, 140)}`);
      if (!sub && /doesn't want to proceed|was rejected/i.test(body)) bump(t, 'rifiuto_permesso', `· ${name} · ${(toolInputs[x.tool_use_id] ?? '?').slice(0, 80)}`);
    }
    if (sub) continue;
    const kind = queued ? queued.origin?.kind : o.origin?.kind;
    const txt = queued ? String(queued.prompt ?? '') : textOf(c);
    if (kind !== 'human' && kind !== 'peer' && kind !== 'task-notification') continue;
    const key = `${kind}|${txt}`;
    // queued attachment + user line of the same message (no id links them): a duplicate only when exactly one of the two
    // is the queued copy; the same words really typed twice both count.
    const prev = seen.get(key);
    const dup = prev && t - prev.t < 10 * 60e3 && prev.queued !== !!queued;
    seen.set(key, dup ? { t, queued: null } : { t, queued: !!queued });
    if (dup) continue;
    if (kind === 'task-notification') { s.notif++; continue; }
    if (kind === 'peer') s.peer++;
    if (lastAssistant && t - lastAssistant.t > 15 * 60e3 && WAITY.test(lastAssistant.text.slice(-300)))
      waits.push(`${day(t)} ${hhmm(lastAssistant.t)}→${hhmm(t)} (${Math.round((t - lastAssistant.t) / 60e3)} min, woken by ${kind}) · ${name} · "${short(lastAssistant.text.slice(-160))}"`);
    lastAssistant = null;
    if (kind !== 'human' || !txt || txt.startsWith('<')) continue;
    s.human++; msgs.total++;
    humanMsgs.push({ t, txt, long: lastLen > LONG }); lastLen = 0;
    const line1 = `${day(t)} ${hhmm(t)} · ${name} · "${short(txt)}"`;
    if (BARE.test(txt)) msgs.bare++;
    else if (CONFUSION.test(txt)) msgs.confusion.push(line1);
    else if (CORRECTION.test(txt)) msgs.correction.push(line1);
  }
  const hub = /regia/i.test(s.title); // the title can appear anywhere in the file: classify after reading it
  for (const m of humanMsgs) {
    const ex = `· ${s.title || dir} · "${short(m.txt).slice(0, 90)}"`;
    (forced[day(m.t)] ??= { human: 0, examples: {} }).human++;
    if (!hub && (BARE.test(m.txt) || PUSHY.test(m.txt))) bump(m.t, 'ok_fuori_regia', ex);
    else if (CONFUSION.test(m.txt)) bump(m.t, 'non_capito', ex);
    else if (NUDGE.test(m.txt)) bump(m.t, 'sollecito', ex);
    else if (CORRECTION.test(m.txt)) bump(m.t, 'correzione', ex);
    else if (m.long) bump(m.t, 'testo_lungo', ex);
  }
  if (s.first && !sub) sessions.push({ ...s, file: path.relative(root, p), spanMinutes: Math.round((s.last - s.first) / 60e3) });
}

if (process.argv.includes('--forced')) {
  const days = Object.keys(forced).sort();
  const total = d => FORCED_KINDS.reduce((a, k) => a + (forced[d][k] ?? 0), 0);
  const topModel = d => Object.entries(models[d] ?? {}).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m.replace(/^claude-/, '')} ${n}`).join(', ') || '?';
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (process.argv.includes('--record')) { // append-only measures, one JSON line per day (latest line for a date wins)
    const brain = (spawnSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout || '').trim() || '?';
    const today = day(Date.now()); // a day still in progress is never recorded (partial)
    const lines = days.filter(d => d !== today).map(d => JSON.stringify({ date: d, metric: 'interventi_forzati', value: total(d),
      breakdown: Object.fromEntries(FORCED_KINDS.map(k => [k, forced[d][k] ?? 0])), human: forced[d].human,
      model: Object.entries(models[d] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null, models: models[d] ?? {},
      brain, tests: null, recorded: new Date().toISOString() }));
    fs.appendFileSync(path.join(repo, 'measures.jsonl'), lines.map(l => l + '\n').join(''), 'utf8');
    console.log(`Recorded ${lines.length} day(s) in measures.jsonl (brain ${brain}).`);
  }
  if (process.argv.includes('--json')) { console.log(JSON.stringify(Object.fromEntries(days.map(d => [d, { totale: total(d), ...forced[d] }])), null, 1)); process.exit(0); }
  const o = [`# Interventi forzati di {{OWNER}} per giorno (${day(since)} → ${until === Infinity ? 'oggi' : day(until - 1)})`, '',
    `| Giorno | Totale | ${FORCED_KINDS.join(' | ')} | messaggi suoi | modelli (messaggi) |`, `|---|---|${FORCED_KINDS.map(() => '---').join('|')}|---|---|`];
  for (const d of days) o.push(`| ${d} | **${total(d)}** | ${FORCED_KINDS.map(k => forced[d][k] ?? 0).join(' | ')} | ${forced[d].human} | ${topModel(d)} |`);
  const last = days[days.length - 1];
  if (last) {
    o.push('', `## Esempi (${last}, max 3 per tipo: verificali prima di fidarti del numero)`);
    for (const k of FORCED_KINDS) for (const e of forced[last].examples[k] ?? []) o.push(`- ${k} · ${e}`);
  }
  console.log(o.join('\n'));
  process.exit(0);
}
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ sessions, msgs, errors, denials, waits }, null, 1));
  process.exit(0);
}
const out = [];
out.push(`# Flow signals ${day(since)} → ${until === Infinity ? 'now' : day(until - 1)}`);
out.push(`\n## Sessions (${sessions.length})`);
for (const s of sessions.sort((a, b) => a.first - b.first))
  out.push(`- ${day(s.first)} ${hhmm(s.first)}-${hhmm(s.last)} · ${s.title || '(no title)'} · human ${s.human} · peer ${s.peer} · notif ${s.notif} · ${s.cwd}`);
out.push(`\n## {{OWNER}}'s messages: ${msgs.total} total, ${msgs.bare} bare ok/fatto/vai/push (${Math.round(100 * msgs.bare / (msgs.total || 1))}%)`);
out.push(`\n### Corrections (${msgs.correction.length}, regex candidates: read in context before counting)`);
out.push(...msgs.correction.map(m => `- ${m}`));
out.push(`\n### Confusion (${msgs.confusion.length})`);
out.push(...msgs.confusion.map(m => `- ${m}`));
out.push(`\n## Permission denials, blocks and {{OWNER}}'s rejections (${denials.length}, subagents included)`);
out.push(...denials.map(d => `- ${d}`));
out.push(`\n## Tool errors by signature (top 25, subagents included)`);
out.push(...Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `- ${v}× ${k}`));
out.push(`\n## Waits > 15 min after a question/wait (${waits.length}, total ${waits.reduce((a, w) => a + Number(w.match(/\((\d+) min/)[1]), 0)} min)`);
out.push(...waits.map(w => `- ${w}`));
console.log(out.join('\n'));
