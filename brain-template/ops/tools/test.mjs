// Offline tests of the ops/tools scripts that need no network: cost.mjs, mem.mjs (now me), chat-prompt.mjs, day.mjs,
// wt-land.mjs, inbox.mjs (its own inbox.test.mjs), recurrence.mjs, brain-site + brain-map (brain-site.test.mjs), the improve loop (ops/improve/lib.test.mjs). Fixtures in a temp folder, never the real transcripts or memory. Usage: node ops/tools/test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan, summarize, advice, kind, usdOf } from './cost.mjs';
import { priceUsage, modelRow } from './prices.mjs';
import { buildPrompt, checkTitle, findFirstPrompts, sameLabel, promptLink, openInCursor, LINK_MAX } from './chat-prompt.mjs';
import { areaOf, nowThreads, claudeChatsOn, renderBrief, renderReport, romeDay } from './day.mjs';
import { land, status } from './wt-land.mjs';
import { parse as parseErrors, recurrence, render as renderRecurrence } from './recurrence.mjs';
import { apply as applyHooks } from './install-inbox-hooks.mjs';
import { parse as pbParse, op as pbOp, render as pbRender } from './playbook.mjs';
import { mdToHtml, asciiOnly, cfHtml, inline } from './clip-html.mjs';
import { pack as ctxPack, gitState, refsOf, MAX as CTX_MAX } from './ctx.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-tools-'));
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const jsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n')); };
const run = (script, args) => spawnSync(process.execPath, [path.join(here, script), ...args], { encoding: 'utf8', timeout: 60000 });
let n = 0;
const T = (name, fn) => { n++; try { fn(); } catch (e) { fails.push(`${name}: ${e.stack}`); } };

// ---------- cost.mjs
const today = romeDay(Date.now());
const ts = `${today}T10:00:00.000Z`;
const SID = '11111111-2222-3333-4444-555555555555';
const proj = path.join(tmp, 'claude', 'C--x-{{BRAIN_NAME}}');
const u = (cr, out = 100) => ({ input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: cr, output_tokens: out });
jsonl(path.join(proj, `${SID}.jsonl`), [
  { type: 'custom-title', customTitle: 'A · Prova' },
  { type: 'user', timestamp: ts, cwd: 'C:/x', message: { content: 'fai la prova' } },
  // one API response split over two lines with the same id: usage counted once, the tool call kept
  { type: 'assistant', timestamp: ts, message: { id: 'm1', model: 'claude-opus-5-5', usage: u(500000), content: [{ type: 'text', text: 'ok' }] } },
  { type: 'assistant', timestamp: ts, message: { id: 'm1', model: 'claude-opus-5-5', usage: u(500000), content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'C:\\x\\{{BRAIN_NAME}}\\now.md' } }] } },
  { type: 'assistant', timestamp: ts, message: { id: 'm2', model: 'claude-opus-5-5', usage: { ...u(1000), output_tokens: 10 }, content: [{ type: 'text', text: 'partial usage first' }] } },
  { type: 'assistant', timestamp: ts, message: { id: 'm2', model: 'claude-opus-5-5', usage: u(1000), content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'cd /c/x && grep -n foo bar.md' } }] } },
  // Claude Code rewrote the same line later: the tool call counts once
  { type: 'assistant', timestamp: ts, message: { id: 'm2', model: 'claude-opus-5-5', usage: u(1000), content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'cd /c/x && grep -n foo bar.md' } }] } },
]);
jsonl(path.join(proj, SID, 'subagents', 'agent-a.jsonl'), [
  { type: 'assistant', timestamp: ts, message: { id: 's1', model: 'claude-sonnet-5-5', usage: u(2000), content: [{ type: 'tool_use', name: 'mcp__Claude_Browser__navigate', input: {} }] } },
]);
T('cost', () => {
  const s = scan(path.join(tmp, 'claude'), Date.now() - 3 * 864e5, Date.now() + 864e5);
  ok(s.msgs.length === 3, `cost: 3 API responses expected (split one counted once), got ${s.msgs.length}`);
  ok(s.chats.size === 1, `cost: the subagent must count under its parent chat, chats ${s.chats.size}`);
  const S = summarize(s, [{ at: Date.parse(ts), model: 'grok', cost: 1.5 }], 4000);
  const want = usdOf(u(500000), 'claude-opus-5-5') + usdOf(u(1000), 'claude-opus-5-5') + usdOf(u(2000), 'claude-sonnet-5-5');
  ok(Math.abs(S.total - want) < 1e-9, `cost: total ${S.total} != ${want}`);
  ok(S.calls === 3, `cost: 3 tool calls expected, got ${S.calls}`);
  ok(S.byKind['memoria (now, errori, diario)']?.calls === 1 && S.byKind.leggere?.calls === 1 && S.byKind.browser?.calls === 1, `cost: kinds wrong ${JSON.stringify(S.byKind)}`);
  ok(S.byArea.A && Object.values(S.chats)[0].title === 'A · Prova', 'cost: area/title from custom-title');
  ok(S.longSave > 0 && advice(S)[0].text.startsWith('Chat lunghe'), `cost: a 500k-context call must give the long-chat advice first: ${JSON.stringify(advice(S))}`);
  ok(S.cursor.total === 1.5, 'cost: Cursor rows summed');
  ok(!S.unpriced.length, `cost: every model priced: ${S.unpriced}`);
  ok(kind('Bash', { command: 'node C:/x/ops/tools/mem.mjs now me --label a' }) === 'memoria (now, errori, diario)', 'cost: mem.mjs is memory');
  ok(kind('Bash', { command: 'cd {{BRAIN}} && git merge --no-edit x' }) === 'worktree → main', 'cost: {{BRAIN_NAME}} merge');
  const cli = run('cost.mjs', ['--root', path.join(tmp, 'claude'), '--state', path.join(tmp, 'none.json'), '--no-cursor', '--days', '2']);
  ok(cli.status === 0 && /Costi del cervello/.test(cli.stdout) && /A · Prova/.test(cli.stdout) , `cost CLI:\n${cli.stdout}${cli.stderr}`);
  // Cursor CSV freshness: download time (file mtime) and newest row, in text and JSON
  const csv = path.join(tmp, 'cursor.csv');
  fs.writeFileSync(csv, `Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n"${today}T08:00:00.000Z","grok",1,1,1,1,4,0.5\n"${today}T09:30:00.000Z","grok",1,1,1,1,4,0.25\n`);
  fs.utimesSync(csv, new Date(`${today}T10:00:00Z`), new Date(`${today}T10:00:00Z`));
  const base = ['--root', path.join(tmp, 'claude'), '--state', path.join(tmp, 'none.json'), '--cursor', csv, '--days', '2'];
  const txt = run('cost.mjs', base), js = run('cost.mjs', [...base, '--json']);
  ok(/scaricato il \d{2}\/\d{2}, \d{2}:\d{2}, ultima riga del \d{2}\/\d{2}, \d{2}:\d{2}/.test(txt.stdout), `cost: Cursor CSV dates in the text:\n${txt.stdout}${txt.stderr}`);
  const cj = JSON.parse(js.stdout || '{}').cursor ?? {};
  ok(cj.downloaded === `${today}T10:00:00.000Z` && cj.lastRow?.startsWith(`${today}T09:30`) && cj.file === 'cursor.csv', `cost: Cursor CSV dates in the JSON: ${JSON.stringify(cj)}`);
});

// ---------- prices.mjs (harness/models.json, list prices read 2026-10-13)
T('prices', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const M = 1e6;
  // Opus 5.5: input 4, 1h cache write 8, 5m write 5, cache read 0.2, output 20 $/M
  const o = priceUsage({ input_tokens: M, cache_creation_input_tokens: 2 * M, cache_creation: { ephemeral_1h_input_tokens: M, ephemeral_5m_input_tokens: M }, cache_read_input_tokens: M, output_tokens: M }, 'claude-opus-5-5');
  ok(o.priced && near(o.usd, 4 + 8 + 5 + 0.2 + 20), `prices: Opus 5.5 ${o.usd}`);
  // no cache_creation split: the whole write at the 5-minute price
  ok(near(usdOf({ cache_creation_input_tokens: M }, 'claude-opus-5-5'), 5), 'prices: write without split = 5m');
  ok(near(usdOf({ input_tokens: M, output_tokens: M, cache_read_input_tokens: M }, 'claude-fable-5-1'), 10 + 50 + 0.25), 'prices: Fable 5.1');
  ok(near(usdOf({ cache_read_input_tokens: M }, 'claude-sonnet-5-5'), 0.1) && near(usdOf({ cache_read_input_tokens: M }, 'claude-sonnet-5'), 0.2), 'prices: Sonnet 5.5 vs 5 cache read');
  ok(near(usdOf({ input_tokens: M, output_tokens: M }, 'claude-opus-5'), 30), 'prices: Opus 5 (still in the transcripts)');
  // Haiku 5.5: up to 100k prompt tokens the low tier, over it the high tier (cache reads count in the prompt)
  ok(near(usdOf({ input_tokens: 50000, output_tokens: 1000 }, 'claude-haiku-5-5'), (50000 * 0.1 + 1000 * 0.5) / M), 'prices: Haiku 5.5 ≤100k');
  ok(near(usdOf({ input_tokens: 10, cache_read_input_tokens: 150000, output_tokens: 1000 }, 'claude-haiku-5-5'), (10 * 0.5 + 150000 * 0.05 + 1000 * 2.5) / M), 'prices: Haiku 5.5 >100k');
  ok(near(usdOf({ input_tokens: M }, 'claude-haiku-4-5-20251001'), 1) && modelRow('claude-opus-5-5[1m]').id === 'claude-opus-5-5' && modelRow('opus').id === 'claude-opus-5-5', 'prices: dated id, [1m], alias');
  ok(near(usdOf({ output_tokens: M, speed: 'fast' }, 'claude-opus-5-5'), 40), 'prices: fast mode Opus 5.5 = 40 $/M output');
  ok(near(usdOf({ input_tokens: M, inference_geo: 'us' }, 'claude-opus-5-5'), 4.4) && near(usdOf({ input_tokens: M, inference_geo: 'us' }, 'claude-haiku-4-5'), 1), 'prices: US inference ×1.1 (4.6+ only)');
  ok(near(usdOf({ server_tool_use: { web_search_requests: 3 } }, 'claude-opus-5-5'), 0.03), 'prices: web search 10 $ per 1000');
  const x = priceUsage({ input_tokens: M }, 'claude-future-9');
  ok(!x.priced && near(x.usd, 4), 'prices: unknown model = defaultModel, flagged unpriced');
});

// ---------- mem.mjs now me
const memRoot = path.join(tmp, 'mem');
fs.mkdirSync(memRoot);
const nowFile = path.join(memRoot, 'now.md');
fs.writeFileSync(nowFile, '# Now\n\n## Agenti e sessioni attive\n- **A · Altro** · x · (2026-10-01)\n\n## Personale\n- **Pers · Y** · y\n');
const mem = (...a) => run('mem.mjs', ['now', 'me', '--root', memRoot, ...a]);
T('mem error --agent', () => {
  fs.writeFileSync(path.join(memRoot, 'ai-errors.md'), '# Errori\n');
  const line = '2026-10-14 10:00 · Alfa · Fix · prod · fatto-non-verificato · detto: x · vero: y · visto da: {{OWNER}}';
  const r = run('mem.mjs', ['error', '--root', memRoot, '--text', line, '--agent', 'reviewer']);
  ok(r.status === 0 && fs.readFileSync(path.join(memRoot, 'ai-errors.md'), 'utf8').includes(`- ${line} · agente: reviewer`), `--agent tags the line: ${r.stdout}${r.stderr}`);
  ok(run('mem.mjs', ['error', '--root', memRoot, '--text', line, '--agent', 'a b']).status === 1, '--agent: a type, no spaces');
  ok(run('mem.mjs', ['error', '--root', memRoot, '--text', line, '--agent']).status === 1, '--agent without its type refused');
  ok(run('mem.mjs', ['error', '--root', memRoot, '--agent', '--text', line]).status === 1, '--agent followed by another flag refused');
});
T('mem error: the work key (· lavoro:)', () => {
  fs.writeFileSync(path.join(memRoot, 'ai-errors.md'), '# Errori\n');
  const app = path.join(tmp, 'mem-app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'chats.json'), JSON.stringify({ chats: [{ id: 'c_1', title: 'Beta · bug 123456', createdAt: 1 }] }));
  const read = () => fs.readFileSync(path.join(memRoot, 'ai-errors.md'), 'utf8');
  const l1 = '2026-10-14 10:00 · Beta · bug 123456 · Fix · bug-non-trovato · detto: x · vero: y · visto da: {{OWNER}}';
  ok(run('mem.mjs', ['error', '--root', memRoot, '--app', app, '--text', l1]).status === 0 && read().includes(`- ${l1} · lavoro: wi:123456`), `the chat's work key is added: ${read()}`);
  const l2 = '2026-10-14 10:01 · Gamma · Fix · bug-non-trovato · detto: x · vero: y · visto da: QA';
  ok(run('mem.mjs', ['error', '--root', memRoot, '--app', app, '--text', l2, '--work', 'branch:repo/fix/x']).status === 0 && read().includes(`- ${l2} · lavoro: branch:repo/fix/x`), '--work names it');
  const l3 = '2026-10-14 10:02 · Delta · Fix · bug-non-trovato · detto: x · vero: y · visto da: QA';
  ok(run('mem.mjs', ['error', '--root', memRoot, '--app', app, '--text', l3]).status === 0 && read().includes(`- ${l3}\n`), 'no app chat with that title: no field');
  ok(run('mem.mjs', ['error', '--root', memRoot, '--app', app, '--text', l3, '--work', 'boh']).status === 1, 'a malformed --work is refused');
});

T('mem idea', () => {
  const ideas = path.join(memRoot, 'ideas.md');
  fs.writeFileSync(ideas, '# Idee\n\n<!-- Template\n## AAAA-MM-GG · [lavoro|personale] · Titolo · `aperta`\n-->\n\n## 2026-10-01 · [lavoro] · Account Reader per Azure · `aperta`\n- **Idea:** x\n');
  const body = (chat, idea = 'una cosa') => { const f = path.join(tmp, `idea-${chat}.md`); fs.writeFileSync(f, `- **Idea:** ${idea}\n- **Come:** due passi\n- **Perché:** risparmio\n- **Notato:** 3 errori uguali\n- **Sicurezza:** media\n- **Fonte:** IA · ${chat} · errore ripetuto\n`); return f; };
  // the AI's ideas need --per: added by default here, NOPER tests its absence
  const idea = (...a) => run('mem.mjs', ['idea', '--root', memRoot, ...(a.includes('--per') || a.includes('NOPER') ? [] : ['--per', 'ia']), ...a.filter(x => x !== 'NOPER')]);
  let r = idea('NOPER', '--area', 'personale', '--title', 'Mappa senza per', '--file', body('OS · Senzaper'));
  ok(r.status === 1 && /--per second-brain\|owner\|ia/.test(r.stderr), `mem idea: an idea of the AI without --per is refused: ${r.stderr}`);
  ok(idea('--area', 'personale', '--title', 'Mappa per sbagliato', '--per', 'tutto', '--file', body('OS · Perx')).status === 1, 'mem idea: --per value checked');
  r = idea('--area', 'personale', '--title', 'Mappa più leggera', '--per', 'second-brain', '--file', body('OS · Mappa'));
  let t = fs.readFileSync(ideas, 'utf8');
  ok(r.status === 0 && t.indexOf(`## ${today} · [personale] · Mappa più leggera · \`aperta\``) < t.indexOf('## 2026-10-01') && t.indexOf('-->') < t.indexOf(`## ${today}`), `mem idea: on top, under the template:\n${r.stderr}${t}`);
  ok(t.includes('- **Per:** second-brain\n- **Fonte:** IA · OS · Mappa · errore ripetuto'), `mem idea: body kept, Per line before Fonte:\n${t}`);
  r = idea('--area', 'personale', '--title', 'Altra idea diversa', '--file', body('OS · Mappa'));
  ok(r.status === 1 && /already wrote an idea today/.test(r.stderr), `mem idea: second idea of the same chat today refused: ${r.stderr}`);
  r = idea('--area', 'personale', '--title', 'Tool nuovo per i costi', '--file', body('OS · Tool'));
  ok(r.status === 0, `mem idea: another chat of the same area (OS · Tool after OS · Mappa) is allowed: ${r.stderr}`);
  r = idea('--area', 'lavoro', '--title', 'Account GitHub per la QA', '--file', body('A · Terza'));
  ok(r.status === 0, `mem idea: a short title sharing only "per" and one word is not a duplicate: ${r.stderr}`);
  fs.appendFileSync(ideas, '\n## 2026-10-02 · [lavoro] · Account per la QA · `aperta`\n- **Idea:** y\n');
  r = idea('--area', 'lavoro', '--title', 'Account per la QA', '--file', body('A · Quarta'));
  ok(r.status === 1 && /almost equal title/.test(r.stderr), `mem idea: an identical title with one meaningful word is still refused: ${r.stderr}`);
  r = idea('--area', 'lavoro', '--title', 'Account Reader per le letture Azure', '--file', body('A · Altro'));
  ok(r.status === 1 && /almost equal title/.test(r.stderr) && r.stderr.includes('Account Reader per Azure'), `mem idea: near-duplicate open title refused and shown: ${r.stderr}`);
  r = idea('--area', 'lavoro', '--title', 'Senza fonte', '--file', (() => { const f = path.join(tmp, 'nofonte.md'); fs.writeFileSync(f, '- **Idea:** x\n'); return f; })());
  ok(r.status === 1 && /Fonte/.test(r.stderr), 'mem idea: Fonte required');
  ok(idea('--area', 'altro', '--title', 'x', '--file', body('Z')).status === 1, 'mem idea: area checked');
  const noNotato = path.join(tmp, 'nonotato.md'); fs.writeFileSync(noNotato, '- **Idea:** x\n- **Fonte:** IA · OS · Nn · y\n');
  ok(idea('--area', 'personale', '--title', 'Senza notato', '--file', noNotato).status === 1, 'mem idea: an idea of the AI needs Notato');
  const badSure = path.join(tmp, 'badsure.md'); fs.writeFileSync(badSure, '- **Idea:** x\n- **Notato:** n\n- **Sicurezza:** certissima\n- **Fonte:** IA · OS · Bs · y\n');
  ok(idea('--area', 'personale', '--title', 'Sicurezza strana', '--file', badSure).status === 1, 'mem idea: Sicurezza is alta|media|bassa');
});

T('mem riflessione', () => {
  const refl = (...a) => run('mem.mjs', ['riflessione', '--root', memRoot, ...a]);
  const f = path.join(tmp, 'refl.md');
  fs.writeFileSync(f, '- **Notato:** fatto-non-verificato tornato 3 volte (recurrence.mjs)\n- **Penso:** dico "fatto" prima di aprire il prodotto\n- **Sicurezza:** media\n- **Non so:** se succede anche in Cursor\n');
  let r = refl('--chat', 'OS · Mappa', '--title', 'Verifico troppo tardi', '--file', f);
  const t = fs.readFileSync(path.join(memRoot, 'ai-reflections.md'), 'utf8');
  ok(r.status === 0 && t.startsWith("# Riflessioni dell'IA") && t.includes('- **Write when:**') && t.includes(`## ${today} · OS · Mappa · Verifico troppo tardi\n- **Notato:**`), `mem riflessione: file created with its header:\n${r.stderr}${t}`);
  r = refl('--chat', 'OS · Mappa', '--title', 'Seconda', '--file', f);
  ok(r.status === 1 && /one a day per chat/.test(r.stderr), 'mem riflessione: one a day per chat');
  ok(refl('--chat', 'OS · Altra', '--title', 'Nuova', '--file', f).status === 0, 'mem riflessione: another chat the same day is fine');
  const half = path.join(tmp, 'refl-half.md'); fs.writeFileSync(half, '- **Notato:** x\n- **Penso:** y\n');
  ok(refl('--chat', 'OS · Terza', '--title', 'Mezza', '--file', half).status === 1, 'mem riflessione: Sicurezza and Non so required');
});

T('mem now me', () => {
  let r = mem('--label', 'OS · Tool', '--text', 'chat · in corso');
  let t = fs.readFileSync(nowFile, 'utf8');
  ok(r.status === 0 && new RegExp(`- \\*\\*OS · Tool\\*\\* · chat · in corso · \\(${today}\\)\\n\\n## Personale`).test(t), `mem: add under the live list with date:\n${r.stderr}${t}`);
  r = mem('--label', '**OS · Tool**', '--text', '**OS · Tool** · fatto · (2026-10-09)');
  t = fs.readFileSync(nowFile, 'utf8');
  ok(r.status === 0 && t.includes('- **OS · Tool** · fatto · (2026-10-09)') && !t.includes('in corso'), `mem: replace own line keeps a given date:\n${t}`);
  ok(mem('--label', 'OS · Tool', '--text', 'x'.repeat(260)).status === 1, 'mem: a line over 250 chars must be refused');
  ok(mem('--text', 'no label').status === 1, 'mem: --label is required');
  r = mem('--label', 'Pers · Z', '--section', 'Personale', '--text', 'z');
  ok(/## Personale\n- \*\*Pers · Y\*\* · y\n- \*\*Pers · Z\*\* · z/.test(fs.readFileSync(nowFile, 'utf8')), 'mem: --section puts the line there');
  fs.appendFileSync(nowFile, '- **Pers · Z** · twice\n');
  ok(mem('--label', 'Pers · Z', '--text', 'q').status === 1, 'mem: the same label on two lines must be refused');
  r = mem('--label', 'OS · Tool', '--del');
  ok(r.status === 0 && !fs.readFileSync(nowFile, 'utf8').includes('OS · Tool'), 'mem: --del removes the own line');
});

// ---------- chat-prompt.mjs
T('chat-prompt', () => {
  ok(checkTitle('A · Fix login') === null, 'chat-prompt: a good title is refused');
  for (const bad of ['Fix login', 'XX · Fix', 'B · SMS no: B · Übersicht', 'A · PR 123', 'A · Fix #12'])
    ok(checkTitle(bad), `chat-prompt: bad title accepted: ${bad}`);
  const job = 'Fai la review della PR.';
  const c = buildPrompt({ title: 'A · Review login', kind: 'code', repo: 'my-app', job, words: 'fai la review', date: '2026-10-10' });
  ok(c.includes('Sei la chat di lavoro "A · Review login"') && c.includes('Repo di lavoro: {{REPOS_JS}}\\my-app.') && c.includes('code.md'), 'chat-prompt: claude head');
  ok(c.includes('inbox.mjs" send --to "regia" --from "a-review-login"') && c.includes('(AskUserQuestion;') && c.includes('blocco `powershell`') && !c.includes('SendMessage') && c.includes('mem.mjs" now me --label "A · Review login"'), 'chat-prompt: fixed lines missing (Regia, wait-devops, env-lease, now.md)');
  ok(c.includes('Suite di test pesanti') && c.includes('`sb-tests`') && c.includes('`release` sempre'), 'chat-prompt: heavy-suite turn line missing (code.md "Heavy test suites")');
  ok(c.includes('Parole di {{OWNER}} (2026-10-10): "fai la review"') && c.includes(job), 'chat-prompt: words and job');
  const k = buildPrompt({ title: 'B · QA', kind: 'qa', harness: 'cursor', repo: 'my-app', job });
  ok(k.includes('Questa chat parte in {{BRAIN_JS}}') && k.includes('AskQuestion') && !k.includes('SendMessage') && k.includes('rules\\qa.md'), 'chat-prompt: cursor variant');
  ok(k.startsWith('Prima cosa: rinomina questa chat in "B · QA" con lo strumento rename_chat.') && !c.includes('rename_chat'), 'chat-prompt: rename_chat line only first and only in Cursor');
  const url = promptLink('a & b "c" · d');
  ok(url === 'cursor://anysphere.cursor-deeplink/prompt?text=a%20%26%20b%20%22c%22%20%C2%B7%20d', `chat-prompt: link encoding: ${url}`);
  ok(promptLink(k).length < LINK_MAX, 'chat-prompt: a normal Cursor prompt fits the link');
  const fakeExe = path.join(tmp, 'Cursor.exe'); fs.writeFileSync(fakeExe, '');
  let calls = [];
  const run = st => (exe, args) => { calls.push([exe, ...args]); return { status: st }; };
  ok(!openInCursor(url, { exe: fakeExe, run: run(0), isOpen: () => false }).ok && calls.length === 0, 'chat-prompt: Cursor closed must fall back without launching');
  ok(openInCursor(url, { exe: fakeExe, run: run(0), isOpen: () => true }).ok && calls[0][1] === '--open-url' && calls[0][2] === '--' && calls[0][3] === url, `chat-prompt: open call ${JSON.stringify(calls[0])}`);
  calls = [];
  ok(!openInCursor('x'.repeat(LINK_MAX + 1), { exe: fakeExe, run: run(0), isOpen: () => true }).ok && calls.length === 0, 'chat-prompt: too long link must fall back without launching');
  ok(!openInCursor(url, { exe: fakeExe, run: run(1), isOpen: () => true }).ok, 'chat-prompt: Cursor exit 1 must fall back');
  ok(!openInCursor(url, { exe: path.join(tmp, 'none.exe'), run: run(0), isOpen: () => true }).ok, 'chat-prompt: missing Cursor must fall back');
  let threw = false; try { buildPrompt({ title: 'A · X', kind: 'code', job: ' ' }); } catch { threw = true; }
  ok(threw, 'chat-prompt: empty job must fail');
  ok(sameLabel('A · Altro', '- **A · Altro** · x\n- **A · Altrove** · y').length === 1, 'chat-prompt: same label found exactly');
  const croot = path.join(tmp, 'pc');
  jsonl(path.join(croot, 'p', 'a.jsonl'), [{ type: 'custom-title', customTitle: 'OS · Progetti' }, { type: 'user', timestamp: ts, message: { content: [{ type: 'text', text: '<system-reminder>\nworktree\n</system-reminder>\nYou are a work chat about projects.' }] } }]);
  jsonl(path.join(croot, 'p', 'b.jsonl'), [{ type: 'custom-title', customTitle: 'Altro' }, { type: 'user', timestamp: ts, message: { content: 'possono vedere progetti?' } }]);
  jsonl(path.join(tmp, 'cu', 'c-x', 'agent-transcripts', 'zz99', 'zz99.jsonl'), [{ role: 'user', message: { content: [{ type: 'text', text: '<user_query>\nSei la chat B · Prova cursor\n</user_query>' }] } }]);
  const h = findFirstPrompts('os progetti', { claudeRoot: croot, cursorRoot: path.join(tmp, 'cu') });
  ok(h[0]?.title === 'OS · Progetti' && h[0].first === 'You are a work chat about projects.', `chat-prompt show: title hit first, reminder stripped: ${JSON.stringify(h[0])}`);
  ok(!h.some(x => x.title === 'Altro'), 'chat-prompt show: "os" matched inside "possono"');
  ok(findFirstPrompts('prova cursor', { claudeRoot: croot, cursorRoot: path.join(tmp, 'cu') })[0]?.harness === 'Cursor', 'chat-prompt show: Cursor first message');
  // session-find: Claude and Cursor chats with the same words (2026-10-10 "un solo modo")
  const sf = spawnSync(process.execPath, [path.join(here, 'session-find.mjs'), 'projects', '--days', '5'], { encoding: 'utf8', env: { ...process.env, BRAIN_CLAUDE_PROJECTS: croot, BRAIN_CURSOR_PROJECTS: path.join(tmp, 'cu') } });
  ok(/## OS · Progetti/.test(sf.stdout) && /: 1 chat/.test(sf.stdout), `session-find: Claude chat missing:\n${sf.stdout}${sf.stderr}`);
  const sfc = spawnSync(process.execPath, [path.join(here, 'session-find.mjs'), 'prova', 'cursor', '--days', '5'], { encoding: 'utf8', env: { ...process.env, BRAIN_CLAUDE_PROJECTS: croot, BRAIN_CURSOR_PROJECTS: path.join(tmp, 'cu') } });
  ok(/## Cursor · Sei la chat B · Prova cursor/.test(sfc.stdout) && /Owner \d\d:\d\d: Sei la chat/.test(sfc.stdout), `session-find: Cursor chat missing:\n${sfc.stdout}${sfc.stderr}`);
});

// ---------- wt-land.mjs: a temp repo with main and worktrees
T('wt-land', () => {
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (cwd, ...a) => { const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }); if (r.status !== 0 && !a.includes('--no-ff')) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  g(repo, 'init', '-q', '-b', 'main'); g(repo, 'config', 'user.name', 't'); g(repo, 'config', 'user.email', 't@t');
  g(repo, 'config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(repo, '.git', 'info'), { recursive: true });
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '\n**/.claude/worktrees/\n'); // as in the real {{BRAIN_NAME}}
  const w = (rel, s, root = repo) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), s); };
  w('ai-errors.md', '# log\n- a\n'); w('now.md', '# now\n- **X** · 1\n'); w('hub.md', 'rule 1\n');
  g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'init');
  const add = name => { const p = path.join(repo, '.claude', 'worktrees', name); g(repo, 'worktree', 'add', '-q', '-b', `claude/${name}`, p, 'main'); return p; };
  const logs = [];
  const opts = { runTests: false, log: s => logs.push(s) };
  // A: both sides append to ai-errors and change now.md → lines joined, now.md = main's, main fast-forwarded
  const a = add('a');
  w('ai-errors.md', '# log\n- a\n- from branch\n', a); w('now.md', '# now\n- **X** · branch\n', a); w('ops/tools/new.mjs', 'x\n', a);
  g(a, 'add', '-A'); g(a, 'commit', '-qm', 'branch work');
  w('ai-errors.md', '# log\n- a\n- from main\n'); w('now.md', '# now\n- **X** · main\n');
  g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'main work');
  land(repo, 'a', opts);
  const errs = fs.readFileSync(path.join(repo, 'ai-errors.md'), 'utf8');
  ok(errs.indexOf('- from main') >= 0 && errs.indexOf('- from main') < errs.indexOf('- from branch'),`wt-land: log lines not joined:\n${errs}\n${logs.join('\n')}`);
  ok(fs.readFileSync(path.join(repo, 'now.md'), 'utf8').includes('- **X** · main'), 'wt-land: now.md must keep main\'s copy');
  ok(fs.existsSync(path.join(repo, 'ops/tools/new.mjs')) && g(repo, 'rev-parse', 'main') === g(a, 'rev-parse', 'HEAD'), 'wt-land: main not fast-forwarded to the branch');
  // B: a real conflict (hub.md) → aborted, main untouched, branch not left mid-merge
  const b = add('b');
  w('hub.md', 'rule branch\n', b); g(b, 'add', '-A'); g(b, 'commit', '-qm', 'b');
  w('hub.md', 'rule main\n'); g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'm');
  const mainBefore = g(repo, 'rev-parse', 'main');
  let err = ''; try { land(repo, 'b', opts); } catch (e) { err = e.message; }
  ok(/conflitto da risolvere a mano in hub\.md/.test(err) && g(repo, 'rev-parse', 'main') === mainBefore && !fs.existsSync(path.join(b, '.git', 'MERGE_HEAD')) && !g(b, 'status', '--porcelain'), `wt-land: real conflict not aborted cleanly: ${err}`);
  const dry = []; land(repo, 'b', { dry: true, log: s => dry.push(s) });
  ok(/si fermerebbe su hub\.md/.test(dry[0] ?? ''), `wt-land --dry: conflict not foreseen: ${dry}`);
  // C: uncommitted work → refused; status lists it
  const c = add('c');
  w('x.md', 'x', c);
  err = ''; try { land(repo, 'c', opts); } catch (e) { err = e.message; }
  ok(/non committate/.test(err), 'wt-land: uncommitted work must be refused');
  const st = status(repo);
  ok(st.find(x => x.name === 'c')?.dirty === 1 && st.find(x => x.name === 'b')?.ahead === 1, `wt-land status: ${JSON.stringify(st)}`);
  // D: main has a pending change on a file the branch touches → committed as auto:, then fast-forward
  const d = add('d');
  w('ai-errors.md', `${fs.readFileSync(path.join(repo, 'ai-errors.md'), 'utf8')}- from d\n`, d); g(d, 'add', '-A'); g(d, 'commit', '-qm', 'd');
  fs.appendFileSync(path.join(repo, 'ai-errors.md'), '- pending in main\n');
  land(repo, 'd', opts);
  const e2 = fs.readFileSync(path.join(repo, 'ai-errors.md'), 'utf8');
  ok(e2.includes('- from d') && e2.includes('- pending in main') && !g(repo, 'status', '--porcelain'), `wt-land: pending main change lost or left dirty:\n${e2}`);
});

T('recurrence', () => {
  const rows = parseErrors([
    '- 2026-10-01 10:00 · Regia · prod DB · azione-pericolosa · detto: query in più · vero: no · visto da: {{OWNER}} · regola: me.md ok',
    '- 2026-10-02 --:-- · OS · Tool · ops/tools · regola-ignorata · detto: heredoc · vero: regola 5 · visto da: io',
    '- 2026-10-03 11:00 · chat X · prod, DB clienti · azione pericolosa · detto: altra query · vero: no · visto da: {{OWNER}}',
    '- 2026-10-04 11:00 · chat Y · App QA · fatto-non-verificato · detto alla Regia: tutto ok · vero: no · visto da: QA',
    '- 2026-10-05 11:00 · chat Z · stile · tipo-inventato · detto: x · vero: y · visto da: {{OWNER}}',
    '- not a line',
  ].join('\n'));
  ok(rows.length === 5, `recurrence parse: ${rows.length}`);
  ok(rows[1].who === 'OS · Tool' && rows[1].area === 'ops/tools' && rows[1].type === 'regola-ignorata', `recurrence chat with dot: ${JSON.stringify(rows[1])}`);
  ok(rows[3].type === 'fatto-non-verificato', `recurrence "detto alla Regia:": ${rows[3].type}`);
  const res = recurrence(rows);
  ok(res.rules.length === 1 && res.rules[0].again === 1, `recurrence came back once (same type, area shares "prod"): ${JSON.stringify(res.rules)}`);
  ok(res.outside.length === 1 && res.outside[0].type === 'tipo-inventato', 'recurrence outside list');
  ok(/tornato 1 volte/.test(renderRecurrence(res)) && /fuori elenco: 1/.test(renderRecurrence(res)), 'recurrence render');
});

T('compact-now hook', () => {
  const hook = path.join(here, '..', '..', '.claude', 'hooks', 'compact-now.mjs');
  const tr = path.join(tmp, 'compact.jsonl');
  fs.writeFileSync(tr, [{ type: 'custom-title', customTitle: 'A · Fix login' }].map(r => JSON.stringify(r)).join('\n'));
  const h = input => spawnSync(process.execPath, [hook], { input: JSON.stringify(input), encoding: 'utf8' }).stdout;
  const o = JSON.parse(h({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tr }) || '{}');
  ok(/--label "A · Fix login"/.test(o.hookSpecificOutput?.additionalContext || ''), `compact-now: ${JSON.stringify(o)}`);
  ok(/primo messaggio ti ha fatto leggere/.test(o.hookSpecificOutput?.additionalContext || ''), 'compact-now: generic re-read without a brief');
  ok(h({ hook_event_name: 'SessionStart', source: 'startup', transcript_path: tr }) === '', 'compact-now: silent on startup');
  fs.writeFileSync(tr, [
    { type: 'custom-title', customTitle: 'A · Fix login' },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'leggi C:\\x\\not-this.md' }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Leggi il brief: C:\\Users\\d\\{{BRAIN_NAME}}\\tmp\\prompt-x.md. Vedi https://github.com/o/r/blob/main/README.md. Poi C:/r/code.md, C:/r/code.md' }] } },
    { type: 'user', message: { role: 'user', content: 'dopo: C:\\x\\later.md' } },
  ].map(r => JSON.stringify(r)).join('\n'));
  const b = JSON.parse(h({ source: 'compact', transcript_path: tr }) || '{}').hookSpecificOutput?.additionalContext || '';
  ok(b.includes('C:\\Users\\d\\{{BRAIN_NAME}}\\tmp\\prompt-x.md, C:/r/code.md)') && !/not-this|later|README/.test(b), `compact-now: brief files (no URLs): ${b}`);
  fs.writeFileSync(tr, JSON.stringify({ type: 'custom-title', customTitle: 'Regia' }));
  ok(h({ source: 'compact', transcript_path: tr }) === '', 'compact-now: silent for the Regia');
  ok(spawnSync(process.execPath, [hook], { input: 'garbage', encoding: 'utf8' }).status === 0, 'compact-now: never fails');
});

T('vendor-guard hook', () => {
  const hook = path.join(here, '..', '..', '.claude', 'hooks', 'vendor-guard.mjs');
  const h = input => spawnSync(process.execPath, [hook], { input: JSON.stringify(input), encoding: 'utf8' });
  const claude = cmd => h({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd } });
  const cursor = cmd => JSON.parse(h({ hook_event_name: 'beforeShellExecution', cursor_version: '3.24', command: cmd }).stdout || '{}').permission || 'pass';
  const cursorAsClaudeHook = cmd => h({ hook_event_name: 'PreToolUse', cursor_version: '3.24', tool_input: { command: cmd } }).status;
  // Claude Code: never the Cursor CLI/API (fake commands, nothing runs)
  for (const cmd of ['cursor-agent -p "review this" --model gpt-5', 'agent -p fake', 'cd C:/fake && cursor-agent --print x',
    '& "C:/Users/x/AppData/Local/cursor-agent/cursor-agent.ps1" -p x', 'cursor agent -p x', 'agent',
    'node C:/Users/x/AppData/Local/cursor-agent/versions/2026.10.01-abc/index.js -p x', 'FOO=1 cursor-agent -p x',
    "bash -lc 'cursor-agent -p x'", 'powershell -NoProfile -Command "& { cursor-agent -p x }"', 'echo $(cursor-agent -p x)',
    'curl -s https://api.cursor.com/v0/agents -H "Authorization: Bearer x"', 'Start-Process -FilePath cursor-agent -ArgumentList "-p x"'])
    ok(claude(cmd).status === 2, `vendor-guard (Claude) lets through: ${cmd}`);
  for (const cmd of ['claude -p "x" --output-format json', 'node "{{BRAIN}}/harness/compare/report.mjs" --day 2026-10-10',
    'node "{{BRAIN}}/ops/tools/chat-prompt.mjs" --harness cursor --open --job-file x.txt', 'cursor-agent --version',
    'grep -n "cursor-agent -p" harness/compare/judge.mjs', 'git commit -m "judge via cursor-agent; agent -p"', 'ls ~/AppData/Local/cursor-agent/',
    'cat <<EOF > x.txt\ncursor-agent -p x\nEOF', 'eval $(ssh-agent)', 'node harness/compare/test.mjs', 'command -v cursor-agent'])
    ok(claude(cmd).status === 0, `vendor-guard (Claude) blocks: ${cmd}`);
  // Cursor: never the Claude CLI/API
  for (const cmd of ['claude -p "x"', 'npx -y @anthropic-ai/claude-code -p x', 'cmd /c "claude -p x"', 'claude',
    'curl https://api.anthropic.com/v1/messages -d "{}"', 'node -e "require(\'@anthropic-ai/claude-agent-sdk\')"',
    '$r = claude -p x', 'C:\\Users\\x\\.local\\bin\\claude.exe -p x'])
    ok(cursor(cmd) === 'deny', `vendor-guard (Cursor) lets through: ${cmd}`);
  for (const cmd of ['cursor-agent -p x', 'claude --version', 'node "{{BRAIN}}/harness/compare/run-claude.mjs"',
    'grep -rn "claude -p" reviews/', "git commit -m 'claude -p'", 'Get-ChildItem ~/.claude'])
    ok(cursor(cmd) === 'pass', `vendor-guard (Cursor) blocks: ${cmd}`);
  // review 10/10: a redirect after the quoted script, backticks inside single quotes, the Anthropic SDKs
  for (const cmd of ['bash -c "cursor-agent -p x" > out.txt', 'powershell -NoProfile -Command "cursor-agent -p x" 2>&1', 'echo "$(cursor-agent -p x)"'])
    ok(claude(cmd).status === 2, `vendor-guard (Claude) lets through: ${cmd}`);
  for (const cmd of ["rg -n '`cursor-agent`' harness/", "grep -rn '`agent` CLI' docs/", "git commit -m 'docs: the `agent` CLI'", "Select-String -Pattern '`agent`' *.md"])
    ok(claude(cmd).status === 0, `vendor-guard (Claude) blocks: ${cmd}`);
  for (const cmd of ['cmd /c "claude -p x" > out.txt', 'pwsh -c "claude -p x" 2>&1', 'python -c "import anthropic; anthropic.Anthropic()"', 'node -e "import(\'@anthropic-ai/sdk\')"', 'python -c "from claude_agent_sdk import query"'])
    ok(cursor(cmd) === 'deny', `vendor-guard (Cursor) lets through: ${cmd}`);
  ok(cursor("rg -n '`claude -p`' reviews/") === 'pass', 'vendor-guard (Cursor) blocks a grep for `claude -p`');
  // minor holes closed 10/10 (Owner: "Sì"): heredoc fed to a shell, npm exec, wsl, node -e / python -c starting the CLI
  for (const cmd of ['bash <<EOF\ncursor-agent -p x\nEOF', 'cat <<EOF | bash\ncursor-agent -p x\nEOF', 'npm exec -- cursor-agent -p x', 'wsl cursor-agent -p x',
    'node -e "require(\'child_process\').execSync(\'cursor-agent -p x\')"', 'python -c "import subprocess; subprocess.run([\'agent\', \'-p\', \'x\'])"'])
    ok(claude(cmd).status === 2, `vendor-guard (Claude) lets through: ${cmd}`);
  for (const cmd of ['wsl -d Ubuntu cursor-agent -p x', 'node <<\'EOF\'\nrequire(\'child_process\').execSync(\'cursor-agent -p x\')\nEOF'])
    ok(claude(cmd).status === 2, `vendor-guard (Claude) lets through: ${cmd}`);
  for (const cmd of ['node -e "require(\'child_process\').execSync(\'git status\')"', 'node -e "console.log(\'agent\')"', 'wsl --list', 'npm exec -- prettier x.md',
    'python -c "import subprocess; print(subprocess.run([\'git\',\'log\',\'--grep\',\'agent\'],capture_output=True).stdout)"',
    'node -e "const o=require(\'child_process\').execSync(\'tasklist\').toString(); console.log(o.includes(\'cursor-agent\'))"',
    'node -e "const m=/x/.exec(s); console.log(j.type===\'agent\')"', 'bash ops/x.sh && cat <<\'EOF\' > notes.md\nagent -p x\nEOF'])
    ok(claude(cmd).status === 0, `vendor-guard (Claude) blocks: ${cmd}`);
  for (const cmd of ['npm exec @anthropic-ai/claude-code -- -p x', 'wsl -e claude -p x', 'sh <<EOF\nclaude -p x\nEOF', 'node -e "require(\'child_process\').execSync(\'claude -p x\')"'])
    ok(cursor(cmd) === 'deny', `vendor-guard (Cursor) lets through: ${cmd}`);
  ok(cursorAsClaudeHook('claude -p x') === 2 && cursorAsClaudeHook('cursor-agent -p x') === 0, 'vendor-guard: Cursor running the Claude hook = Cursor rules');
  ok(spawnSync(process.execPath, [hook], { input: 'garbage', encoding: 'utf8' }).status === 0, 'vendor-guard: never fails');
});

T('install-inbox-hooks', () => {
  const base = { model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node chat-feed.mjs', timeout: 10 }] }] } };
  const a = applyHooks(base);
  ok(a.changes.length === 2 && a.settings.hooks.Stop[0].hooks.length === 2 && a.settings.hooks.SessionStart[0].matcher === 'compact', `install hooks: ${JSON.stringify(a)}`);
  ok(base.hooks.Stop[0].hooks.length === 1, 'install hooks: input untouched');
  ok(applyHooks(a.settings).changes.length === 0, 'install hooks: idempotent');
  const r = applyHooks(a.settings, { remove: true });
  ok(r.changes.length === 2 && r.settings.hooks.Stop[0].hooks.length === 1 && !r.settings.hooks.SessionStart && r.settings.model === 'x', `install hooks remove: ${JSON.stringify(r.settings)}`);
  const f = path.join(tmp, 'settings.json'); fs.writeFileSync(f, '﻿' + JSON.stringify(base));
  const out = spawnSync(process.execPath, [path.join(here, 'install-inbox-hooks.mjs'), '--file', f], { encoding: 'utf8' });
  ok(out.status === 0 && fs.existsSync(`${f}.bak-${new Date().toISOString().slice(0, 10)}-inbox`) && JSON.parse(fs.readFileSync(f, 'utf8')).hooks.SessionStart, `install hooks CLI: ${out.stdout}${out.stderr}`);
});

T('playbook', () => {
  const empty = pbParse('');
  let b = pbOp('reviewer', empty, 'propose', { text: 'Before a finding on SQL, check that the app DBs have no FKs · see review-catalog', source: 'ai-errors 2026-10-08 10:37 · reviewer', date: '2026-10-10' });
  ok(b.Proposti[0].id === 'RV-1' && !b.Proposti[0].text.includes(' · ') && b.Punti.length === 0, `playbook propose: ${JSON.stringify(b)}`);
  const refused = f => { try { f(); return false; } catch (e) { return e.code === 4; } };
  ok(refused(() => pbOp('reviewer', b, 'propose', { text: 'Before any finding on SQL check that the app DBs have no FKs', source: 'x' })), 'playbook: near-duplicate refused');
  ok(refused(() => pbOp('reviewer', b, 'propose', { text: 'new point', source: '' })), 'playbook: source required');
  ok(refused(() => pbOp('reviewer', b, 'propose', { text: 'x'.repeat(301), source: 's' })), 'playbook: point too long');
  // review 10/10: a line we can't read refuses the write instead of vanishing; "·" in a source can't break the fields
  const good = pbRender('reviewer', pbOp('reviewer', b, 'accept', { id: 'RV-1', date: '2026-10-10' }));
  ok(pbParse(good.replace('dal 2026-10-10', 'dal 2026-10-10   ').replace(/\n/g, '\r\n')).Punti.length === 1, 'playbook: trailing spaces and CRLF tolerated');
  ok(refused(() => pbParse(good.replace('+0/-0', '+0/−0'))), 'playbook: malformed line refused, not dropped');
  ok(refused(() => pbParse(`${good}\n## Appunti\n- x`)), 'playbook: unknown section refused');
  const dots = pbOp('reviewer', pbParse(''), 'propose', { text: 'Primo punto qualsiasi', source: '{{OWNER}} · · fonte: chat 10/10', date: '2026-10-10' });
  const back = pbParse(pbRender('reviewer', dots)).Proposti[0];
  ok(back.text === 'Primo punto qualsiasi' && back.source === '{{OWNER}}, , fonte: chat 10/10' && back.date === '2026-10-10', `playbook: dots in source: ${JSON.stringify(back)}`);
  b = pbOp('reviewer', b, 'accept', { id: 'RV-1', date: '2026-10-11' });
  ok(b.Punti[0].id === 'RV-1' && b.Punti[0].date === '2026-10-11' && !b.Proposti.length, 'playbook accept');
  b = pbOp('reviewer', b, 'vote', { id: 'RV-1', kind: 'harmful' });
  b = pbOp('reviewer', b, 'vote', { id: 'RV-1', kind: 'harmful' });
  b = pbOp('reviewer', b, 'vote', { id: 'RV-1', kind: 'helpful' });
  ok(b.Punti[0].up === 1 && b.Punti[0].down === 2, 'playbook vote');
  ok(pbOp('reviewer', b, 'vote', { id: 'RV-1,RV-1', kind: 'helpful' }).Punti[0].up === 2, 'playbook: repeated id voted once');
  ok(refused(() => pbOp('reviewer', b, 'vote', { id: 'RV-1,RV-9', kind: 'helpful' })) && b.Punti[0].up === 1, 'playbook: unknown id refuses the whole vote');
  const round = pbParse(pbRender('reviewer', b));
  ok(JSON.stringify(round) === JSON.stringify(b), `playbook render/parse round trip:\n${pbRender('reviewer', b)}`);
  b = pbOp('reviewer', b, 'propose', { text: 'Report a finding only with a concrete failing input', source: '{{OWNER}} 2026-10-10' });
  ok(b.Proposti[0].id === 'RV-2', 'playbook ids grow');
  b = pbOp('reviewer', b, 'remove', { id: 'RV-1', why: 'more harmful than helpful', date: '2026-10-12' });
  b = pbOp('reviewer', b, 'propose', { text: 'Third point about tests', source: 's' });
  ok(b.Tolti[0].id === 'RV-1' && /tolto: more harmful/.test(b.Tolti[0].note) && b.Proposti[1].id === 'RV-3', 'playbook remove keeps history, ids never reused');
  let big = pbParse('');
  const distinct = k => Array.from({ length: 56 }, (_, j) => `p${k}w${j}`).join(' ').slice(0, 280); // no shared words
  for (let k = 0; k < 8; k++) { big = pbOp('qa', big, 'propose', { text: distinct(k), source: 's' }); big = pbOp('qa', big, 'accept', { id: big.Proposti[0].id }); }
  const ninth = pbOp('qa', big, 'propose', { text: distinct(8), source: 's' });
  ok(refused(() => pbOp('qa', ninth, 'accept', { id: ninth.Proposti[0].id })), 'playbook: Punti cap refused');
  // CLI on a temp root
  const proot = path.join(tmp, 'pb');
  const cli = args => spawnSync(process.execPath, [path.join(here, 'playbook.mjs'), ...args, '--root', proot], { encoding: 'utf8' });
  ok(cli(['propose', 'prod-log-reader', '--text', 'Say which subscription was searched', '--source', 'me.md Safety']).status === 0, 'playbook CLI propose');
  ok(cli(['accept', 'prod-log-reader', 'PL-1']).status === 0 && cli(['vote', 'prod-log-reader', 'PL-1', 'helpful']).status === 0, 'playbook CLI accept+vote');
  ok(/prod-log-reader: 1 punti/.test(cli(['list']).stdout), `playbook CLI list: ${cli(['list']).stdout}`);
  ok(cli(['propose', 'nobody', '--text', 'x', '--source', 's']).status === 4, 'playbook CLI unknown agent');
});

T('brain-site (own test file)', () => {
  const r = spawnSync(process.execPath, [path.join(here, 'brain-site.test.mjs')], { encoding: 'utf8', timeout: 120000 });
  ok(r.status === 0, `brain-site.test.mjs:\n${r.stdout}${r.stderr}`);
});

T('inbox (own test file)', () => {
  const r = spawnSync(process.execPath, [path.join(here, 'inbox.test.mjs')], { encoding: 'utf8', timeout: 120000 });
  ok(r.status === 0, `inbox.test.mjs:\n${r.stdout}${r.stderr}`);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? fails.join('\n') : `ok: ${n} groups (cost, mem now me, chat-prompt, day, wt-land, inbox, brain-site, estimates, prices, routing)`);
process.exit(fails.length ? 1 : 0);
