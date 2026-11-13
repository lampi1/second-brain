// The routine runtime's optional read-only test DB (ADR 0175): never a blocker. An unreachable DB lets the step go on
// with "DB unavailable" in the report and the events; a non-SELECT and a production-looking target are refused, at
// load time, before the step and inside the MCP server at call time.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTestDbTarget, createRoutineRuntime, parseRoutinePackage } from '../../../packages/routine-runtime/src/index';
import { handleTestDbMessage } from '../../../packages/routine-runtime/src/testdb-mcp';
import { done, routinePackage, scriptedEngine, tempDir } from './fakes';

const call = (args: Record<string, unknown>) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'test_db_query', arguments: args } });

describe('test DB: never a blocker', () => {
  it('an unreachable DB: the step continues and the report says "DB unavailable"', async () => {
    const root = tempDir();
    const pkg = routinePackage({ devops: undefined, inputs: [], testDbs: [{ id: 'qa', server: 'qa-sql.test.local', database: 'AirTest' }],
      steps: [{ id: 'check', title: 'Check', prompt: 'Check data.', testDbs: ['qa'] }] }, { secrets: { testDbs: { qa: { user: 'reader', password: 'pw-qa-123' } } } });
    const engine = scriptedEngine(() => done('checked without the DB'));
    const probed: number[] = [];
    const runtime = createRoutineRuntime({ pkg, paths: { runsRoot: path.join(root, 'runs'), workspace: id => path.join(root, 'ws', id) }, engine,
      testDb: { probe: async (_s, _p, timeoutMs) => { probed.push(timeoutMs); return false; }, server: { command: 'node', args: ['mcp.js', 'testdb'] } } });
    const handle = runtime.start();
    const run = await handle.finished;
    expect(run.status).toBe('done');
    expect(probed).toEqual([10_000]);
    expect(run.steps[0]!.testDb).toBe('unavailable');
    expect(engine.requests[0]!.prompt).toContain('Continue without them');
    expect(engine.requests[0]!.mcpConfig).toBeUndefined();
    expect(fs.readFileSync(path.join(root, 'runs', handle.runId, 'report.md'), 'utf8')).toContain('Test DB: DB unavailable');
    expect(runtime.store.events(handle.runId).some(e => e.type === 'db-unavailable')).toBe(true);
  });

  it('a reachable DB is served through the package MCP server, config outside the run folder', async () => {
    const root = tempDir();
    const pkg = routinePackage({ devops: undefined, inputs: [], testDbs: [{ id: 'qa', server: 'qa-sql.test.local', database: 'AirTest' }],
      steps: [{ id: 'check', title: 'Check', prompt: 'Check data.', testDbs: ['qa'] }] }, { secrets: { testDbs: { qa: { user: 'reader', password: 'pw-qa-123' } } } });
    let config: string | undefined;
    const engine = scriptedEngine(r => { config = fs.readFileSync(r.mcpConfig!, 'utf8'); return done('ok'); });
    const runtime = createRoutineRuntime({ pkg, paths: { runsRoot: path.join(root, 'runs'), workspace: id => path.join(root, 'ws', id) }, engine,
      testDb: { probe: async () => true, server: { command: 'node', args: ['mcp.js', 'testdb'] } } });
    const run = await runtime.start().finished;
    expect(run.steps[0]!.testDb).toBe('available');
    expect(JSON.parse(config!).mcpServers['routine-testdb']).toMatchObject({ command: 'node', args: ['mcp.js', 'testdb'] });
    expect(engine.requests[0]!.mcpConfig!.startsWith(path.join(root, 'runs'))).toBe(false);
    expect(fs.existsSync(engine.requests[0]!.mcpConfig!)).toBe(false);
  });

  it('refuses production-looking targets at load time and at the MCP call', async () => {
    expect(checkTestDbTarget({ id: 'x', server: 'sql-prod.contoso.net', database: 'Air' })).toMatch(/production/);
    expect(checkTestDbTarget({ id: 'x', server: 'sql.contoso.net', database: 'Air_PRD' })).toMatch(/production/);
    expect(() => parseRoutinePackage(routinePackage({ testDbs: [{ id: 'p', server: 'sql-live.contoso.net', database: 'Air' }] }))).toThrow(/production/);
    const evidence = path.join(tempDir(), 'q.md');
    let driven = false;
    const reply = await handleTestDbMessage(call({ target: 'p', query: 'SELECT 1' }), {
      targets: [{ id: 'p', server: 'sql-prod.contoso.net', port: 1433, database: 'Air', user: 'u', password: 'p' }], evidence,
    }, async () => { driven = true; return { columns: [], rows: [], rowCount: 0, truncated: false }; });
    expect(JSON.stringify(reply)).toMatch(/production/);
    expect(driven).toBe(false);
  });

  it('refuses a non-SELECT at the MCP call; a SELECT runs and is logged as evidence', async () => {
    const evidence = path.join(tempDir(), 'q.md');
    const config = { targets: [{ id: 'qa', server: 'qa-sql.test.local', port: 1433, database: 'AirTest', user: 'u', password: 'pw-qa-123' }], evidence };
    const queries: string[] = [];
    const driver = async (input: { query: string }) => { queries.push(input.query); return { columns: ['n'], rows: [[1]], rowCount: 1, truncated: false }; };
    for (const query of ['DELETE FROM Patients', 'UPDATE Patients SET x = 1', 'SELECT 1; DROP TABLE x', 'EXEC sp_who']) {
      const reply = await handleTestDbMessage(call({ target: 'qa', query }), config, driver as never);
      expect(JSON.stringify(reply)).toContain('"isError":true');
    }
    expect(queries).toEqual([]);
    const ok = await handleTestDbMessage(call({ target: 'qa', query: 'SELECT COUNT(*) AS n FROM Patients' }), config, driver as never);
    expect(JSON.stringify(ok)).not.toContain('isError');
    expect(fs.readFileSync(evidence, 'utf8')).toContain('SELECT COUNT(*) AS n FROM Patients');
  });

  it('tells a query error (the server answered) from a database it cannot reach, masking the login', async () => {
    const evidence = path.join(tempDir(), 'q.md');
    const config = { targets: [{ id: 'qa', server: 'qa-sql.test.local', port: 1433, database: 'AirTest', user: 'ro_reader_x', password: 'pw-qa-123' }], evidence };
    const failing = (stage: string, detail: string) => async () => { throw Object.assign(new Error('Test database transport failed'), { stage, detail }); };
    const bad = JSON.stringify(await handleTestDbMessage(call({ target: 'qa', query: 'SELECT Nope FROM Patients' }), config, failing('query', "Invalid column name 'Nope'.") as never));
    expect(bad).toContain('Query error (the database is reachable)');
    expect(bad).toContain("Invalid column name 'Nope'");
    expect(bad).not.toContain('DB unavailable');
    const down = JSON.stringify(await handleTestDbMessage(call({ target: 'qa', query: 'SELECT 1 AS n' }), config, failing('connect', "Login failed for user 'ro_reader_x'.") as never));
    expect(down).toContain('DB unavailable: could not connect or sign in');
    expect(down).not.toContain('ro_reader_x');
    expect(fs.readFileSync(evidence, 'utf8')).not.toContain('ro_reader_x');
  });
});
