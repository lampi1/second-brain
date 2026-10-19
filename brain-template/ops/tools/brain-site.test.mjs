// Offline tests of the brain site: parsers (brain-site/parse.mjs), the map (brain-map.mjs collect + check) and the
// server's guards (brain-site.mjs). Temp folders only, never the real brain. Usage: node ops/tools/brain-site.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import * as P from './brain-site/parse.mjs';
import { collect, check, header, frontmatter, mapRows, simplify, humanize, boxLabel, headingLabel, labelFor, uniqueLabels, LABELS } from './brain-map.mjs';
import { makeServer, allowedFiles, parseChatList, parseChatRead, ageOf } from './brain-site.mjs';

const fails = [];
let n = 0;
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const T = async (name, fn) => { n++; try { await fn(); } catch (e) { fails.push(`${name}: ${e.stack}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-brain-site-'));
const put = (root, f, text) => { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };

await T('parse: ai-errors with " · " in the chat name and an off-format line', () => {
  const rows = P.aiErrors([
    '# header', '- **Read when:** not a row',
    '- 2026-10-10 15:00 · OS · Tool · ops/tools · regola-ignorata · detto: "a · b" scritto · vero: rotto · visto da: {{OWNER}} · regola: `me.md` X',
    '- 2026-09-30 --:-- · Orchestrator · Importer · richiesta-fraintesa · detto: x · vero: y · visto da: z',
    '- 2026-10-01 12:00 · niente formato',
  ].join('\n'));
  ok(rows.length === 3, `3 rows, got ${rows.length}`);
  ok(rows[0].chi === 'OS · Tool' && rows[0].area === 'ops/tools' && rows[0].tipo === 'regola-ignorata', `fields: ${JSON.stringify(rows[0])}`);
  ok(rows[0].detto === '"a · b" scritto' && rows[0].regola === '`me.md` X', `claim/rule: ${JSON.stringify(rows[0])}`);
  ok(rows[1].ora === '' && rows[1].tipo === 'richiesta-fraintesa', `no time: ${JSON.stringify(rows[1])}`);
  ok(rows[2].tipo === '' && rows[2].riga.includes('niente formato'), 'off-format line kept with its raw text');
});

await T('parse: wins, journal, now, ideas, proposals, bugs, jsonl', () => {
  const w = P.aiWins('- 2026-10-10 17:59 · claude · OS · Tool · Orchestrator · pieno · parole: "perfetto" · consegnato: fatto');
  ok(w[0]?.chat === 'OS · Tool' && w[0].area === 'Orchestrator' && w[0].esito === 'pieno' && w[0].parole === 'perfetto', `wins: ${JSON.stringify(w)}`);
  const j = P.journal('# d\n- 09:51 UTC · verificato · x\n- 16:09 · fatto · [personale] OS · y\n- loose line', '2026-10-10');
  ok(j.length === 3 && j[0].utc && j[1].area === 'personale' && j[1].testo === 'OS · y' && j[2].tag === '', `journal: ${JSON.stringify(j)}`);
  const nw = P.now('# Now\n- **not in a section** · x\n## Lavoro · codice\n- **Fix A** · branch x · prossimo: PR · (2026-10-08)\n');
  ok(nw.length === 1 && nw[0].filo === 'Fix A' && nw[0].prossimo === 'prossimo: PR' && nw[0].aggiornato === '2026-10-08' && nw[0].sezione === 'Lavoro · codice', `now: ${JSON.stringify(nw)}`);
  const id = P.ideas('## AAAA-MM-GG · [lavoro|personale] · T · `aperta`\n## 2026-10-06 · [personale] · Rete · `aperta`\n- **Idea:** una\n  due\n- **Riprendere:** il 2026-10-09.\n');
  ok(id.length === 1 && id[0].idea === 'una due' && id[0].scaduta === '2026-10-09' && id[0].chi === 'Owner', `ideas: ${JSON.stringify(id)}`);
  const ia = P.ideas('## 2026-10-10 · [personale] · Mappa · `aperta`\n- **Idea:** x\n- **Come:** due passi\n- **Fonte:** IA · OS · Mappa · errore\n');
  ok(ia[0]?.come === 'due passi' && ia[0].fonte === 'IA · OS · Mappa · errore' && ia[0].chi === 'IA', `ideas of the AI: ${JSON.stringify(ia)}`);
  const ia2 = P.ideas('## 2026-10-11 · [personale] · X · `aperta`\n- **Idea:** x\n- **Per:** owner\n- **Notato:** n\n- **Penso:** p\n- **Sicurezza:** bassa\n- **Non so:** q\n- **Fonte:** IA · OS · Tool · z\n');
  ok(ia2[0]?.per === 'owner' && ia2[0].notato === 'n' && ia2[0].penso === 'p' && ia2[0].sicurezza === 'bassa' && ia2[0].nonso === 'q', `AI reasoning fields: ${JSON.stringify(ia2)}`);
  const rf = P.reflections("# Riflessioni dell'IA\n\n## 2026-10-11 · OS · Tool · Verifico tardi\n- **Notato:** a\n- **Penso:** b\n- **Sicurezza:** media\n- **Non so:** c\n");
  ok(rf.length === 1 && rf[0].chat === 'OS · Tool' && rf[0].titolo === 'Verifico tardi' && rf[0].nonso === 'c', `reflections: ${JSON.stringify(rf)}`);
  const pr = P.proposals('- **P-094** · 2026-10-10 · Cosa · regola · fonte · **applicata** 2026-10-10 (x)');
  ok(pr[0]?.id === 'P-094' && pr[0].stato === 'applicata' && pr[0].tipo === 'regola', `proposals: ${JSON.stringify(pr)}`);
  const pr2 = P.proposals('- **P-046** · 2026-10-07 · Titoli `<Area> · <cosa>` per le chat · regola · {{OWNER}} · **sostituita** da P-050');
  ok(pr2[0]?.tipo === 'regola' && pr2[0].stato === 'sostituita' && pr2[0].proposta.includes('<Area> · <cosa>'), `proposal with " · " in its text: ${JSON.stringify(pr2)}`);
  ok(P.bugLog('- 2026-10-08 · Core · bug · RC-1 · reviewer · PR 1')[0]?.pattern === 'RC-1', 'bug log');
  ok(P.jsonl('{"a":1}\nbroken\n{"a":2}').length === 2, 'jsonl skips a broken line');
});

await T('Adesso: chat list and messages from chats.mjs text', () => {
  const l = parseChatList('Chat Claude e Cursor aggiornate negli ultimi 2 giorni: 2\n- Claude · OS · Mappa 3D · {{BRAIN_NAME}} (worktree) · 11/10, 08:46 · in corso · id 45ba291b\n- Cursor · Orchestrator · {{BRAIN_NAME}} · 10/10, 21:55 · aspetta te (comando da lanciare) · id 1c194f13\n');
  ok(l.length === 2 && l[0].title === 'OS · Mappa 3D' && l[0].harness === 'Claude' && l[0].state === 'in corso' && l[0].id === '45ba291b' && l[1].state === 'aspetta te (comando da lanciare)', `chat list: ${JSON.stringify(l)}`);
  const m = parseChatRead('Claude · X · f · 11/10 · in corso · id a\nUltimi 3 di 9 messaggi:\nOwner: ciao\nAgente: prima riga\nseconda riga\nAgente: [Bash]\n');
  ok(m.length === 3 && m[1].text === 'prima riga seconda riga' && m[0].who === 'Owner', `chat read: ${JSON.stringify(m)}`);
  const m2 = parseChatRead('Owner: ciao\n· (messaggio da un\'altra chat o agente) testo dell’Orchestrator\n');
  ok(m2.length === 2 && m2[0].text === 'ciao' && m2[1].who === 'Altro', `mail from another chat is never {{OWNER}}'s: ${JSON.stringify(m2)}`);
  // ages are Rome time whatever the PC timezone; a future date is last year's
  const noon = Date.parse('2026-10-11T10:00:00Z'); // 12:00 in Rome (CEST)
  ok(ageOf('11/10, 11:00', noon) === 60 && ageOf('11/10, 12:00', noon) === 0, `ageOf in Rome time: ${ageOf('11/10, 11:00', noon)}`);
  ok(ageOf('31/12, 18:00', Date.parse('2027-01-01T09:00:00Z')) === 16 * 60, `ageOf across new year: ${ageOf('31/12, 18:00', Date.parse('2027-01-01T09:00:00Z'))}`);
  ok(ageOf('ieri') === null, 'ageOf unreadable → null');
});

// A tiny brain: map.md, rules, a tool, a hook wired at both levels, an agent with its notebook, a skill.
const root = path.join(tmp, '{{BRAIN_NAME}}'), home = path.join(tmp, 'home');
put(root, 'map.md', '| File | Holds | Read when | Write when |\n|---|---|---|---|\n| `now.md` | Open threads | always | change |\n| `hub.md` | Orchestrator | hub | rule |\n| `gone.md` | Missing | x | y |\n');
put(root, 'now.md', '# Now\n');
put(root, 'hub.md', '{{OWNER}} talks only to the hub chat.\n');
put(root, 'me.md', '# {{OWNER}}\n');
put(root, 'ops/tools/foo.mjs', '// foo: reads now.md and calls dev.azure.com for the PRs.\n// Second line.\nimport fs from "node:fs";\n');
put(root, '.claude/hooks/bar.mjs', '// Stop hook: writes now.md\n');
put(root, '.claude/settings.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `node ${root}/.claude/hooks/bar.mjs` }] }] } }));
put(root, '.claude/agents/rev.md', '---\nname: rev\ndescription: Reviews a diff.\nmodel: opus\n---\nBody.\nNotebook: before working read `playbooks/rev.md`.\n');
put(root, 'playbooks/rev.md', '# Taccuino: rev\n');
put(root, 'harness/cursor/hooks.json', JSON.stringify({ version: 1, hooks: { stop: [{ command: `node ${root}/ops/tools/foo.mjs` }] } }));
put(home, '.claude/skills/stato/SKILL.md', '---\nname: stato\ndescription: Status of everything.\n---\nReads now.md.\n');
put(home, '.claude/settings.json', JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node ${root}/.claude/hooks/bar.mjs` }] }] } }));
put(root, 'secret.env', 'TOKEN=x\n');
put(root, '.gitignore', '*.env\n');
const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
git('init', '-q'); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');

await T('brain-map: helpers', () => {
  ok(header('#!/usr/bin/env node\n// a\n// b\ncode') === 'a\nb', 'header joins the top comment');
  ok(frontmatter('---\nname: x\nmodel: "opus"\n---\n').model === 'opus', 'frontmatter');
  ok(mapRows(fs.readFileSync(path.join(root, 'map.md'), 'utf8')).length === 3, 'map.md rows');
});

await T('brain-map: pieces and arrows come from the files', () => {
  const m = collect({ root, home, usage: { days: 30, skills: [['stato', 0]], agents: [['rev', 4]], tools: [['foo', 2]], files: [['now.md', 9]] },
    playbooks: [{ agent: 'rev', punti: 1, proposti: [], size: 10, review: ['RV-1'] }], inbox: { boxes: [{ box: 'os-tool', unread: 2, listening: false }], stats: { 'os-tool -> orchestrator': { sent: 3, delivered: 3, via: {} } } } });
  const ids = new Set(m.nodes.map(x => x.id));
  for (const id of ['tool:foo', 'hook:brain:bar', 'agent:rev', 'playbook:rev', 'skill:stato', 'mem:now.md', 'rule:hub.md', 'chat:box:os-tool', 'ext:devops'])
    ok(ids.has(id), `node ${id} missing`);
  const has = (from, to, kind) => m.edges.some(e => e.from === from && e.to === to && e.kind === kind);
  ok(has('harness:claude', 'hook:brain:bar', 'hook'), 'hook wiring from the project settings');
  ok(m.nodes.find(x => x.id === 'hook:brain:bar').events.length === 2, 'both settings files wire the hook');
  ok(has('harness:cursor', 'tool:foo', 'hook'), 'Cursor hooks.json wiring');
  ok(has('tool:foo', 'ext:devops', 'esterno') && has('tool:foo', 'mem:now.md', 'usa'), 'tool → external and → memory');
  ok(has('agent:rev', 'playbook:rev', 'legge'), 'agent → its notebook');
  ok(has('chat:box:os-tool', 'chat:orchestrator-claude', 'posta'), 'mail pair from inbox stats');
  ok(m.nodes.find(x => x.id === 'tool:foo').uses === 2 && m.nodes.find(x => x.id === 'mem:now.md').reads === 9, 'use counts');
  ok(m.weak.some(w => /skill mai usati.*stato/.test(w.text)) && m.weak.some(w => /RV-1/.test(w.text)) && m.weak.some(w => /os-tool: 2 messaggi/.test(w.text)), `weak: ${JSON.stringify(m.weak.map(w => w.text))}`);
  ok(m.warnings.some(w => /gone\.md/.test(w)), 'a map.md row without its file is reported');
  const flow = m.flows.find(f => f.id === 'orchestrator').steps[0];
  ok(flow.verified, `the cited sentence is found: ${JSON.stringify(flow)}`);
  ok(m.flows.find(f => f.id === 'orchestrator').steps.some(s => !s.verified), 'a step whose file lacks the sentence is unverified');
  const nodeIds = new Set(m.nodes.map(x => x.id));
  ok(m.edges.every(e => nodeIds.has(e.from) && nodeIds.has(e.to)), 'every arrow joins two pieces');
  ok(m.nodes.every(x => !('text' in x)), 'file bodies are not shipped to the page (only the proof lines)');
});

await T('brain-map: speaking labels, technical name kept', () => {
  ok(humanize('my-tool.mjs') === 'My tool' && humanize('notes/') === 'Notes' && humanize('ops/runbook/') === 'Runbook' && humanize('/cmd') === 'Cmd', 'humanize');
  const areas = { app: 'App' };
  ok(boxLabel('app-domande-doppie', areas) === 'App · domande doppie' && boxLabel('second-brain', areas) === 'Second brain' && boxLabel('app-x', {}) === 'App x', `box label: ${boxLabel('app-domande-doppie', areas)}`);
  ok(headingLabel('# Errori dell\'IA: il registro\n') === "Errori dell'IA" && headingLabel('# Catalogo query (index)') === 'Catalogo query', 'heading before ":" or "("');
  ok(headingLabel('# A heading that is far too long to be a label\n') === null && headingLabel('no heading') === null, 'long or missing heading → none');
  ok(labelFor({ id: 'mem:notes-x.md', kind: 'file', label: 'notes-x.md', file: 'notes-x.md' }, '# Note di lavoro: tutto\n') === 'Note di lavoro', 'a markdown file gets its short heading');
  ok(labelFor({ id: 'mem:long-x.md', kind: 'file', label: 'long-x.md', file: 'long-x.md' }, '# A heading that is far too long to be a label\n') === 'Long x', 'long heading → readable name');
  ok(labelFor({ id: 'agent:x', kind: 'agente', label: 'x', file: 'x.md' }, '---\nname: x\nlabel: Lettore di prova\n---\n') === 'Lettore di prova', 'frontmatter label wins');
  ok(labelFor({ id: 'owner', kind: 'persona', label: 'Owner' }) === 'Owner', 'people, chats, services keep their name');
  const known = Object.entries(LABELS).find(([k]) => k.startsWith('tool:'));
  if (known) ok(labelFor({ id: known[0], kind: 'tool', label: 'x.mjs', file: 'x.mjs' }) === known[1], 'the labels list wins');
  const u = uniqueLabels([{ id: 'a', label: 'Posta', name: 'a.mjs' }, { id: 'b', label: 'posta', name: 'b.mjs' }, { id: 'c', label: 'Altro', name: 'c.mjs' }]);
  ok(u[0].label === 'Posta (a.mjs)' && u[1].label === 'posta (b.mjs)' && u[2].label === 'Altro', `same label → technical name added: ${JSON.stringify(u)}`);
  const m = collect({ root, home, inbox: { boxes: [{ box: 'os-tool-prova', unread: 0, listening: true }], stats: {} } });
  const by = id => m.nodes.find(x => x.id === id);
  ok(by('tool:foo').name === 'foo.mjs' && by('tool:foo').label === 'Foo', `tool: ${JSON.stringify([by('tool:foo').label, by('tool:foo').name])}`);
  ok(by('agent:rev').name === 'rev' && by('agent:rev').label === 'Rev' && by('playbook:rev').label === 'Taccuino: Rev', `agent and notebook: ${by('agent:rev').label} / ${by('playbook:rev').label}`);
  ok(by('skill:stato').name === '/stato' && by('chat:box:os-tool-prova').label === boxLabel('os-tool-prova') && by('chat:box:os-tool-prova').label !== 'os-tool-prova', `skill and box: ${by('skill:stato').label} / ${by('chat:box:os-tool-prova').label}`);
  ok(by('mem:now.md').name === 'now.md' && by('mem:now.md').label !== 'now.md', `memory file: ${by('mem:now.md').label}`);
  ok(m.edges.some(e => e.from === 'tool:foo' && e.to === 'mem:now.md'), 'arrows still found by the technical name');
  const s = simplify(m);
  ok(s.nodes.some(x => x.members?.length) && s.nodes.every(x => (x.members ?? []).every(mb => mb.name)), 'group members carry their technical name');
});

await T('brain-map: check finds a proof that disappeared', () => {
  const m = collect({ root, home });
  const before = check(m, { home });
  ok(!before.some(p => /foo\.mjs/.test(p)), `clean map: ${before.join(' | ')}`);
  put(root, 'ops/tools/foo.mjs', '// foo: changed.\n');
  const after = check(m, { home });
  ok(after.some(p => /foo\.mjs/.test(p)), `changed file detected: ${after.join(' | ')}`);
  fs.rmSync(path.join(root, 'playbooks', 'rev.md'));
  ok(check(m, { home }).some(p => /playbook:rev/.test(p)), 'missing file detected');
});

await T('brain-site: only tracked files, only localhost, only GET', async () => {
  ok(!allowedFiles(root).includes('secret.env') && allowedFiles(root).includes('hub.md'), 'gitignored files are never listed');
  const srv = makeServer(root);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  // agent: false = a new connection each time: a git call in the test may outlast the server's 5 s keep-alive
  const get = (p, host = 'localhost', method = 'GET') => new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host }, agent: false }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b })); });
    req.on('error', rej); req.end();
  });
  try {
    ok((await get('/api/files', 'evil.example')).status === 403, 'foreign Host refused');
    ok((await get('/api/files', 'localhost', 'POST')).status === 405, 'POST refused');
    // POST /api/send: only from the site's own page, only to an existing mailbox
    fs.mkdirSync(path.join(root, 'ops', 'state', 'inbox', 'os-prova'), { recursive: true });
    const send = (body, headers = {}) => new Promise((res, rej) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/send', method: 'POST', headers: { host: 'localhost', origin: `http://localhost:${port}`, 'x-second-brain': '1', 'content-type': 'application/json', ...headers } },
        r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b })); });
      req.on('error', rej); req.end(JSON.stringify(body));
    });
    ok((await send({ to: 'os-prova', text: 'ciao' }, { origin: 'https://evil.example' })).status === 403, 'send: foreign Origin refused');
    ok((await send({ to: 'os-prova', text: 'ciao' }, { origin: 'null' })).status === 403, 'send: Origin null (file:// page) refused');
    ok((await send({ to: 'os-prova', text: 'ciao' }, { 'x-second-brain': '' })).status === 403, 'send: missing site header refused');
    ok((await send({ to: 'os-prova', text: 'ciao' }, { 'content-type': 'text/plain' })).status === 403, 'send: a plain form post refused');
    ok((await send({ to: 'nessuno', text: 'ciao' })).status === 400, 'send: unknown chat refused');
    ok((await send({ to: 'os-prova', text: '' })).status === 400, 'send: empty text refused');
    const okSend = await send({ to: 'OS · Prova', text: 'dal test' });
    const boxFiles = fs.readdirSync(path.join(root, 'ops', 'state', 'inbox', 'os-prova')).filter(f => f.endsWith('.json'));
    ok(okSend.status === 200 && boxFiles.length === 1 && /dal sito second-brain/.test(fs.readFileSync(path.join(root, 'ops', 'state', 'inbox', 'os-prova', boxFiles[0]), 'utf8')), `send: delivered to the mailbox: ${okSend.body}`);
    ok((await get('/api/file?p=secret.env')).status === 404, 'secret not served');
    ok((await get('/api/file?p=../../etc/hosts')).status === 404, 'path outside not served');
    const f = await get('/api/file?p=hub.md');
    ok(f.status === 200 && JSON.parse(f.body).text.includes('hub chat'), 'tracked file served');
    const first = git('log', '-1', '--format=%cI', '--', 'hub.md').stdout.trim();
    ok(first && JSON.parse(f.body).modified === first, `modified = last commit date, from the cached map: ${JSON.parse(f.body).modified} vs ${first}`);
    // a new commit (git's index and HEAD log change): the list and the dates follow it at once, no 60 s wait
    put(root, 'hub.md', '{{OWNER}} talks only to the hub chat.\nnew line\n');
    put(root, 'later.md', 'added later\n');
    git('add', '-A');
    spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'second'], { encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_DATE: '2030-01-02T03:04:05Z' } });
    ok(JSON.parse((await get('/api/files')).body).includes('later.md'), 'a newly committed file is listed at once');
    const f2 = JSON.parse((await get('/api/file?p=hub.md')).body);
    ok(f2.modified.startsWith('2030-01-02') && f2.text.includes('new line'), `the new commit date is served: ${f2.modified}`);
    // a merge that resolves a conflict changes the file itself: its date is the merge's (as `git log -1 -- f` says)
    const G = (date, ...a) => spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_DATE: date } });
    const base = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
    git('checkout', '-qb', 'side'); put(root, 'hub.md', 'side\n'); G('2030-02-01T00:00:00Z', 'commit', '-qam', 'side');
    git('checkout', '-q', base); put(root, 'hub.md', 'main\n'); G('2030-02-02T00:00:00Z', 'commit', '-qam', 'main');
    G('2030-02-03T00:00:00Z', 'merge', '-q', 'side'); put(root, 'hub.md', '{{OWNER}} talks only to the hub chat.\nresolved\n'); git('add', 'hub.md'); G('2030-02-03T00:00:00Z', 'commit', '-qm', 'merge');
    const r3 = await get('/api/file?p=hub.md').catch(e => ({ status: 0, body: String(e) }));
    const f3 = r3.status === 200 ? JSON.parse(r3.body) : { modified: `${r3.status} ${r3.body}`, text: '' };
    ok(f3.modified.startsWith('2030-02-03') && f3.text.includes('resolved'), `a resolved merge dates the file: ${f3.modified}`);
    const t = JSON.parse((await get('/api/tables')).body);
    ok(Array.isArray(t.errors) && Array.isArray(t.now) && t.today, 'tables');
    ok((await get('/../brain-site.mjs')).status === 404, 'no files outside the assets folder');
    ok((await get('/')).body.includes('second-brain'), 'home page');
    const s = JSON.parse((await get('/api/search?q=hub%20chat')).body);
    ok(s.some(h => h.file === 'hub.md'), 'search');
  } finally { srv.close(); }
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? fails.join('\n') : `ok: ${n} groups (parse, brain-map, check, server guards)`);
process.exit(fails.length ? 1 : 0);
