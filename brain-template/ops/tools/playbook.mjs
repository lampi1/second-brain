// playbook: one notebook per specialist agent the owner adds (prod-log-reader, qa, devops-writer), so each one gets better run after run without growing everyone's context (D3 of
// reviews/2026-10-10-architettura-agenti.md, {{OWNER}} 2026-10-10: "taccuino per specialista"). ACE format (Zhang et al.
// 2025): numbered points, each citing the error or praise it comes from, helpful/harmful counters, only small edits
// (add / edit / remove / vote one point), never a rewrite of the whole notebook (that is what collapses a context).
// Files: playbooks/<agent>.md in the MAIN checkout (from worktrees too), read only by that specialist at its start.
// A point enters "Punti" only after {{OWNER}}'s yes: a chat or agent `propose`s it (→ "Proposti"), the Orchestrator asks him
// in a panel, `accept` moves it. Votes are free: the chat that launched the specialist votes the points the
// specialist says it used (helpful when the result held, harmful when {{OWNER}}, a review or QA proved it wrong).
// Limits (Hermes: a hard cap forces consolidation): a point ≤ 300 chars, "Punti" ≤ 2500 chars per notebook, a
// near-duplicate of an existing point is refused (edit that one instead), a proposal without a source is refused.
// Usage (--file = text written with the Write tool):
//   node "{{BRAIN}}/ops/tools/playbook.mjs" propose <agent> --text "<point>" --source "<ai-errors AAAA-MM-GG HH:MM | ai-wins … | {{OWNER}} …>"
//   node .../playbook.mjs accept <agent> <id>                (after {{OWNER}}'s yes)
//   node .../playbook.mjs reject <agent> <id> --why "<…>"
//   node .../playbook.mjs edit <agent> <id> --text "<…>"     (counters kept; after {{OWNER}}'s yes)
//   node .../playbook.mjs remove <agent> <id> --why "<…>"    (moved to "Tolti", never deleted)
//   node .../playbook.mjs vote <agent> <id[,id…]> helpful|harmful
//   node .../playbook.mjs list                               (every notebook: points, proposals, size, points to review;
//                                                            a notebook whose specialist is gone is named, never deleted)
// Exit: 0 ok, 3 usage, 4 refused (limit, duplicate, missing source, unknown id).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENTS = { 'prod-log-reader': 'PL', 'qa': 'QA', 'devops-writer': 'DW' };
export const MAX_POINT = 300, MAX_PUNTI = 2500;
const SECTIONS = ['Punti', 'Proposti', 'Tolti'];
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
const refuse = m => { const e = new Error(m); e.code = 4; throw e; };

const header = agent => [
  `# Taccuino: ${agent}`, '',
  `Punti imparati da questo specialista, letti solo da lui all'avvio (non fanno parte del contesto fisso). Formato ACE:`,
  'ogni punto cita da dove nasce (una riga di `ai-errors.md`, di `ai-wins.md` o una frase di {{OWNER}}) e porta i contatori',
  'utile/dannoso. Si cambia solo con `ops/tools/playbook.mjs` (un punto alla volta, mai riscritto per intero); un punto',
  'entra in "Punti" solo dopo il sì di {{OWNER}}. Un punto con più "dannoso" che "utile" va rivisto in manutenzione.', '', '',
].join('\n');

// One point line: "- **RV-3** · +2/-0 · <text> · fonte: <source> · dal AAAA-MM-GG"
const LINE = /^- \*\*([A-Z]{2}-\d+)\*\* · \+(\d+)\/-(\d+) · (.*) · fonte: (.*?) · (dal|proposto il|tolto il) (\d{4}-\d{2}-\d{2})(?: · (.*))?$/;
export function parse(text) {
  const book = { Punti: [], Proposti: [], Tolti: [] };
  let sec = null;
  // Strict below the first "## " heading: a line we can't read would vanish at the next write (and its id be reused),
  // so it stops every write until fixed by hand (review 10/10). Trailing spaces and CRLF are tolerated.
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trimEnd();
    const h = l.match(/^## (.*)$/);
    if (h) {
      if (!SECTIONS.includes(h[1].trim())) refuse(`riga ${i + 1}: sezione "${h[1]}" sconosciuta (solo ${SECTIONS.join(', ')}): sistemala a mano`);
      sec = h[1].trim(); return;
    }
    if (!sec || !l || l === '(nessuno)') return;
    const m = l.match(LINE);
    if (!m) refuse(`riga ${i + 1} illeggibile in "${sec}": "${l.slice(0, 80)}" — sistemala a mano nel formato "- **XX-n** · +u/-d · testo · fonte: … · dal AAAA-MM-GG"`);
    book[sec].push({ id: m[1], up: +m[2], down: +m[3], text: m[4], source: m[5], date: m[7], note: m[8] ?? null });
  });
  return book;
}
const fmt = (p, sec) => `- **${p.id}** · +${p.up}/-${p.down} · ${p.text} · fonte: ${p.source} · ${sec === 'Punti' ? 'dal' : sec === 'Proposti' ? 'proposto il' : 'tolto il'} ${p.date}${p.note ? ` · ${p.note}` : ''}`;
export const render = (agent, book) => `${header(agent)}${SECTIONS.map(s => `## ${s}\n${book[s].length ? book[s].map(p => fmt(p, s)).join('\n') : '(nessuno)'}`).join('\n\n')}\n`;
const size = pts => pts.reduce((n, p) => n + p.text.length, 0);
const words = s => new Set(s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
const overlap = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };
const clean = t => String(t ?? '').replace(/\s*·\s*/g, ', ').replace(/\s+/g, ' ').trim(); // "·" is the field separator

export function file(root, agent) {
  if (!AGENTS[agent]) refuse(`agente sconosciuto "${agent}": uno tra ${Object.keys(AGENTS).join(', ')}`);
  return path.join(root, 'playbooks', `${agent}.md`);
}
export const load = (root, agent) => { const f = file(root, agent); return fs.existsSync(f) ? parse(fs.readFileSync(f, 'utf8')) : { Punti: [], Proposti: [], Tolti: [] }; };

// The pure operations: book in, book out (or a refusal). Ids never reused (the highest ever seen + 1).
export function op(agent, book, cmd, { id, text, source, why, kind, date = today() } = {}) {
  const b = structuredClone(book);
  const find = (sec, i) => { const k = b[sec].findIndex(p => p.id === i); if (k < 0) refuse(`${i} non è tra i ${sec.toLowerCase()} di ${agent}`); return k; };
  if (cmd === 'propose') {
    const t = clean(text);
    if (!t) refuse('punto vuoto');
    if (t.length > MAX_POINT) refuse(`punto di ${t.length} caratteri, massimo ${MAX_POINT}: accorcialo`);
    if (!clean(source)) refuse('manca --source: un punto nasce da un errore, una lode o una frase di {{OWNER}}');
    const dup = [...b.Punti, ...b.Proposti].find(p => overlap(p.text, t) >= 0.6);
    if (dup) refuse(`quasi uguale a ${dup.id} ("${dup.text.slice(0, 80)}"): modifica quello invece di aggiungerne un altro`);
    const n = Math.max(0, ...SECTIONS.flatMap(s => b[s].map(p => +p.id.split('-')[1]))) + 1;
    b.Proposti.push({ id: `${AGENTS[agent]}-${n}`, up: 0, down: 0, text: t, source: clean(source), date, note: null });
  } else if (cmd === 'accept') {
    const [p] = b.Proposti.splice(find('Proposti', id), 1);
    if (size(b.Punti) + p.text.length > MAX_PUNTI) refuse(`i Punti di ${agent} supererebbero ${MAX_PUNTI} caratteri (di ${size(b.Punti) + p.text.length - MAX_PUNTI}): prima togli o accorcia un punto`);
    b.Punti.push({ ...p, date });
  } else if (cmd === 'reject' || cmd === 'remove') {
    const sec = cmd === 'reject' ? 'Proposti' : 'Punti';
    if (!clean(why)) refuse('manca --why');
    const [p] = b[sec].splice(find(sec, id), 1);
    b.Tolti.push({ ...p, date, note: `${cmd === 'reject' ? 'rifiutato' : 'tolto'}: ${clean(why)}` });
  } else if (cmd === 'edit') {
    const t = clean(text);
    if (!t || t.length > MAX_POINT) refuse(`testo vuoto o oltre ${MAX_POINT} caratteri`);
    const sec = b.Punti.some(p => p.id === id) ? 'Punti' : 'Proposti';
    const k = find(sec, id);
    if (sec === 'Punti' && size(b.Punti) - b.Punti[k].text.length + t.length > MAX_PUNTI) refuse(`i Punti di ${agent} supererebbero ${MAX_PUNTI} caratteri`);
    b[sec][k] = { ...b[sec][k], text: t };
  } else if (cmd === 'vote') {
    if (!['helpful', 'harmful'].includes(kind)) refuse('vote: helpful o harmful');
    for (const i of new Set(String(id).split(',').map(s => s.trim()).filter(Boolean))) {
      const k = find('Punti', i);
      b.Punti[k][kind === 'helpful' ? 'up' : 'down']++;
    }
  } else refuse(`comando sconosciuto ${cmd}`);
  return b;
}

export function summary(root) {
  return Object.keys(AGENTS).map(a => {
    const b = load(root, a);
    const review = b.Punti.filter(p => p.down > p.up).map(p => p.id);
    return { agent: a, punti: b.Punti.length, proposti: b.Proposti.map(p => p.id), size: size(b.Punti), review };
  });
}

/** Notebooks left by a specialist that no longer exists (its know-how moved to a skill): never read, never deleted. */
export function orphans(root) {
  const dir = path.join(root, 'playbooks');
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => f.endsWith('.md') && f !== 'README.md' && !AGENTS[f.slice(0, -3)]).sort();
}

// Lock (as env-lease): one writer at a time across chats; a lock older than 30 s is stale.
function withLock(root, fn) {
  const key = path.resolve(root).replace(/[\\/]+$/, '').toLowerCase(); // one lock whatever the spelling of the root
  const lock = path.join(os.tmpdir(), `{{BRAIN_NAME}}-playbook-${Buffer.from(key).toString('hex').slice(-16)}.lock`);
  const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  for (let i = 0; ; i++) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.unlinkSync(lock); } catch {}
      if (i > 100) refuse('taccuini bloccati da un\'altra chat da oltre 10 s: riprova');
      sleep(100);
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch {} }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const root = arg('--root') ?? '{{BRAIN}}';
  const [cmd, agent, third, fourth] = argv;
  try {
    if (cmd === 'list') {
      for (const s of summary(root)) console.log(`${s.agent}: ${s.punti} punti (${s.size}/${MAX_PUNTI} caratteri) · proposti: ${s.proposti.join(', ') || 'nessuno'}${s.review.length ? ` · da rivedere: ${s.review.join(', ')}` : ''}`);
      for (const f of orphans(root)) console.log(`playbooks/${f}: taccuino di uno specialista che non c'è più, nessuno lo legge: porta i punti utili nella skill che fa quel lavoro, poi toglilo`);
    } else if (['propose', 'accept', 'reject', 'edit', 'remove', 'vote'].includes(cmd)) {
      const text = arg('--file') ? fs.readFileSync(arg('--file'), 'utf8') : arg('--text');
      const out = withLock(root, () => {
        const before = load(root, agent);
        const after = op(agent, before, cmd, { id: third, text, source: arg('--source'), why: arg('--why'), kind: fourth });
        fs.mkdirSync(path.dirname(file(root, agent)), { recursive: true });
        fs.writeFileSync(file(root, agent), render(agent, after));
        return after;
      });
      const last = cmd === 'propose' ? out.Proposti[out.Proposti.length - 1].id : third;
      console.log(`${agent}: ${cmd} ${last} fatto · ${out.Punti.length} punti, ${out.Proposti.length} proposti (${path.relative(root, file(root, agent))})`);
    } else { console.error('playbook: propose | accept | reject | edit | remove | vote | list'); process.exit(3); }
  } catch (e) {
    console.error(`playbook: ${e.message}`);
    process.exit(e.code === 4 ? 4 : 3);
  }
}
