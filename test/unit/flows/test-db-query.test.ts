// Exercises the host-only SQL boundary with synthetic config and an injected driver; never contacts a database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestDbQueryExecutor, readTestDbTargets, validateTestDbSql, validateTestDbQueryRequest } from '../../../packages/routine-runtime/src/test-db-query';

const dirs: string[] = [];
const target = { id: 'test-a', server: 'sql.example.invalid', database: 'ExplicitSandbox' };
const config = (value: unknown = { schema: 1, targets: [target] }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-db-')); dirs.push(dir);
  const file = path.join(dir, 'targets.json'); fs.writeFileSync(file, JSON.stringify(value)); return file;
};
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('conservative SELECT grammar', () => {
  it.each([
    'SELECT 1', "SELECT N'UPDATE ; EXEC' AS label;", 'SELECT t.[name], COUNT(*) FROM [dbo].[Items] t GROUP BY t.[name]',
    'SELECT TOP (10) id FROM dbo.Items WHERE id IN (1, 2) ORDER BY id DESC',
    "SELECT CASE WHEN id > 1 THEN 'yes' ELSE 'no' END FROM dbo.Items", 'SELECT CAST(id AS VARCHAR(20)) FROM dbo.Items',
    'SELECT [a]]b] FROM [dbo].[Rows]', 'SELECT 3.14',
  ])('allows %s', sql => { expect(validateTestDbSql(sql)).toBe(sql); });
  it.each([
    'DELETE FROM dbo.Items', 'SELECT * INTO dbo.Copy FROM dbo.Items', 'SELECT 1; SELECT 2', 'SELECT 1 SELECT 2',
    'SELECT 1; USE master', 'SELECT * FROM OtherDb.dbo.Items', 'SELECT * FROM [OtherDb].[dbo].[Items]',
    'SELECT * FROM [OtherDb]..[Items]', 'SELECT * FROM host.db.dbo.Items', 'SELECT * FROM dbo.fn_write()',
    'SELECT OPENROWSET(1)', 'SELECT [OPENROWSET](1)', 'SELECT OPENQUERY(1)', 'SELECT OPENDATASOURCE(1)',
    'SELECT NEXT VALUE FOR dbo.Sequence', 'WITH a AS (SELECT 1) SELECT * FROM a', 'SELECT (SELECT 1)',
    'SELECT 1 UNION SELECT 2', 'SELECT @@VERSION', 'SELECT @x = 1', 'SELECT * FROM #temp',
    'SELECT * FROM sys.configurations', 'SELECT * FROM [sys].[databases]', 'SELECT * FROM INFORMATION_SCHEMA.TABLES', 'SELECT * FROM [sys ].databases', 'SELECT * FROM [##shared]', 'SELECT * FROM COUNT(TABLOCKX)',
    '/* harmless */ SELECT 1', 'SELECT 1 -- harmless', 'SELECT 1 /* incomplete', 'SELECT /* nested /* */ 1 */', "SELECT 'unterminated", 'SELECT 1; EXEC sp_who',
    'SELECT unknown_function(1)', 'SELECT * FROM dbo.Items WITH (UPDLOCK)', 'SELECT 1 OPTION (QUERYTRACEON 1)',
    'SELECT 1 FOR XML AUTO', 'SELECT 1) ', 'SELECT (1', 'SELECT 1\u0000', 'SELECT * FROM "db"."dbo"."Items"',
  ])('rejects %s', sql => { expect(() => validateTestDbSql(sql)).toThrow(); });
});

describe('host-owned target configuration', () => {
  it('starts with no targets and never infers test names', async () => {
    const file = config({ schema: 1, targets: [] }), driver = vi.fn();
    const executor = new TestDbQueryExecutor({ file, driver });
    await expect(executor.execute({ targetId: 'test-production', query: 'SELECT 1' })).rejects.toThrow('not explicitly configured');
    expect(driver).not.toHaveBeenCalled(); expect(readTestDbTargets(`${file}.missing`)).toEqual([]);
  });
  it('pins the exact server and database and reads only the fixed read-only credential environment variables', async () => {
    const file = config(), driver = vi.fn().mockResolvedValue({ columns: ['one'], rows: [[1]], rowCount: 1, truncated: false });
    const executor = new TestDbQueryExecutor({ file, driver, env: name => name === 'SQLCMD_TEST_RO_USER' ? 'restricted_reader' : 'test-only-secret' });
    await expect(executor.execute({ targetId: 'test-a', query: 'SELECT 1' })).resolves.toMatchObject({ targetId: 'test-a', rows: [[1]] });
    expect(driver.mock.calls[0]?.[0]).toMatchObject({ target: { ...target, port: 1433 }, password: 'test-only-secret', maxRows: 100 });
    await expect(executor.execute({ targetId: 'TEST-A', query: 'SELECT 1' })).rejects.toThrow('not explicitly configured');
    fs.writeFileSync(file, JSON.stringify({ schema: 1, targets: [] }));
    await expect(executor.execute({ targetId: 'test-a', query: 'SELECT 1' })).rejects.toThrow();
    expect(driver).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...target, password: '<not-permitted>' }, { ...target, database: 'master' }, { ...target, server: 'server;Database=Other' },
    { ...target, database: '' }, { ...target, port: 0 }, { ...target, database: ' db ' },
  ])('rejects invalid host target config', t => { expect(() => readTestDbTargets(config({ schema: 1, targets: [t] }))).toThrow(); });
  it('enforces mandatory denies and requires explicit user confirmation for historical name overlaps', () => {
    expect(() => readTestDbTargets(config({ schema: 1, targets: [target], deniedDatabases: [target.database] }))).toThrow();
    expect(readTestDbTargets(config({ schema: 1, targets: [{ ...target, confirmedTestDatabase: true }], deniedDatabases: [target.database] }))).toHaveLength(1);
    expect(() => readTestDbTargets(config({ schema: 1, targets: [{ ...target, confirmedTestDatabase: true }], mandatoryDenyDatabases: [target.database] }))).toThrow();
    expect(() => readTestDbTargets(config({ schema: 1, targets: [{ ...target, database: 'MASTER', confirmedTestDatabase: true }] }))).toThrow();
    expect(() => readTestDbTargets(config({ schema: 1, targets: [{ ...target, database: 'name-prod' }] }))).toThrow();
  });
  it('rejects malformed, oversized, duplicate and unknown configuration fields', () => {
    expect(() => readTestDbTargets(config({ schema: 1, targets: [target, target] }))).toThrow();
    expect(() => readTestDbTargets(config({ schema: 1, targets: [], allowProduction: true }))).toThrow();
    const file = config(); fs.writeFileSync(file, '{'); expect(() => readTestDbTargets(file)).toThrow();
    fs.writeFileSync(file, ' '.repeat(65_537)); expect(() => readTestDbTargets(file)).toThrow();
  });
  it('validates before connecting and never reflects driver errors or credentials', async () => {
    const driver = vi.fn().mockRejectedValue(new Error('test-only-secret server sql text'));
    const executor = new TestDbQueryExecutor({ file: config(), driver, env: name => name === 'SQLCMD_TEST_RO_USER' ? 'restricted_reader' : 'test-only-secret' });
    await expect(executor.execute({ targetId: 'test-a', query: 'SELECT 1; DELETE FROM dbo.Items' })).rejects.toThrow();
    expect(driver).not.toHaveBeenCalled();
    await expect(executor.execute({ targetId: 'test-a', query: 'SELECT 1' })).rejects.toThrow('Test database query failed');
    try { await executor.execute({ targetId: 'test-a', query: 'SELECT 1' }); } catch (error) { expect(String(error)).not.toContain('test-only-secret'); }
  });
  it('fails before connection on missing credentials, cancellation or agent-supplied target overrides', async () => {
    const driver = vi.fn(), executor = new TestDbQueryExecutor({ file: config(), driver, env: () => undefined });
    await expect(executor.execute({ targetId: 'test-a', query: 'SELECT 1' })).rejects.toThrow('credential');
    await expect(executor.execute({ targetId: 'test-a', query: 'SELECT 1' }, AbortSignal.abort())).rejects.toThrow('cancelled');
    await expect(executor.execute({ targetId: 'test-a', query: 'SELECT 1', database: 'Other' })).rejects.toThrow();
    expect(driver).not.toHaveBeenCalled();
  });
  it('rejects revoked results and only looks up the two fixed credential names', async () => {
    const env = vi.fn((name: string) => name === 'SQLCMD_TEST_RO_USER' ? 'restricted_reader' : 'test-only-secret');
    let allowed = true;
    const driver = vi.fn(async () => { allowed = false; return { columns: ['one'], rows: [[1]], rowCount: 1, truncated: false }; });
    const executor = new TestDbQueryExecutor({ file: config(), driver, env });
    await expect(executor.execute({ targetId: 'test-a', query: 'SELECT 1' }, undefined, () => { if (!allowed) throw new Error('revoked'); })).rejects.toThrow('Test database query failed');
    expect(env.mock.calls.map(call => call[0])).toEqual(['SQLCMD_TEST_RO_USER', 'SQLCMD_TEST_RO_PASSWORD']);
  });
  it('journals the trusted configured database before credentials or transport and refuses missing evidence', async () => {
    const order: string[] = [];
    const env = vi.fn(() => { order.push('credentials'); return 'test-only-secret'; });
    const driver = vi.fn(async () => { order.push('driver'); return { columns: [], rows: [], rowCount: 0, truncated: false }; });
    const executor = new TestDbQueryExecutor({ file: config(), driver, env });
    await executor.execute({ targetId: 'test-a', query: 'SELECT 1' }, undefined, undefined, database => { expect(database).toBe(target.database); order.push('journal'); });
    expect(order[0]).toBe('journal'); expect(order.at(-1)).toBe('driver');
    env.mockClear(); driver.mockClear();
    await expect(executor.execute({ targetId: 'test-a', query: 'SELECT 1' }, undefined, undefined, () => { throw new Error('private path'); })).rejects.toThrow('evidence could not be recorded');
    expect(env).not.toHaveBeenCalled(); expect(driver).not.toHaveBeenCalled();
  });
  it.each([0, -1, 501, 1.5, '2', NaN])('rejects invalid row bounds %s', maxRows => {
    expect(() => validateTestDbQueryRequest({ targetId: 'test-a', query: 'SELECT 1', maxRows })).toThrow();
  });
});
