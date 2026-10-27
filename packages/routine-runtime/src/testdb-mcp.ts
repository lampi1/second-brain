// The routine runtime's tiny stdio MCP server for read-only test DB queries (ADR 0175 item 10). Started by the step's
// Claude session through the --mcp-config the runtime wrote; reads its targets and logins from the 0600 temp file named
// by SB_ROUTINE_TESTDB_CONFIG. One tool, test_db_query: one SELECT (validateTestDbSql), on a target the guard still
// accepts at call time (never production), through the tedious driver (ApplicationIntent=ReadOnly, rolled-back
// transaction). Every call appends the query text and the row count to the step's evidence file. No app, no brain.
import fs from 'node:fs';
import readline from 'node:readline';
import { checkTestDbTarget } from './testdb-guard';
import { validateTestDbSql, type TestDbDriver } from './test-db-query';
import { TESTDB_TOOL, type TestDbServerConfig } from './testdb';
import { createMasker } from './mask';

const MAX_ROWS = 200;

const TOOL = {
  name: TESTDB_TOOL,
  description: 'Run ONE read-only SELECT on a test database of this routine (never production). Returns columns and rows as JSON.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['target', 'query'],
    properties: {
      target: { type: 'string', description: 'the test database id' },
      query: { type: 'string', description: 'one SELECT statement' },
      maxRows: { type: 'number', description: `rows to return, 1-${MAX_ROWS}` },
    },
  },
};

type Json = Record<string, unknown>;

/** Handles one JSON-RPC message; null = no reply (a notification). Exported for the unit tests. */
export async function handleTestDbMessage(message: Json, config: TestDbServerConfig, driver: TestDbDriver): Promise<Json | null> {
  const id = message.id;
  if (id === undefined || id === null) return null;
  const reply = (result: unknown): Json => ({ jsonrpc: '2.0', id, result });
  const text = (t: string, isError = false) => reply({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
  switch (message.method) {
    case 'initialize': {
      const asked = (message.params as Json | undefined)?.protocolVersion;
      return reply({ protocolVersion: typeof asked === 'string' ? asked : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'routine-testdb', version: '1' } });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: [TOOL] });
    case 'tools/call': {
      const params = (message.params ?? {}) as Json, args = (params.arguments ?? {}) as Json;
      if (params.name !== TESTDB_TOOL) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
      const masker = createMasker(config.targets.flatMap(t => [t.password, t.user]));
      const target = config.targets.find(t => t.id === args.target);
      const log = (line: string) => { try { fs.appendFileSync(config.evidence, masker.mask(line), { mode: 0o600 }); } catch { /* evidence is best effort */ } };
      if (!target) return text(`Unknown or unavailable test database "${String(args.target)}". Available: ${config.targets.map(t => t.id).join(', ') || 'none'}.`, true);
      const refused = checkTestDbTarget(target, config.recognised);
      if (refused) { log(`\n## ${target.id}: refused\n\n${refused}\n`); return text(`Refused: ${refused}.`, true); }
      let sql: string;
      try { sql = validateTestDbSql(args.query); } catch (e) {
        log(`\n## ${target.id}: refused query\n\n\`\`\`sql\n${String(args.query).slice(0, 4000)}\n\`\`\`\n\n${(e as Error).message}\n`);
        return text(`Refused: ${(e as Error).message}. Only one SELECT is allowed.`, true);
      }
      const maxRows = typeof args.maxRows === 'number' && Number.isInteger(args.maxRows) ? Math.min(Math.max(args.maxRows, 1), MAX_ROWS) : 50;
      try {
        const result = await driver({ target: { id: target.id, server: target.server, port: target.port, database: target.database }, userName: target.user, password: target.password, query: sql, maxRows });
        log(`\n## ${target.id} (${target.database})\n\n\`\`\`sql\n${sql}\n\`\`\`\n\nRows: ${result.rowCount}${result.truncated ? ' (truncated)' : ''}\n`);
        return text(masker.mask(JSON.stringify({ columns: result.columns, rows: result.rows, rowCount: result.rowCount, truncated: result.truncated })));
      } catch {
        log(`\n## ${target.id} (${target.database})\n\n\`\`\`sql\n${sql}\n\`\`\`\n\nDB unavailable (the query failed)\n`);
        return text('DB unavailable: the query failed (VPN or permissions). Continue without it.', true);
      }
    }
    default: return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  }
}

/** Serves stdin/stdout until stdin closes. */
export async function serveTestDb(config: TestDbServerConfig, driver: TestDbDriver, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: Json;
    try { message = JSON.parse(line) as Json; } catch { output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`); continue; }
    const reply = await handleTestDbMessage(message, config, driver);
    if (reply) output.write(`${JSON.stringify(reply)}\n`);
  }
}

/** The entry when run as a process (mcp-main.ts `testdb`: the app's out/main/routine-mcp.js, node/tsx in a terminal). */
export async function main(): Promise<void> {
  const file = process.env.SB_ROUTINE_TESTDB_CONFIG;
  if (!file) { process.stderr.write('SB_ROUTINE_TESTDB_CONFIG is not set\n'); process.exit(2); }
  const config = JSON.parse(fs.readFileSync(file, 'utf8')) as TestDbServerConfig;
  const { runTestDbQuery } = await import('./test-db-driver');
  await serveTestDb(config, runTestDbQuery);
}
