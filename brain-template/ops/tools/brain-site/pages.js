// Brain site pages. Each page: one bold line that says the key fact, then charts and tables from the real files.
// Every chart and table opens with an explain box (app.js explain()): the most interesting fact computed from the data,
// in bold, the next step it suggests, and in small what it says and why it matters ({{OWNER}} 2026-10-10: "le info devono
// catturare la mia attenzione e soddisfare la mia curiosità"). Columns carry a `help` shown on mouse-over.
'use strict';
(() => {
  const { page, api, el, fmt, daysAgo, table, chart, md, head, section, kpis, loading, errorBox, tabs } = App;
  const E = App.esc;
  const sum = a => a.reduce((x, y) => x + (y || 0), 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const entries = (o, by = 'usd') => Object.entries(o ?? {}).filter(([k, v]) => k !== '<synthetic>' && (v?.[by] ?? v) > 0).sort((a, b) => (b[1]?.[by] ?? b[1]) - (a[1]?.[by] ?? a[1]));
  const pill = (text, kind = '') => el(`span.pill${kind ? `.${kind}` : ''}`, text);
  const ageCell = d => { if (!d) return ''; const n = daysAgo(d); return pill(n <= 0 ? 'oggi' : n === 1 ? 'ieri' : `${n} giorni fa`, n > 7 ? 'bad' : n > 3 ? 'warn' : 'good'); };
  const fileLink = (p, text) => el('a', { href: `#esplora/${encodeURI(p)}` }, text ?? p);
  const short = (s, n = 80) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''));
  const baseName = s => String(s ?? '').replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  const countBy = (rows, key) => Object.entries(rows.reduce((m, r) => ((m[r[key] || '—'] = (m[r[key] || '—'] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const tablesP = () => api('/api/tables');
  // replaceChildren would print a null part as the text "null": optional parts are dropped here
  const put = (node, ...parts) => node.replaceChildren(...parts.flat().filter(p => p != null && p !== false));
  const HELP = {
    ctx: 'Quanti token la chat rileggeva a ogni messaggio, al massimo. Sopra 400k ogni messaggio costa molto: meglio ripartire.',
    usd: 'Stima a prezzi API (con l\'abbonamento non viene addebitata): serve a confrontare, non è una fattura.',
    calls: 'Quante volte il modello ha usato uno strumento (leggere, scrivere, lanciare comandi).',
    save: 'Quanto avresti risparmiato ripartendo la chat a ~200k di contesto invece di continuarla.',
  };

  // ---------- Fatto, Da fare and the stand-up ({{OWNER}} 2026-10-10: "più essenziali e comprensibili con i link ai bug
  // devops e pr... macroargomentizzare... per lo standup"): rows from day.mjs --json grouped by macro-topic, names not
  // numbers (the id only inside the link), technical detail folded away.
  const AREA_NAME = { Alfa: 'Alfa', Beta: 'Beta', Produzione: 'Produzione', 'Personale e OS': 'second-brain e personale', Altro: 'Bug di Triage (da validare)' };
  const WORK = ['Alfa', 'Beta', 'Produzione']; // what goes in the team stand-up
  // names not numbers: drop a leading "#1234", a conventional-commit prefix and "{{OWNER}}" written in third person
  const clean = s => String(s ?? '').replace(/^\s*#\d+\s*/, '').replace(/^\s*(fix|feat|chore|refactor|docs|test)(\([^)]*\))?:\s*/i, '').replace(/\s+/g, ' ').trim();
  const firstPerson = s => String(s ?? '').replace(/\bOwner\s+/g, '');
  const bugName = t => clean(String(t ?? '').replace(/^\[[^\]]+\]\s*-?\s*/, ''));
  const topicOf = t => String(t ?? '').match(/^\[([^\]]+)\]/)?.[1] ?? '';
  // a PR is named after the bug it fixes (Italian, what QA and colleagues know), else after its own cleaned title
  const prName = pr => { const b = (pr.items ?? []).find(i => !/^P-/.test(i.type)); return b ? bugName(b.title) : clean(pr.title); };
  const link = (url, text) => (url ? el('a', { href: url, target: '_blank', rel: 'noopener' }, text) : el('span', text));
  // a diary line, readable: no "[personale]" tag, cut at the first sentence end, at most n chars
  const firstClause = (s, n = 110) => short(clean(String(s ?? '').replace(/\[personale\]\s*/gi, '')).split(/(?<=[.;])\s/)[0], n);
  const quote = s => `«${s}»`;
  const list3 = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} e ${a[a.length - 1]}`);

  // One line per thing done, grouped by macro-topic.
  function doneView(rep) {
    if (!rep?.rows) return el('p.muted', 'Report non disponibile.');
    const by = {};
    for (const r of rep.rows) {
      if (r.kind === 'diario' && !/fatto|verificato|decisione/i.test(r.tag)) continue;
      (by[r.area] ??= []).push(r);
    }
    const lineOf = r => r.kind === 'pr-unita' ? el('li', pill('PR unita', 'good'), ' ', link(r.url, clean(r.title)))
      : r.kind === 'pr-aperta' ? el('li', pill('PR aperta'), ' ', link(r.url, clean(r.title)))
      : r.kind === 'work-item' ? el('li', pill(r.state), ' ', link(r.url, bugName(r.title)), topicOf(r.title) ? el('span.muted', ` · ${topicOf(r.title)}`) : null)
      : r.kind === 'diario' ? el('li', pill(r.tag.replace(/\[personale\]\s*/i, '')), ' ', firstClause(r.title))
      : r.kind === 'chat' ? el('li', pill('chat'), ' ', r.title, el('span.muted', ` · ${r.from}-${r.to}`))
      : el('li', pill('Cursor'), ' ', short(r.title, 90));
    const areas = (rep.areas ?? Object.keys(by)).filter(a => by[a]?.length);
    const warn = rep.devops === false ? noDevops() : null;
    if (!areas.length) return el('div', warn, el('p.muted', 'Niente registrato per questo giorno.'));
    return el('div', warn, el('div.topics', areas.map(a => el('div.topic.card', el('h3', AREA_NAME[a] ?? a), el('ul.done', by[a].slice(0, 12).map(lineOf)),
      by[a].length > 12 ? el('p.muted.small', `… e altre ${by[a].length - 12}`) : null)),
      el('details.small', el('summary', 'Dettaglio tecnico (report completo, commit)'), md(rep.text ?? '', { base: `giornata-${rep.day}` }))));
  }
  // DevOps not read (az login expired): said on screen, never hidden in the details
  const noDevops = () => el('p.error', 'DevOps non letto (az login scaduto?): qui mancano PR e work item. Rilancia "az login" e premi Aggiorna.');

  // One block per macro-topic of what is open: your PRs (named after their bug), work items, now.md threads.
  function todoView(br) {
    if (!br?.threads) return el('p.muted', 'Brief non disponibile.');
    const by = {};
    for (const p of br.prs ?? []) (by[p.area] ??= []).push({ kind: 'pr', ...p });
    for (const i of (br.items ?? []).filter(i => !i.triage)) (by[i.area] ??= []).push(i);
    for (const t of (br.threads ?? []).filter(t => !t.done && !/^Agenti e sessioni/.test(t.section))) (by[t.area] ??= []).push({ kind: 'thread', ...t });
    const triage = (br.items ?? []).filter(i => i.triage);
    const lineOf = r => r.kind === 'pr' ? el('li', pill(r.build === 'succeeded' ? 'build verde' : r.build ? `build ${r.build}` : 'PR', r.build === 'succeeded' ? 'good' : r.build ? 'bad' : ''), ' ', link(r.url, prName(r)),
        el('span.muted', ` · PR verso ${r.target}${r.votes ? ` · voti: ${r.votes}` : ''}`),
        r.items?.length ? el('details.small', el('summary', `${r.items.length} work item collegati`), el('ul.done', r.items.map(i => el('li', pill(i.state), ' ', link(i.url, bugName(i.title)), i.assignee ? el('span.muted', ` · a ${i.assignee}`) : null)))) : null)
      : r.kind === 'work-item' ? el('li', pill(r.state), ' ', link(r.url, bugName(r.title)), el('span.muted', ` · ${r.type}${topicOf(r.title) ? ` · ${topicOf(r.title)}` : ''}`))
      : el('li', r.stale ? pill('fermo', 'bad') : pill('filo'), ' ', el('b', r.label), r.next ? ` · ${short(r.next.replace(/^prossimo:\s*/i, ''), 120)}` : '');
    const areas = (br.areas ?? Object.keys(by)).filter(a => by[a]?.length);
    return el('div', br.devops === false ? noDevops() : null, el('div.topics', areas.map(a => el('div.topic.card', el('h3', AREA_NAME[a] ?? a), el('ul.done', by[a].map(lineOf)))),
      triage.length ? el('div.topic.card', el('h3', AREA_NAME.Altro), el('p.muted.small', 'Si toccano solo dopo la validazione di un umano.'), el('ul.done', triage.map(lineOf))) : null,
      el('details.small', el('summary', 'Dettaglio tecnico (brief completo)'), md(br.text ?? '', { base: 'brief' }))));
  }

  // 3-5 sentences to read aloud: yesterday (last day with a diary), today, blockers. Work topics only.
  function standupText(rep, br) {
    const S = [];
    const did = WORK.map(a => {
      const rows = (rep?.rows ?? []).filter(r => r.area === a);
      const merged = rows.filter(r => r.kind === 'pr-unita'), opened = rows.filter(r => r.kind === 'pr-aperta');
      const bits = [
        ...(merged.length ? [`ho unito ${merged.length === 1 ? 'la PR' : `${merged.length} PR:`} ${list3(merged.slice(0, 3).map(r => quote(short(clean(r.title), 60))))}`] : []),
        ...(opened.length ? [`ho aperto ${opened.length === 1 ? 'la PR' : `${opened.length} PR:`} ${list3(opened.slice(0, 3).map(r => quote(short(clean(r.title), 60))))}`] : []),
        // a diary line said aloud: its subject (before ":"), without the area label ("A · QA export: …" → "QA export")
        ...rows.filter(r => r.kind === 'diario' && /fatto/i.test(r.tag)).map(r => `ho chiuso ${quote(short(String(r.title).split(':')[0].replace(/^\[personale\]\s*/i, '').replace(/^(A|B|Prod|OS|Pers) · /, '').trim(), 60))}`),
        ...rows.filter(r => r.kind === 'chat' && r.his > 0).map(r => `ho lavorato a ${quote(r.title.replace(/^(A|B|Prod) · /, ''))}`),
      ];
      return bits.length ? `${a}: ${list3([...new Set(bits)].slice(0, 3))}.` : null;
    }).filter(Boolean);
    S.push(did.length ? `${rep?.day ? fmt.day(rep.day).replace(/^\w/, c => c.toUpperCase()) : 'Ieri'} · ${did.join(' ')}` : 'Ieri niente di registrato sul lavoro.');
    const prs = (br?.prs ?? []).filter(p => WORK.includes(p.area));
    if (prs.length) S.push(`Ho ${prs.length} PR aperte: ${list3(prs.slice(0, 3).map(p => quote(prName(p))))}${prs.some(p => /nessuno/.test(p.votes ?? '')) ? ', aspettano revisione' : ''}.`);
    const next = (br?.threads ?? []).filter(t => !t.done && WORK.includes(t.area) && !/^Agenti e sessioni/.test(t.section) && /prossimo/i.test(t.next) && !t.stale);
    if (next.length) S.push(`Oggi: ${list3(next.slice(0, 3).map(t => `${t.label.replace(/^(A|B|Prod) · /, '')} (${short(t.next.replace(/^prossimo:\s*/i, ''), 70)})`))}.`);
    const wait = (br?.threads ?? []).filter(t => !t.done && WORK.includes(t.area) && /aspetta/i.test(t.next));
    if (wait.length) S.push(`Aspetto: ${list3(wait.slice(0, 2).map(t => `${t.label.replace(/^(A|B|Prod) · /, '')} (${short(t.next.replace(/^aspetta\w*:?\s*/i, ''), 60)})`))}.`);
    return firstPerson(S.join('\n'));
  }
  function standupBox(prevDay) {
    const box = el('div.card.standup', el('div.section-head', el('h2', 'Per lo standup'), el('p', 'Lavoro di ieri e di oggi, da leggere a voce')), loading('Preparo le frasi (DevOps e diario)…'));
    Promise.all([api(`/api/day?date=${prevDay}`), api('/api/day?kind=brief')]).then(([rep, br]) => {
      // a failed read is said, never turned into "nothing done"
      if (!rep?.value || !br?.value) { box.replaceChildren(box.firstChild, errorBox(rep?.error ?? br?.error ?? 'report non disponibile')); return; }
      const text = standupText(rep.value, br.value);
      box.replaceChildren(...[box.firstChild, rep.value.devops === false || br.value.devops === false ? noDevops() : null, el('div.standup-text', text.split('\n').map(s => el('p', s))),
        el('div.btn-row', el('button.btn.primary', { type: 'button', onclick: () => navigator.clipboard?.writeText(text).then(() => App.toast('Frasi copiate'), () => App.toast('Copia non riuscita: seleziona il testo')) }, 'Copia'),
          el('span.muted.small', `Fatto dal ${fmt.day(prevDay)} (diario, chat${rep.value.devops === false ? '' : ', DevOps'}); da fare dal brief e da now.md.`))].filter(Boolean));
    }).catch(e => box.replaceChildren(box.firstChild, errorBox(e)));
    return box;
  }

  // ---------- DevOps names and links (v2, {{OWNER}} 2026-10-11 "i link anche delle cose di devops"): numbers in now.md
  // and chat text ("PR 12", "!12", "#1234", "1234") become a link named after the thing, built from the live
  // brief (your PRs and their work items, your work items). A number the brief does not know stays as it is.
  function devopsIndex(br) {
    const idx = new Map();
    const add = (id, url, name, kind) => { if (id && url && !idx.has(id)) idx.set(id, { url, name, kind }); };
    for (const p of br?.prs ?? []) {
      add(p.url.match(/pullrequest\/(\d+)/)?.[1], p.url, prName(p), 'PR');
      for (const i of p.items ?? []) add(i.url.match(/edit\/(\d+)/)?.[1], i.url, bugName(i.title), i.type.split(' ')[0]);
    }
    for (const i of br?.items ?? []) add(i.url.match(/edit\/(\d+)/)?.[1], i.url, bugName(i.title), i.type);
    return idx;
  }
  function linkify(text, idx) {
    const s = String(text ?? '');
    const re = /(?<![\w!#])(PR\s*!?|!|#)?(\d{4,6})\b/g;
    const out = []; let last = 0, m;
    while ((m = re.exec(s))) {
      const id = m[2], hit = idx?.get(id);
      const allowed = m[1] || id.length >= 5; // a bare 4-digit number is a year or a time, never a PR
      if (!hit || !allowed) continue;
      out.push(s.slice(last, m.index), el('a', { href: hit.url, target: '_blank', rel: 'noopener', title: `${hit.kind} ${id}` }, `${hit.kind === 'PR' ? 'PR ' : ''}«${short(hit.name, 50)}»`));
      last = m.index + m[0].length;
    }
    out.push(s.slice(last));
    return el('span', out);
  }
  const briefP = () => api('/api/day?kind=brief').then(r => r.value ?? null).catch(() => null);
  const nowP = () => api('/api/now').then(r => r.value ?? null).catch(() => null);
  const lastDiaryDay = t => [...new Set(t.journal.map(r => r.data))].filter(d => d < t.today).sort().pop() ?? t.today;
  // "now" is recent: working in the last 2 hours, waiting for you since less than a day; older ones are listed as stopped
  const recent = (c, min) => c.ageMin == null || c.ageMin <= min;
  const isLive = c => /in corso/.test(c.state) && recent(c, 120), waitsYou = c => /aspetta/.test(c.state) && recent(c, 24 * 60);
  const ago = c => (c.ageMin == null ? c.when : c.ageMin < 60 ? `${c.ageMin} min fa` : c.ageMin < 1440 ? `${Math.round(c.ageMin / 60)} h fa` : `${Math.round(c.ageMin / 1440)} giorni fa`);
  const chatName = c => c.title || '(senza titolo)';

  // ---------- Home (v2: "uno che non conosce il second brain sa cosa è"; 3-5 useful things, the rest one click away)
  page('home', 'Home', async main => {
    const t = await tablesP();
    const cards = el('div.cards');
    put(main,
      el('section.hero', el('h1', 'second-brain'),
        el('p', { html: 'Il <b>secondo cervello</b> di Owner: le regole, la memoria e gli agenti che fanno lavorare le sue chat di intelligenza artificiale.' }),
        el('p.muted', 'Qui vedi cosa stanno facendo le chat adesso, cosa hai fatto, cosa ti aspetta e quanto costa. Tutto letto dai file sul PC, senza spendere token.')),
      cards);
    const tile = (eyebrow, ...kids) => el('div.tile.card', el('span.eyebrow', eyebrow), ...kids);
    // 1. Adesso
    const adesso = tile('Adesso', loading('Guardo le chat…'));
    // 2. Stand-up
    const stand = standupBox(lastDiaryDay(t));
    // 3. Da fare
    const todo = tile('Da fare', loading('Leggo DevOps…'));
    // 4. Spesa
    const spesa = tile('Spesa', loading('Calcolo…'));
    // 5. Idee + mappa
    const ai = t.ideas.filter(i => i.chi === 'IA');
    // Focus rule ({{OWNER}} 2026-10-11, "poche e utili"): at most 5 blocks; the ideas card only when the AI proposed one
    const aiOpen = ai.filter(i => i.stato === 'aperta');
    const ideas = aiOpen.length ? tile("Spunti dell'IA", el('span.big', String(aiOpen.length)), el('p', el('b', short(aiOpen[0].titolo, 80))), el('a.go', { href: '#spunti' }, 'Leggili →')) : null;
    const map = el('div.tile.card.cta', el('span.eyebrow', 'Come funziona'), el('p', 'Le chat, gli agenti, la memoria e le regole del cervello, in 3D, con i percorsi passo per passo.'),
      el('button.map-btn', { type: 'button', onclick: () => { location.hash = 'mappa'; } }, 'Apri la mappa 3D'));
    cards.append(...[adesso, todo, spesa, ideas ?? map].filter(Boolean));
    main.insertBefore(stand, cards);
    nowP().then(n => {
      const chats = n?.chats ?? [];
      const live = chats.filter(isLive), wait = chats.filter(waitsYou);
      adesso.replaceChildren(el('span.eyebrow', 'Adesso'), el('span.big', String(live.length + wait.length)),
        el('p', `${live.length} chat al lavoro`, wait.length ? el('b', `, ${wait.length} aspettano te`) : ''),
        el('ul', [...wait, ...live].slice(0, 4).map(c => el('li', pill(waitsYou(c) ? 'aspetta te' : 'al lavoro', waitsYou(c) ? 'warn' : 'blue'), ' ', chatName(c)))),
        el('a.go', { href: '#adesso' }, 'Guarda cosa fanno →'));
    });
    briefP().then(br => {
      if (!br) { todo.replaceChildren(el('span.eyebrow', 'Da fare'), errorBox('brief non disponibile')); return; }
      const idx = devopsIndex(br);
      const mine = (br.prs ?? []).filter(p => WORK.includes(p.area));
      const decide = (br.threads ?? []).filter(x => !x.done && /decide|sceglie|aspetta te|aspetta owner/i.test(x.next) && !/^Agenti e sessioni/.test(x.section));
      todo.replaceChildren(el('span.eyebrow', 'Da fare'), el('span.big', String(mine.length + decide.length)),
        el('p', `${mine.length} tue PR aperte, ${decide.length} decisioni che aspettano te`),
        el('ul', [...mine.slice(0, 2).map(p => el('li', pill('PR'), ' ', link(p.url, short(prName(p), 48)))), ...decide.slice(0, 1).map(x => el('li', pill('decidi', 'warn'), ' ', el('b', short(x.label, 48))))]),
        br.devops === false ? noDevops() : null, el('a.go', { href: '#dafare' }, 'Tutto il da fare →'));
    });
    Promise.all([api('/api/cost?days=1'), api('/api/cost?days=14')]).then(([d1, d14]) => {
      const days = Object.entries(d14.value?.byDay ?? {}).sort(([a], [b]) => a.localeCompare(b));
      const max = Math.max(1, ...days.map(([, v]) => v.usd));
      const avg = days.length ? sum(days.map(([, v]) => v.usd)) / days.length : 0;
      const today = d1.value?.total ?? 0;
      spesa.replaceChildren(el('span.eyebrow', 'Spesa di oggi'), el('span.big', fmt.usd(today)),
        el('p', `media ${fmt.usd(avg)} al giorno nelle ultime 2 settimane`),
        el('div.spark', { role: 'img', 'aria-label': 'Spesa degli ultimi 14 giorni' }, days.map(([d, v]) => el(`i${d === t.today ? '.today' : ''}`, { style: `height:${Math.max(4, (v.usd / max) * 100)}%`, title: `${fmt.day(d)}: ${fmt.usd(v.usd)}` }))),
        el('a.go', { href: '#costi' }, 'Dove va la spesa →'));
    }).catch(e => spesa.replaceChildren(el('span.eyebrow', 'Spesa'), errorBox(e)));
  });

  // ---------- Adesso (v2: "un posto dove vedere tutto ciò che sto facendo adesso"): the real chats, refreshed every
  // 20 s by the page (zero tokens: harness/cursor/chats.mjs reads the transcripts), each with a message box.
  page('adesso', 'Adesso', async main => {
    const list = el('div.section'), stamp = el('span.small.muted');
    let stop = false, timer = null;
    const ask = composer({ title: 'Chiedi a una chat', hint: 'Il messaggio arriva nella posta della chat (inbox.mjs) e la sveglia se è in ascolto. Zero token finché la chat non lo legge.' });
    put(main, head('Adesso', 'Le chat di Claude e Cursor che stanno lavorando ora, cosa fanno e cosa aspettano da te. <b>Si aggiorna da sola.</b>'),
      el('div.btn-row', el('span.live-dot', { 'aria-hidden': 'true' }), stamp, el('button.btn', { type: 'button', onclick: () => draw(true) }, 'Aggiorna ora')),
      list, ask.node);
    // the chats first; the DevOps names arrive with the brief (up to ~15 s the first time) and the cards are redrawn
    let idx = new Map();
    briefP().then(br => { idx = devopsIndex(br); if (!stop) draw(); });
    async function draw(fresh = false) {
      let n; try { n = (await api('/api/now', { fresh })).value; } catch (e) { list.replaceChildren(errorBox(e)); return; }
      if (stop) return;
      const chats = n?.chats ?? [];
      ask.setTargets(n?.boxes ?? []);
      const group = (title, rows, note) => rows.length ? el('section.section', el('div.section-head', el('h2', `${title} (${rows.length})`), note ? el('p', note) : null), el('div.chat-grid', rows.map(c => chatCard(c, idx, ask)))) : null;
      const wait = chats.filter(waitsYou), live = chats.filter(isLive), rest = chats.filter(c => !waitsYou(c) && !isLive(c));
      put(list,
        !wait.length && !live.length ? el('p.lead', 'Nessuna chat al lavoro in questo momento.') : null,
        group('Aspettano te', wait, 'hanno una domanda o un comando per te'),
        group('Al lavoro', live, 'stanno facendo qualcosa adesso'),
        rest.length ? el('details', el('summary', `Finite o ferme nelle ultime 48 ore (${rest.length})`), el('div.chat-grid', rest.map(c => chatCard(c, idx, ask)))) : null,
        el('details', el('summary', 'Posta tra le chat'), el('p.small.muted', `${(n?.boxes ?? []).filter(b => b.listening).length} chat in ascolto. `, el('a', { href: '#collabora' }, 'Registro completo →'))));
      stamp.textContent = `aggiornato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
    await draw();
    timer = setInterval(() => { if (!document.hidden) draw(); }, 20000);
    return () => { stop = true; clearInterval(timer); };
  });
  function chatCard(c, idx, ask) {
    const st = waitsYou(c) ? pill('aspetta te', 'warn') : isLive(c) ? pill('al lavoro', 'blue') : /fermo/.test(c.state) ? pill('fermo', 'bad') : pill('finita', 'good');
    return el('article.chat-card.card',
      el('div.top-line', st, pill(c.harness), c.box?.listening ? pill('in ascolto') : null, el('span.meta-line', `${ago(c)}${/worktree/.test(c.folder) ? ' · worktree' : ''}`)),
      el('h3', chatName(c)),
      c.now?.prossimo ? el('p.next', '→ ', linkify(c.now.prossimo.replace(/^prossimo:\s*/i, ''), idx)) : null,
      c.last ? el('p.last', el('span.muted', 'Ultimo messaggio: '), linkify(c.last, idx)) : null,
      c.lastOwner ? el('p.meta-line', `Tu: «${short(c.lastOwner, 120)}»`) : null,
      c.box ? el('div.btn-row', el('button.btn', { type: 'button', onclick: () => ask.open(c.box.name, chatName(c)) }, 'Scrivi a questa chat')) : el('p.meta-line', 'Senza casella di posta: scrivile dalla sua finestra.'));
  }

  // Message box: pick a chat, a ready phrase or your own text, then confirm. Sent through /api/send → inbox.mjs, which
  // marks it as not written by Owner: no ok or permission travels this way.
  function composer({ title, hint }) {
    const sel = el('select', { 'aria-label': 'Chat a cui scrivere' });
    const ta = el('textarea', { placeholder: 'Scrivi cosa vuoi chiedere…', 'aria-label': 'Testo del messaggio', maxlength: 2000 });
    const confirm = el('div.confirm', { hidden: true });
    const phrases = ['A che punto sei? Rispondimi in 3 righe.', 'Riprendi da dove eri rimasta.', 'Spiegami in parole semplici cosa stai facendo.', 'Cosa ti serve da me per andare avanti?'];
    const node = el('section.section.card.composer', { id: 'composer' }, el('h2', title), el('p.small.muted', hint),
      el('div.btn-row', el('label.small', 'A:'), sel),
      el('div.chips', phrases.map(p => el('button', { type: 'button', onclick: () => { ta.value = p; ta.focus(); } }, p))),
      ta, el('div.btn-row', el('button.btn.primary', { type: 'button', onclick: () => {
        const to = sel.value, text = ta.value.trim();
        if (!to || !text) { App.toast('Scegli la chat e scrivi il messaggio'); return; }
        confirm.hidden = false;
        confirm.replaceChildren(el('p', el('b', `Invio a ${sel.selectedOptions[0]?.textContent}?`), ' Arriva come messaggio dal sito, non come tua risposta: per ok e permessi scrivi nella chat.'),
          el('div.btn-row', el('button.btn.primary', { type: 'button', onclick: async () => {
            try { const r = await App.post('/api/send', { to, text }); App.toast(r.listening ? 'Inviato: la chat si sveglia ora' : 'Inviato: la chat lo legge a fine turno'); ta.value = ''; confirm.hidden = true; }
            catch (e) { confirm.replaceChildren(errorBox(e)); }
          } }, 'Sì, invia'), el('button.btn', { type: 'button', onclick: () => { confirm.hidden = true; } }, 'Annulla')));
      } }, 'Invia…')), confirm);
    return {
      node,
      setTargets(boxes) {
        const cur = sel.value;
        sel.replaceChildren(...boxes.slice().sort((a, b) => (a.box === 'orchestrator' ? -1 : b.box === 'orchestrator' ? 1 : a.box.localeCompare(b.box))).map(b => el('option', { value: b.box }, `${b.box === 'orchestrator' ? 'Orchestrator' : b.box}${b.listening ? ' · in ascolto' : ''}`)));
        if (cur) sel.value = cur;
      },
      open(box, name) { sel.value = box; ta.focus(); node.scrollIntoView({ behavior: 'smooth', block: 'center' }); App.toast(`Scrivi a ${name}`); },
    };
  }

  // ---------- Fatto (v2: was "Oggi"; only what was done, grouped by topic, with DevOps links) ----------
  page('fatto', 'Fatto', async (main, arg) => {
    const t = await tablesP();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : t.today;
    const j = t.journal.filter(r => r.data === day);
    put(main,
      head(day === t.today ? 'Fatto oggi' : `Fatto il ${fmt.day(day)}`, 'Gli esiti per argomento: PR, bug, chat e diario. <b>I link aprono DevOps.</b>'),
      el('div.btn-row', el('label.small.muted', { for: 'day-pick' }, 'Giorno:'), el('input', { id: 'day-pick', type: 'date', value: day, max: t.today, onchange: e => { location.hash = `fatto/${e.target.value}`; } }),
        day === t.today ? null : el('a.btn', { href: '#fatto' }, 'Oggi')),
      day === t.today ? standupBox(lastDiaryDay(t)) : null,
      el('div#day-report', loading(`Preparo il giorno: legge DevOps e le chat (${day === t.today ? 'pochi secondi' : 'fino a 40 secondi per un giorno passato'} la prima volta)…`)),
      el('details', el('summary', `Il diario del giorno (${j.length} righe)`), table({ name: `diario-${day}`, rows: j, filters: ['tag', 'area'], search: false,
        cols: [{ key: 'ora', label: 'Ora', nowrap: true }, { key: 'tag', label: 'Tipo', help: 'fatto = un esito; decisione; lezione = cosa hai imparato; attrito = tempo perso', render: r => pill(r.tag || '—') }, { key: 'testo', label: 'Cosa', clip: true }], empty: 'Nessuna riga nel diario.' })));
    api(`/api/day?date=${day}`).then(r => main.querySelector('#day-report')?.replaceChildren(r.value ? doneView(r.value) : errorBox(r.error ?? 'report non disponibile'))).catch(e => main.querySelector('#day-report')?.replaceChildren(errorBox(e)));
  });
  page('oggi', 'Oggi', async () => { location.replace('#fatto'); }, { nav: false }); // old links

  // ---------- Da fare ----------
  const threads = (rows, name, ex) => table({ name, rows, filters: ['sezione'], sort: { key: 'aggiornato', dir: -1 }, explain: ex, cols: [
    { key: 'filo', label: 'Filo', render: r => el('b', r.filo) }, { key: 'sezione', label: 'Sezione' }, { key: 'prossimo', label: 'Prossimo passo', clip: true, help: 'Cosa deve succedere perché il filo vada avanti' },
    { key: 'dove', label: 'Dove', clip: true, help: 'La chat, il branch o il file dove sta il lavoro' }, { key: 'aggiornato', label: 'Fermo da', help: 'Da quanto la riga non cambia: verde ≤ 3 giorni, giallo ≤ 7, rosso oltre', render: r => ageCell(r.aggiornato) }] });
  page('dafare', 'Da fare', async main => {
    const t = await tablesP();
    const open = t.now.filter(r => !/^Agenti e sessioni/.test(r.sezione));
    const due = t.ideas.filter(i => i.scaduta && i.scaduta <= t.today && !/fatta|scartata/.test(i.stato));
    put(main,
      head('Da fare', 'Le tue PR, i bug e i lavori aperti, per argomento. <b>I link aprono DevOps.</b>'),
      el('div.btn-row', el('button.btn', { type: 'button', title: 'Rilegge PR e work item da DevOps adesso (zero token)', onclick: () => { main.querySelector('#todo')?.replaceChildren(loading('Rileggo DevOps e now.md…')); api('/api/day?kind=brief', { fresh: true }).then(r => main.querySelector('#todo')?.replaceChildren(r.value ? todoView(r.value) : errorBox(r.error ?? 'brief non disponibile'))).catch(e => main.querySelector('#todo')?.replaceChildren(errorBox(e))); } }, 'Rileggi da DevOps')),
      el('div#todo', loading('Leggo DevOps e now.md…')),
      due.length ? section('Idee da riprendere', '', el('ul.list', due.map(i => el('li', pill(i.area), el('span', el('b', i.titolo), ` · ${short(i.idea, 160)}`))))) : null,
      el('details', el('summary', `Tutti i fili di now.md (${open.length})`), threads(open, 'fili-aperti')));
    api('/api/day?kind=brief').then(r => main.querySelector('#todo')?.replaceChildren(r.value ? todoView(r.value) : errorBox(r.error ?? 'brief non disponibile'))).catch(e => main.querySelector('#todo')?.replaceChildren(errorBox(e)));
  });

  // ---------- Idee ({{OWNER}}'s own; the AI's are in "Spunti dell'IA") ----------
  page('idee', 'Idee', async main => {
    const t = await tablesP();
    const mine = t.ideas.filter(i => i.chi !== 'IA');
    const by = s => mine.filter(i => i.stato === s).length;
    const oldOpen = mine.filter(i => i.stato === 'aperta').sort((a, b) => a.data.localeCompare(b.data))[0];
    put(main,
      head('Idee', `<b>${by('aperta')} aperte</b>, ${by('in corso')} in corso, ${by('fatta')} fatte.${oldOpen ? ` La più vecchia aperta: <b>${E(oldOpen.titolo)}</b>.` : ''}`),
      table({ name: 'idee', rows: mine, filters: ['stato', 'area'],
        cols: [
          { key: 'data', label: 'Data', nowrap: true }, { key: 'titolo', label: 'Idea', render: r => el('b', r.titolo) }, { key: 'area', label: 'Area' },
          { key: 'stato', label: 'Stato', render: r => pill(r.stato, r.stato === 'aperta' ? 'warn' : r.stato === 'fatta' ? 'good' : '') }, { key: 'riprendere', label: 'Riprendere', clip: true, help: 'Quando o a quale condizione ripensarci' }],
        detail: r => md(r.testo) }),
      el('p.small.muted', 'Le idee proposte dall\'IA sono in ', el('a', { href: '#spunti' }, 'Spunti dell\'IA'), '.'));
  });

  // ---------- Spunti dell'IA ({{OWNER}} 2026-10-11: "spunti e idee dell'IA per migliorare il second brain, migliorare
  // {{OWNER}} e migliorare sè stessa"; "se l'IA può avere qualcosa di simile a ragionamento proprio si vedesse in quel
  // posto"): each item shows the reasoning (noticed, thinks, how sure, what it does not know) and can be sent to the Orchestrator.
  const PER = [['second-brain', 'Per second-brain', 'il cervello: regole, tool, agenti'], ['owner', 'Per {{OWNER}}', 'il tuo modo di lavorare, abitudini, tempo'], ['ia', "Per l'IA", 'come lavorano Orchestrator, chat e agenti']];
  const sureP = s => { const v = String(s ?? '').toLowerCase().match(/alta|media|bassa/)?.[0]; return v ? pill(`sicurezza ${v}`, v === 'alta' ? 'good' : v === 'media' ? 'warn' : 'bad') : null; };
  function reasoning(x) {
    return el('dl.kv.small',
      x.notato ? [el('dt', 'Ho notato'), el('dd', x.notato)] : null,
      x.penso ? [el('dt', 'Penso'), el('dd', x.penso)] : null,
      x.nonso ? [el('dt', 'Non so'), el('dd', x.nonso)] : null,
      x.come ? [el('dt', 'Cosa fare'), el('dd', x.come)] : null);
  }
  function discuss(title, text) {
    const box = el('div.confirm', { hidden: true });
    const btn = el('button.btn', { type: 'button', onclick: () => {
      box.hidden = false;
      box.replaceChildren(el('p.small', el('b', 'Mando all’Orchestrator?'), ` «Discutiamone: ${short(title, 80)}»`),
        el('div.btn-row', el('button.btn.primary', { type: 'button', onclick: async () => {
          try { await App.post('/api/send', { to: 'orchestrator', text }); App.toast('Mandato all’Orchestrator'); box.hidden = true; } catch (e) { box.replaceChildren(errorBox(e)); }
        } }, 'Sì, manda'), el('button.btn', { type: 'button', onclick: () => { box.hidden = true; } }, 'Annulla')));
    } }, 'Discutiamone');
    return el('div.composer', el('div.btn-row', btn), box);
  }
  page('spunti', "Spunti dell'IA", async (main, arg) => {
    const t = await tablesP();
    const ai = t.ideas.filter(i => i.chi === 'IA');
    const refl = t.reflections ?? [];
    const sub = [...PER.map(p => p[0]), 'riflessioni'].includes(arg) ? arg : 'tutti';
    const spunto = i => el('article.card.tile',
      el('div.top-line', pill(i.stato, i.stato === 'aperta' ? 'warn' : i.stato === 'fatta' ? 'good' : ''), sureP(i.sicurezza), el('span.small.muted', ` ${fmt.day(i.data)}`)),
      el('h3', i.titolo), i.idea ? el('p', i.idea) : null, reasoning(i),
      i.fonte ? el('p.small.muted', `Nato in: ${i.fonte.replace(/^IA\s*·\s*/, '')}`) : null,
      i.stato === 'aperta' ? discuss(i.titolo, `Discutiamo lo spunto dell'IA «${i.titolo}» (ideas.md, ${i.data}, per ${i.per || '?'}). {{OWNER}} vuole parlarne: portalo nella sua prossima scaletta con pro, contro e cosa servirebbe per farlo.`) : null);
    const thought = r => el('article.card.tile',
      el('div.top-line', sureP(r.sicurezza), el('span.small.muted', ` ${fmt.day(r.data)} · ${r.chat}`)),
      el('h3', r.titolo), reasoning(r),
      discuss(r.titolo, `Discutiamo la riflessione dell'IA «${r.titolo}» (ai-reflections.md, ${r.data}, chat ${r.chat}). {{OWNER}} vuole parlarne.`));
    const group = ([id, title, hint]) => {
      const rows = ai.filter(i => i.per === id || (id === 'second-brain' && !i.per));
      return el('section.section', el('div.section-head', el('h2', `${title} (${rows.length})`), el('p', hint)),
        rows.length ? el('div.cards', rows.map(spunto)) : el('p.muted', 'Ancora nessuno spunto qui: compaiono quando un\'IA ne propone uno.'));
    };
    put(main,
      head("Spunti dell'IA", ai.length || refl.length ? `<b>${ai.filter(i => i.stato === 'aperta').length} spunti aperti</b> e <b>${refl.length} riflessioni</b>. Ogni voce mostra il ragionamento: cosa ho notato, cosa penso, quanto ne sono sicura, cosa non so.` : "<b>Ancora nessuno spunto.</b> Qui l'IA scrive come migliorare il cervello, il tuo modo di lavorare e se stessa, con il suo ragionamento e i suoi dubbi."),
      tabs([['tutti', 'Tutti'], ...PER.map(([id, title]) => [id, title]), ['riflessioni', `Riflessioni (${refl.length})`]], id => { location.hash = `spunti/${id}`; }, sub),
      sub === 'riflessioni'
        ? (refl.length ? el('div.cards', refl.map(thought)) : el('p.card', el('b', 'Ancora nessuna riflessione.'), " Le chat la scrivono a fine lavoro quando hanno qualcosa di vero da dire su di sé (mem.mjs riflessione)."))
        // "Tutti": only the parts that have something (no zero counters); the empty ones in one line
        : sub === 'tutti' ? [...PER.filter(([id]) => ai.some(i => i.per === id || (id === 'second-brain' && !i.per))).map(group),
          (empty => (empty.length ? el('p.muted', `${empty.join(' e ')}: ancora niente.`) : null))(PER.filter(([id]) => !ai.some(i => i.per === id || (id === 'second-brain' && !i.per))).map(p => p[1]))]
          : group(PER.find(p => p[0] === sub)));
  });

  // ---------- Costi (v2: 3 numbers, where to save, 2 charts; the rest one click away) ----------
  page('costi', 'Costi', async (main, arg) => {
    const days = [1, 7, 30, 90].includes(Number(arg)) ? Number(arg) : 7;
    const r = await api(`/api/cost?days=${days}`);
    const c = r.value;
    if (!c) { put(main, errorBox(r.error ?? 'costi non disponibili')); return; }
    const byDay = Object.entries(c.byDay).sort(([a], [b]) => a.localeCompare(b));
    const nDays = Math.max(1, byDay.length);
    const kindsAll = entries(c.byKind);
    const kinds = kindsAll.slice(0, 7).concat(kindsAll.length > 7 ? [['altro', { usd: sum(kindsAll.slice(7).map(([, v]) => v.usd)) }]] : []);
    const areas = entries(c.byArea), models = entries(c.byModel);
    const top3 = c.chats.slice(0, 3);
    put(main,
      head('Costi', `<b>${fmt.usd(c.total)} in ${days === 1 ? 'un giorno' : `${days} giorni`}</b>, ${fmt.usd(c.total / nDays)} al giorno. ${c.advice?.[0] ? `Il risparmio più grande: <b>${E(c.advice[0].text.split(':')[0].toLowerCase())}, ${fmt.usd(c.advice[0].usd)}</b>.` : ''}`,
        { at: r.at, onRefresh: () => api(`/api/cost?days=${days}`, { fresh: true }).then(() => App.toast('Ricalcolo in corso (fino a 20 s): poi ricarica')) }),
      el('div.seg', { role: 'group', 'aria-label': 'Periodo' }, [1, 7, 30, 90].map(d => el('button', { type: 'button', 'aria-pressed': String(d === days), onclick: () => { location.hash = `costi/${d}`; } }, d === 1 ? 'Oggi' : `${d} giorni`))),
      section('Dove risparmiare', 'calcolato da cost.mjs, in ordine di dollari', el('ul.list.card', (c.advice ?? []).slice(0, 3).map(a => el('li', pill(fmt.usd(a.usd), 'warn'), el('span', a.text))))),
      el('div.grid-2',
        chart({ title: 'Spesa per giorno', note: 'oggi in arancione', labels: byDay.map(([d]) => fmt.day(d)), datasets: [{ label: 'spesa', data: byDay.map(([, v]) => Math.round(v.usd)), colors: () => byDay.map(([d]) => (d === romeToday() ? App.tok('--cat-2') : App.tok('--cat-1'))) }], money: true, name: `spesa-giorni-${days}` }),
        chart({ title: 'Per tipo di lavoro', note: kinds[0] ? `"${kinds[0][0]}" è il ${pct(kinds[0][1].usd, c.total)}%` : '', labels: kinds.map(([k]) => k), datasets: [{ label: 'spesa', data: kinds.map(([, v]) => Math.round(v.usd)) }], horizontal: true, money: true, categorical: true, name: `spesa-tipo-${days}` })),
      el('details', el('summary', 'Per area, per modello e chat per chat'),
        el('div.grid-2',
          chart({ title: 'Per area', labels: areas.map(([k]) => k), datasets: [{ label: 'spesa', data: areas.map(([, v]) => Math.round(v.usd)) }], horizontal: true, money: true, categorical: true, name: `spesa-area-${days}` }),
          chart({ title: 'Per modello', labels: models.map(([k]) => k), datasets: [{ label: 'spesa', data: models.map(([, v]) => Math.round(v.usd * 100) / 100) }], horizontal: true, money: true, categorical: true, name: `spesa-modello-${days}` })),
        table({ name: `chat-costi-${days}`, rows: c.chats.map(x => ({ ...x, cartella: baseName(x.folder), al: x.to ? new Date(x.to).toISOString().slice(0, 16).replace('T', ' ') : '' })), sort: { key: 'usd', dir: -1 },
          explain: { find: top3.length ? `Le 3 chat più care valgono <b>${pct(sum(top3.map(x => x.usd)), c.total)}%</b> del periodo.` : '' },
          cols: [{ key: 'title', label: 'Chat', clip: true }, { key: 'usd', label: 'Spesa', type: 'usd', help: HELP.usd }, { key: 'ctxMax', label: 'Lunghezza max', type: 'num', help: HELP.ctx, render: x => fmt.k(x.ctxMax) }, { key: 'longSave', label: 'Risparmiabile', type: 'usd', help: HELP.save }, { key: 'al', label: 'Ultima attività', nowrap: true }] }),
        c.cursor?.downloaded ? el('p.small.muted', `Cursor: ${fmt.usd(c.cursor.total)} nel periodo (CSV scaricato ${fmt.when(c.cursor.downloaded)}, ultima riga ${c.cursor.lastRow ? fmt.when(c.cursor.lastRow) : '?'}).`) : null));
  });
  const romeToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());

  // ---------- Qualità ----------
  page('qualita', 'Qualità', async (main, arg) => {
    const t = await tablesP();
    const sub = ['errori', 'regole', 'lodi', 'taccuini', 'proposte', 'misure', 'bug'].includes(arg) ? arg : 'errori';
    const week = t.errors.filter(r => daysAgo(r.data) < 7).length;
    const rules = t.recurrence?.rules ?? [];
    const back = rules.filter(r => r.again > 0);
    const body = el('div.section');
    put(main, 
      head('Qualità', `<b>${t.errors.length} errori</b> dell'IA registrati (${week} negli ultimi 7 giorni), <b>${t.wins.length} lodi</b>; <b>${rules.length - back.length} regole su ${rules.length}</b> hanno fermato il loro errore.`),
      tabs([['errori', `Errori (${t.errors.length})`], ['regole', 'Regole servite?'], ['lodi', `Lodi (${t.wins.length})`], ['taccuini', 'Taccuini'], ['proposte', `Proposte (${t.proposals.length})`], ['misure', 'Misure'], ['bug', `Bug (${t.bugs.length})`]], id => { location.hash = `qualita/${id}`; }, sub),
      body);
    if (sub === 'errori') {
      const types = countBy(t.errors, 'tipo').slice(0, 14);
      const dates = countBy(t.errors, 'data').sort(([a], [b]) => a.localeCompare(b));
      const worst = [...dates].sort((a, b) => b[1] - a[1])[0];
      body.append(el('div.grid-2',
        chart({ title: 'Errori per tipo', labels: types.map(([k]) => k), datasets: [{ label: 'errori', data: types.map(([, v]) => v) }], horizontal: true, name: 'errori-per-tipo',
          explain: { find: types[0] ? `<b>${E(types[0][0])}</b> è l'errore più comune: <b>${types[0][1]} volte, il ${pct(types[0][1], t.errors.length)}%</b>.` : '', next: types[0]?.[0] === 'fatto-non-verificato' ? 'l\'IA dice cose senza controllarle: chiedi sempre "da dove lo sai?"' : 'guarda in "Regole servite?" se la regola su questo tipo funziona', says: 'che tipo di errori fa l\'IA.', why: 'un tipo che si ripete chiede una regola.' } }),
        chart({ title: 'Errori per giorno', labels: dates.map(([d]) => fmt.day(d)), datasets: [{ label: 'errori', data: dates.map(([, v]) => v) }], name: 'errori-per-giorno',
          explain: { find: worst ? `Il giorno peggiore: <b>${E(fmt.day(worst[0]))}, ${worst[1]} errori</b>.` : '', says: 'quanti errori hai registrato ogni giorno.', why: 'più chat in parallelo, più errori: è un segnale di carico.' } })),
      table({ name: 'errori-ia', rows: [...t.errors].reverse(), filters: ['tipo'],
        explain: { find: `<b>${week} errori negli ultimi 7 giorni</b> su ${t.errors.length} in tutto.`, says: 'ogni errore: cosa ha detto l\'IA e cosa era vero.', why: 'è lo storico da cui nascono le regole; clic su una riga per leggerla tutta.' },
        cols: [
          { key: 'data', label: 'Data', nowrap: true }, { key: 'chi', label: 'Chi', clip: true, help: 'La chat o l\'agente che ha sbagliato' }, { key: 'area', label: 'Area', clip: true }, { key: 'tipo', label: 'Tipo', render: r => pill(r.tipo || '—') },
          { key: 'detto', label: 'Ha detto', clip: true, help: 'Cosa ha affermato o fatto l\'IA' }, { key: 'vero', label: 'Era vero', clip: true, help: 'Come stavano davvero le cose' }, { key: 'regola', label: 'Regola nata', clip: true, help: 'La regola scritta per non ripetere l\'errore' }] }));
    } else if (sub === 'regole') {
      const rows = rules.map(r => ({ data: r.date, tipo: r.type, area: r.area, regola: r.rule, tornato: r.again }));
      const worstRule = [...back].sort((a, b) => b.again - a.again)[0];
      body.append(table({ name: 'regole-servite', rows, filters: ['tipo'], sort: { key: 'tornato', dir: -1 },
        explain: { find: `<b>${rules.length - back.length} regole su ${rules.length} hanno funzionato</b>: il loro errore non è più tornato.${worstRule ? ` La meno efficace: <b>${E(short(worstRule.rule, 60))}</b>, errore tornato ${worstRule.again} volte.` : ''}`, next: worstRule ? 'quella regola va riscritta: chiedilo all’Orchestrator con le parole dell\'errore' : '', says: 'per ogni regola nata da un errore, se l\'errore è tornato dopo.', why: 'una regola che non ferma l\'errore è solo testo in più.' },
        cols: [
          { key: 'data', label: 'Data', nowrap: true }, { key: 'tipo', label: 'Tipo' }, { key: 'area', label: 'Area', clip: true }, { key: 'regola', label: 'Regola', clip: true },
          { key: 'tornato', label: 'Errore tornato', type: 'num', help: 'Quante volte lo stesso tipo di errore, in un\'area simile, è tornato dopo la regola (recurrence.mjs)', render: r => pill(r.tornato ? `${r.tornato} volte` : 'no', r.tornato ? 'bad' : 'good') }] }));
    } else if (sub === 'lodi') {
      const byChat = countBy(t.wins, 'chat');
      body.append(table({ name: 'lodi', rows: [...t.wins].reverse(), filters: ['harness', 'esito'],
        explain: { find: t.wins.length ? `<b>${t.wins.length} lodi</b>; la chat che ne ha di più: <b>${E(byChat[0][0])} (${byChat[0][1]})</b>.` : 'Ancora nessuna lode registrata.', says: 'ogni volta che hai scritto "perfetto", "ora funziona"… e cosa era stato consegnato.', why: 'dice cosa funziona, da ripetere.' },
        cols: [
          { key: 'data', label: 'Data', nowrap: true }, { key: 'ora', label: 'Ora' }, { key: 'chat', label: 'Chat' }, { key: 'esito', label: 'Esito', help: 'pieno = lode senza riserve; parziale = "perfetto, però…"', render: r => pill(r.esito, r.esito === 'pieno' ? 'good' : '') },
          { key: 'parole', label: 'Le tue parole', clip: true }, { key: 'consegnato', label: 'Cosa era stato consegnato', clip: true }], empty: 'Ancora nessuna lode registrata.' }));
    } else if (sub === 'taccuini') {
      const pb = t.playbooks ?? [];
      const totalPts = sum(pb.map(p => p.punti)), proposed = sum(pb.map(p => p.proposti.length));
      body.append(table({ name: 'taccuini', rows: pb.map(p => ({ agente: p.agent, punti: p.punti, proposti: p.proposti.length, caratteri: p.size, da_rivedere: p.review.join(', ') })), search: false,
        explain: { find: `<b>${totalPts} punti</b> imparati in tutto, <b>${proposed} in attesa</b> del tuo sì.`, next: proposed ? 'l’Orchestrator ti porta i punti proposti: un sì e lo specialista li usa' : '', says: 'il taccuino di ogni specialista: cosa ha imparato dai suoi errori e dalle tue lodi.', why: 'ogni punto rende lo specialista più bravo senza appesantire le altre chat.' },
        cols: [
          { key: 'agente', label: 'Specialista', render: r => fileLink(`playbooks/${r.agente}.md`, r.agente) }, { key: 'punti', label: 'Punti', type: 'num', help: 'Punti approvati da te, che lo specialista legge all\'avvio' }, { key: 'proposti', label: 'In attesa', type: 'num', help: 'Punti proposti dalle chat, non ancora approvati' },
          { key: 'caratteri', label: 'Caratteri (max 2500)', type: 'num', help: 'Il taccuino ha un tetto: quando è pieno si accorpa' }, { key: 'da_rivedere', label: 'Da rivedere', help: 'Punti con più voti "dannoso" che "utile"' }] }));
    } else if (sub === 'proposte') {
      const st = countBy(t.proposals, 'stato'), tp = countBy(t.proposals, 'tipo').slice(0, 10);
      const applied = t.proposals.filter(p => p.stato === 'applicata').length, measured = t.proposals.filter(p => /confermata|inutile|peggiorata/.test(p.stato)).length;
      body.append(el('div.grid-2',
        chart({ title: 'Proposte per stato', labels: st.map(([k]) => k), datasets: [{ label: 'proposte', data: st.map(([, v]) => v) }], horizontal: true, name: 'proposte-stato',
          explain: { find: `<b>${applied} applicate ma solo ${measured} misurate</b> (confermate, inutili o peggiorate).`, next: 'chiedi una misura per le applicate: senza, non sai se hanno aiutato', says: 'a che punto è ogni proposta di miglioramento.', why: 'tenere solo ciò che migliora davvero.' } }),
        chart({ title: 'Proposte per tipo', labels: tp.map(([k]) => short(k, 30)), datasets: [{ label: 'proposte', data: tp.map(([, v]) => v) }], horizontal: true, name: 'proposte-tipo',
          explain: { find: tp[0] ? `Quasi sempre <b>${E(tp[0][0])}</b> (${tp[0][1]} su ${t.proposals.length}).` : '', says: 'di che tipo sono le proposte.', why: 'troppe regole e pochi script = più testo da rileggere.' } })),
      table({ name: 'proposte', rows: [...t.proposals].reverse(), filters: ['stato', 'tipo'],
        explain: { says: 'ogni proposta (regola, script, hook, agente) e il suo esito.', why: 'serve a non riproporre ciò che hai già scartato.' },
        cols: [
          { key: 'id', label: 'Id', nowrap: true }, { key: 'data', label: 'Data', nowrap: true }, { key: 'proposta', label: 'Proposta', clip: true }, { key: 'tipo', label: 'Tipo' },
          { key: 'stato', label: 'Stato', help: 'proposta → accettata → applicata → confermata (misurata e utile), oppure rifiutata / inutile / peggiorata', render: r => pill(r.stato || '—', /confermata|applicata/.test(r.stato) ? 'good' : /rifiutata|peggiorata|inutile/.test(r.stato) ? 'bad' : '') }] }));
    } else if (sub === 'misure') {
      const m = t.measures.filter(x => x.metric === 'interventi_forzati').sort((a, b) => a.date.localeCompare(b.date));
      const keys = [...new Set(m.flatMap(x => Object.keys(x.breakdown ?? {})))];
      const first = m[0], last = m[m.length - 1];
      body.append(
        m.length ? chart({ title: 'Interventi forzati per giorno', labels: m.map(x => fmt.day(x.date)), datasets: keys.map(k => ({ label: k.replace(/_/g, ' '), data: m.map(x => x.breakdown?.[k] ?? 0) })), stacked: true, tall: true, name: 'interventi-forzati',
          explain: { find: first && last && first !== last ? `Dal ${E(fmt.day(first.date))} al ${E(fmt.day(last.date))}: <b>da ${first.value} a ${last.value}</b> interventi al giorno.` : '', next: 'se sale, guarda il colore più alto: è il tipo di intervento da eliminare', says: 'quante volte al giorno hai dovuto correggere, rispiegare o sollecitare l\'IA.', why: 'è la misura di quanto il cervello ti fa perdere tempo: più basso è meglio.' } }) : el('p.muted', 'Nessuna misura registrata.'),
        table({ name: 'misure', rows: t.measures.map(x => ({ data: x.date, metrica: x.metric, valore: x.value, messaggi: x.human, modello: x.model, cervello: x.brain, ...Object.fromEntries(Object.entries(x.breakdown ?? {})) })), sort: { key: 'data', dir: -1 }, filters: ['metrica'],
          cols: [{ key: 'data', label: 'Data', nowrap: true }, { key: 'metrica', label: 'Metrica' }, { key: 'valore', label: 'Valore', type: 'num' }, { key: 'messaggi', label: 'Tuoi messaggi', type: 'num', help: 'Quanti messaggi hai scritto quel giorno: per confrontare giorni pieni e vuoti' }, { key: 'modello', label: 'Modello' }, { key: 'cervello', label: 'Versione cervello', help: 'Il commit di {{BRAIN_NAME}} di quel giorno: per legare una misura a un cambio di regole' }] }));
    } else if (sub === 'bug') {
      const areas = countBy(t.bugs, 'area');
      body.append(table({ name: 'bug-log', rows: [...t.bugs].reverse(), filters: ['area'],
        explain: { find: areas[0] ? `L'area con più bug: <b>${E(areas[0][0])} (${areas[0][1]})</b>.` : '', next: areas[0] ? 'prima di una review in quell\'area, guarda questi bug: gli schemi si ripetono' : '', says: 'ogni bug confermato, con il suo schema.', why: 'gli schemi che tornano diventano controlli della review.' },
        cols: [{ key: 'data', label: 'Data', nowrap: true }, { key: 'area', label: 'Area' }, { key: 'bug', label: 'Bug', clip: true }, { key: 'pattern', label: 'Schema', help: 'Il tipo di errore ricorrente (review-catalog.md)' }, { key: 'fonte', label: 'Trovato da', clip: true }, { key: 'rif', label: 'Rif.', clip: true }] }));
    }
  });

  // ---------- Confronto ----------
  page('confronto', 'Confronto', async main => {
    const files = await api('/api/files');
    const reports = files.filter(f => f.startsWith('reviews/compare/'));
    const box = el('div.card', loading());
    put(main, 
      head('Confronto Cursor e Claude', 'Lo stesso lavoro fatto dagli agenti di Cursor e di Claude, giudicato alla cieca. <b>Ogni tabella si scarica in CSV</b>, il report intero in Markdown o HTML.'),
      App.explain({ says: 'chi trova più problemi veri, chi dà falsi allarmi, quanto costa e quanto tempo ci mette.', why: 'decide quale strumento usare per quale lavoro, con i numeri e non a sensazione.', next: 'guarda "Ancora da giudicare": senza il tuo giudizio (o della QA) i numeri restano a zero' }),
      el('div.btn-row', ['reviews/compare/report.md', 'reviews/compare/report.html', 'reviews/compare/summary.md'].filter(f => files.includes(f)).map(f => el('a.btn', { href: `/api/file?p=${encodeURIComponent(f)}&raw=1` }, `Scarica ${baseName(f)}`))),
      box,
      section('Tutti i file del confronto', `${reports.length} file`, table({ name: 'file-confronto', rows: reports.map(f => ({ file: f, nome: baseName(f), cartella: f.split('/').slice(2, -1).join('/') })), filters: ['cartella'], cols: [
        { key: 'nome', label: 'File', render: r => fileLink(r.file, r.nome) }, { key: 'cartella', label: 'Cartella' },
        { key: 'file', label: 'Scarica', render: r => el('a', { href: `/api/file?p=${encodeURIComponent(r.file)}&raw=1` }, 'scarica'), csv: r => r.file }] })),
    );
    const f = files.includes('reviews/compare/report.md') ? 'reviews/compare/report.md' : reports.find(x => x.endsWith('.md'));
    if (f) api(`/api/file?p=${encodeURIComponent(f)}`).then(r => box.replaceChildren(el('p.muted.small', `${f} · aggiornato ${fmt.when(r.modified)}`), md(r.text, { wide: true, base: 'confronto' })));
    else box.replaceChildren(el('p.muted', 'Nessun report di confronto ancora.'));
  }, { nav: false });

  // ---------- Collaborazione ----------
  page('collabora', 'Collaborazione', async main => {
    const t = await tablesP();
    const pairs = Object.entries(t.inbox?.stats ?? {}).sort((a, b) => b[1].sent - a[1].sent);
    const held = Object.entries(t.envs.filter(e => e.action === 'release' && e.heldMin).reduce((m, e) => ((m[e.env] = (m[e.env] ?? 0) + e.heldMin), m), {})).sort((a, b) => b[1] - a[1]);
    const waits = t.envs.filter(e => e.action === 'wait').length;
    const boxes = t.inbox?.boxes ?? [];
    const stuck = boxes.filter(b => b.unread && !b.listening);
    put(main, 
      head('Collaborazione', `<b>${sum(pairs.map(([, s]) => s.sent))} messaggi</b> tra chat, <b>${boxes.filter(b => b.listening).length} chat in ascolto</b> adesso.`),
      section('Caselle di posta', '', table({ name: 'caselle', rows: boxes.map(b => ({ chat: b.box, ascolta: b.listening ? 'sì' : 'no', da_leggere: b.unread, dal: b.since ? fmt.when(b.since) : '' })), search: false,
        explain: { find: stuck.length ? `<b>${stuck.length} chat hanno posta non letta e non ascoltano</b>: ${E(stuck.map(b => b.box).join(', '))}.` : 'Nessun messaggio fermo: <b>la posta arriva</b>.', next: stuck.length ? 'riapri quelle chat o chiedi all’Orchestrator di girare il messaggio' : '', says: 'ogni chat che usa la posta tra chat: se sta ascoltando e cosa la aspetta.', why: 'un messaggio non letto è un lavoro fermo.' },
        cols: [{ key: 'chat', label: 'Chat', render: r => el('b', r.chat) }, { key: 'ascolta', label: 'In ascolto', help: 'sì = la chat si sveglia appena arriva un messaggio', render: r => pill(r.ascolta, r.ascolta === 'sì' ? 'good' : '') }, { key: 'da_leggere', label: 'Da leggere', type: 'num' }, { key: 'dal', label: 'In ascolto dal' }] })),
      el('div.grid-2',
        pairs.length ? chart({ title: 'Chi scrive a chi', labels: pairs.map(([k]) => k.replace(' -> ', ' → ')), datasets: [{ label: 'inviati', data: pairs.map(([, s]) => s.sent) }, { label: 'consegnati', data: pairs.map(([, s]) => s.delivered) }], horizontal: true, name: 'posta-coppie',
          explain: { find: `La coppia più attiva: <b>${E(pairs[0][0].replace(' -> ', ' → '))} (${pairs[0][1].sent})</b>.`, says: 'quali chat si passano il lavoro da sole.', why: 'ogni messaggio diretto è un passaggio che non fai tu.' } }) : null,
        held.length ? chart({ title: 'Ambienti condivisi: minuti occupati', labels: held.map(([k]) => k), datasets: [{ label: 'minuti', data: held.map(([, v]) => v) }], horizontal: true, name: 'ambienti-minuti',
          explain: { find: `<b>${E(held[0][0])}</b> è l'ambiente più conteso (${held[0][1]} minuti)${waits ? `; <b>${waits} volte</b> una chat ha dovuto aspettare` : ''}.`, says: 'quanto ogni stack, nodo di test o pannello browser è stato occupato.', why: 'se una chat aspetta spesso, lì serve un secondo ambiente.' } }) : null),
      section('Registro della posta', '', table({ name: 'posta-registro', rows: [...(t.inbox?.log ?? [])].reverse().map(x => ({ quando: fmt.when(x.ts), azione: x.action === 'sent' ? 'inviato' : x.action === 'delivered' ? 'consegnato' : x.action, da: x.from, a: x.to, come: x.via ?? '', passo: x.hop ?? '' })), filters: ['azione', 'da', 'a'],
        explain: { says: 'ogni messaggio inviato e consegnato tra chat.', why: 'per ritrovare chi ha detto cosa a chi.' },
        cols: [{ key: 'quando', label: 'Quando', nowrap: true }, { key: 'azione', label: 'Azione' }, { key: 'da', label: 'Da' }, { key: 'a', label: 'A' }, { key: 'come', label: 'Come', help: 'wait = la chat era in ascolto; hook = consegnato a fine turno' }, { key: 'passo', label: 'Passo', type: 'num', help: 'Il numero della risposta nel botta e risposta (massimo 6, poi si ferma)' }] })),
      section('Registro degli ambienti', '', table({ name: 'ambienti-registro', rows: [...t.envs].reverse().map(x => ({ quando: fmt.when(x.ts), ambiente: x.env, chat: x.chat, azione: x.action, minuti: x.heldMin ?? '' })), filters: ['ambiente', 'azione'],
        explain: { says: 'chi ha preso, aspettato e lasciato uno stack o il pannello browser.', why: 'per capire perché una chat era ferma.' },
        cols: [{ key: 'quando', label: 'Quando', nowrap: true }, { key: 'ambiente', label: 'Ambiente' }, { key: 'chat', label: 'Chat', clip: true }, { key: 'azione', label: 'Azione', help: 'take = preso; wait = in coda; got = ottenuto dopo l\'attesa; release = lasciato' }, { key: 'minuti', label: 'Minuti', type: 'num' }] })),
    );
  }, { nav: false });

  // ---------- Esplora ----------
  page('esplora', 'Esplora', async (main, arg) => {
    const files = await api('/api/files');
    const groups = {};
    for (const f of files) (groups[f.includes('/') ? f.split('/')[0] : '(cartella principale)'] ??= []).push(f);
    const tree = el('nav.tree.card', { 'aria-label': 'File di second-brain' });
    const filter = el('input', { type: 'search', placeholder: 'Filtra i nomi dei file…', 'aria-label': 'Filtra i file', oninput: () => drawTree() });
    const viewer = el('div.section', el('p.muted', 'Scegli un file a sinistra, o cerca una parola in tutti i file.'));
    const hits = el('div.hits');
    const search = el('form.btn-row', { onsubmit: async e => {
      e.preventDefault();
      const q = e.target.q.value.trim(); if (q.length < 2) return;
      hits.replaceChildren(loading('Cerco…'));
      const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
      hits.replaceChildren(el('p.muted.small', `${r.length}${r.length >= 300 ? '+' : ''} risultati per "${q}"`), ...r.map(h => el('a', { href: `#esplora/${encodeURI(h.file)}` }, el('span', `${h.file}${h.line ? `:${h.line}` : ''}`), h.text)));
    } }, el('input', { name: 'q', type: 'search', placeholder: 'Cerca una parola in tutti i file…', 'aria-label': 'Cerca nei file', style: 'flex:1;min-width:0;padding:6px 10px;border:2px solid var(--line);border-radius:4px;background:var(--surface)' }), el('button.btn.primary', { type: 'submit' }, 'Cerca'));
    function drawTree() {
      const q = filter.value.toLowerCase();
      tree.replaceChildren(filter, ...Object.entries(groups).map(([g, list]) => {
        const shown = list.filter(f => !q || f.toLowerCase().includes(q));
        if (!shown.length) return null;
        return el('details', { open: q || (arg && arg.startsWith(g)) ? true : null }, el('summary', `${g} (${shown.length})`),
          el('div', shown.map(f => el('a', { href: `#esplora/${encodeURI(f)}`, 'aria-current': String(f === arg) }, f.slice(g.includes('(') ? 0 : g.length + 1)))));
      }).filter(Boolean));
    }
    drawTree();
    // on a phone an open file comes before the file list
    put(main, head('Esplora', `<b>${files.length} file</b> di second-brain: regole, memoria, diario, runbook, report, tool. Solo lettura.`), search, hits, el(`div.explore${arg ? '.has-file' : ''}`, tree, viewer));
    if (arg && files.includes(arg)) {
      viewer.replaceChildren(loading());
      const f = await api(`/api/file?p=${encodeURIComponent(arg)}`);
      const isMd = /\.md$/.test(arg);
      const isJsonl = /\.jsonl$/.test(arg);
      let content;
      if (isMd) content = el('div.card', md(f.text, { base: baseName(arg) }));
      else if (isJsonl) {
        const rows = f.text.split(/\r?\n/).filter(Boolean).map(l => { try { const o = JSON.parse(l); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v])); } catch { return { riga: l }; } });
        const keys = [...new Set(rows.flatMap(Object.keys))].slice(0, 8);
        content = table({ name: baseName(arg), rows, cols: keys.map(k => ({ key: k, label: k, clip: true })) });
      } else content = el('pre.code', f.text);
      viewer.replaceChildren(el('div.section-head', el('h2', arg), el('p', `${fmt.int(f.size)} byte · ultima modifica ${fmt.when(f.modified)} (${fmt.ago(f.modified)})`)),
        el('div.btn-row', el('a.btn', { href: `/api/file?p=${encodeURIComponent(arg)}&raw=1` }, 'Scarica'),
          el('button.btn', { type: 'button', onclick: () => navigator.clipboard?.writeText(`{{BRAIN}}/${arg}`).then(() => App.toast('Percorso copiato'), () => App.toast('Copia non riuscita')) }, 'Copia il percorso')),
        content);
      tree.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    }
  });
})();
