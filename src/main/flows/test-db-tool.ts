// Authenticated per-chat test DB query tool. The host derives its flow binding and exact user-approved grant.
// Mounted by wiring.ts; callers cannot choose a flow, bypass consent, or supply database credentials.
import type { McpTool } from '../mcp/server';
export type TestDbReadRun = (chatId: string, request: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>;
export function testDbReadTools(read: TestDbReadRun): McpTool[] {
  return [{
    name: 'flow_test_db_query',
    description: 'Read a configured test database only from a chat bound to the running agent step explicitly declaring testDbRead:true or the test-db-read adapter of an automatic flow. The host requires an enabled exact-revision user-approved testDbRead grant for targetId. Supply one bounded read-only SELECT query; no credentials, connection strings, production targets, writes or alternate execution tools. Every executed query records its SHA-256 hash, configured database, run, timestamp and outcome as evidence; raw SQL and result rows are not saved in the flow journal. Returns bounded rows and evidenceId. A refusal is final for this request.',
    inputSchema: { type: 'object', required: ['targetId', 'query'], additionalProperties: false, properties: {
      targetId: { type: 'string', maxLength: 64 }, query: { type: 'string', maxLength: 16384 }, maxRows: { type: 'integer', minimum: 1, maximum: 500 },
    } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      if (!ctx.params.chatId) throw new Error("This tool works only on a chat's own endpoint.");
      return JSON.stringify(await read(ctx.params.chatId, args, ctx.signal));
    },
  }];
}
