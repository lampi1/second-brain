// chat-prompt: the prompt of a new work chat, the same in Claude (chip spawn_task) and Cursor (link --open), so the
// Orchestrator writes only the job (hub.md "New chats"; {{OWNER}} 2026-10-09, "l’Orchestrator che mi apre altre chat con il prompt già
// ben scritto"). Fixed parts: role and title, what to read for the kind of work, where questions go, the now.md line
// via mem.mjs, the wait-devops / env-lease line. Checks the title (`<Area> · <cosa>`). Also `show`: the full first
// prompt of an old chat (Claude or Cursor), e.g. to reuse or review it. READ-ONLY.
// Usage:
//   node "{{BRAIN}}/ops/tools/chat-prompt.mjs" --title "A · Fix login" --kind code|qa|prod|os|research
//        [--harness claude|cursor] [--repo my-app] [--words "<{{OWNER}}'s words>"] (--job "<task>" | --job-file <path>)
//        [--thread "<words of its now.md line>"]  (a resume: the ctx.mjs pack of that line goes into the prompt, so the
//                    chat starts with the line and its files/branches/worktrees checked on disk, 2026-10-15)
//        [--app]    (the chat runs in the second-brain app: no inbox `wait` line, the app delivers the mail)
//        [--open]   (cursor only: opens the chat in Cursor with the prompt link, {{OWNER}} clicks "Create Chat"; the
//                    copy block is printed instead when the link is too long or Cursor refuses it)
//   node .../chat-prompt.mjs show <words of the title or of the first message> [--days 30]
// Job text with backslashes or several lines: write it to a file with Write and pass --job-file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { slug } from './inbox.mjs';
import { pack as ctxPack } from './ctx.mjs';

export const OPS = '{{BRAIN_JS}}';
const REPOS = '{{REPOS_JS}}';
const AREAS = ['A', 'B', 'Prod', 'OS', 'Pers'];
const rome = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export const READ = {
  code: ['code.md'],
  qa: ['code.md', 'rules\\qa.md'],
  prod: ['ops\\AGENTS.md', 'ops\\runbook\\index.md'],
  os: ['map.md', 'brain-rules.md', 'harness\\tools.md'],
  research: ['map.md'],
};
const KIND_RULES = {
  code: 'Lavoro sul codice con code workflow nel repo indicato; prima di dire "fatto" o di un commit, il sotto-agente `reviewer` sul diff (code.md). A che punto è il ramo (status, base, commit, merge in corso): `node "{{BRAIN}}/ops/tools/repo-state.mjs" <cartella>`, una chiamata.',
  qa: 'QA: scenario esatto dei test case, mai cambiato per aggirare un bug (resta Blocked); risultati sul tracker solo dopo l\'ok di {{OWNER}}.',
  prod: 'Produzione: proponi i comandi, li lancia {{OWNER}}; query sui DB di prod solo dall’Orchestrator (gli mandi il percorso del `.sql`); log e `az` in sola lettura li leggi tu (me.md "Safety").',
  os: 'Cervello: niente segreti nei file; permessi, settings e hook solo con l\'ok esplicito di {{OWNER}}; testo con backslash solo via Write/Edit; il contesto fisso non cresce; test offline, `reviewer` sul diff e `node ops\\tools\\brain-lint.mjs` prima del merge in main.',
  research: 'Solo ricerca e proposta: non cambiare niente finché {{OWNER}} non dice sì; fonti con data per ogni affermazione.',
};

// `<Area> · <cosa>`: Area from the list, cosa 1-3 words, no ids or PR numbers (hub.md "New chats").
export function checkTitle(title) {
  const m = String(title ?? '').match(/^(\S+) · (.+)$/);
  if (!m) return `titolo "${title}": serve "<Area> · <cosa>" (Area = ${AREAS.join(', ')})`;
  if (!AREAS.includes(m[1])) return `titolo "${title}": l'area "${m[1]}" non è tra ${AREAS.join(', ')}`;
  if (m[2].trim().split(/\s+/).length > 3) return `titolo "${title}": "${m[2]}" ha più di 3 parole`;
  if (/\d{3,}|#|!\d/.test(m[2])) return `titolo "${title}": niente id, numeri di PR o codici cliente`;
  return null;
}

export function buildPrompt({ title, kind, harness = 'claude', repo, words, job, date = rome(), app = false, context }) {
  const err = checkTitle(title) ?? (!READ[kind] ? `--kind deve essere uno tra ${Object.keys(READ).join(', ')}` : null) ?? (!job?.trim() ? 'manca il lavoro (--job o --job-file)' : null);
  if (err) throw new Error(err);
  const repoPath = repo ? (/^[A-Za-z]:[\\/]/.test(repo) ? repo : `${REPOS}\\${repo}`) : null;
  const read = [`${OPS}\\AGENTS.md`, ...READ[kind].map(f => `${OPS}\\${f}`)];
  const L = [];
  // Cursor: the Agents Window agent names its own chat with the built-in rename_chat tool, only when asked (tested 10/10)
  if (harness === 'cursor') L.push(`Prima cosa: rinomina questa chat in "${title}" con lo strumento rename_chat.`);
  L.push(`Sei la chat di lavoro "${title}" del cervello di {{OWNER}} (${OPS}). Italiano con {{OWNER}}; codice, commit e PR in inglese.`);
  if (harness === 'cursor') L.push(`Questa chat parte in ${OPS}${repoPath ? `; il repo di lavoro è ${repoPath} (usalo con percorsi assoluti e \`git -C\`, {{OWNER}} non apre quella cartella)` : ''}.`);
  else if (repoPath) L.push(`Repo di lavoro: ${repoPath}.`);
  L.push(`Prima di tutto leggi ${read.join(', ')}.`, '');
  if (words?.trim()) L.push(`Parole di {{OWNER}} (${date}): "${words.trim()}"`, '');
  L.push('Compito:', job.trim(), '');
  if (context?.trim()) L.push(`Contesto del filo (ctx.mjs, letto dai file veri al lancio: parti da qui, i file interi solo se servono):`, context.trim(), '');
  L.push('Regole:');
  L.push(`- ${KIND_RULES[kind]}`);
  const me = slug(title);
  const INBOX = 'node "{{BRAIN}}/ops/tools/inbox.mjs"';
  // 2026-10-13 "l’Orchestrator mi serve principalmente per lo stato": each chat asks {{OWNER}} itself, the app pops it up or queues it
  L.push(`- Domande e comandi per {{OWNER}} li fai tu, qui: domande con i pannelli (${harness === 'cursor' ? 'AskQuestion' : 'AskUserQuestion'}; 2-3 opzioni, la consigliata prima), comandi come un solo blocco \`powershell\` (l'app lo mostra con Esegui); prima, in 1-3 righe, il contesto e il perché (cosa vedrà, cosa cambia). L'app li mostra in popup o in coda: mai mandarli all’Orchestrator. All’Orchestrator solo risultati e stato con \`${INBOX} send --to "orchestrator" --from "${me}" --file <testo scritto con Write>\`; query su DB di produzione: all’Orchestrator (DB, perché, percorso del .sql).`);
  // --app: the second-brain app delivers mail to its chats itself, mid-turn too: a `wait` would only wake the chat for
  // nothing every 2 h (2026-10-13 zero-token audit: 115 waits a week)
  if (app) L.push(`- Posta tra chat: te la consegna l'app second-brain da sé, anche a metà turno (niente \`wait\`); per scrivere usa send_to_chat. I passaggi operativi (build pronta, stack libero, fix pronto per la QA) li mandi tu direttamente alla chat interessata; domande e comandi per {{OWNER}} li fai tu qui (sopra).`);
  else L.push(`- Posta tra chat (Claude e Cursor): appena partita lancia in background \`${INBOX} wait --me "${me}"\` e rilancialo dopo ogni messaggio ricevuto; i passaggi operativi (build pronta, stack libero, fix pronto per la QA) li mandi tu direttamente alla chat interessata con \`${INBOX} send --to "<chat>" --from "${me}" --file <testo>\`; domande e comandi per {{OWNER}} li fai tu qui (sopra).`);
  L.push(`- Tieni la tua riga in now.md, mai a mano: \`node "{{BRAIN}}/ops/tools/mem.mjs" now me --label "${title}" --text "<dove · stato · prossimo passo>"\`; a lavoro chiuso \`now me --label "${title}" --del\`; per rileggere righe di now.md \`now show --label "${title}"\` (o \`--match "<parole>"\`), mai il file intero.`);
  L.push('- Se {{OWNER}} ti corregge o scopri un tuo errore: una riga con `node "{{BRAIN}}/ops/tools/mem.mjs" error --text "<riga>"` (formato in ai-errors.md).');
  // 2026-10-11: 10 chats ran full suites together, CPU 100%, ~1 h lost (code.md "Heavy test suites")
  L.push('- Suite di test pesanti (check completo, e2e, vitest intero): una alla volta sulla macchina, con lo stesso turno sull\'ambiente dei test del repo (`sb-tests` per second-brain-app): `wait` in background → suite → `release` sempre, anche se fallisce; senza turno solo singoli file di test; un timeout preso a PC carico non prova niente.');
  // 2026-10-15: a CPU load generator + repeated e2e by day blocked his work chats for over an hour (code.md "Load tests only at night")
  L.push('- Test di carico, stress, generatori di CPU/RAM, benchmark sotto carico, e2e ripetuti per caricare la macchina: solo di notte, fuori dal suo orario di lavoro, mai di giorno su questo PC (è il PC in cui lavora); di giorno programmali per la notte e dillo.');
  return L.join('\n');
}

// Cursor prompt link: Cursor shows "Create chat with prompt", one click on "Create Chat" opens a new Agents Window chat
// with the prompt in it (never sent by itself). Docs cap a link at 10,000 chars: past LINK_MAX the copy block is used.
export const LINK_MAX = 9000;
export const promptLink = prompt => 'cursor://anysphere.cursor-deeplink/prompt?text=' + encodeURIComponent(prompt);

// Direct and waited launch: a detached start died silently on 10/10 and the link never reached Cursor. Only with Cursor
// already open: then Cursor.exe hands the link to it and exits; with Cursor closed it would become the app itself and
// never exit (the timeout would kill it under {{OWNER}}'s eyes).
const cursorOpen = () => /cursor\.exe/i.test(spawnSync('tasklist', ['/FI', 'IMAGENAME eq Cursor.exe', '/NH'], { encoding: 'utf8' }).stdout ?? '');
export function openInCursor(url, { exe = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'cursor', 'Cursor.exe'), run = spawnSync, isOpen = cursorOpen } = {}) {
  if (url.length > LINK_MAX) return { ok: false, why: `link di ${url.length} caratteri, oltre ${LINK_MAX}` };
  if (!fs.existsSync(exe)) return { ok: false, why: `Cursor non trovato in ${exe}` };
  if (!isOpen()) return { ok: false, why: 'Cursor è chiuso: aprilo e rilancia, o usa il blocco' };
  const r = run(exe, ['--open-url', '--', url], { encoding: 'utf8', timeout: 30000 });
  if (r.error || r.status !== 0) return { ok: false, why: `Cursor --open-url: ${r.error?.message ?? `uscita ${r.status}`}` };
  return { ok: true };
}

// Open chats with the same label in now.md (main checkout): the title must be unique among open chats.
export function sameLabel(title, nowText) {
  return nowText.split(/\r?\n/).filter(l => l.startsWith(`- **${title}**`));
}

// First prompt of an old chat: Claude transcripts (title or first message) and Cursor transcripts (first message).
export function findFirstPrompts(query, { claudeRoot, cursorRoot, days = 30 }) {
  const ws = query.toLowerCase().split(/\s+/).filter(Boolean);
  // whole words only: "os" must not hit "possono"
  const hasWords = s => { const set = new Set(String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u)); return ws.every(w => set.has(w)); };
  const since = Date.now() - days * 864e5;
  const hits = [];
  const each = (dir, fn) => { let e = []; try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch {} for (const x of e) fn(path.join(dir, x.name), x); };
  const typed = t => [...String(t).matchAll(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/g)].map(m => m[1]).join('\n').trim() || String(t).trim();
  each(claudeRoot, (d, x) => x.isDirectory() && each(d, (f, y) => {
    if (!y.isFile() || !f.endsWith('.jsonl') || fs.statSync(f).mtimeMs < since) return;
    let title = '', first = '', at = 0;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type === 'custom-title') title = j.customTitle;
      if (!first && j.type === 'user' && !j.isMeta) {
        const c = j.message?.content;
        // a chip's first message starts with <system-reminder> blocks (worktree notice), then the prompt
        const t = (typeof c === 'string' ? c : Array.isArray(c) && !c.some(p => p.type === 'tool_result') ? c.filter(p => p.type === 'text').map(p => p.text).join('\n') : '')
          .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
        if (t && !t.startsWith('<')) { first = t; at = Date.parse(j.timestamp); }
      }
    }
    const titleHit = hasWords(title);
    if (first && (titleHit || hasWords(`${title}\n${first}`))) hits.push({ harness: 'Claude', title: title || '(senza titolo)', at, first, titleHit });
  }));
  each(cursorRoot, d => each(path.join(d, 'agent-transcripts'), (td, y) => {
    if (!y.isDirectory()) return;
    const f = path.join(td, `${y.name}.jsonl`);
    let st; try { st = fs.statSync(f); } catch { return; }
    if (st.mtimeMs < since) return;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.role !== 'user') continue;
      const first = typed((j.message?.content || []).map(c => c.text || '').join('\n'));
      if (first && hasWords(first)) hits.push({ harness: 'Cursor', title: `chat ${y.name.slice(0, 8)}`, at: st.mtimeMs, first, titleHit: false });
      break;
    }
  }));
  return hits.sort((a, b) => (b.titleHit - a.titleHit) || (b.at - a.at));
}

function main() {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv[0] === 'show') {
    const q = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--')).join(' ');
    if (!q) { console.error('usage: chat-prompt.mjs show <words> [--days 30]'); process.exit(1); }
    const hits = findFirstPrompts(q, {
      claudeRoot: arg('--claude-root') ?? path.join(os.homedir(), '.claude', 'projects'),
      cursorRoot: arg('--cursor-root') ?? path.join(os.homedir(), '.cursor', 'projects'), days: Number(arg('--days') ?? 30),
    });
    if (!hits.length) { console.log(`Nessuna chat con "${q}" negli ultimi ${arg('--days') ?? 30} giorni.`); process.exitCode = 1; return; }
    const h = hits[0];
    const when = new Date(h.at).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 16);
    console.log(`${h.harness} · ${h.title} · ${when}${hits.length > 1 ? ` (altre ${hits.length - 1}: ${hits.slice(1, 4).map(x => x.title).join(', ')})` : ''}\n\n${h.first}`);
    return;
  }
  const job = arg('--job-file') ? fs.readFileSync(arg('--job-file'), 'utf8') : arg('--job');
  const title = arg('--title');
  try {
    let context;
    if (arg('--thread')) {
      const r = ctxPack({ match: arg('--thread'), footer: false });
      if (!r.ok) throw new Error(`--thread: ${r.text}`);
      context = r.text;
    }
    const prompt = buildPrompt({ title, kind: arg('--kind'), harness: arg('--harness') ?? 'claude', repo: arg('--repo'), words: arg('--words'), job, app: argv.includes('--app'), context });
    const nowFile = arg('--now') ?? path.join(OPS, 'now.md');
    const dup = fs.existsSync(nowFile) ? sameLabel(title, fs.readFileSync(nowFile, 'utf8')) : [];
    if (dup.length) console.error(`attenzione: in now.md c'è già una riga "${title}" (${dup[0].slice(0, 90)}…): titolo unico tra le chat aperte, o è la stessa chat?`);
    if (argv.includes('--open')) {
      if ((arg('--harness') ?? 'claude') !== 'cursor') throw new Error('--open serve solo con --harness cursor (Claude: chip spawn_task)');
      const r = openInCursor(promptLink(prompt));
      if (r.ok) { console.log(`aperta in Cursor: {{OWNER}} clicca "Create Chat" (la chat si rinomina "${title}" da sola)`); return; }
      console.error(`link non usato (${r.why}): blocco da copiare qui sotto`);
    }
    console.log(prompt);
  } catch (e) { console.error(`chat-prompt: ${e.message}`); process.exit(1); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
