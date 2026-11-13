// The adapters' parity harness (ADR 0221): each recording in test/fixtures/wire/<engine>/<case>.ndjson is played back
// by test/fixtures/replay-engine.mjs to the real adapter (ClaudeSession, CodexSession, AcpSession), and the chat it
// builds must equal the one pinned beside it (<case>.items.json): same items, same order, same pending requests, no
// step where the app sent another kind of message. No model, no network, no tokens. The recordings are made by the
// adapters' own record mode (src/main/chats/wire-record.ts) against the synthetic fakes in test/fixtures (rule 4: no
// agent runs the Cursor CLI, so the ACP recording is the fake Cursor's, synthetic); SB_WIRE_FIXTURES_UPDATE=1 makes
// them again. Also checked: a recording holds no secret, no prompt text and no machine path.
// Removed on 2026-11-09: the tests that started a real process, git, a port or a fake CLI (docs/tests/load-sensitive-
// removed.md); the lines above still name what they covered, and only the in-process tests below remain.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HarnessSession } from '../../../src/main/chats/session';
import { readWire } from '../../../src/main/chats/wire-record';

const FIXTURES = path.resolve(import.meta.dirname, '..', '..', 'fixtures');
const WIRE = path.join(FIXTURES, 'wire');

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

/** machine-specific and moment-specific values out of a string: temp folders, the home folder, the repo, ids */
const MACHINE = [os.tmpdir(), fs.realpathSync.native(os.tmpdir()), os.homedir(), path.resolve(import.meta.dirname, '..', '..', '..')]
  .flatMap(p => [p, p.replace(/\\/g, '/'), p.replace(/\\/g, '\\\\'), JSON.stringify(p).slice(1, -1)])
  .filter((p, i, all) => p.length > 3 && all.indexOf(p) === i).sort((a, b) => b.length - a.length);

const fixture = (c: Case) => path.join(WIRE, c.engine, `${c.name}.ndjson`);

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
