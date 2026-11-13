// day: the raw material of the Orchestrator's brief and day report in one call, split Alfa / Beta / Produzione /
// Personale (routines.md "Report della giornata", P-092; journal/brief/). READ-ONLY. The Orchestrator still adds mail, Teams
// and calendar ("Posta e chat"), picks the top 3 and writes the text for {{OWNER}}; never the reviews of others' PRs
// (P-091). Area by heuristics (chat label, target branch release, area words): a draft, the Orchestrator corrects it.
// Usage (--json on both: structured rows with title, link, state, area, time (HH:MM, Rome) and a chat's project folder (cwd), for the brain site's Fatto/Da fare/stand-up):
//        node "{{BRAIN}}/ops/tools/day.mjs" brief                    (live PRs, work items, now.md)
//        node "{{BRAIN}}/ops/tools/day.mjs" report [--date AAAA-MM-GG] (journal, DevOps of the
//          day, chats active that day in Claude and Cursor, {{BRAIN_NAME}} commits)
// Auth for DevOps: the current `az login` (like my-tasks.mjs); --offline skips DevOps (tests, no network).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { brainRoot } from './brain-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPS = brainRoot(import.meta.url);
const ORG = 'https://dev.azure.com/{{DEVOPS_ORG}}';
export const romeDay = t => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const romeTime = t => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(t));
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

export const AREAS = ['Alfa', 'Beta', 'Produzione', 'Personale e OS', 'Altro'];
const AT_WORDS = /\bB\b|release|\bbeta\b/i;
// Area of a chat label ("A · Fix login"), a now.md line, a journal line or a work item title.
export function areaOf(text, { branch } = {}) {
  const t = String(text ?? '');
  if (branch) return /release/.test(branch) ? 'Beta' : 'Alfa';
  const label = t.replace(/^- /, '').replace(/^\*\*/, '').match(/^(A|B|Prod|OS|Pers|Orchestrator)\b/)?.[1];
  if (label) return { A: 'Alfa', B: 'Beta', Prod: 'Produzione', OS: 'Personale e OS', Pers: 'Personale e OS', Orchestrator: 'Personale e OS' }[label];
  if (/\[personale\]|^\s*-?\s*\*?\*?Pers\b|{{BRAIN_NAME}}|cervello|Orchestrator\b|Orchestrator\b/i.test(t)) return 'Personale e OS';
  if (AT_WORDS.test(t)) return 'Beta';
  if (/\bprod\b|produzione|ring-?\d|rilascio|incident|urgenza|nodi? /i.test(t)) return 'Produzione';
  return 'Alfa';
}

// now.md → threads by section: label, the "prossimo" part, date, stale (> 7 days).
export function nowThreads(text, today) {
  const out = []; let section = '';
  for (const l of text.split(/\r?\n/)) {
    if (/^## /.test(l)) { section = l.slice(3).trim(); continue; }
    if (!l.startsWith('- **')) continue;
    const label = l.match(/^- \*\*(.+?)\*\*/)?.[1] ?? '';
    const date = l.match(/\((\d{4}-\d{2}-\d{2})\)\s*$/)?.[1] ?? '';
    const next = l.match(/(?<![\p{L}])(?:prossimo|aspetta|resta|decide)(?![\p{L}])[^·]*/iu)?.[0] ?? '';
    const days = date ? Math.round((Date.parse(today) - Date.parse(date)) / 864e5) : null;
    out.push({ section, label, date, next: next.trim(), stale: days !== null && days > 7, done: /prossimo: niente/i.test(l) || (/\bFATT[OA]\b|chiuso/i.test(l) && !next), area: section.startsWith('Personale') ? 'Personale e OS' : section.includes('produzione') ? 'Produzione' : areaOf(label || l), line: l });
  }
  return out;
}

// Claude chats with activity on `day` (Rome): title, first → last time, {{OWNER}}'s messages, last answer.
export function claudeChatsOn(root, day) {
  const res = [];
  const from = Date.parse(`${day}T00:00:00Z`) - 3 * 864e5;
  let dirs = []; try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch {}
  for (const d of dirs) {
    for (const f of fs.readdirSync(path.join(root, d.name)).filter(f => f.endsWith('.jsonl'))) {
      const file = path.join(root, d.name, f);
      if (fs.statSync(file).mtimeMs < from) continue;
      let title = '', first = 0, last = 0, his = 0, lastText = '', cwd = '';
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.type === 'custom-title') title = j.customTitle;
        if (!cwd && typeof j.cwd === 'string') cwd = j.cwd; // the project folder: tells the app's own chats apart
        if ((j.type !== 'user' && j.type !== 'assistant') || j.isSidechain || !j.timestamp || romeDay(j.timestamp) !== day) continue;
        const t = Date.parse(j.timestamp);
        first ||= t; last = t;
        const c = j.message?.content;
        if (j.type === 'user' && !j.isMeta && (typeof c === 'string' ? !c.startsWith('<') : Array.isArray(c) && c.some(p => p.type === 'text' && !p.text.startsWith('<')) && !c.some(p => p.type === 'tool_result'))) his++;
        if (j.type === 'assistant') { const tx = (c ?? []).filter(p => p.type === 'text').map(p => p.text).join(' ').trim(); if (tx) lastText = tx; }
      }
      if (first) res.push({ title: title || '(senza titolo)', first, last, his, last_answer: clip(lastText, 180), area: areaOf(title || lastText), cwd });
    }
  }
  return res.sort((a, b) => a.first - b.first);
}

// DevOps over REST with the az login token (same as my-tasks.mjs).
async function devops() {
  const { stdout } = await promisify(execFile)('az', ['account', 'get-access-token', '--resource', '499b84ac-1321-427f-aa17-267ca6975798', '--query', 'accessToken', '-o', 'tsv'], { shell: true });
  const headers = { Authorization: `Bearer ${stdout.trim()}`, 'Content-Type': 'application/json' };
  const api = async (p, body) => {
    const r = await fetch(`${ORG}${p}`, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) });
    if (!r.ok) throw new Error(`${r.status} on ${p}`);
    return r.json();
  };
  const me = (await api('/_apis/connectionData')).authenticatedUser;
  return { api, me };
}

async function devopsDay(day) {
  const { api, me } = await devops();
  const prs = st => api(`/_apis/git/pullrequests?searchCriteria.creatorId=${me.id}&searchCriteria.status=${st}&$top=100&api-version=7.1`).then(r => r.value);
  const [active, completed] = await Promise.all([prs('active'), prs('completed')]);
  const link = p => `${ORG}/${encodeURIComponent(p.repository.project.name)}/_git/${encodeURIComponent(p.repository.name)}/pullrequest/${p.pullRequestId}`;
  const opened = [...active, ...completed].filter(p => romeDay(p.creationDate) === day);
  const merged = completed.filter(p => p.closedDate && romeDay(p.closedDate) === day);
  const next = romeDay(Date.parse(`${day}T12:00:00Z`) + 864e5);
  const wiql = await api('/_apis/wit/wiql?api-version=7.1', { query: `SELECT [System.Id] FROM WorkItems WHERE [System.ChangedBy] = @Me AND [System.ChangedDate] >= '${day}' AND [System.ChangedDate] < '${next}' ORDER BY [System.ChangedDate] DESC` });
  const ids = wiql.workItems.map(w => w.id).slice(0, 100);
  const items = ids.length ? (await api('/_apis/wit/workitemsbatch?api-version=7.1', { ids, fields: ['System.Id', 'System.WorkItemType', 'System.Title', 'System.State', 'System.TeamProject', 'System.ChangedDate'] })).value.map(w => w.fields) : [];
  const wiLink = f => `${ORG}/${encodeURIComponent(f['System.TeamProject'])}/_workitems/edit/${f['System.Id']}`;
  // text = the markdown line; the other fields feed --json (the brain site's "Fatto" and stand-up)
  const target = p => p.targetRefName.replace('refs/heads/', '');
  return {
    opened: opened.map(p => ({ kind: 'pr-aperta', time: romeTime(p.creationDate), title: p.title, target: target(p), url: link(p), text: `PR aperta: "${p.title}" → ${target(p)} ${link(p)}`, area: areaOf('', { branch: p.targetRefName }) })),
    merged: merged.map(p => ({ kind: 'pr-unita', time: romeTime(p.closedDate), title: p.title, target: target(p), url: link(p), text: `PR unita: "${p.title}" → ${target(p)} ${link(p)}`, area: areaOf('', { branch: p.targetRefName }) })),
    items: items.map(f => ({ kind: 'work-item', time: f['System.ChangedDate'] ? romeTime(f['System.ChangedDate']) : '', type: f['System.WorkItemType'], title: f['System.Title'], state: f['System.State'], url: wiLink(f), text: `${f['System.WorkItemType']} "${clip(f['System.Title'], 90)}" ora ${f['System.State']} ${wiLink(f)}`, area: f['System.TeamProject'] === 'Project Triage' ? 'Altro' : areaOf(f['System.Title']) })),
  };
}

const node = (script, args) => spawnSync(process.execPath, [path.join(OPS, script), ...args], { encoding: 'utf8', timeout: 120000 });
const group = (rows) => Object.fromEntries(AREAS.map(a => [a, rows.filter(r => r.area === a)]));

export function renderReport({ day, journal, chats, cursor, dv, commits, brief }) {
  const L = [`# Giornata ${day}: materiale per il report (day.mjs)`, '', 'Esiti prima: PR, QA, deploy, messaggi; poi le chat. L’Orchestrator scrive il report in parole semplici per gruppi.'];
  const rows = [
    ...(dv?.merged ?? []), ...(dv?.opened ?? []),
    ...journal.map(l => ({ text: `diario: ${l.replace(/^- /, '')}`, area: areaOf(l) })),
    ...(dv?.items ?? []).map(x => ({ ...x, text: `work item: ${x.text}` })),
    ...chats.map(c => ({ text: `chat Claude "${c.title}" ${romeTime(c.first)}-${romeTime(c.last)}, ${c.his} messaggi tuoi; ultima risposta: ${c.last_answer}`, area: c.area })),
    ...cursor.map(l => ({ text: `chat Cursor ${l.replace(/^- /, '')}`, area: areaOf(l.replace(/^- /, '')) })),
  ];
  for (const [a, list] of Object.entries(group(rows))) {
    if (!list.length) continue;
    L.push('', `## ${a}`, ...list.map(r => `- ${r.text}`));
  }
  if (dv === null) L.push('', 'DevOps non letto (--offline o az login scaduto): PR e work item del giorno mancano.');
  L.push('', 'Limiti: work item solo se la tua è l\'ultima modifica di quel giorno; chat Cursor per ultima attività (una chat continuata dopo non compare): completa con `devops-me.mjs --days 1`.');
  if (commits.length) L.push('', `## {{BRAIN_NAME}} (commit non automatici)`, ...commits.map(c => `- ${c}`));
  if (brief) L.push('', `Brief del giorno: journal/brief/${day}.md`);
  return L.join('\n');
}

// --json for the brain site: the same material as structured rows (title, link, state, area), names not ids.
export function reportData({ day, journal, chats, cursor, dv, commits, brief }) {
  const mergedUrls = new Set((dv?.merged ?? []).map(p => p.url)); // opened and merged the same day: only "merged"
  const rows = [
    ...(dv?.merged ?? []), ...(dv?.opened ?? []).filter(p => !mergedUrls.has(p.url)), ...(dv?.items ?? []),
    ...journal.map(l => { const m = l.replace(/^- /, '').match(/^(\d{1,2}:\d{2})(?: UTC)? · ([^·]+?) · (.*)$/); return { kind: 'diario', time: m?.[1] ?? '', tag: m?.[2]?.trim() ?? '', title: (m?.[3] ?? l.replace(/^- /, '')).replace(/^\[personale\]\s*/, ''), area: areaOf(l) }; }),
    ...chats.map(c => ({ kind: 'chat', title: c.title, from: romeTime(c.first), to: romeTime(c.last), his: c.his, last: c.last_answer, area: c.area, cwd: c.cwd ?? '' })),
    ...cursor.map(l => ({ kind: 'chat-cursor', title: l.replace(/^- /, ''), area: areaOf(l.replace(/^- /, '')) })),
  ].map(({ text, ...r }) => r);
  return { day, devops: dv !== null, areas: AREAS, rows, commits, brief, text: renderReport({ day, journal, chats, cursor, dv, commits, brief }) };
}
// devops-me.mjs --prs text → PRs with their build and linked work items.
export function parsePrs(text) {
  const prs = [];
  for (const l of String(text ?? '').split(/\r?\n/)) {
    // a draft PR has "(bozza)" after the target; a new PR may have no build yet ("ultima build: nessuna")
    const pr = l.match(/^- "(.+)" → (\S+)( \(bozza\))? (https?:\/\/\S+)/);
    if (pr) { prs.push({ kind: 'pr', title: pr[1], target: pr[2], draft: !!pr[3], url: pr[4], area: areaOf('', { branch: pr[2] }), items: [] }); continue; }
    if (/^- /.test(l)) { prs.push(null); continue; } // a PR line we cannot read: its details must not stick to the previous PR
    const cur = prs[prs.length - 1]; if (!cur) continue;
    const meta = l.match(/auto-complete: (\S+) · voti: (.+?) · ultima build: (\S+)(?: (https?:\/\/\S+))?/);
    if (meta) Object.assign(cur, { autocomplete: meta[1] === 'sì', votes: meta[2], build: meta[3] === 'nessuna' ? '' : meta[3], buildUrl: meta[4] ?? '' });
    const wi = l.match(/^\s+#\d+ (.+?) "(.+?)" \((.+?)\)(?: assegnato a (.+?))? (https?:\/\/\S+)/);
    if (wi) cur.items.push({ type: wi[1], title: wi[2], state: wi[3], assignee: wi[4] ?? '', url: wi[5] });
  }
  return prs.filter(Boolean);
}
export function briefData({ day, prsText, items, threads }) {
  const wiUrl = f => `${ORG}/${encodeURIComponent(f['System.TeamProject'])}/_workitems/edit/${f['System.Id']}`;
  return {
    day, devops: !!prsText?.trim(), areas: AREAS,
    prs: parsePrs(prsText),
    items: items.map(f => ({ kind: 'work-item', type: f['System.WorkItemType'], title: f['System.Title'], state: f['System.State'], url: wiUrl(f), triage: f['System.TeamProject'] === 'Project Triage', area: f['System.TeamProject'] === 'Project Triage' ? 'Altro' : areaOf(f['System.Title']) })),
    threads: threads.map(({ line, ...t }) => t),
    text: renderBrief({ day, prsText, items, threads }),
  };
}

export function renderBrief({ day, prsText, items, threads }) {
  const L = [`# Brief ${day}: materiale (day.mjs)`, '', 'L’Orchestrator aggiunge mail, Teams e calendario ("Posta e chat"), sceglie i primi 3 attorno alle call; le review delle PR degli altri non entrano (P-091).'];
  L.push('', '## Le tue PR, dal vivo', prsText?.trim() ? prsText.trim().split('\n').filter(l => !l.startsWith('# ')).join('\n') : 'DevOps non letto.');
  const rows = [
    ...items.filter(f => f['System.TeamProject'] !== 'Project Triage').map(f => ({ area: areaOf(f['System.Title']), text: `${f['System.State']} · ${f['System.WorkItemType']} "${clip(f['System.Title'], 90)}" ${ORG}/${encodeURIComponent(f['System.TeamProject'])}/_workitems/edit/${f['System.Id']}` })),
    ...threads.filter(t => !t.done).map(t => ({ area: t.area, text: `filo: ${t.label}${t.next ? ` · ${clip(t.next, 110)}` : ''}${t.stale ? ` · VECCHIO (${t.date}): da verificare` : ''}` })),
  ];
  for (const [a, list] of Object.entries(group(rows))) if (list.length) L.push('', `## ${a}`, ...list.map(r => `- ${r.text}`));
  const triage = items.filter(f => f['System.TeamProject'] === 'Project Triage');
  if (triage.length) L.push('', `## Bug di Triage assegnati a te: ${triage.length}`, 'Si toccano solo dopo la validazione di un umano (me.md).');
  return L.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const offline = argv.includes('--offline');
  const day = arg('--date') ?? romeDay(Date.now());
  // a fresh brain has no now.md until the first chat writes its line (ADR 0072): an empty day, not an error
  const nowFile = arg('--now') ?? path.join(OPS, 'now.md');
  const nowText = fs.existsSync(nowFile) ? fs.readFileSync(nowFile, 'utf8') : '';
  if (argv[0] === 'brief') {
    let prsText = '', items = [];
    if (!offline) {
      const [p, t] = await Promise.all([
        promisify(execFile)(process.execPath, [path.join(OPS, 'ops', 'tools', 'devops-me.mjs'), '--prs'], { timeout: 120000 }).then(r => r.stdout).catch(() => ''),
        promisify(execFile)(process.execPath, [path.join(OPS, 'ops', 'tools', 'my-tasks.mjs'), '--json'], { timeout: 120000 }).then(r => JSON.parse(r.stdout).items).catch(() => []),
      ]);
      prsText = p; items = t;
    }
    const input = { day, prsText, items, threads: nowThreads(nowText, day) };
    console.log(argv.includes('--json') ? JSON.stringify(briefData(input)) : renderBrief(input));
  } else if (argv[0] === 'report') {
    const jf = path.join(OPS, 'journal', `${day}.md`);
    const journal = fs.existsSync(jf) ? fs.readFileSync(jf, 'utf8').split(/\r?\n/).filter(l => l.startsWith('- ')) : [];
    const chats = claudeChatsOn(arg('--claude-root') ?? path.join(os.homedir(), '.claude', 'projects'), day);
    const dd = `${day.slice(8)}/${day.slice(5, 7)}`;
    // chats.mjs lists by LAST activity: look back from today to the asked day (a chat continued later is missed: said in the report)
    const back = Math.max(1, Math.ceil((Date.now() - Date.parse(`${day}T00:00:00Z`)) / 864e5) + 1);
    const cursor = offline ? [] : (node('harness/cursor/chats.mjs', ['list', '--days', String(back)]).stdout || '').split('\n').filter(l => l.startsWith('- ') && l.includes(` ${dd}, `));
    let dv = null;
    if (!offline) { try { dv = await devopsDay(day); } catch { dv = null; } }
    // a wide window, then the exact Rome day per commit (CET/CEST and a wrong PC clock both handled)
    const log = spawnSync('git', ['-C', OPS, 'log', `--since=${day}T00:00:00Z`, '--format=%cI %s'], { encoding: 'utf8' }).stdout || '';
    const commits = [...new Set(log.split('\n').map(l => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)])
      .filter(([d, s]) => d && romeDay(d) === day && s && !s.startsWith('auto:') && !/^(Merge |merge main)/.test(s)).map(([, s]) => s))].slice(0, 15).map(s => clip(s, 140));
    const input = { day, journal, chats, cursor, dv, commits, brief: fs.existsSync(path.join(OPS, 'journal', 'brief', `${day}.md`)) };
    console.log(argv.includes('--json') ? JSON.stringify(reportData(input)) : renderReport(input));
  } else {
    console.log('usage: node ops/tools/day.mjs brief | report [--date AAAA-MM-GG] [--offline]');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
