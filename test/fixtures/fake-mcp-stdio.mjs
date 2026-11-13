// A fake MCP server over stdio for the unit tests of the app's MCP client and gateway (src/main/mcp-servers, ADR 0086):
// newline-delimited JSON-RPC; answers initialize, tools/list (two pages: a reading tool and a writing one) and
// tools/call (echo: its arguments and whether the token variable reached it, never the token itself). FAKE_MCP_EXIT=1
// exits at once with a message on stderr (the "server closed" error); FAKE_MCP_ASK=1 sends a roots/list request first.
import readline from 'node:readline';

if (process.env.FAKE_MCP_EXIT === '1') { process.stderr.write('fatal: missing organization\n'); process.exit(3); }
const send = m => process.stdout.write(`${JSON.stringify(m)}\n`);
process.stdout.write('a log line that is not JSON\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.method === undefined) return; // our answer to the server's request
  if (m.id === undefined) return;
  switch (m.method) {
    case 'initialize':
      if (process.env.FAKE_MCP_ASK === '1') send({ jsonrpc: '2.0', id: 'ask-1', method: 'roots/list' });
      send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-stdio', version: '0.1' } } });
      break;
    case 'tools/list':
      if (!m.params?.cursor) send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'read_items', description: 'reads', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }], nextCursor: 'p2' } });
      else send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'write_item', description: 'writes', inputSchema: { type: 'object' } }] } });
      break;
    case 'tools/call':
      send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify({ tool: m.params.name, args: m.params.arguments, token: process.env.FAKE_MCP_TOKEN ? process.env.FAKE_MCP_TOKEN.length : 0 }) }] } });
      break;
    default:
      send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } });
  }
});
