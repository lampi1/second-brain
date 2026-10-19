// mem: the one way to write {{BRAIN_NAME}} shared memory (now.md, ai-errors.md, journal, ideas) from ANY chat, worktrees included.
// Always writes the MAIN checkout ({{BRAIN}}), never the caller's worktree; the Stop hook commits.
// Checks before writing (reject = exit 1, nothing written): control characters (Bash-collapsed backslashes), now.md
// lines over 250 chars (says by how much), a match that is not exactly one line, an identical line already present.
// Times and dates are Europe/Rome (the PC timezone may be wrong). A lock file serialises parallel chats.
// now.md is written ONLY here: the hook brain-limits refuses Edit/Write of its lines ({{OWNER}}, 2026-10-10).
// Usage (text from --text, or --file <path> written with the Write tool when it has backslashes):
//   node "{{BRAIN}}/ops/tools/mem.mjs" now me --label "<chat label>" --text "<where · state · next>"
//        (your own line: replaced, or added under "Agenti e sessioni attive" / --section; date added; --del removes it)
//   node "{{BRAIN}}/ops/tools/mem.mjs" now set --match "<words of that line>" --text "<line>"
//   node .../mem.mjs now add --section "<words of the ## heading>" --text "<line>"
//   node .../mem.mjs now del --match "<words of that line>"          (thread closed)
//   node .../mem.mjs now show [--label "<chat label>" | --match "<words>"] [--section "<words>"] [--days N]
//        READ-ONLY: only the now.md lines asked for (your own line, a thread, a section, the lines dated in the last N
//        days), with their line numbers, instead of reading the whole file (~9k tokens re-read by every later step;
//        2026-10-13: 475 now.md reads a week)
//   node .../mem.mjs error --text "<line in ai-errors.md format>" [--agent <type>] [--work wi:<id>|branch:<repo>/<b>] [--run r_<id>]
//        (prints earlier lines with the same type + area; --agent = a sub-agent of that chat made the error: adds
//        " · agente: <type>", which settles that sub-agent's routing outcome, improve/routing-outcomes.mjs; adds
//        " · lavoro: <key>", the work the error fails as a whole (improve/work-keys.mjs: --work, else the key of the
//        app chat whose title the line names; none found = no field, matched later by that title); adds " · run: <id>",
//        the agent run the error belongs to (--run, else the run of that app chat): the app's agent metrics count it)
//   node .../mem.mjs journal --text "<tag · text>"                   (adds "- HH:MM · " and today's file)
//   node .../mem.mjs idea --area lavoro|personale --title "<title>" --file <md: Idea / Come / Perché / Fonte lines>
//        [--per second-brain|owner|ia]   (required when Fonte starts with "IA": what the AI's idea improves; an
//        idea of the AI also needs "- **Notato:**", and may add "- **Penso:**", "- **Sicurezza:** alta|media|bassa", "- **Non so:**")
//   node .../mem.mjs riflessione --chat "<chat>" --title "<sentence>" --file <md: Notato / Penso / Sicurezza / Non so>
//        (ai-reflections.md: the AI's reasoning about itself and the work with {{OWNER}}; one per chat per day)
//        (on top of ideas.md, state `aperta`; refuses an almost equal open title and a 2nd idea of the same chat today)
//   add --dry to print the result without writing; --root <dir> only for tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { eventContext, originField } from './event-origin.mjs';
import { brainRoot } from './brain-root.mjs';
// Automatic work attribution belongs to the optional improve analytics package; ordinary memory never requires it.
const analyticsFile = pathToFileURL(path.join(brainRoot(import.meta.url), 'ops', 'improve', 'work-keys.mjs'));
const analytics = fs.existsSync(analyticsFile) ? await import(analyticsFile.href) : null;

const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const ROOT = arg('--root') ?? '{{BRAIN}}';
const DRY = argv.includes('--dry');
const NOW_MAX = 250;
const fail = msg => { throw new Error(msg); }; // caught in main(): the lock is always released
const rome = o => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', ...o }).format(new Date());
const today = rome({ year: 'numeric', month: '2-digit', day: '2-digit' });
const hhmm = rome({ hour: '2-digit', minute: '2-digit' });
const words = s => (s || '').toLowerCase().split(/\s+/).filter(Boolean);
const hasAll = (line, ws) => ws.every(w => line.toLowerCase().includes(w));
const bullet = s => (s.startsWith('- ') ? s : `- ${s}`);

// Lock: one writer at a time across chats; a lock older than 30 s is stale.
const LOCK = path.join(os.tmpdir(), '{{BRAIN_NAME}}-mem.lock');
const lock = () => {
  for (let i = 0; i < 100; i++) {
    try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return; } catch {
      try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 30000) fs.unlinkSync(LOCK); } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  fail('memory is locked by another chat for > 10 s; retry');
};
const unlock = () => { try { fs.unlinkSync(LOCK); } catch {} };

const edit = (rel, change) => {
  const file = path.join(ROOT, rel);
  lock();
  try {
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const eol = before.includes('\r\n') ? '\r\n' : '\n';
    const lines = before.replace(/\r\n/g, '\n').split('\n');
    const msg = change(lines);
    const after = lines.join('\n').replace(/\n/g, eol);
    if (DRY) return console.log(`(dry) ${rel}: ${msg}`);
    if (after !== before) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, after); } // journal/ appears on first use
    console.log(`${rel} (main checkout): ${msg}`);
  } finally { unlock(); }
};

// The chat's own line, found by its label (`- **<label>**`): replaced, added under --section (default the hub's live
// list) when missing, removed with --del. The label is prefixed and today's date appended when the text lacks them.
const meCmd = (lines, text) => {
  const label = (arg('--label') || '').replace(/^\*\*|\*\*$/g, '').trim();
  if (!label) fail('now me: --label "<the chat label, e.g. OS · Tool>" is required');
  const head = `- **${label}**`;
  const mine = lines.map((l, i) => [l, i]).filter(([l]) => l.startsWith(head));
  if (mine.length > 1) fail(`label "${label}" is on ${mine.length} lines (${mine.map(([, i]) => i + 1).join(', ')}): merge them with set/del`);
  if (argv.includes('--del')) {
    if (!mine.length) return `no line for "${label}", nothing removed`;
    lines.splice(mine[0][1], 1);
    return `removed line ${mine[0][1] + 1}`;
  }
  if (text === undefined) fail('--text or --file is required');
  let body = text.replace(/^- /, '');
  if (!body.startsWith(`**${label}**`)) body = `**${label}** · ${body}`;
  if (!/\(\d{4}-\d{2}-\d{2}\)\s*$/.test(body)) body += ` · (${today})`;
  const line = bullet(body);
  if (line.length > NOW_MAX) fail(`now.md line is ${line.length} chars, ${line.length - NOW_MAX} over the ${NOW_MAX} limit: shorten it (details go to the file it points to)`);
  if (mine.length) {
    if (lines[mine[0][1]] === line) return 'identical line already present, nothing written';
    lines[mine[0][1]] = line;
    return `replaced line ${mine[0][1] + 1}`;
  }
  // a fresh brain has no now.md (ADR 0072): the first line creates it with the default section only
  if (lines.length === 1 && lines[0] === '' && !arg('--section')) lines.splice(0, 1, '# Now: open threads', '', '## Agenti e sessioni attive', '');
  const ws = words(arg('--section') ?? 'Agenti e sessioni attive');
  const heads = lines.map((l, i) => [l, i]).filter(([l]) => /^##\s/.test(l) && hasAll(l, ws));
  if (heads.length !== 1) fail(`--section must match exactly one "## " heading, matches ${heads.length}: ${lines.filter(l => /^##\s/.test(l)).join(' | ')}`);
  let end = heads[0][1] + 1;
  while (end < lines.length && !/^##?\s/.test(lines[end])) end++;
  while (end > heads[0][1] + 1 && lines[end - 1].trim() === '') end--;
  lines.splice(end, 0, line);
  return `added at line ${end + 1}`;
};

// now show: a read, so no lock and no write. Filters add up (AND); none = the "Agenti e sessioni attive" section.
export function nowShow(md, { label, match, section, days, now = Date.now() } = {}) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let sec = '';
  const dates = days ? Array.from({ length: Number(days) }, (_, i) => {
    const t = new Date(now - i * 864e5);
    const f = o => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', ...o }).format(t);
    return [f({ year: 'numeric', month: '2-digit', day: '2-digit' }), f({ day: '2-digit', month: '2-digit' }).split('-').reverse().join('/')];
  }).flat() : null;
  const secWs = words(section ?? (label || match || days ? '' : 'Agenti e sessioni attive'));
  const out = [];
  lines.forEach((l, i) => {
    if (/^##\s/.test(l)) { sec = l; return; }
    if (!l.startsWith('- ')) return;
    if (secWs.length && !hasAll(sec, secWs)) return;
    if (label && !l.startsWith(`- **${label.replace(/^\*\*|\*\*$/g, '').trim()}**`)) return;
    if (match && !hasAll(l, words(match))) return;
    if (dates && !dates.some(d => l.includes(d))) return;
    out.push(`${i + 1}: ${l}`);
  });
  return out;
}

const nowCmd = (sub, text) => {
  if (sub === 'show') {
    const md = fs.existsSync(path.join(ROOT, 'now.md')) ? fs.readFileSync(path.join(ROOT, 'now.md'), 'utf8') : '';
    const out = nowShow(md, { label: arg('--label'), match: arg('--match'), section: arg('--section'), days: arg('--days') });
    return console.log(out.length ? out.join('\n') : 'now.md: nessuna riga per questi filtri');
  }
  const one = (lines, m) => {
    const ws = words(m);
    if (!ws.length) fail('--match "<words>" is required');
    const hits = lines.map((l, i) => [l, i]).filter(([l]) => l.startsWith('- ') && hasAll(l, ws));
    if (hits.length !== 1) fail(`--match must hit exactly one line, hits ${hits.length}${hits.length ? ':\n' + hits.map(([l, i]) => `  ${i + 1}: ${l.slice(0, 120)}`).join('\n') : ''}`);
    return hits[0][1];
  };
  edit('now.md', lines => {
    if (sub === 'me') return meCmd(lines, text);
    if (sub === 'del') { const i = one(lines, arg('--match')); const [l] = lines.splice(i, 1); return `removed line ${i + 1}: ${l.slice(0, 80)}`; }
    if (sub !== 'set' && sub !== 'add') fail('now: use me | set | add | del');
    if (text === undefined) fail('--text or --file is required');
    const line = bullet(text);
    if (line.length > NOW_MAX) fail(`now.md line is ${line.length} chars, ${line.length - NOW_MAX} over the ${NOW_MAX} limit: shorten it (details go to the file it points to)`);
    if (lines.includes(line)) return 'identical line already present, nothing written';
    if (sub === 'set') { const i = one(lines, arg('--match')); lines[i] = line; return `replaced line ${i + 1}`; }
    const ws = words(arg('--section'));
    const heads = lines.map((l, i) => [l, i]).filter(([l]) => /^##\s/.test(l) && hasAll(l, ws));
    if (!ws.length || heads.length !== 1) fail(`--section must match exactly one "## " heading, matches ${heads.length}: ${lines.filter(l => /^##\s/.test(l)).join(' | ')}`);
    let end = heads[0][1] + 1;
    while (end < lines.length && !/^##?\s/.test(lines[end])) end++;
    while (end > heads[0][1] + 1 && lines[end - 1].trim() === '') end--;
    lines.splice(end, 0, line);
    return `added at line ${end + 1}`;
  });
};

export const WORK_KEY = /^(wi:\d{4,7}|branch:[\w.-]+\/[\w./-]+|chat:[\w:.-]+)$/;
export const RUN_ID = /^r_[a-f0-9]{12}$/;
const APP_DIR = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'second-brain');
/** The app chats (the stable app's chats.json, or `appDir`) and the one a line names, or null. `rest` = the line after
 *  its time: titles contain " · " themselves, so the chat is the longest title the line starts with. */
function chatOfLine(rest, appDir) {
  let chats = [];
  try { chats = JSON.parse(fs.readFileSync(path.join(appDir, 'chats.json'), 'utf8')).chats ?? []; } catch { return null; }
  if (!Array.isArray(chats)) return null;
  // the longest title, then the newest chat with it (a title is reused after a chat is closed)
  const c = chats.filter(x => x && typeof x.title === 'string' && x.title && rest.startsWith(`${x.title} · `))
    .sort((a, b) => b.title.length - a.title.length || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))[0];
  return c ? { c, chats } : null;
}
/** The work key of the app chat a line names, or null. */
export function workOfLine(rest, { appDir = APP_DIR, state = path.join(ROOT, 'ops', 'state', 'improve') } = {}) {
  if (!analytics) return null;
  const hit = chatOfLine(rest, appDir);
  // its hand-off chain too: the chain is one work, keyed by the first key found along it
  return hit ? analytics.workKeys(analytics.chainOf(hit.c, hit.chats), { state }).get(hit.c.id) ?? null : null;
}
/** The agent run of the app chat a line names (its latest, open or ended), or null: a chat not started from an agent has none. */
export function runOfLine(rest, { appDir = APP_DIR } = {}) {
  const id = chatOfLine(rest, appDir)?.c.run?.runId;
  return typeof id === 'string' && RUN_ID.test(id) ? id : null;
}

const errorCmd = (text, agent, work, run) => {
  if (text === undefined) fail('--text or --file is required');
  if (agent !== undefined && !/^[\w-]{1,40}$/.test(agent)) fail('--agent: the sub-agent type (general-purpose, Explore…)');
  if (agent !== undefined && / · agente: /.test(text)) fail('--agent given and the text already has "· agente:"');
  if (work !== undefined && !WORK_KEY.test(work)) fail('--work: wi:<id>, branch:<repo>/<branch> or chat:<id>');
  if (/ · lavoro: /.test(text)) fail('the text already has "· lavoro:": pass it with --work');
  if (run !== undefined && !RUN_ID.test(run)) fail('--run: the agent run id, r_ and 12 hex digits');
  if (/ · run: /.test(text)) fail('the text already has "· run:": pass it with --run');
  const f = bullet(text).slice(2).split(' · ');
  if (f.length < 6) fail('not in ai-errors.md format: "AAAA-MM-GG HH:MM · chat · area · tipo · detto: … · vero: … · visto da: …"');
  // the whole work fails, not only this chat (2026-10-14, "il voto va al lavoro intero"): its key, when known
  let key = work ?? null;
  const app = arg('--app') ? { appDir: arg('--app') } : {};
  if (!key) try { key = workOfLine(f.slice(1).join(' · '), app); } catch { key = null; }
  // the agent run it belongs to (AGENTS-DESIGN §5: the app counts the lines Brother saw per run, as a secondary column)
  let runId = run ?? null;
  if (!runId) try { runId = runOfLine(f.slice(1).join(' · '), app); } catch { runId = null; }
  const context = eventContext();
  const line = bullet(text) + (agent ? ` · agente: ${agent}` : '') + (key ? ` · lavoro: ${key}` : '') + (runId ? ` · run: ${runId}` : '') +
    (context.origin ? ` · reporter-origin: ${originField(context.origin)}` : '') +
    (context.responsibleEpisode ? ` · responsible-episode: ${originField(context.responsibleEpisode)}` : '');
  const [, , area, type] = f;
  const sig = words(area).filter(w => w.length >= 4);
  edit('ai-errors.md', lines => {
    if (lines.includes(line)) return 'identical line already present, nothing written';
    const same = lines.filter(l => l.startsWith('- ') && l.split(' · ')[3] === type
      && sig.some(w => (l.split(' · ')[2] || '').toLowerCase().includes(w)));
    const month = `## ${today.slice(0, 7)}`;
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if ([...lines].reverse().find(l => /^## \d{4}-\d{2}/.test(l)) !== month) lines.push('', month);
    lines.push(line, '');
    if (!same.length) return 'appended';
    return `appended. SECONDA VOLTA (stesso tipo "${type}", stessa area): manda all’Orchestrator una proposta di regola ` +
      `(file + testo esatto, brain-rules.md):\n${same.map(l => '  ' + l.slice(0, 200)).join('\n')}`;
  });
};

const journalCmd = text => {
  if (text === undefined) fail('--text or --file is required');
  const day = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'][new Date(`${today}T12:00:00Z`).getUTCDay()];
  const line = /^- \d{2}:\d{2} · /.test(text) ? text : `- ${hhmm} · ${text.replace(/^- /, '')}`;
  edit(`journal/${today}.md`, lines => {
    if (lines.length === 1 && lines[0] === '') lines.splice(0, 1, `# ${today} (${day})`, '');
    if (lines.includes(line)) return 'identical line already present, nothing written';
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push(line, '');
    return 'appended';
  });
};

// An idea, on top of ideas.md (newest first, under the template). The body (--file, several lines) holds the fields
// "- **Idea:** …", "- **Come:** …", "- **Perché:** …", "- **Fonte:** IA · <chat> · <what made it>" (the format
// of the brain-edit skill, 2026-10-10). Refused: a title almost equal to an idea still open (shown), a second idea of the same chat today.
// Italian function words never make two titles "the same" ("Account Azure per QA" is not "Account Reader per Azure").
const STOP = new Set('per con che dei del dell della delle degli dal dalla nel nella nei tra fra una uno gli le lo la il di da in su al alla alle agli non piu come sul sulla'.split(' '));
const sigWords = s => new Set(words(String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, ' ')).filter(w => w.length >= 3 && !STOP.has(w)));
const similar = (a, b) => {
  const x = sigWords(a), y = sigWords(b);
  if (!x.size || !y.size) return false;
  const common = [...x].filter(w => y.has(w)).length;
  return common >= Math.min(2, x.size, y.size) && common / Math.min(x.size, y.size) >= 0.7;
};
const ideaCmd = body => {
  const area = arg('--area'), title = (arg('--title') || '').trim();
  if (!['lavoro', 'personale'].includes(area)) fail('idea: --area lavoro|personale is required');
  if (!title || title.includes(' · ') || title.includes('`')) fail('idea: --title "<short title>" is required (no " · " or backticks)');
  if (body === undefined) fail('idea: --file <md with the Idea / Come / Perché / Fonte lines> is required');
  const lines = body.replace(/\r\n/g, '\n').trim().split('\n');
  const field = k => lines.find(l => new RegExp(`^- \\*\\*${k}:\\*\\*`, 'i').test(l));
  for (const k of ['Idea', 'Fonte']) if (!field(k)) fail(`idea: the "- **${k}:** …" line is missing`);
  // "IA · <chat> · <reason>": chat titles hold " · " themselves ("OS · Tool"), so the chat is everything between the
  // first field and the last one
  // an idea of the AI says what it improves ({{OWNER}} 2026-10-11: second-brain, {{OWNER}}'s way of working, the AI itself)
  const per = arg('--per');
  const fromAI = /^- \*\*Fonte:\*\*\s*IA\b/i.test(field('Fonte') ?? '');
  if (fromAI && !['second-brain', 'owner', 'ia'].includes(per)) fail('idea: an idea of the AI needs --per second-brain|owner|ia');
  if (per && !['second-brain', 'owner', 'ia'].includes(per)) fail('idea: --per is second-brain, owner or ia');
  // the AI's reasoning, not only its conclusion ({{OWNER}} 2026-10-11): Notato / Penso / Sicurezza / Non so
  const sure = field('Sicurezza');
  if (sure && !/^- \*\*Sicurezza:\*\*\s*(alta|media|bassa)\b/i.test(sure)) fail('idea: "- **Sicurezza:**" is alta, media or bassa');
  if (fromAI && !field('Notato')) fail('idea: an idea of the AI needs "- **Notato:** …" (what was noticed, with the data)');
  if (per && !field('Per')) lines.splice(lines.findIndex(l => /^- \*\*Fonte:\*\*/i.test(l)), 0, `- **Per:** ${per}`);
  const chatOf = fonte => { const p = (fonte || '').replace(/^- \*\*Fonte:\*\*\s*/i, '').split(' · ').map(x => x.trim()); return p.length >= 3 ? p.slice(1, -1).join(' · ').toLowerCase() : ''; };
  const chat = chatOf(field('Fonte'));
  const origin = eventContext().origin;
  // Source text identifies human vs AI only; it cannot supply an AI model or identify its session.
  if (origin && (fromAI ? origin.kind === 'model' : origin.kind === 'human')) {
    lines.push(`- **Event origin:** ${originField(origin)}`);
  }
  edit('ideas.md', file => {
    const entries = [];
    file.forEach((l, i) => { const h = l.match(/^## (\d{4}-\d{2}-\d{2}) · \[(\w+)\] · (.+?) · `([^`]+)`\s*$/); if (h) entries.push({ i, date: h[1], title: h[3], state: h[4] }); });
    for (const e of entries) {
      let j = e.i + 1; while (j < file.length && !/^## /.test(file[j])) j++;
      e.fonte = file.slice(e.i + 1, j).find(l => /^- \*\*Fonte:\*\*/i.test(l));
    }
    const dup = entries.find(e => /aperta|in corso/.test(e.state) && similar(e.title, title));
    if (dup) fail(`an open idea with an almost equal title exists, update it instead: "## ${dup.date} · … · ${dup.title} · \`${dup.state}\`" (line ${dup.i + 1})`);
    if (chat && entries.some(e => e.date === today && chatOf(e.fonte) === chat)) fail(`this chat ("${chat}") already wrote an idea today: one a day per chat`);
    const at = entries.length ? entries[0].i : file.length;
    file.splice(at, 0, `## ${today} · [${area}] · ${title} · \`aperta\``, ...lines, '');
    return `added at line ${at + 1}`;
  });
};

// A reflection of the AI on itself and on the work with {{OWNER}} (ai-reflections.md, newest first): written by a chat
// at the end of a job only when it has something true to say; never announced, never on a schedule, never invented.
// Body (--file): "- **Notato:**" (with the data or the episode), "- **Penso:**", "- **Sicurezza:** alta|media|bassa",
// "- **Non so:**" (what it cannot know or may get wrong). One per chat per day.
const reflectionCmd = body => {
  const title = (arg('--title') || '').trim(), chat = (arg('--chat') || '').trim();
  if (!title || title.includes(' · ') || !chat) fail('riflessione: --title "<one strong sentence>" and --chat "<chat label>" are required');
  if (body === undefined) fail('riflessione: --file <md with Notato / Penso / Sicurezza / Non so> is required');
  const lines = body.replace(/\r\n/g, '\n').trim().split('\n');
  for (const k of ['Notato', 'Penso', 'Sicurezza', 'Non so']) if (!lines.some(l => new RegExp(`^- \\*\\*${k}:\\*\\*`, 'i').test(l))) fail(`riflessione: the "- **${k}:** …" line is missing`);
  if (!lines.some(l => /^- \*\*Sicurezza:\*\*\s*(alta|media|bassa)\b/i.test(l))) fail('riflessione: "- **Sicurezza:**" is alta, media or bassa');
  edit('ai-reflections.md', file => {
    if (file.length === 1 && file[0] === '') file.splice(0, 1, ...REFLECTIONS_HEAD);
    const heads = file.map((l, i) => [/^## \d{4}-\d{2}-\d{2} · /.test(l) ? l : null, i]).filter(([m]) => m);
    // chat labels hold " · " themselves ("OS · Tool"): compare the whole prefix
    if (heads.some(([l]) => l.toLowerCase().startsWith(`## ${today} · ${chat.toLowerCase()} · `))) fail(`this chat ("${chat}") already wrote a reflection today: one a day per chat`);
    const at = heads.length ? heads[0][1] : file.length;
    file.splice(at, 0, `## ${today} · ${chat} · ${title}`, ...lines, '');
    return `added at line ${at + 1}`;
  });
};
const REFLECTIONS_HEAD = [
  '# Riflessioni dell\'IA', '',
  'Il ragionamento dell\'IA su se stessa e sul lavoro con {{OWNER}}, con i suoi dubbi ({{OWNER}}, 2026-10-11): errori che',
  'tornano, dove si è sentita incerta, cosa ha imparato dalle correzioni.',
  '- **Read when:** second-brain (sezione Spunti dell\'IA), una revisione, "come sta andando l\'IA?".',
  '- **Write when:** una chat, a fine lavoro, ha qualcosa di vero da dire su di sé: solo con',
  '  `node "{{BRAIN}}/ops/tools/mem.mjs" riflessione --chat "<chat>" --title "<frase>" --file <md>`;',
  '  mai annunciata, mai a orario, mai inventata; al massimo una al giorno per chat. Più recenti in alto.', '',
];

const main = () => {
  if (argv[0] === 'riflessione') {
    const body = arg('--file') ? fs.readFileSync(arg('--file'), 'utf8') : undefined;
    if (body !== undefined && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body)) fail('control character in the text (a backslash collapsed by Bash?): write it with Write and pass --file');
    return reflectionCmd(body);
  }
  if (argv[0] === 'idea') {
    const body = arg('--file') ? fs.readFileSync(arg('--file'), 'utf8') : undefined;
    if (body !== undefined && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body)) fail('control character in the text (a backslash collapsed by Bash?): write it with Write and pass --file');
    return ideaCmd(body);
  }
  let text = arg('--file') ? fs.readFileSync(arg('--file'), 'utf8') : arg('--text');
  if (text !== undefined) {
    text = text.replace(/\r?\n$/, '');
    if (/[\x00-\x08\x0b-\x1f]/.test(text)) fail('control character in the text (a backslash collapsed by Bash?): write it to a file with Write and pass --file');
    if (text.includes('\n')) fail('one line only');
  }
  const [cmd, sub] = argv;
  if (cmd === 'now') return nowCmd(sub, text);
  // --agent needs its type: a forgotten one would write an untagged line and the sub-agent would close as a success
  if (cmd === 'error' && argv.includes('--agent') && !/^[^-]/.test(arg('--agent') ?? '')) fail('--agent needs the sub-agent type (general-purpose, Explore…)');
  if (cmd === 'error' && argv.includes('--work') && !/^[^-]/.test(arg('--work') ?? '')) fail('--work needs its key (wi:<id>, branch:<repo>/<branch>)');
  if (cmd === 'error' && argv.includes('--run') && !/^[^-]/.test(arg('--run') ?? '')) fail('--run needs the agent run id (r_…)');
  if (cmd === 'error') return errorCmd(text, arg('--agent'), arg('--work'), arg('--run'));
  if (cmd === 'journal') return journalCmd(text);
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
  console.log(src.slice(0, src.indexOf('import ')).trim());
  if (cmd) process.exitCode = 1;
};
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) try { main(); } catch (e) { console.error(`mem: ${e.message}`); process.exit(1); }
