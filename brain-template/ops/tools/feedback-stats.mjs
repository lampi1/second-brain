// feedback-stats: how well the AI is doing for {{OWNER}}, positive vs negative, computed ON DEMAND only (never a hook,
// never on a schedule; {{OWNER}}, 2026-10-09). No LLM, no writes. Sources:
//   1. his messages in Claude (~/.claude/projects) and Cursor (~/.cursor/projects/*/agent-transcripts) transcripts,
//      judged by the regexes of signals-regex.mjs (praise vs correction/confusion);
//   2. the logs ai-wins.md (written by the hooks) and ai-errors.md (written by the chats);
//   3. implicit signals: panels answered with the recommended option (Claude only: Cursor does not save the answer),
//      deliveries ("fatto", "pronto", "ora funziona"...) with no correction in his next N messages;
//   4. --devops (read-only GETs, current az login): votes of others on his PRs, QA test results on test plans named
//      after his PRs ("[App QA] Pr 12 …"), his own runs (agent QA) excluded.
// Usage: node ops/tools/feedback-stats.mjs [--since AAAA-MM-GG] [--until AAAA-MM-GG] [--n 2] [--devops] [--json]
//        default since = 7 days ago; dates = midnight Europe/Rome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CORRECTION, CONFUSION, positiveKind } from './signals-regex.mjs';
import { areaOf } from './feedback-log.mjs';

const argv = process.argv.slice(2);
const arg = n => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const romeMidnight = d => { // 'YYYY-MM-DD' → epoch ms of 00:00 in Europe/Rome (same as flow-signals)
  const utc = Date.parse(`${d}T00:00:00Z`);
  const local = Date.parse(new Date(utc).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(' ', 'T') + 'Z');
  return utc - (local - utc);
};
const day = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const since = romeMidnight(arg('--since') ?? day(Date.now() - 7 * 864e5));
const until = arg('--until') ? romeMidnight(arg('--until')) : Date.now() + 1;
const inWin = t => t >= since && t < until;
const N = Number(arg('--n') ?? 2);
const ROOT = arg('--root') ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLAUDE = process.env.BRAIN_CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects');
const CURSOR = process.env.BRAIN_CURSOR_PROJECTS || path.join(os.homedir(), '.cursor', 'projects');
const DELIVERY = /\b(fatto|fatta|pronto|pronta|completat|funziona|corrett[oa]|sistemat|aggiornat|creat[oa]|aggiunt[oa]|pushat|mergiat|pubblicat|committat|implementat|done|ready)\b/i;
const RECOMMENDED = /\((consigliat[oa]|recommended)\)/i;
const NEGATIVE = t => !positiveKind(t) && (CORRECTION.test(t) || CONFUSION.test(t));
const typeOf = title => (/^regia\b/i.test(title || '') ? 'Regia' : 'chat');
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const ls = d => { try { return fs.readdirSync(d); } catch { return []; } };
const rows = f => read(f).split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// One timeline per chat: { harness, title, cwd, events: [{ t, who: 'a'|'d', text }], panels: [...] }
const chats = [];
// Claude: main transcripts only (subagents never talk to {{OWNER}}).
for (const dir of ls(CLAUDE)) {
  for (const f of ls(path.join(CLAUDE, dir)).filter(f => f.endsWith('.jsonl'))) {
    const p = path.join(CLAUDE, dir, f);
    try { if (fs.statSync(p).mtimeMs < since) continue; } catch { continue; }
    const c = { harness: 'claude', title: '', cwd: '', events: [], panels: [] }, asks = {}, last = new Map();
    for (const o of rows(p)) {
      if (o.type === 'custom-title') c.title = o.customTitle;
      if (o.cwd) c.cwd = o.cwd;
      if (o.isSidechain) continue;
      const t = Date.parse(o.timestamp ?? ''), content = Array.isArray(o.message?.content) ? o.message.content : [];
      for (const x of content) if (x.type === 'tool_use' && x.name === 'AskUserQuestion') asks[x.id] = x.input?.questions || [];
      for (const x of content) if (x.type === 'tool_result' && asks[x.tool_use_id] && inWin(t))
        c.panels.push({ questions: asks[x.tool_use_id], answers: o.toolUseResult?.answers || {}, raw: JSON.stringify(x.content ?? '') });
      if (!t || !inWin(t)) continue;
      const text = typeof o.message?.content === 'string' ? o.message.content : content.filter(x => x.type === 'text').map(x => x.text).join('\n');
      if (o.type === 'assistant' && text.trim()) c.events.push({ t, who: 'a', text });
      // His message: a user line, or a queued_command attachment when typed while the agent works (same text twice → once).
      const queued = o.type === 'attachment' && o.attachment?.type === 'queued_command' ? String(o.attachment.prompt ?? '') : null;
      const kind = queued !== null ? o.attachment.origin?.kind : o.origin?.kind;
      const msg = queued ?? (o.type === 'user' ? text : '');
      if (kind !== 'human' || !msg || msg.startsWith('<')) continue;
      if (last.has(msg) && t - last.get(msg) < 10 * 60e3) continue;
      last.set(msg, t);
      c.events.push({ t, who: 'd', text: msg });
    }
    if (c.events.length || c.panels.length) chats.push(c);
  }
}
// Cursor: titles from its DB when readable (same table as harness/cursor/chats.mjs), dates from the <timestamp> tag.
const cursorTitles = (() => {
  try {
    process.removeAllListeners('warning');
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const db = new DatabaseSync(process.env.BRAIN_CURSOR_DB || path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb'), { readOnly: true });
    const m = new Map(db.prepare('SELECT composerId, value FROM composerHeaders').all().map(r => { try { return [r.composerId, JSON.parse(r.value).name || '']; } catch { return [r.composerId, '']; } }));
    db.close();
    return m;
  } catch { return new Map(); }
})();
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const stamp = s => { // "Friday, Oct 9, 2026, 9:00 PM (UTC+2)"
  const m = String(s).match(/<timestamp>\w+, (\w{3}) (\d+), (\d{4}), (\d+):(\d+) (AM|PM) \(UTC([+-]\d+)?(?::(\d+))?\)/);
  if (!m) return 0;
  const h = (Number(m[4]) % 12) + (m[6] === 'PM' ? 12 : 0), off = (Number(m[7] || 0) * 60) + Math.sign(Number(m[7] || 0)) * Number(m[8] || 0);
  return Date.UTC(Number(m[3]), MONTHS[m[1]], Number(m[2]), h, Number(m[5])) - off * 60e3;
};
const typed = text => [...String(text).matchAll(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/g)].map(m => m[1]).join('\n').trim();
const AUTO = /^(\[correction-log\]|Briefly inform the user about the task result|Perform any necessary follow-up actions)/;
for (const folder of ls(CURSOR)) {
  const base = path.join(CURSOR, folder, 'agent-transcripts');
  for (const id of ls(base)) {
    const p = path.join(base, id, `${id}.jsonl`);
    let mtime; try { mtime = fs.statSync(p).mtimeMs; } catch { continue; }
    if (mtime < since) continue;
    const repo = folder.match(/source-repos-(.+)$/i)?.[1];
    const c = { harness: 'cursor', title: cursorTitles.get(id) || '', cwd: /{{BRAIN_NAME}}/i.test(folder) ? 'C:/x/{{BRAIN_NAME}}' : repo ? `C:/source/repos/${repo}` : '', events: [], panels: [] };
    let t = 0;
    for (const r of rows(p)) {
      const text = (r.message?.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
      if (r.role === 'user') {
        t = stamp(text) || t;
        const msg = typed(text);
        if (msg && !AUTO.test(msg) && !msg.startsWith('<') && (t ? inWin(t) : true)) c.events.push({ t: t || mtime, who: 'd', text: msg });
      } else if (r.role === 'assistant' && text.trim() && (!t || inWin(t))) c.events.push({ t: t || mtime, who: 'a', text });
    }
    if (c.events.some(e => e.who === 'd')) chats.push(c);
  }
}

// 1. His messages: praise vs correction/confusion, by harness, area and chat type.
const tally = {}; // key → { pos, part, neg, msgs }
const bump = (key, k) => { const x = (tally[key] ??= { pos: 0, part: 0, neg: 0, msgs: 0 }); x[k]++; };
const examples = { pos: [], neg: [] };
for (const c of chats) {
  const area = areaOf(c.title, c.cwd);
  for (const e of c.events.filter(e => e.who === 'd')) {
    const k = positiveKind(e.text), kind = k === 'positivo' ? 'pos' : k === 'parziale' ? 'part' : NEGATIVE(e.text) ? 'neg' : null;
    for (const key of ['tutto', `harness:${c.harness}`, `area:${area}`, `tipo:${typeOf(c.title)}`]) { bump(key, 'msgs'); if (kind) bump(key, kind); }
    if (kind === 'pos' && examples.pos.length < 3) examples.pos.push(`${c.title || area}: "${e.text.replace(/\s+/g, ' ').slice(0, 70)}"`);
    if (kind === 'neg' && examples.neg.length < 3) examples.neg.push(`${c.title || area}: "${e.text.replace(/\s+/g, ' ').slice(0, 70)}"`);
  }
}
// 3a. Panels with a recommended option: picked it, picked another, closed without answering.
const panels = { rec: 0, other: 0, dismissed: 0, noRec: 0 };
for (const c of chats) for (const p of c.panels) for (const q of p.questions) {
  const rec = (q.options || []).find(o => RECOMMENDED.test(o.label || ''));
  const a = String(p.answers[q.question] ?? (/dismissed|declined/i.test(p.raw) ? 'User dismissed' : ''));
  if (!rec) { panels.noRec++; continue; }
  if (/User dismissed|declined/i.test(a) || !a) panels.dismissed++;
  else if (a.split(', ').includes(rec.label) || a === rec.label) panels.rec++;
  else panels.other++;
}
// 3b. Deliveries: the agent says it is done/ready/working; clean if none of his next N messages corrects it.
const deliv = {};
for (const c of chats) {
  const ev = c.events;
  ev.forEach((e, i) => {
    if (e.who !== 'a' || ev[i + 1]?.who !== 'd' || !DELIVERY.test(e.text.slice(0, 200))) return;
    const next = ev.slice(i + 1).filter(x => x.who === 'd').slice(0, N);
    const x = (deliv[c.harness] ??= { total: 0, clean: 0 });
    x.total++; if (!next.some(m => NEGATIVE(m.text))) x.clean++;
  });
}
// 2. The logs, in the window.
const logLines = file => read(path.join(ROOT, file)).split(/\r?\n/).filter(l => /^- \d{4}-\d{2}-\d{2} /.test(l) && inWin(romeMidnight(l.slice(2, 12))));
const wins = logLines('ai-wins.md').map(l => l.split(' · '));
const errs = logLines('ai-errors.md');
// ai-errors.md: chat titles may contain " · " themselves, so the area and agent type come from the text before the type.
const TYPES = /· (test-passato-a-torto|bug-non-trovato|fatto-non-verificato|posto-sbagliato|regola-ignorata|richiesta-fraintesa|non-capito|azione-pericolosa|fuori-ruolo|blocco-aggirato|altro|[a-z-]+) · (detto|fatto)/;
const errHead = l => l.slice(19, l.search(TYPES) > 0 ? l.search(TYPES) : 120);
const errArea = l => { const h = errHead(l); return /regia/i.test(h) ? 'Regia' : h.match(/\b(Prod|B|A|OS|Pers)\b/)?.[1] ?? 'altro'; };
const errType = l => { const h = errHead(l); return /regia/i.test(h) ? 'Regia' : /reviewer|investigator|packager|log-reader|brain-editor|flow-optimizer|sottoagente|subagent|agente /i.test(h) ? 'sottoagente' : 'chat'; };
const count = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});

// 4. DevOps (only with --devops): read-only GETs.
let devops = null;
if (argv.includes('--devops')) {
  try {
    const ORG = 'https://dev.azure.com/{{DEVOPS_ORG}}';
    const token = execFileSync('az', ['account', 'get-access-token', '--resource', '499b84ac-1321-427f-aa17-267ca6975798', '--query', 'accessToken', '-o', 'tsv'], { shell: true, encoding: 'utf8', windowsHide: true }).trim();
    const res = async p => { const r = await fetch(ORG + p, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`${r.status} on ${p.slice(0, 80)}`); return r; };
    const get = async p => (await res(p)).json();
    const me = (await get('/_apis/connectionData')).authenticatedUser;
    const mine = (await get(`/_apis/git/pullrequests?searchCriteria.creatorId=${me.id}&searchCriteria.status=all&$top=1000&api-version=7.1`)).value;
    const ids = new Set(mine.map(p => p.pullRequestId));
    const votes = { approvate: 0, negative: 0, prs: 0 };
    for (const pr of mine.filter(p => inWin(Date.parse(p.creationDate)))) {
      votes.prs++;
      for (const r of pr.reviewers.filter(r => r.id !== me.id && !r.isContainer)) { if (r.vote >= 5) votes.approvate++; if (r.vote < 0) votes.negative++; }
    }
    const qa = { Passed: 0, Failed: 0, Blocked: 0, failed: [] }, plans = new Map();
    // Runs updated in the window: the API takes at most 7 days per call and pages with a continuation token.
    const runIds = new Set();
    for (let from = since; from < Math.min(until, Date.now()); from += 7 * 864e5) {
      const to = Math.min(from + 7 * 864e5, until, Date.now());
      let token = '';
      for (let page = 0; page < 30; page++) {
        const r = await res(`/{{DEVOPS_PROJECT}}/_apis/test/runs?minLastUpdatedDate=${new Date(from).toISOString()}&maxLastUpdatedDate=${new Date(to).toISOString()}&$top=100${token ? `&continuationToken=${encodeURIComponent(token)}` : ''}&api-version=7.1`);
        (await r.json()).value.forEach(run => runIds.add(run.id));
        token = r.headers.get('x-ms-continuationtoken') || '';
        if (!token) break;
      }
    }
    const results = [], queue = [...runIds];
    await Promise.all(Array.from({ length: 8 }, async () => { // 8 calls at a time
      while (queue.length) results.push(...(await get(`/{{DEVOPS_PROJECT}}/_apis/test/Runs/${queue.shift()}/results?api-version=7.1`)).value);
    }));
    for (const r of results) {
      if (!['Passed', 'Failed', 'Blocked'].includes(r.outcome) || r.runBy?.id === me.id || !inWin(Date.parse(r.completedDate || r.lastUpdatedDate))) continue;
      const pid = r.testPlan?.id;
      if (pid && !plans.has(pid)) plans.set(pid, await get(`/{{DEVOPS_PROJECT}}/_apis/testplan/plans/${pid}?api-version=7.1`).then(p => p.name, () => ''));
      const pr = Number(String(plans.get(pid) || '').match(/\bPR\s*!?\s*(\d{3,})/i)?.[1]);
      if (!ids.has(pr)) continue;
      qa[r.outcome]++;
      if (r.outcome !== 'Passed' && qa.failed.length < 5) qa.failed.push(`${r.outcome}: ${r.testCaseTitle} (${plans.get(pid)}) ${ORG}/{{DEVOPS_PROJECT}}/_testPlans/execute?planId=${pid}`);
    }
    qa.runs = runIds.size;
    devops = { votes, qa };
  } catch (e) { devops = { error: e.message }; }
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const result = { since: day(since), until: day(Math.min(until, Date.now())), tally, panels, deliveries: deliv,
  logs: { wins: wins.length, winsByKind: count(wins, w => w[4]), winsByArea: count(wins, w => w[3]), errors: errs.length, errorsByArea: count(errs, errArea), errorsByType: count(errs, errType) }, devops };
if (argv.includes('--json')) { console.log(JSON.stringify(result, null, 1)); process.exit(0); }

const row = (label, x) => `| ${label} | ${x.pos} | ${x.part} | ${x.neg} | ${pct(x.pos + x.part, x.pos + x.part + x.neg)} | ${x.msgs} |`;
const group = pre => Object.entries(tally).filter(([k]) => k.startsWith(pre)).sort((a, b) => b[1].msgs - a[1].msgs).slice(0, 8);
const o = [`# Feedback all'IA, ${result.since} → ${result.until}`, '',
  '## I tuoi messaggi (regex: lodi contro correzioni e "non ho capito")', '',
  '| | positivi | parziali | negativi | % positivi | messaggi |', '|---|---|---|---|---|---|',
  row('**tutto**', tally.tutto ?? { pos: 0, part: 0, neg: 0, msgs: 0 }),
  ...group('harness:').map(([k, x]) => row(k.slice(8), x)),
  ...group('tipo:').map(([k, x]) => row(k.slice(5), x)),
  ...group('area:').map(([k, x]) => row(`area ${k.slice(5)}`, x)), '',
  '"Negativi" = candidati della regex delle correzioni, larga (prende anche domande come "come mai"): conta la tendenza; i confermati sono in "Registri".', ''];
if (examples.pos.length) o.push(`Esempi positivi: ${examples.pos.join(' · ')}`);
if (examples.neg.length) o.push(`Esempi negativi: ${examples.neg.join(' · ')}`, '');
const pq = panels.rec + panels.other + panels.dismissed;
o.push('## Segnali impliciti', '',
  `- **Pannelli** (solo Claude: Cursor non salva la risposta): ${pq} domande con un'opzione consigliata, scelta la consigliata ${panels.rec} (${pct(panels.rec, pq)}), un'altra ${panels.other}, chiuse senza risposta ${panels.dismissed}; senza consigliata ${panels.noRec}.`,
  ...Object.entries(deliv).map(([h, x]) => `- **Consegne ${h}** ("fatto", "pronto", "ora funziona"...): ${x.total}, senza correzioni nei ${N} messaggi dopo ${x.clean} (${pct(x.clean, x.total)}).`));
if (devops?.error) o.push(`- **DevOps**: non letto (${devops.error}).`);
else if (devops) o.push(`- **PR tue create nel periodo**: ${devops.votes.prs}; voti degli altri: approvate ${devops.votes.approvate}, negativi ${devops.votes.negative}.`,
  `- **Test QA sui tuoi lavori** (Test Plan col numero di una tua PR, eseguiti da altri): Passed ${devops.qa.Passed}, Failed ${devops.qa.Failed}, Blocked ${devops.qa.Blocked} (${pct(devops.qa.Passed, devops.qa.Passed + devops.qa.Failed + devops.qa.Blocked)} passati).`,
  ...devops.qa.failed.map(f => `  - ${f}`));
else o.push('- PR e test QA: aggiungi `--devops`.');
o.push('', '## Registri', '',
  `- \`ai-wins.md\` (scritto dagli hook): ${wins.length} righe ${JSON.stringify(result.logs.winsByKind)}, per area ${JSON.stringify(result.logs.winsByArea)}.`,
  `- \`ai-errors.md\` (scritto dalle chat): ${errs.length} righe, per area ${JSON.stringify(result.logs.errorsByArea)}, per tipo di agente ${JSON.stringify(result.logs.errorsByType)}.`);
console.log(o.join('\n'));
