// Verifies the real transport's configuration, dispatch and rollback lifecycle through a fake Tedious connection.
// No sockets, credentials or SQL servers are used by these tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  config: undefined as unknown,
  sql: [] as string[],
  events: [] as string[],
  database: 'ExplicitSandbox',
  failQuery: false,
  hold: false,
  rollbackFails: false,
  beforeUser: undefined as (() => void) | undefined,
  rows: [[1], [2], [3]] as unknown[][],
}));
vi.mock('tedious', async () => {
  const { EventEmitter } = await import('node:events');
  class Request extends EventEmitter {
    constructor(readonly sql: string, readonly done: (error?: Error) => void) { super(); }
    cancel() { this.done(new Error('cancelled')); }
  }
  class Connection extends EventEmitter {
    constructor(config: unknown) { super(); fake.config = config; }
    connect(done: () => void) { fake.events.push('connect'); done(); }
    beginTransaction(done: () => void) { fake.events.push('begin'); done(); }
    rollbackTransaction(done: (error?: Error) => void) { fake.events.push('rollback'); done(fake.rollbackFails ? new Error('rollback') : undefined); }
    close() { fake.events.push('close'); }
    execSql(request: Request) {
      fake.sql.push(request.sql);
      if (request.sql.startsWith('SET XACT_ABORT')) { fake.beforeUser?.(); request.done(); return; }
      const identity = request.sql.startsWith('SELECT DB_NAME()');
      if (!identity && fake.hold) return;
      if (!identity && fake.failQuery) { request.done(new Error('secret driver details')); return; }
      request.emit('columnMetadata', [{ colName: identity ? 'database_name' : 'value', type: { name: 'Int' } }]);
      for (const row of identity ? [[fake.database]] : fake.rows) request.emit('row', row.map(value => ({ value })));
      request.done();
    }
  }
  return { Connection, Request, ISOLATION_LEVEL: { READ_UNCOMMITTED: 1 } };
});
import { runTestDbQuery } from '../../../src/main/flows/test-db-driver';

const input = () => ({ target: { id: 'test-a', server: 'sql.example.invalid', port: 1433, database: 'ExplicitSandbox' }, userName: 'restricted_reader', password: 'test-only-secret', query: 'SELECT value FROM dbo.Items', maxRows: 2 });
beforeEach(() => { fake.sql = []; fake.events = []; fake.database = 'ExplicitSandbox'; fake.failQuery = false; fake.hold = false; fake.rollbackFails = false; fake.beforeUser = undefined; fake.rows = [[1], [2], [3]]; });
afterEach(() => vi.useRealTimers());

describe('encrypted rollback-only SQL driver', () => {
  it('pins exact target, verifies DB_NAME, caps streamed rows and rolls back before closing', async () => {
    const result = await runTestDbQuery(input());
    expect(fake.config).toMatchObject({ server: 'sql.example.invalid', authentication: { type: 'default' }, options: {
      database: 'ExplicitSandbox', encrypt: true, trustServerCertificate: false, readOnlyIntent: true,
      fallbackToDefaultDb: false, rowCollectionOnDone: false, rowCollectionOnRequestCompletion: false,
    } });
    expect(fake.sql).toEqual(['SELECT DB_NAME() AS database_name', 'SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET ROWCOUNT 3', 'SELECT value FROM dbo.Items']);
    expect(result).toEqual({ columns: ['value'], rows: [[1], [2]], rowCount: 2, truncated: true });
    expect(fake.events).toEqual(['connect', 'begin', 'rollback', 'close']);
  });
  it('rejects mismatched database case before user SQL', async () => {
    fake.database = 'explicitsandbox';
    await expect(runTestDbQuery(input())).rejects.toThrow('transport failed');
    expect(fake.sql).toEqual(['SELECT DB_NAME() AS database_name']);
    expect(fake.events.slice(-2)).toEqual(['rollback', 'close']);
  });
  it('rolls back on query failure and exposes no raw error', async () => {
    fake.failQuery = true;
    await expect(runTestDbQuery(input())).rejects.toThrow('Test database transport failed');
    expect(fake.events.slice(-2)).toEqual(['rollback', 'close']);
  });
  it('closes even when rollback fails and does not return query results', async () => {
    fake.rollbackFails = true;
    await expect(runTestDbQuery(input())).rejects.toThrow('transport failed');
    expect(fake.events.slice(-2)).toEqual(['rollback', 'close']);
  });
  it('rechecks authorization after connection/setup and refuses revoked SQL', async () => {
    let allowed = true; fake.beforeUser = () => { allowed = false; };
    await expect(runTestDbQuery({ ...input(), authorize: () => { if (!allowed) throw new Error('revoked'); } })).rejects.toThrow('revoked');
    expect(fake.sql).toHaveLength(2); expect(fake.events.slice(-2)).toEqual(['rollback', 'close']);
  });
  it('bounds cell size and result bytes without unbounded row collection', async () => {
    fake.rows = [[ 'x'.repeat(9000) ]];
    const result = await runTestDbQuery(input());
    expect((result.rows[0]?.[0] as string).length).toBe(4096); expect(result.truncated).toBe(true);
    fake.rows = Array.from({ length: 500 }, () => ['x'.repeat(4096)]);
    const bounded = await runTestDbQuery({ ...input(), maxRows: 500 });
    expect(JSON.stringify(bounded.rows).length).toBeLessThan(1_048_576); expect(bounded.truncated).toBe(true);
  });
  it('aborts hanging queries by closing the rollback-only session', async () => {
    fake.hold = true; const controller = new AbortController();
    const result = runTestDbQuery({ ...input(), signal: controller.signal });
    const assertion = expect(result).rejects.toThrow('transport failed');
    await vi.waitFor(() => expect(fake.sql).toHaveLength(3)); controller.abort();
    await assertion; expect(fake.events.at(-1)).toBe('close');
  });
  it('enforces a wall-clock deadline even when the driver request never finishes', async () => {
    vi.useFakeTimers(); fake.hold = true;
    const result = runTestDbQuery(input()); const assertion = expect(result).rejects.toThrow('transport failed');
    await vi.advanceTimersByTimeAsync(60_000); await assertion;
    expect(fake.events.at(-1)).toBe('close');
  });
  it('does not connect for an already aborted signal', async () => {
    await expect(runTestDbQuery({ ...input(), signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fake.events).toEqual([]);
  });
});
