// Fake of the brain's harness/compare/app-queue.mjs, the queue of the comparison's side b that the app runs (ADR 0046
// §4; the app's half: src/main/compare/queue.ts). Same commands and shapes as the real one:
//   list                        → { runs: [{ round, side: "b", experiment, engine, model, effort, cwd, prompt, denyRead }] } (queued only)
//   start --round R --side b    → { ok: true } | { ok: false, why } (a run that is not queued)
//   record --round R --side b   ← stdin { engine, model, effort, text, costUsd, tokens, durationMs, turns } → exit 0
//                                 (exit 2 when engine is not the run's own)
//   fail --round R --side b     ← stdin { error, durationMs } → exit 0
// State: <brain>/ops/state/compare/app-queue.json { runs: [{ ...run, status: queued|running|done|failed, result? }] },
// seeded by the test. Every call is appended to app-queue.log beside this file ({ cmd, round, side, stdin }).
// Used by test/unit/compare/queue.test.ts, copied into a temporary brain.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', '..', 'ops', 'state', 'compare', 'app-queue.json');
const [cmd, ...rest] = process.argv.slice(2);
const arg = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const round = arg('--round'), side = arg('--side');
const stdin = cmd === 'record' || cmd === 'fail' ? JSON.parse(fs.readFileSync(0, 'utf8') || 'null') : null;
fs.appendFileSync(path.join(HERE, 'app-queue.log'), `${JSON.stringify({ cmd, round: round ?? null, side: side ?? null, stdin })}\n`);

const state = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { runs: [] };
const save = () => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(state, null, 1)); };
const find = () => state.runs.find(r => r.round === round && r.side === side);

if (cmd === 'list') {
  const runs = state.runs.filter(r => r.status === 'queued').map(({ status: _status, result: _result, ...run }) => run);
  process.stdout.write(`${JSON.stringify({ runs })}\n`);
} else if (cmd === 'start') {
  const r = find();
  if (!r) process.stdout.write(`${JSON.stringify({ ok: false, why: 'esecuzione sconosciuta' })}\n`);
  else if (r.status !== 'queued') process.stdout.write(`${JSON.stringify({ ok: false, why: `già ${r.status}` })}\n`);
  else { r.status = 'running'; save(); process.stdout.write('{"ok":true}\n'); }
} else if (cmd === 'record' || cmd === 'fail') {
  const r = find();
  if (!r) { console.error(`Error: esecuzione sconosciuta ${round}/${side}`); process.exit(2); }
  // like the brain's: a record from an engine other than the run's side b is refused
  if (cmd === 'record' && stdin?.engine !== r.engine) { console.error(`Error: motore ${stdin?.engine} diverso dal lato b (${r.engine})`); process.exit(2); }
  r.status = cmd === 'record' ? 'done' : 'failed';
  r.result = stdin;
  save();
} else {
  console.error('usage: app-queue.mjs list | start|record|fail --round R --side b');
  process.exit(1);
}
