// Optional read-only test DB access of a routine step (ADR 0175 item 10; owner decision 2026-10-27: a bonus, never a
// blocker). Before a step that lists `testDbs`, the runtime checks every target ONCE: the guard (test only, never
// production) and a TCP reach probe with a ~10 s timeout (VPN). Reachable targets are served to the session by the
// package's stdio MCP server (testdb-mcp.ts) through a temp config outside the run folder; an unreachable one is
// recorded as "DB unavailable" and the step runs without it: no retry, no step failure.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { checkTestDbTarget, type RecognisedTestDb } from './testdb-guard';
import type { RoutineTestDb } from './format';

export const TESTDB_PROBE_MS = 10_000;
export const TESTDB_SERVER_NAME = 'routine-testdb';
export const TESTDB_TOOL = 'test_db_query';
export const TESTDB_EVIDENCE = 'test-db-queries.md';

/** True when server:port answers a TCP connect within the timeout (no credentials sent). */
export type TestDbProbe = (server: string, port: number, timeoutMs: number) => Promise<boolean>;
export const tcpProbe: TestDbProbe = (server, port, timeoutMs) => new Promise(resolve => {
  const socket = net.connect({ host: server, port });
  const end = (ok: boolean) => { socket.removeAllListeners(); socket.destroy(); resolve(ok); };
  socket.setTimeout(timeoutMs, () => end(false));
  socket.once('connect', () => end(true));
  socket.once('error', () => end(false));
});

/** What the MCP server reads (a 0600 temp file; it holds the logins, so never in the run folder). */
export interface TestDbServerConfig {
  targets: { id: string; server: string; port: number; database: string; user: string; password: string }[];
  recognised?: RecognisedTestDb[];
  /** the step's evidence file: query text + row count per call */
  evidence: string;
}

export interface TestDbStepCheck {
  status: 'available' | 'unavailable' | 'refused';
  note: string;
  /** the reachable targets with their logins, for the server config */
  targets: TestDbServerConfig['targets'];
}

/** Checks a step's test DBs once: refused (guard), unavailable (no login or no answer), or available. */
export async function checkStepTestDbs(ids: string[], declared: RoutineTestDb[], logins: Record<string, { user: string; password: string }>,
  options: { recognised?: RecognisedTestDb[]; probe?: TestDbProbe; timeoutMs?: number } = {}): Promise<TestDbStepCheck> {
  const notes: string[] = [], targets: TestDbServerConfig['targets'] = [];
  let refused = false;
  for (const id of ids) {
    const db = declared.find(d => d.id === id);
    if (!db) { notes.push(`${id}: not declared in the package`); refused = true; continue; }
    const reason = checkTestDbTarget(db, options.recognised);
    if (reason) { notes.push(`${id}: refused (${reason})`); refused = true; continue; }
    const login = logins[id];
    if (!login) { notes.push(`${id}: DB unavailable (no login in the package)`); continue; }
    const port = db.port ?? 1433;
    const reachable = await (options.probe ?? tcpProbe)(db.server, port, options.timeoutMs ?? TESTDB_PROBE_MS).catch(() => false);
    if (!reachable) { notes.push(`${id}: DB unavailable (no answer in ${Math.round((options.timeoutMs ?? TESTDB_PROBE_MS) / 1000)} s; VPN?)`); continue; }
    targets.push({ id, server: db.server, port, database: db.database, user: login.user, password: login.password });
    notes.push(`${id}: available`);
  }
  return { status: targets.length ? 'available' : refused ? 'refused' : 'unavailable', note: notes.join('; '), targets };
}

/** Writes the server config and the --mcp-config entry into a fresh private temp dir; `dispose` removes both. */
export function writeTestDbServer(config: TestDbServerConfig, server: { command: string; args: string[]; env?: Record<string, string> }): { dir: string; entry: { command: string; args: string[]; env: Record<string, string> }; dispose(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-testdb-'));
  const file = path.join(dir, 'testdb.json');
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  return {
    dir,
    entry: { command: server.command, args: server.args, env: { ...(server.env ?? {}), SB_ROUTINE_TESTDB_CONFIG: file } },
    dispose: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp: best effort */ } },
  };
}
