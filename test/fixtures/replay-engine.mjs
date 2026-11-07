#!/usr/bin/env node
// A replay engine for the adapters' parity tests (ADR 0221): plays back one NDJSON recording of an engine's wire
// (src/main/chats/wire-record.ts; fixtures in test/fixtures/wire/<engine>/) as if it were that engine, so ClaudeSession,
// CodexSession and AcpSession are tested against a recorded protocol shape with no model, no network and no tokens.
// How: it prints the recorded engine>app lines up to the next recorded app>engine line, then waits for one line from
// the app, compares its shape (method / type / subtype / response or request) with the recorded one and goes on.
// Request ids are mapped by position: a recorded app request id becomes the id the app actually sent, in the answers
// the recording gives back (JSON-RPC `id`, Claude's control `request_id`). After the script it stays alive until stdin
// ends, like an idle engine. Used by test/unit/chats/wire-replay.test.ts through the adapters' .mjs fake path.
// Env: SB_REPLAY_FILE (the recording), SB_REPLAY_REPORT (an NDJSON file it appends to: {step}, {diverged}, {extra},
// {done}), SB_REPLAY_VERSION (what `--version` prints, default "replay 0.0.0").
import fs from 'node:fs';
import readline from 'node:readline';

if (process.argv.includes('--version')) { process.stdout.write(`${process.env.SB_REPLAY_VERSION ?? 'replay 0.0.0'}\n`); process.exit(0); }
const file = process.env.SB_REPLAY_FILE;
if (!file) { process.stderr.write('replay: SB_REPLAY_FILE is not set\n'); process.exit(2); }
const entries = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).sort((a, b) => a.seq - b.seq);
const report = o => { if (process.env.SB_REPLAY_REPORT) fs.appendFileSync(process.env.SB_REPLAY_REPORT, `${JSON.stringify(o)}\n`); };
const parse = s => { try { return JSON.parse(s); } catch { return null; } };

/** what a line is, ignoring its values: enough to see the app sent the same kind of message at the same step */
export const shape = o => {
  if (!o || typeof o !== 'object') return 'text';
  const sub = o.request?.subtype ?? o.response?.subtype ?? o.subtype;
  const role = o.method ? (o.id !== undefined ? 'request' : 'notify') : (o.result !== undefined || o.error !== undefined) ? 'response' : '';
  return [o.type, o.method, sub, role].filter(Boolean).join('/');
};

const ids = new Map(); // recorded app request id → the id the app sent now
const mapOut = o => {
  if (!o || typeof o !== 'object') return o;
  if (o.id !== undefined && o.method === undefined && ids.has(o.id)) o.id = ids.get(o.id);
  if (o.type === 'control_response' && o.response && ids.has(o.response.request_id)) o.response.request_id = ids.get(o.response.request_id);
  return o;
};

let i = 0;
const emit = () => {
  while (i < entries.length && entries[i].dir === 'engine>app') {
    const o = parse(entries[i].line);
    process.stdout.write(`${o ? JSON.stringify(mapOut(o)) : entries[i].line}\n`);
    i++;
  }
  if (i >= entries.length) report({ done: true, steps: entries.length });
};

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  if (i >= entries.length) { report({ extra: shape(parse(line)) }); return; }
  const want = parse(entries[i].line), got = parse(line);
  if (shape(want) !== shape(got)) report({ diverged: i, want: shape(want), got: shape(got) });
  if (want && got) {
    if (want.id !== undefined && want.method !== undefined && got.id !== undefined) ids.set(want.id, got.id);
    if (want.request_id !== undefined && got.request_id !== undefined) ids.set(want.request_id, got.request_id);
  }
  report({ step: i, shape: shape(got) });
  i++;
  emit();
});
rl.on('close', () => process.exit(0));
emit();
