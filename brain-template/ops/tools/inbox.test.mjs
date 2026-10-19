// Offline tests of inbox.mjs: temp folders only, never the real ops/state. Usage: node ops/tools/inbox.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { slug, paths, send, take, unread, listening, stats, hookOutput, detectHarness, noteHarness, harnessOf, appServes } from './inbox.mjs';

process.removeAllListeners('warning');
const here = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(here, 'inbox.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-inbox-'));
const P = paths(tmp);
const fails = [];
let n = 0;
const ok = (c, m) => { if (!c) fails.push(m); };
const T = async (name, fn) => { n++; try { await fn(); } catch (e) { fails.push(`${name}: ${e.stack}`); } };
const run = (args, input) => spawnSync(process.execPath, [TOOL, ...args, '--root', tmp], { encoding: 'utf8', input, timeout: 120000 }); // hang deadline only
const delay = ms => new Promise(r => setTimeout(r, ms));
// No fixed waits (a busy PC made "waiter registered" fail once after 800 ms, 10/10): poll the condition until it holds,
// the process it depends on is gone, or a generous deadline that only a real hang reaches.
const waitFor = async (cond, { ms = 60000, stop = () => false } = {}) => {
  for (const end = Date.now() + ms; Date.now() < end; await delay(25)) { if (cond()) return true; if (stop()) return cond(); }
  return cond();
};

await T('slug', () => {
  ok(slug('OS · Architettura') === 'os-architettura', 'slug middle dot');
  ok(slug('OS - Architettura') === slug('os-architettura'), 'slug dash');
  ok(slug('B · Übersicht') === 'b-ubersicht', 'slug accents');
});

await T('send/take', () => {
  const { msg, listening: on } = send(P, { to: 'Orchestrator', from: 'OS · Tool', text: 'ciao' });
  ok(!on, 'nobody listening yet');
  ok(unread(P, 'orchestrator').length === 1, 'one unread');
  const got = take(P, 'ORCHESTRATOR', 'test');
  ok(got.length === 1 && got[0].id === msg.id && got[0].text === 'ciao', 'taken');
  ok(take(P, 'Orchestrator', 'test').length === 0, 'taken only once');
  ok(fs.existsSync(path.join(P.box('orchestrator'), 'read', `${msg.id}.json`)), 'moved to read/');
});

await T('empty and missing args', () => {
  let e1; try { send(P, { to: 'a', from: 'b', text: '  ' }); } catch (e) { e1 = e; }
  ok(e1, 'empty text refused');
  let e2; try { send(P, { to: '', from: 'b', text: 'x' }); } catch (e) { e2 = e; }
  ok(e2, 'missing --to refused');
});

await T('reply chain and hop limit', () => {
  let m = send(P, { to: 'A', from: 'B', text: 'q' }).msg;
  for (let i = 2; i <= 6; i++) {
    m = send(P, { to: i % 2 ? 'A' : 'B', from: i % 2 ? 'B' : 'A', text: `r${i}`, replyTo: m.id }).msg;
    ok(m.hop === i, `hop ${i}`);
  }
  let err; try { send(P, { to: 'A', from: 'B', text: 'r7', replyTo: m.id }); } catch (e) { err = e; }
  ok(err && err.code === 4, 'hop 7 refused');
  let err2; try { send(P, { to: 'A', from: 'B', text: 'x', replyTo: 'nope' }); } catch (e) { err2 = e; }
  ok(err2 && err2.code === 4, 'unknown reply id refused');
  take(P, 'A', 't'); take(P, 'B', 't');
});

await T('CLI wait wakes on send', async () => {
  const child = spawn(process.execPath, [TOOL, 'wait', '--me', 'OS - Prova', '--poll', '0.2', '--root', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => (out += d));
  let exited = null;
  const done = new Promise(r => child.on('exit', c => { exited = c; r(c); }));
  ok(await waitFor(() => listening(P, 'os-prova'), { stop: () => exited !== null }), `waiter registered (exit ${exited}): ${out}`);
  const again = run(['wait', '--me', 'os prova', '--poll', '0.2']);
  ok(again.status === 0 && /già in ascolto/.test(again.stdout), `second waiter refused: ${again.stdout}${again.stderr}`);
  const s = run(['send', '--to', 'OS · Prova', '--from', 'Orchestrator', '--text', 'vai col passo 2']);
  ok(s.status === 0 && /la chat è in ascolto/.test(s.stdout), `send says listening: ${s.stdout}${s.stderr}`);
  // a deadline for a hang, not a wait; unref: it must not keep the test process alive once the waiter is done
  const code = await Promise.race([done, new Promise(r => setTimeout(r, 60000, 'timeout').unref())]);
  ok(code === 0, `waiter exit ${code}`);
  ok(/vai col passo 2/.test(out) && /send --to "orchestrator" --from "os-prova" --reply-to/.test(out) && /wait --me "os-prova"/.test(out), `render: ${out}`);
  // the printed commands name this script and the same --root, so a worktree prototype answers into the same boxes
  ok(out.includes(TOOL.replace(/\\/g, '/')) && out.includes(`--root "${tmp}"`), `render paths: ${out}`);
  // and the printed "Rispondi:" command works as is (the live test of 10/10 found it pointing elsewhere)
  const reply = out.split('\n').find(l => l.startsWith('Rispondi: '));
  const rf = path.join(tmp, 'reply.txt'); fs.writeFileSync(rf, 'fatto, passo 2 ok');
  const r = spawnSync(reply.slice('Rispondi: '.length).replace('<testo scritto con Write>', `"${rf}"`), { shell: true, encoding: 'utf8' });
  ok(r.status === 0, `reply command: ${r.stdout}${r.stderr}`);
  const back = take(P, 'Orchestrator', 'test');
  ok(back.length === 1 && back[0].hop === 2 && back[0].text === 'fatto, passo 2 ok', `reply landed: ${JSON.stringify(back)}`);
  ok(!listening(P, 'os-prova'), 'waiter file removed');
});

await T('CLI wait gives up', () => {
  const r = run(['wait', '--me', 'Vuota', '--poll', '0.1', '--max-min', '0.005']);
  ok(r.status === 2, `exit 2, got ${r.status}`);
});

await T('CLI read and list', () => {
  run(['send', '--to', 'Lettore', '--from', 'X', '--text', 'uno']);
  const l = run(['list']);
  ok(/lettore: 1 da leggere · non in ascolto/.test(l.stdout), `list: ${l.stdout}`);
  const r = run(['read', '--me', 'Lettore']);
  ok(/uno/.test(r.stdout), 'read prints');
  ok(/nessun messaggio/.test(run(['read', '--me', 'Lettore']).stdout), 'read empty');
});

await T('hook claude', () => {
  const tr = path.join(tmp, 'claude.jsonl');
  fs.writeFileSync(tr, [{ type: 'custom-title', customTitle: 'Vecchio' }, { type: 'user', message: { content: 'x' } }, { type: 'custom-title', customTitle: 'A · Fix login' }].map(r => JSON.stringify(r)).join('\n'));
  const none = run(['hook', 'claude'], JSON.stringify({ session_id: 's', transcript_path: tr, hook_event_name: 'Stop' }));
  ok(none.stdout === '', 'no mail, no output');
  send(P, { to: 'A - Fix login', from: 'Orchestrator', text: '{{OWNER}} dice: ok push' });
  send(P, { to: 'Altra chat', from: 'Orchestrator', text: 'non per te' });
  const r = run(['hook', 'claude'], JSON.stringify({ session_id: 's', transcript_path: tr, hook_event_name: 'Stop', stop_hook_active: false }));
  const o = JSON.parse(r.stdout || '{}');
  ok(o.decision === 'block' && /ok push/.test(o.reason) && !/non per te/.test(o.reason), `claude hook: ${r.stdout}${r.stderr}`);
  ok(run(['hook', 'claude'], JSON.stringify({ transcript_path: tr })).stdout === '', 'delivered once');
  ok(run(['hook', 'claude'], 'not json').status === 0, 'bad input never fails');
  take(P, 'Altra chat', 't');
});

await T('hook cursor', async () => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return; } // node without sqlite: skip
  const dbf = path.join(tmp, 'state.vscdb');
  const db = new DatabaseSync(dbf);
  db.exec('CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO composerHeaders VALUES (?, ?)').run('c-1', JSON.stringify({ name: 'Orchestrator' }));
  db.close();
  send(P, { to: 'Orchestrator', from: 'B · Bug Mario', text: 'domanda per Owner: A o B?' });
  const r = spawnSync(process.execPath, [TOOL, 'hook', 'cursor', '--root', tmp], { input: '﻿' + JSON.stringify({ conversation_id: 'c-1', hook_event_name: 'stop', status: 'completed', loop_count: 0 }), encoding: 'utf8', env: { ...process.env, BRAIN_CURSOR_DB: dbf } });
  const o = JSON.parse(r.stdout || '{}');
  ok(/A o B/.test(o.followup_message || ''), `cursor hook: ${r.stdout}${r.stderr}`);
});

await T('stale waiter file is not listening', () => {
  const box = P.box('Morta'); fs.mkdirSync(box, { recursive: true });
  const wf = path.join(box, '.waiter.json');
  // a live pid (this test) but no heartbeat for a minute: the waiter was killed and its pid reused
  fs.writeFileSync(wf, JSON.stringify({ pid: process.pid, since: new Date().toISOString(), me: 'Morta', pollMs: 3000 }));
  const old = new Date(Date.now() - 60000); fs.utimesSync(wf, old, old);
  ok(!listening(P, 'Morta'), 'stale heartbeat = not listening');
  const r = run(['wait', '--me', 'Morta', '--poll', '0.1', '--max-min', '0.005']);
  ok(r.status === 2 && !/già in ascolto/.test(r.stdout), `a new waiter takes over a stale file: ${r.stdout}`);
  fs.writeFileSync(wf, JSON.stringify({ pid: 999999, since: new Date().toISOString(), me: 'Morta' }));
  ok(!listening(P, 'Morta'), 'dead pid = not listening');
});

await T('cursor hook leaves mail queued past loop limit or on abort', async () => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return; }
  const dbf = path.join(tmp, 'state2.vscdb');
  const db = new DatabaseSync(dbf);
  db.exec('CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO composerHeaders VALUES (?, ?)').run('c-2', JSON.stringify({ name: 'Coda' }));
  db.close();
  send(P, { to: 'Coda', from: 'X', text: 'resto in coda' });
  const h = extra => spawnSync(process.execPath, [TOOL, 'hook', 'cursor', '--root', tmp], { input: JSON.stringify({ conversation_id: 'c-2', hook_event_name: 'stop', ...extra }), encoding: 'utf8', env: { ...process.env, BRAIN_CURSOR_DB: dbf } });
  ok(h({ status: 'completed', loop_count: 3 }).stdout === '', 'loop limit: no output');
  ok(h({ status: 'aborted', loop_count: 0 }).stdout === '', 'aborted: no output');
  ok(unread(P, 'Coda').length === 1, 'mail still queued');
  ok(/resto in coda/.test(JSON.parse(h({ status: 'completed', loop_count: 0 }).stdout || '{}').followup_message || ''), 'delivered on a normal stop');
});

await T('cursor stop hook correction-log hands over the mail', async () => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return; }
  const dbf = path.join(tmp, 'state3.vscdb');
  const db = new DatabaseSync(dbf);
  db.exec('CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO composerHeaders VALUES (?, ?)').run('c-3', JSON.stringify({ name: 'A · QA prova' }));
  db.close();
  const tr = path.join(tmp, 'cur.jsonl');
  fs.writeFileSync(tr, [{ role: 'user', message: { content: [{ type: 'text', text: '<user_query>fai la QA</user_query>' }] } },
    { role: 'assistant', message: { content: [{ type: 'text', text: 'fatto' }] } }].map(r => JSON.stringify(r)).join('\n'));
  send(P, { to: 'A - QA prova', from: 'A · Fix', text: 'build PR pronta su test 3' });
  const cl = path.join(here, '..', '..', 'harness', 'cursor', 'correction-log.mjs');
  const r = spawnSync(process.execPath, [cl], { input: JSON.stringify({ conversation_id: 'c-3', hook_event_name: 'stop', status: 'completed', loop_count: 0, transcript_path: tr }), encoding: 'utf8',
    env: { ...process.env, BRAIN_CURSOR_DB: dbf, BRAIN_INBOX_ROOT: tmp, BRAIN_CORRECTIONS_FILE: path.join(tmp, 'corr.json') } });
  const o = JSON.parse(r.stdout || '{}');
  ok(/^\[posta\]/.test(o.followup_message || '') && /build PR pronta/.test(o.followup_message), `correction-log + inbox: ${r.stdout}${r.stderr}`);
  ok((o.followup_message || '').includes(`--root "${tmp}"`), 'reply command keeps the root of BRAIN_INBOX_ROOT');
});

await T('NO_REPLY wakes nobody', () => {
  const r = send(P, { to: 'Silenzio', from: 'X', text: ' NO_REPLY ' });
  ok(r.msg === null && unread(P, 'Silenzio').length === 0, 'NO_REPLY not queued');
});

await T('hookOutput shapes', () => {
  ok(hookOutput('claude', 'x').decision === 'block', 'claude shape');
  ok(hookOutput('cursor', 'x').followup_message === 'x', 'cursor shape');
});

await T('cross-engine transport ignores retired settings, both directions and CLI', () => {
  const file = path.join(tmp, 'brain-settings.json');
  ok(detectHarness({ CURSOR_AGENT: '1' }) === 'cursor' && detectHarness({ CLAUDECODE: '1' }) === 'claude', 'detectHarness');
  noteHarness(P, 'Cur · A', 'cursor');
  noteHarness(P, 'Cla · B', 'claude');
  const cursorEnv = { ...process.env, CURSOR_AGENT: '1' };
  delete cursorEnv.CLAUDECODE;
  for (const raw of ['{"crossHarnessMessages":false}', '\ufeff{"crossHarnessMessages":false}',
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"crossHarnessMessages":false}', 'utf16le')]), '{not json']) {
    fs.writeFileSync(file, raw);
    const before = fs.readFileSync(file);
    ok(send(P, { to: 'Cla · B', from: 'Cur · A', text: 'cross' }).msg, 'Cursor to Claude');
    ok(send(P, { to: 'Cur · A', from: 'Cla · B', text: 'cross', harness: 'claude' }).msg, 'Claude to Cursor');
    const r = spawnSync(process.execPath, [TOOL, 'send', '--to', 'Cla · B', '--from', 'Cur · A', '--text', 'cli', '--harness', 'app', '--root', tmp], { encoding: 'utf8', env: cursorEnv, timeout: 120000 });
    ok(r.status === 0, `CLI cross-engine delivery: ${r.status} ${r.stderr}`);
    ok(harnessOf(P, 'cur-a') === 'cursor', 'environment still determines sender harness');
    ok(fs.readFileSync(file).equals(before), 'legacy settings never rewritten');
  }
  fs.rmSync(file);
  for (const b of ['cur-a', 'cla-b']) take(P, b, 'test');
});

await T('the second-brain app serves a box: send says it delivers at once; a stale heartbeat does not count', () => {
  const beat = path.join(P.dir, '.app-second-brain.json');
  fs.writeFileSync(beat, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), boxes: ['pers-app'] }));
  const s = run(['send', '--to', 'Pers · App', '--from', 'Orchestrator', '--text', 'subito']);
  ok(s.status === 0 && /aperta nell’app second-brain/.test(s.stdout), `send says the app delivers: ${s.stdout}${s.stderr}`);
  ok(!appServes(P, 'Altra chat'), 'a box the app does not list');
  // a wait in an app chat ends at once and says not to relaunch it (the app takes the mail before any wait could)
  const w = run(['wait', '--me', 'Pers · App', '--poll', '0.1', '--max-min', '0.01']);
  ok(w.status === 0 && /non rilanciarlo/.test(w.stdout) && !listening(P, 'pers-app'), `wait in an app chat: ${w.status} ${w.stdout}${w.stderr}`);
  const old =new Date(Date.now() - 60000);
  fs.utimesSync(beat, old, old);
  ok(!appServes(P, 'Pers · App'), 'stale heartbeat (app closed) ignored');
  fs.rmSync(beat);
  take(P, 'pers-app', 'test');
});

await T('stats', () => {
  const s = stats(P);
  ok(s['os-tool -> orchestrator']?.sent === 1 && s['os-tool -> orchestrator']?.delivered === 1, `stats: ${JSON.stringify(s['os-tool -> orchestrator'])}`);
  ok(s['orchestrator -> os-prova']?.via?.wait === 1, 'via wait counted');
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`inbox tests: ${fails.length} failed of ${n}\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log(`inbox tests: ${n} groups ok`);
