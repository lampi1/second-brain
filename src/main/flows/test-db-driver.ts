// Tedious SQL Server transport used only by the host's validated test-db executor. Each call owns one encrypted
// connection and rollback-only transaction; bounded streaming results and a wall-clock deadline prevent runaway reads.
import { Connection, Request, ISOLATION_LEVEL } from 'tedious';
import type { TestDbCell, TestDbDriver, TestDbDriverInput, TestDbQueryResult } from './test-db-query';

const DEADLINE_MS = 95_000, CLEANUP_MS = 2_000, MAX_BYTES = 1_048_576, MAX_CELL = 4096, MAX_COLUMNS = 128;
type Result = Omit<TestDbQueryResult, 'targetId'>;
const failure = (): Error => new Error('Test database transport failed');

export const runTestDbQuery: TestDbDriver = async (input: TestDbDriverInput): Promise<Result> => {
  const { target, signal } = input;
  if (signal?.aborted) throw failure();
  const connection = new Connection({
    server: target.server,
    authentication: { type: 'default', options: { userName: input.userName, password: input.password } },
    options: {
      database: target.database, port: target.port, encrypt: true, trustServerCertificate: false,
      readOnlyIntent: true, fallbackToDefaultDb: false, connectTimeout: 30_000, requestTimeout: 60_000,
      cancelTimeout: 1_000, maxRetriesOnTransientErrors: 0, abortTransactionOnError: true,
      isolationLevel: ISOLATION_LEVEL.READ_UNCOMMITTED, appName: 'second-brain-test-read',
      rowCollectionOnDone: false, rowCollectionOnRequestCompletion: false, useColumnNames: false,
      textsize: MAX_CELL * 2,
    },
  });
  let closed = false, began = false, stopped = false;
  let rejectStop: (error: Error) => void = () => undefined;
  const stopping = new Promise<never>((_, reject) => { rejectStop = reject; });
  const close = () => { if (!closed) { closed = true; connection.close(); } };
  // Closing a connection also rolls back an open transaction server-side if cancellation/transport failure prevents
  // the explicit rollback below. Never return a connection to a pool, and never commit, even after a successful read.
  const stop = () => { stopped = true; rejectStop(failure()); close(); };
  connection.on('error', stop);
  connection.on('end', () => { if (!closed) stop(); });
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, DEADLINE_MS);
  const wait = <T>(work: Promise<T>): Promise<T> => Promise.race([work, stopping]);
  const callback = (start: (done: (error?: Error | null) => void) => void): Promise<void> => wait(new Promise((resolve, reject) => {
    if (stopped) { reject(failure()); return; }
    start(error => error ? reject(failure()) : resolve());
  }));
  const read = (sql: string, maxRows: number): Promise<Result> => {
    const requestTimer = setTimeout(stop, 60_000);
    return wait(new Promise<Result>((resolve, reject) => {
    const columns: string[] = [], rows: TestDbCell[][] = [];
    let bytes = 0, truncated = false, invalid = false;
    const request = new Request(sql, error => {
      if (error || invalid) reject(failure());
      else resolve({ columns, rows, rowCount: rows.length, truncated });
    });
    request.on('columnMetadata', metadata => {
      if (!Array.isArray(metadata) || columns.length || metadata.length > MAX_COLUMNS || metadata.some(column => ['Xml', 'UDT'].includes(column.type.name))) { invalid = true; request.cancel(); return; }
      for (const column of metadata) columns.push(column.colName.slice(0, 128));
    });
    request.on('row', (values: { value: unknown }[]) => {
      if (invalid) return;
      if (values.length > MAX_COLUMNS) { invalid = true; request.cancel(); return; }
      if (rows.length >= maxRows) { truncated = true; return; }
      const row: TestDbCell[] = values.map(column => {
        const v: unknown = column.value;
        if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return v;
        let s: string;
        if (typeof v === 'string' || typeof v === 'bigint') s = String(v);
        else if (v instanceof Date) s = v.toISOString();
        else if (Buffer.isBuffer(v)) s = v.toString('base64');
        else { invalid = true; return null; }
        if (s.length >= MAX_CELL) { truncated = true; return s.slice(0, MAX_CELL); }
        return s;
      });
      bytes += Buffer.byteLength(JSON.stringify(row), 'utf8');
      if (bytes > MAX_BYTES) { truncated = true; return; }
      rows.push(row);
    });
    connection.execSql(request);
    })).finally(() => clearTimeout(requestTimer));
  };
  try {
    await callback(done => connection.connect(done));
    await callback(done => connection.beginTransaction(done, 'sb_test_read', ISOLATION_LEVEL.READ_UNCOMMITTED)); began = true;
    const identity = await read('SELECT DB_NAME() AS database_name', 1);
    if (identity.rows.length !== 1 || identity.rows[0]?.[0] !== target.database) throw failure();
    await read(`SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET ROWCOUNT ${input.maxRows + 1}`, 0);
    input.authorize?.();
    return await read(input.query, input.maxRows);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', stop);
    if (began && !closed) {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          new Promise<void>((resolve, reject) => connection.rollbackTransaction(error => error ? reject(failure()) : resolve(), 'sb_test_read')),
          new Promise<never>((_, reject) => { cleanupTimer = setTimeout(() => { close(); reject(failure()); }, CLEANUP_MS); }),
        ]);
      } finally { if (cleanupTimer) clearTimeout(cleanupTimer); close(); }
    } else close();
  }
};
