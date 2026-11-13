// Host-only test database boundary for flow tools: validates exact user-configured targets and a deliberately
// small SELECT dialect before handing credentials to the SQL driver. No config writes, credentials or SQL in logs.
import fs from 'node:fs';
import { runTestDbQuery } from './test-db-driver';

export type TestDbCell = string | number | boolean | null;
export interface TestDbQueryRequest { targetId: string; query: string; maxRows: number }
export interface TestDbQueryResult { targetId: string; columns: string[]; rows: TestDbCell[][]; rowCount: number; truncated: boolean }
export interface TestDbTarget { id: string; server: string; port: number; database: string; confirmedTestDatabase?: true }
export interface TestDbDriverInput { target: TestDbTarget; userName: string; password: string; query: string; maxRows: number; signal?: AbortSignal; authorize?: () => void }
export type TestDbDriver = (input: TestDbDriverInput) => Promise<Omit<TestDbQueryResult, 'targetId'>>;
export class TestDbQueryError extends Error {}
const deny = (message: string): never => { throw new TestDbQueryError(message); };
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : deny('Invalid test database configuration or request');
const exact = (v: Record<string, unknown>, allowed: string[]): void => { if (Object.keys(v).some(k => !allowed.includes(k))) deny('Unknown test database configuration or request field'); };
const str = (v: unknown, max: number): string => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\x00-\x1f\x7f]/.test(v) ? v : deny('Invalid test database configuration or request text');
const identifier = (v: unknown): string => { const value = str(v, 64); return /^[a-zA-Z0-9_-]+$/.test(value) ? value : deny('Invalid test database target ID'); };

interface Token { kind: 'word' | 'identifier' | 'literal' | 'symbol'; value: string }
const FORBIDDEN = new Set(('ALTER BACKUP BEGIN BREAK BULK CHECKPOINT CLOSE COMMIT CONTINUE CREATE DBCC DEALLOCATE DECLARE DELETE DENY DISABLE DROP ENABLE EXEC EXECUTE FETCH GRANT GO GOTO IF INSERT INTO KILL MERGE OPEN OPENQUERY OPENROWSET OPENDATASOURCE OPTION PRINT RAISERROR READTEXT RECEIVE RECONFIGURE RESTORE RETURN REVERT REVOKE ROLLBACK SAVE SEND SET SHUTDOWN THROW TRUNCATE UPDATE UPDATETEXT USE WAITFOR WHILE WITH WRITETEXT NEXT VALUE FOR UNION INTERSECT EXCEPT NOLOCK READUNCOMMITTED READCOMMITTED READCOMMITTEDLOCK REPEATABLEREAD SERIALIZABLE ROWLOCK PAGLOCK TABLOCK TABLOCKX UPDLOCK XLOCK HOLDLOCK NOWAIT READPAST SNAPSHOT FORCESEEK FORCESCAN INDEX NOEXPAND KEEPIDENTITY KEEPDEFAULTS IGNORE_CONSTRAINTS IGNORE_TRIGGERS SPATIAL_WINDOW_MAX_CELLS TABLESAMPLE').split(' '));
const FUNCTIONS = new Set(('ABS AVG CEILING COALESCE CONCAT COUNT COUNT_BIG DATALENGTH DATEADD DATEDIFF DATEDIFF_BIG DATEFROMPARTS DATENAME DATEPART DAY FLOOR GETDATE GETUTCDATE ISNULL LEFT LEN LOWER LTRIM MAX MIN MONTH NULLIF REPLACE RIGHT ROUND RTRIM SIGN SQRT STRING_AGG SUBSTRING SUM SYSDATETIME SYSUTCDATETIME TRIM UPPER YEAR CAST CONVERT TRY_CAST TRY_CONVERT VARCHAR NVARCHAR CHAR NCHAR DECIMAL NUMERIC DATETIME DATETIME2 DATETIMEOFFSET TIME VARBINARY BINARY').split(' '));
const PAREN_KEYWORDS = new Set(['SELECT', 'TOP', 'IN', 'AND', 'OR', 'NOT', 'ON', 'WHERE', 'HAVING', 'WHEN', 'THEN', 'ELSE', 'AS']);

/** This is intentionally not a general T-SQL parser: one SELECT, no subqueries, CTEs, variables, hints or UDFs.
 *  SQL permissions remain mandatory: a view or synonym can otherwise hide a cross-database dependency. */
export function validateTestDbSql(query: unknown): string {
  if (typeof query !== 'string' || !query.trim() || query.length > 16_384 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(query)) deny('Query must be a SELECT of at most 16384 characters');
  const sql = query as string, tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (sql.startsWith('--', i) || sql.startsWith('/*', i)) deny('SQL comments are not allowed');
    if (c === "'" || c === '[' || c === '"') {
      const end = c === '[' ? ']' : c; let value = '', closed = false; i++;
      while (i < sql.length) { if (sql[i] === end) { if (sql[i + 1] === end) { value += end; i += 2; continue; } i++; closed = true; break; } value += sql[i++]!; }
      if (!closed) deny('Unterminated SQL text');
      tokens.push({ kind: c === "'" ? 'literal' : 'identifier', value }); continue;
    }
    const word = /^[a-zA-Z_][a-zA-Z0-9_$]*/.exec(sql.slice(i));
    if (word) { tokens.push({ kind: 'word', value: word[0].toUpperCase() }); i += word[0].length; continue; }
    const number = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(sql.slice(i));
    if (number) { tokens.push({ kind: 'literal', value: number[0] }); i += number[0].length; continue; }
    if (!'(),.*+-/%=<>!;'.includes(c)) deny('Unsupported SQL syntax');
    tokens.push({ kind: 'symbol', value: c }); i++;
  }
  if (tokens.at(-1)?.kind === 'symbol' && tokens.at(-1)?.value === ';') tokens.pop();
  if (tokens[0]?.kind !== 'word' || tokens[0]?.value !== 'SELECT') deny('Only SELECT queries are allowed');
  let depth = 0, selects = 0;
  for (let n = 0; n < tokens.length; n++) {
    const t = tokens[n]!, prev = tokens[n - 1], next = tokens[n + 1];
    if ((t.kind === 'word' || t.kind === 'identifier') && ['SYS', 'INFORMATION_SCHEMA'].includes(t.value.trimEnd().toUpperCase())) deny('System catalog access is not allowed');
    if (t.kind === 'identifier' && /^[#@]/.test(t.value.trim())) deny('Temporary objects and variables are not allowed');
    if (t.kind === 'word') {
      if (t.value === 'SELECT' && ++selects > 1) deny('Only one SELECT without subqueries is allowed');
      if (FORBIDDEN.has(t.value)) deny('Unsupported or unsafe SQL keyword');
    }
    if (t.kind === 'symbol' && t.value === ';') deny('Multiple SQL statements are not allowed');
    if (t.kind === 'symbol' && t.value === '(') {
      depth++;
      if (prev && (prev.kind === 'word' || prev.kind === 'identifier') &&
          (prev.kind !== 'word' || (!FUNCTIONS.has(prev.value) && !PAREN_KEYWORDS.has(prev.value)) || tokens[n - 2]?.value === '.')) deny('Only approved built-in SQL functions are allowed');
    }
    if (t.kind === 'symbol' && t.value === ')' && --depth < 0) deny('Unbalanced SQL parentheses');
    if (t.kind === 'symbol' && t.value === '.') {
      if (!prev || !next || prev.value === '.' || next.value === '.' || tokens[n - 2]?.value === '.' || tokens[n + 2]?.value === '.') deny('Cross-database and linked-server names are not allowed');
    }
  }
  if (depth !== 0) deny('Unbalanced SQL parentheses');
  // The driver executes this statement separately, never by concatenating SQL before or after it.
  return sql;
}

export function validateTestDbQueryRequest(value: unknown): TestDbQueryRequest {
  const v = record(value); exact(v, ['targetId', 'query', 'maxRows']);
  const maxRows = v.maxRows ?? 100;
  if (!Number.isInteger(maxRows) || (maxRows as number) < 1 || (maxRows as number) > 500) deny('maxRows must be between 1 and 500');
  return { targetId: identifier(v.targetId), query: validateTestDbSql(v.query), maxRows: maxRows as number };
}

export function readTestDbTargets(file: string): TestDbTarget[] {
  let raw: unknown;
  try { const stat = fs.statSync(file); if (!stat.isFile() || stat.size > 65_536) deny('Invalid test database configuration'); raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; return deny('Test database configuration is unavailable or invalid'); }
  const config = record(raw); exact(config, ['schema', 'targets', 'deniedDatabases', 'mandatoryDenyDatabases']);
  const databaseName = (name: unknown): string => { const value = str(name, 128); return /^[A-Za-z0-9_]+$/.test(value) ? value : deny('Invalid exact database name'); };
  const denyNames = (names: unknown): string[] => { if (names === undefined) return []; if (!Array.isArray(names) || names.length > 256) return deny('Invalid database deny list'); return names.map(name => str(name, 128).toLowerCase()); };
  const denied = denyNames(config.deniedDatabases), mandatory = [...denyNames(config.mandatoryDenyDatabases), 'master', 'model', 'msdb', 'tempdb', 'resource'];
  if (config.schema !== 1 || !Array.isArray(config.targets) || config.targets.length > 32) deny('Invalid test database configuration');
  const ids = new Set<string>();
  return (config.targets as unknown[]).map(value => {
    const v = record(value); exact(v, ['id', 'server', 'port', 'database', 'confirmedTestDatabase']);
    const id = identifier(v.id); if (ids.has(id)) deny('Duplicate test database target ID'); ids.add(id);
    const server = str(v.server, 253), database = databaseName(v.database), port = v.port ?? 1433;
    if (v.confirmedTestDatabase !== undefined && v.confirmedTestDatabase !== true) deny('A database override must be an explicit user confirmation');
    if (mandatory.includes(database.toLowerCase()) || denied.includes(database.toLowerCase()) && v.confirmedTestDatabase !== true) deny('Database is denied by the host configuration');
    if (!/^[a-zA-Z0-9.:-]+$/.test(server) || !Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) deny('Invalid test database connection settings');
    return { id, server, database, port: port as number, ...(v.confirmedTestDatabase === true ? { confirmedTestDatabase: true as const } : {}) };
  });
}

export class TestDbQueryExecutor {
  constructor(private readonly options: { file: string; driver?: TestDbDriver; env?: (name: 'SQLCMD_TEST_RO_USER' | 'SQLCMD_TEST_RO_PASSWORD') => string | undefined }) {}
  async execute(value: unknown, signal?: AbortSignal, authorize?: () => void, onTarget?: (database: string) => void): Promise<TestDbQueryResult> {
    const request = validateTestDbQueryRequest(value);
    const target = readTestDbTargets(this.options.file).find(t => t.id === request.targetId);
    if (!target) return deny('Test database target is not explicitly configured');
    // Journal the trusted configured database before any network attempt; successful queries additionally verify DB_NAME.
    try { onTarget?.(target.database); } catch { return deny('Test database evidence could not be recorded'); }
    if (signal?.aborted) return deny('Test database query was cancelled');
    const env = this.options.env ?? ((name: string) => process.env[name]);
    const userName = env('SQLCMD_TEST_RO_USER'), credential = env('SQLCMD_TEST_RO_PASSWORD');
    if (!userName || userName.length > 128 || /[\x00-\x1f\x7f]/.test(userName) || !credential || credential.length > 8192) return deny('Test database credential is unavailable');
    try {
      authorize?.();
      const result = await (this.options.driver ?? runTestDbQuery)({ target, userName, password: credential, query: request.query, maxRows: request.maxRows, signal, authorize });
      authorize?.();
      if (signal?.aborted) return deny('Test database query was cancelled');
      return { targetId: target.id, ...result };
    }
    catch { return deny(signal?.aborted ? 'Test database query was cancelled' : 'Test database query failed; verify the read-only login, target, certificate and query'); }
  }
}
