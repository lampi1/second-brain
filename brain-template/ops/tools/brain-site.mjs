// brain-site: "second-brain", {{OWNER}}'s brain ({{BRAIN_NAME}}) as a local website (name: {{OWNER}} 2026-10-10; {{OWNER}} 2026-10-10: "esplorare il mio cervello come fosse un sito web...
// senza dover spendere token per tenerlo aggiornato"; "per ora solo sul pc"). A small node server on 127.0.0.1 that
// reads the real files at every page open: zero tokens, no model, nothing written. Pages (ops/tools/brain-site/):
// today (costs, what was done), to do (brief, now.md, ideas), costs, quality (errors, praise, notebooks, proposals,
// measures, bugs), Cursor-vs-Claude comparison, collaboration (mail between chats, environments), the 3D map
// (brain-map.mjs) and every brain file. Slow sources (cost.mjs, day.mjs, brain-map.mjs: 5-20 s) are cached and
// refreshed in the background, so a page opens at once with the last result and its time.
// Only GET, except POST /api/send (a message to a chat's mailbox, below); only files tracked by git in {{BRAIN_NAME}} (so gitignored secrets like ops/credentials.md never show) plus
// the comparison reports; one declared exception: the two collaboration logs of ops/state (inbox.log, envs.log: chat
// names, environments, times; no secrets) feed the Collaboration page. Requests whose Host is not localhost are
// refused (DNS rebinding). The CDN libraries are pinned with integrity hashes (index.html, map3d.js).
// Usage: node "{{BRAIN}}/ops/tools/brain-site.mjs" [serve] [--port 4317] [--root <{{BRAIN_NAME}}>]
//          (how {{OWNER}} uses it: started by hand when he wants it, 2026-10-10 "non voglio farlo partire ad ogni riavvio")
//        node .../brain-site.mjs install     (optional, not in use: starts with Windows, via a hidden launcher in Startup)
//        node .../brain-site.mjs uninstall   (removes that launcher)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as P from './brain-site/parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, 'brain-site');
export const DEFAULT_ROOT = '{{BRAIN}}';
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const romeDay = (t = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

// Files the site may show: tracked by git (gitignored = secrets, state, outputs) + the comparison reports.
export function allowedFiles(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 1e8 });
  const files = (r.stdout ?? '').split('\n').filter(Boolean);
  const cmp = path.join(root, 'reviews', 'compare');
  const walk = (d, depth = 0) => { for (const e of (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : [])) {
    const p = path.join(d, e.name);
    if (e.isDirectory() && depth < 3) walk(p, depth + 1);
    else if (/\.(md|json|html|txt)$/.test(e.name)) files.push(path.relative(root, p).replace(/\\/g, '/'));
  } };
  for (const f of ['report.md', 'report.html', 'summary.md']) if (fs.existsSync(path.join(cmp, f))) files.push(`reviews/compare/${f}`);
  walk(path.join(cmp, 'reports'));
  return [...new Set(files)].filter(f => !/(^|\/)\.env|credentials|secret/i.test(f)).sort();
}

// Stale-while-revalidate cache: answer at once with the last value, refresh in the background when older than ttl.
const cache = new Map();
export function cached(key, ttlMs, fn, { force = false } = {}) {
  const c = cache.get(key) ?? {};
  cache.set(key, c);
  const fresh = c.at && Date.now() - c.at < ttlMs;
  if (!c.running && (force || !fresh)) {
    c.running = Promise.resolve().then(fn).then(v => { c.value = v; c.at = Date.now(); c.error = null; },
      e => { c.error = String(e?.message ?? e); }).finally(() => { c.running = null; });
  }
  if (c.at && !force) return Promise.resolve({ value: c.value, at: c.at, refreshing: !!c.running, error: c.error });
  return (c.running ?? Promise.resolve()).then(() => ({ value: c.value, at: c.at, refreshing: !!c.running, error: c.error }));
}

const runNode = (script, args, root, timeout = 180000) => new Promise((res, rej) =>
  execFile(process.execPath, [path.join(HERE, script), ...args], { cwd: root, maxBuffer: 1e8, timeout, windowsHide: true },
    (err, stdout, stderr) => (err && !stdout ? rej(new Error(stderr || err.message)) : res(stdout))));

// Every table of the brain, parsed now (cheap: file reads only).
export async function tables(root) {
  const jdir = path.join(root, 'journal');
  const days = (fs.existsSync(jdir) ? fs.readdirSync(jdir) : []).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  const journal = days.flatMap(f => P.journal(read(path.join(jdir, f)), f.slice(0, 10)));
  const imp = f => import(pathToFileURL(path.join(HERE, f)).href);
  let playbooks = null, recurrence = null, quality = null, inbox = null;
  try { playbooks = (await imp('playbook.mjs')).summary(root); } catch { /* none */ }
  // quality: what the app's Qualità page shows from ai-errors.md (canonical types, unreadable lines, who saw them, rules in a 14-day window)
  try { const m = await imp('recurrence.mjs'); const t = read(path.join(root, 'ai-errors.md')) ?? ''; recurrence = m.recurrence(m.parse(t)); quality = m.quality?.(t, { today: romeDay() }) ?? null; } catch { /* none */ }
  try { const m = await imp('inbox.mjs'); const Pa = m.paths(root); inbox = { boxes: m.list(Pa), stats: m.stats(Pa), log: P.jsonl(read(Pa.log)) }; } catch { /* none */ }
  const briefs = (fs.existsSync(path.join(jdir, 'brief')) ? fs.readdirSync(path.join(jdir, 'brief')) : []).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  return {
    today: romeDay(),
    errors: P.aiErrors(read(path.join(root, 'ai-errors.md'))),
    wins: P.aiWins(read(path.join(root, 'ai-wins.md'))),
    journal,
    now: P.now(read(path.join(root, 'now.md'))),
    ideas: P.ideas(read(path.join(root, 'ideas.md'))),
    reflections: P.reflections(read(path.join(root, 'ai-reflections.md'))),
    proposals: P.proposals(read(path.join(root, 'proposals.md'))),
    bugs: P.bugLog(read(path.join(root, 'bug-log.md'))),
    measures: P.jsonl(read(path.join(root, 'measures.jsonl'))),
    envs: P.jsonl(read(path.join(root, 'ops', 'state', 'envs.log'))),
    briefs: briefs.map(f => `journal/brief/${f}`),
    playbooks, recurrence, quality, inbox,
  };
}

// "Adesso": the Claude and Cursor chats of the last 2 days (harness/cursor/chats.mjs, read-only), with their now.md
// line, their mailbox and, for the ones still working or waiting for {{OWNER}}, their last messages.
export function parseChatList(text) {
  const out = [];
  for (const l of String(text ?? '').split(/\r?\n/)) {
    if (!l.startsWith('- ')) continue;
    const p = l.slice(2).split(' · ');
    if (p.length < 6) continue;
    const id = p.pop().replace(/^id\s+/, ''), state = p.pop(), when = p.pop(), folder = p.pop(), harness = p.shift();
    out.push({ harness, title: p.join(' · '), folder, when, state, id });
  }
  return out;
}
export function parseChatRead(text) {
  const msgs = [];
  for (const l of String(text ?? '').split(/\r?\n/)) {
    const m = l.match(/^(Agente|Owner|Cursor):\s?(.*)$/);
    if (m) msgs.push({ who: m[1], text: m[2] });
    else if (/^·\s*\(/.test(l.trim())) msgs.push({ who: 'Altro', text: l.trim() }); // mail from another chat, Cursor's own turns: never {{OWNER}}'s words
    else if (msgs.length && l.trim()) msgs[msgs.length - 1].text += ` ${l.trim()}`;
  }
  return msgs;
}
// Minutes since "dd/mm, hh:mm" as chats.mjs prints it, in Europe/Rome whatever the PC timezone;
// a date in the future is last year's (31/12 seen on 1/1). null when unreadable.
export function ageOf(when, now = Date.now()) {
  const w = String(when ?? '').match(/(\d{1,2})\/(\d{1,2}),\s*(\d{1,2}):(\d{2})/);
  if (!w) return null;
  const romeOffset = t => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t)).map(x => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(t / 6e4) * 6e4; };
  const at = y => { const guess = Date.UTC(y, +w[2] - 1, +w[1], +w[3], +w[4]); return guess - romeOffset(guess); };
  const y = +new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric' }).format(new Date(now));
  let t = at(y);
  if (t > now + 5 * 6e4) t = at(y - 1);
  return Math.max(0, Math.round((now - t) / 6e4));
}
async function nowData(root) {
  const chats = parseChatList(await runNode('../../harness/cursor/chats.mjs', ['list', '--days', '2'], root));
  const slugOf = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let boxes = [];
  try { const m = await import(pathToFileURL(path.join(HERE, 'inbox.mjs')).href); boxes = m.list(m.paths(root)); } catch { /* no inbox */ }
  const nowLines = P.now(read(path.join(root, 'now.md')));
  const live = chats.filter(c => /in corso|aspetta/.test(c.state)).slice(0, 10);
  await Promise.all(live.map(async c => {
    try {
      const msgs = parseChatRead(await runNode('../../harness/cursor/chats.mjs', ['read', c.id, '--n', '8'], root, 30000));
      const said = msgs.filter(m => m.who !== 'Owner' && m.who !== 'Altro' && !/^\[[^\]]+\]$/.test(m.text.trim()));
      c.last = said.length ? said[said.length - 1].text.slice(0, 400) : '';
      const his = msgs.filter(m => m.who === 'Owner');
      c.lastOwner = his.length ? his[his.length - 1].text.slice(0, 200) : '';
    } catch { /* unreadable chat: shown without messages */ }
  }));
  for (const c of chats) {
    // minutes since the last activity ("10/10, 14:08", local time, this year): "now" means recent, not "ever waiting"
    c.ageMin = ageOf(c.when);
    // chats.mjs cuts long titles with "…": match the mailbox and the now.md line by prefix then
    const cut = c.title.endsWith('…'), key = slugOf(c.title.replace(/…$/, ''));
    const same = s => (cut ? slugOf(s).startsWith(key) : slugOf(s) === key);
    const box = boxes.find(b => same(b.box));
    c.box = box ? { name: box.box, listening: box.listening, unread: box.unread } : null;
    c.now = nowLines.find(n => same(n.filo)) ?? null;
  }
  // the site's own mailbox is not a chat to write to
  return { chats, boxes: boxes.filter(b => b.box !== 'second-brain') };
}

// Messages from the site to a chat ({{OWNER}} 2026-10-11, "un'azione sul sito triggera un prompt all'IA... a una chat
// specifica"): only POST /api/send, only from this site's own page (Origin + a custom header a cross-site form cannot
// set), only to an existing mailbox, short text; delivered by inbox.mjs, which marks it "not written by {{OWNER}}", so
// no ok or permission can travel this way.
export const SEND_MAX = 2000;
async function sendMessage(root, { to, text }) {
  const m = await import(pathToFileURL(path.join(HERE, 'inbox.mjs')).href);
  const P2 = m.paths(root);
  const boxes = m.list(P2).map(b => b.box);
  const box = m.slug(to);
  if (!boxes.includes(box)) throw Object.assign(new Error(`la chat "${to}" non ha una casella di posta`), { code: 400 });
  const body = String(text ?? '').trim();
  if (!body || body.length > SEND_MAX) throw Object.assign(new Error(`testo vuoto o oltre ${SEND_MAX} caratteri`), { code: 400 });
  if (box === 'second-brain') throw Object.assign(new Error('il sito non è una chat'), { code: 400 });
  // the site reads no answers: the chat answers in its own window, where {{OWNER}} sees it
  return m.send(P2, { to: box, from: 'second-brain', harness: 'app', text: `${body}\n\n(dal sito second-brain, su richiesta di Owner: rispondi nella tua chat, non con inbox.mjs; il sito non legge risposte)` });
}

const TTL = { map: 10 * 60e3, cost: 3 * 60e3, day: 5 * 60e3, brief: 15 * 60e3, now: 20e3, improve: 60e3 };
export function makeServer(root, { port = 4317 } = {}) {
  let files = null, filesAt = 0;
  const allowed = () => { if (!files || Date.now() - filesAt > 60e3) { files = allowedFiles(root); filesAt = Date.now(); } return files; };
  const json = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); };
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };

  return http.createServer(async (req, res) => {
    try {
      const host = String(req.headers.host ?? '').replace(/:\d+$/, '');
      if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) return json(res, 403, { error: 'solo da questo PC (localhost)' });
      const u = new URL(req.url, `http://${host}`);
      if (req.method === 'POST' && u.pathname === '/api/send') {
        const origin = String(req.headers.origin ?? '');
        if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || req.headers['x-second-brain'] !== '1' || !/application\/json/.test(req.headers['content-type'] ?? ''))
          return json(res, 403, { error: 'invio permesso solo dalla pagina di second-brain' });
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 10000) return json(res, 413, { error: 'messaggio troppo lungo' }); }
        let body; try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'richiesta non valida' }); }
        try { const r = await sendMessage(root, body); return json(res, 200, { ok: true, id: r?.msg?.id ?? null, listening: !!r?.listening }); }
        catch (e) { return json(res, e.code ?? 500, { error: e.message }); }
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'solo lettura' });
      const force = u.searchParams.get('fresh') === '1';
      const p = u.pathname;
      if (p === '/api/tables') return json(res, 200, await tables(root));
      if (p === '/api/now') return json(res, 200, await cached('now', TTL.now, () => nowData(root), { force }));
      // which code is serving the page (so "it looks unchanged" can be checked at a glance)
      if (p === '/api/version') return json(res, 200, { site: spawnSync('git', ['-C', HERE, 'log', '-1', '--format=%h %cI'], { encoding: 'utf8' }).stdout.trim(), root, here: HERE.replace(/\\/g, '/') });
      if (p === '/api/map') return json(res, 200, await cached('map', TTL.map, async () => {
        // in a child process: brain-map runs brain-usage and brain-lint synchronously (~18 s), which would freeze the server
        return JSON.parse(await runNode('brain-map.mjs', ['--json', '--root', root], root));
      }, { force }));
      if (p === '/api/cost') {
        const days = Math.min(90, Math.max(1, Number(u.searchParams.get('days')) || 7));
        return json(res, 200, await cached(`cost:${days}`, TTL.cost, async () => {
          const j = JSON.parse(await runNode('cost.mjs', ['--days', String(days), '--json'], root));
          j.chats = Object.values(j.chats ?? {}).filter(c => c.usd > 0).sort((a, b) => b.usd - a.usd).slice(0, 300);
          return j;
        }, { force }));
      }
      if (p === '/api/day') {
        const kind = u.searchParams.get('kind') === 'brief' ? 'brief' : 'report';
        const date = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('date') ?? '') ? u.searchParams.get('date') : romeDay();
        const args = kind === 'brief' ? ['brief', '--json'] : ['report', '--date', date, '--json'];
        // structured rows (title, link, state, area) plus the markdown in `text`
        return json(res, 200, await cached(`day:${kind}:${kind === 'brief' ? '' : date}`, kind === 'brief' ? TTL.brief : TTL.day,
          async () => ({ date, kind, ...JSON.parse(await runNode('day.mjs', args, root)) }), { force }));
      }
      // the shared self-improvement loop (ops/improve): one row per policy for the app's Miglioramento page (~5 s: it rescans the jobs)
      if (p === '/api/improve') return json(res, 200, await cached('improve', TTL.improve, async () => {
        const j = JSON.parse(await runNode(path.join('..', 'improve', 'improve.mjs'), ['status', '--json', '--state', path.join(root, 'ops', 'state')], root));
        if (!j.ok) throw new Error(j.error ?? 'improve.mjs senza risposta');
        return { policies: j.policies };
      }, { force }));
      if (p === '/api/files') return json(res, 200, allowed());
      if (p === '/api/file') {
        const f = String(u.searchParams.get('p') ?? '').replace(/\\/g, '/');
        if (!allowed().includes(f)) return json(res, 404, { error: 'file non trovato o non mostrabile' });
        const abs = path.join(root, f), st = fs.statSync(abs);
        const log = spawnSync('git', ['-C', root, 'log', '-1', '--format=%cI', '--', f], { encoding: 'utf8' }).stdout.trim();
        if (u.searchParams.get('raw') === '1') {
          res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${path.basename(f)}"` });
          return res.end(fs.readFileSync(abs));
        }
        return json(res, 200, { path: f, size: st.size, modified: log || st.mtime.toISOString(), text: st.size > 3e6 ? '(file troppo grande da mostrare)' : fs.readFileSync(abs, 'utf8') });
      }
      if (p === '/api/search') {
        const q = String(u.searchParams.get('q') ?? '').trim().toLowerCase();
        if (q.length < 2) return json(res, 200, []);
        const hits = [];
        for (const f of allowed().filter(f => /\.(md|mjs|jsonl?|sh|ps1|txt)$/.test(f))) {
          const t = read(path.join(root, f)); if (!t) continue;
          if (f.toLowerCase().includes(q)) hits.push({ file: f, line: 0, text: '(nome del file)' });
          t.split(/\r?\n/).forEach((l, i) => { if (hits.length < 300 && l.toLowerCase().includes(q)) hits.push({ file: f, line: i + 1, text: l.trim().slice(0, 240) }); });
          if (hits.length >= 300) break;
        }
        return json(res, 200, hits);
      }
      if (p === '/api/status') return json(res, 200, Object.fromEntries([...cache].map(([k, c]) => [k, { at: c.at, running: !!c.running, error: c.error }])));
      // static
      const f = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
      const abs = path.join(ASSETS, f);
      if (!abs.startsWith(ASSETS) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return json(res, 404, { error: 'pagina non trovata' });
      res.writeHead(200, { 'content-type': types[path.extname(abs)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(abs));
    } catch (e) {
      json(res, 500, { error: String(e?.message ?? e) });
    }
  });
}

// Windows start-up: a hidden launcher (like watch-hidden.vbs) in the user's Startup folder. Run only by {{OWNER}}.
const STARTUP = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const LAUNCHER = path.join(STARTUP, 'brain-brain-site.vbs');
function install(port, root) {
  // the script of the brain's own checkout, never a worktree copy that may be deleted later
  const script = path.join(root, 'ops', 'tools', 'brain-site.mjs');
  if (!fs.existsSync(script)) { console.error(`Non trovo ${script}: prima il merge in main.`); process.exit(1); }
  const cmd = `""${process.execPath}"" ""${script}"" serve --port ${port} --root ""${root}""`;
  fs.writeFileSync(LAUNCHER, `' Starts second-brain, the {{BRAIN_NAME}} site (http://localhost:${port}) hidden at Windows logon. Remove: node ${script.replace(/\\/g, '/')} uninstall\r\nCreateObject("WScript.Shell").Run "${cmd}", 0, False\r\n`);
  spawn('wscript.exe', [LAUNCHER], { detached: true, stdio: 'ignore' }).unref();
  console.log(`Installato: ${LAUNCHER}\nIl sito parte a ogni accensione; ora è avviato: http://localhost:${port}`);
}
function uninstall() {
  if (fs.existsSync(LAUNCHER)) { fs.unlinkSync(LAUNCHER); console.log(`Tolto: ${LAUNCHER} (il server già acceso resta fino al riavvio)`); }
  else console.log('Niente da togliere: il collegamento non c\'era.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const port = Number(arg('--port') ?? 4317);
  const root = arg('--root') ?? DEFAULT_ROOT;
  if (argv[0] === 'install') install(port, root);
  else if (argv[0] === 'uninstall') uninstall();
  else {
    const srv = makeServer(root, { port });
    srv.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `La porta ${port} è già usata: il sito è probabilmente già acceso (http://localhost:${port}).` : e.message); process.exit(1); });
    srv.listen(port, '127.0.0.1', () => {
      console.log(`second-brain: http://localhost:${port}`);
      // warm the slow sources so the first visit is quick
      for (const u of ['/api/map', '/api/cost?days=7', '/api/cost?days=1', '/api/cost?days=30', '/api/day?kind=report'])
        http.get({ host: '127.0.0.1', port, path: u, headers: { host: 'localhost' } }, r => r.resume()).on('error', () => {});
    });
  }
}
