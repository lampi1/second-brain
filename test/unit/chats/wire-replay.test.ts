// The adapters' parity harness (ADR 0221): each recording in test/fixtures/wire/<engine>/<case>.ndjson is played back
// by test/fixtures/replay-engine.mjs to the real adapter (ClaudeSession, CodexSession, AcpSession), and the chat it
// builds must equal the one pinned beside it (<case>.items.json): same items, same order, same pending requests, no
// step where the app sent another kind of message. No model, no network, no tokens. The recordings are made by the
// adapters' own record mode (src/main/chats/wire-record.ts) against the synthetic fakes in test/fixtures (rule 4: no
// agent runs the Cursor CLI, so the ACP recording is the fake Cursor's, synthetic); SB_WIRE_FIXTURES_UPDATE=1 makes
// them again. Also checked: a recording holds no secret, no prompt text and no machine path.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { CodexSession } from '../../../src/main/chats/codex';
import { AcpSession } from '../../../src/main/chats/acp';
import type { HarnessSession } from '../../../src/main/chats/session';
import { readWire } from '../../../src/main/chats/wire-record';
import { FAKE, FAKE_CURSOR, recSink, tmp, waitFor, type RecSink } from './helpers';

const FIXTURES = path.resolve(import.meta.dirname, '..', '..', 'fixtures');
const WIRE = path.join(FIXTURES, 'wire');
const REPLAY = path.join(FIXTURES, 'replay-engine.mjs');
const FAKE_CODEX = path.join(FIXTURES, 'fake-codex-app-server.mjs');
const UPDATE = process.env.SB_WIRE_FIXTURES_UPDATE === '1';
/** a step that never comes fails by itself: a replay that diverged waits forever otherwise */
const STEP_MS = 60_000;

type Engine = 'claude' | 'codex' | 'acp';
interface Case { engine: Engine; name: string; turns: { text: string; allow?: boolean }[] }
const CASES: Case[] = [
  { engine: 'claude', name: 'turns', turns: [{ text: 'ciao' }, { text: 'stream' }] },
  { engine: 'claude', name: 'permission', turns: [{ text: 'bash', allow: true }] },
  { engine: 'codex', name: 'turns', turns: [{ text: 'ciao' }, { text: 'plan' }] },
  { engine: 'codex', name: 'permission', turns: [{ text: 'perm', allow: true }] },
  { engine: 'acp', name: 'turns', turns: [{ text: 'ciao' }, { text: 'todo' }] },
  { engine: 'acp', name: 'permission', turns: [{ text: 'perm', allow: true }] },
];

const open: HarnessSession[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); });

/** the session of an engine, on a given .mjs engine (a fake to record, the replay engine to test) */
function session(engine: Engine, exe: string, env: Record<string, string>, sink: RecSink): HarnessSession {
  const cwd = tmp('wire-cwd');
  const s: HarnessSession = engine === 'claude'
    ? new ClaudeSession({ chatId: 'c_wire', cwd, claudePath: exe, sessionId: '11111111-2222-4333-8444-555555555555', env: { FAKE_CLAUDE_DELAY: '0', ...env } }, sink)
    : engine === 'codex'
      ? new CodexSession({ engineId: 'codex', label: 'Codex', command: 'codex', args: ['app-server'], loginCommand: 'codex login', chatId: 'c_wire', cwd, pathOverride: exe, env: { FAKE_CODEX_DELAY: '0', ...env } }, sink)
      : new AcpSession({ engineId: 'cursor', label: 'Cursor', args: ['acp'], modelFlag: '--model', acpCommand: 'agent', loginCommand: 'agent login', chatId: 'c_wire', cwd, pathOverride: exe, env: { FAKE_CURSOR_DELAY: '0', CURSOR_CONFIG_DIR: tmp('wire-cfg'), ...env } }, sink);
  open.push(s);
  s.start();
  return s;
}

/** plays the case's turns: each sent once the session is idle, its permission answered as the case says */
async function play(c: Case, s: HarnessSession, sink: RecSink): Promise<void> {
  if (s.ready) await s.ready;
  let results = 0;
  for (const turn of c.turns) {
    const asked = sink.pendings.length;
    s.send(turn.text);
    if (turn.allow !== undefined) {
      const req = await waitFor(() => sink.pendings[asked], `${c.engine} ${c.name}: the permission`, STEP_MS);
      s.answer(req.id, { kind: 'permission', allow: turn.allow });
    }
    results++;
    await waitFor(() => [...sink.items.values()].filter(i => i.kind === 'result').length >= results && !s.busy, `${c.engine} ${c.name}: result ${results}`, STEP_MS);
  }
}

/** machine-specific and moment-specific values out of a string: temp folders, the home folder, the repo, ids */
const MACHINE = [os.tmpdir(), fs.realpathSync.native(os.tmpdir()), os.homedir(), path.resolve(import.meta.dirname, '..', '..', '..')]
  .flatMap(p => [p, p.replace(/\\/g, '/'), p.replace(/\\/g, '\\\\'), JSON.stringify(p).slice(1, -1)])
  .filter((p, i, all) => p.length > 3 && all.indexOf(p) === i).sort((a, b) => b.length - a.length);
/** a recording keeps its ids (the adapter checks them on replay), only this machine's paths go */
const scrubMachine = (s: string): string => {
  let out = s;
  for (const p of MACHINE) out = out.split(p).join('<machine>');
  return out;
};
/** the chat compared: also without the moment's times and random ids */
const scrub = (s: string): string => scrubMachine(s).replace(/<machine>[^\s"',)]*/g, '<machine>')
  .replace(/(?<![\w-])1\d{12}(?!\d)/g, '<time>').replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>');

/** what the chat shows, without ids, times and durations: the parity being tested */
const TIMING = /^(id|at|ts|ms|t0|startedAt|endedAt|updatedAt|createdAt|durationMs|elapsedMs|firstTokenMs|apiMs|turnMs|toolUseId|parentId|requestId)$/;
function norm(v: unknown): unknown {
  if (typeof v === 'string') return scrub(v);
  if (Array.isArray(v)) return v.map(norm);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !TIMING.test(k)).map(([k, x]) => [k, norm(x)]));
}
const chatOf = (sink: RecSink) => norm({
  items: [...sink.items.values()].filter(i => i.kind !== 'user'),
  pendings: sink.pendings.map(p => ({ kind: (p as { kind?: string }).kind, tool: (p as { tool?: string }).tool })),
});

const fixture = (c: Case) => path.join(WIRE, c.engine, `${c.name}.ndjson`);
const expected = (c: Case) => path.join(WIRE, c.engine, `${c.name}.items.json`);

/** records the case against its synthetic fake, through the adapter's own record mode, into the fixture folder */
async function record(c: Case): Promise<void> {
  const dir = tmp('wire-rec');
  const prev = process.env.SB_WIRE_RECORD_DIR;
  process.env.SB_WIRE_RECORD_DIR = dir;
  const sink = recSink();
  const exe = c.engine === 'claude' ? FAKE : c.engine === 'codex' ? FAKE_CODEX : FAKE_CURSOR;
  try {
    const s = session(c.engine, exe, {}, sink);
    await play(c, s, sink);
    await s.close(500);
  } finally { if (prev === undefined) delete process.env.SB_WIRE_RECORD_DIR; else process.env.SB_WIRE_RECORD_DIR = prev; }
  // the session's own recording: the largest (an engine may be started once more for a probe)
  const file = fs.readdirSync(dir).flatMap(d => fs.readdirSync(path.join(dir, d)).map(f => path.join(dir, d, f)))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]!;
  // the fakes' random uuids become fixed ones, the same value everywhere in the file, so the adapter still sees one id per thing (and the guard sees no real GUID)
  const ids = new Map<string, string>();
  const fixed = (s: string) => s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, g => {
    if (!ids.has(g)) ids.set(g, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
    return ids.get(g)!;
  });
  const lines = readWire(file).map(e => JSON.stringify({ ...e, ts: 0, run: 'r', line: fixed(scrubMachine(e.line)) }));
  fs.mkdirSync(path.dirname(fixture(c)), { recursive: true });
  fs.writeFileSync(fixture(c), `${lines.join('\n')}\n`);
  fs.writeFileSync(expected(c), `${JSON.stringify(chatOf(sink), null, 2)}\n`);
}

describe.each(CASES)('$engine $name: replayed without tokens', c => {
  it('builds the same chat as the recorded run, step by step', async () => {
    if (UPDATE) await record(c);
    const reportFile = path.join(tmp('wire-report'), 'report.ndjson');
    const sink = recSink();
    const s = session(c.engine, REPLAY, { SB_REPLAY_FILE: fixture(c), SB_REPLAY_REPORT: reportFile }, sink);
    await play(c, s, sink);
    const report = () => (fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>) : []);
    await waitFor(() => report().some(r => r.done), 'the whole recording played', STEP_MS);
    expect(report().filter(r => r.diverged !== undefined)).toEqual([]);
    expect(chatOf(sink)).toEqual(JSON.parse(fs.readFileSync(expected(c), 'utf8')));
  }, 4 * STEP_MS);
});

describe('the recordings', () => {
  const files = CASES.map(fixture);
  it('cover the three adapters with at least one turn each', () => {
    for (const f of files) expect(readWire(f).filter(e => e.dir === 'engine>app').length).toBeGreaterThan(2);
  });
  it('hold no secret, no prompt text and no machine path', () => {
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.|Bearer\s+[A-Za-z0-9]/);
      expect(text).not.toMatch(/\/mcp\/(?!<redacted>)[A-Za-z0-9]/);
      for (const p of MACHINE) expect(text.includes(p), `${path.basename(f)} has a machine path`).toBe(false);
      const sent = readWire(f).filter(e => e.dir === 'app>engine').map(e => e.line).join('\n');
      for (const c of CASES.filter(x => fixture(x) === f)) for (const t of c.turns) expect(sent).not.toContain(`"${t.text}"`);
    }
  });
});
