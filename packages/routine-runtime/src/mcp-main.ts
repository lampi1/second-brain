// The one process entry for the routine runtime's stdio MCP servers (ADR 0175): `mcp-main testdb` serves the read-only
// test DB tool, `mcp-main devops` the read-only work item tools, `mcp-main browser` the routine browser. The app bundles it as out/main/routine-mcp.js and
// starts it with Electron as Node; a terminal host runs it with node/tsx. Each server reads its private config file.
import { main as testDbMain } from './testdb-mcp';
import { devopsMain } from './devops-mcp';
import { browserMain } from './browser-mcp';

const kind = process.argv[2];
const run = kind === 'testdb' ? testDbMain : kind === 'devops' ? devopsMain : kind === 'browser' ? browserMain : undefined;
if (!run) { process.stderr.write('usage: routine-mcp testdb|devops|browser\n'); process.exit(2); }
else run().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
