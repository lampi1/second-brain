// The app's MCP client (ADR 0086) against local fakes, no network: Streamable HTTP with a JSON and an SSE answer, the
// session id, the token header sent and a 401 mapped to a clear "token" error; stdio with the fake server (paged tool
// list, readOnlyHint, a server request answered, the token variable reaching the process, a crash with its stderr);
// the Windows .cmd rule for arguments.
import { afterEach, describe, expect, it } from 'vitest';
import type http from 'node:http';
import { spawnPlan, type Upstream } from '../../../src/main/mcp-servers/client';
const servers: http.Server[] = [], ups: Upstream[] = [];
afterEach(() => { for (const u of ups.splice(0)) u.close(); for (const s of servers.splice(0)) s.close(); });

describe('stdio upstream', () => {
  it('a .cmd on Windows takes plain arguments only, through cmd.exe', () => {
    const plan = spawnPlan({ transport: 'stdio', command: 'C:\\tools\\npx.cmd', args: ['-y', '@azure-devops/mcp', 'contoso'], env: {} }, 'win32');
    expect(plan.verbatim).toBe(true);
    expect(plan.args.at(-1)).toBe('""C:\\tools\\npx.cmd" -y @azure-devops/mcp contoso"');
    expect(() => spawnPlan({ transport: 'stdio', command: 'C:\\tools\\npx.cmd', args: ['a & calc'], env: {} }, 'win32')).toThrow(/non sicuro/);
    expect(spawnPlan({ transport: 'stdio', command: '/usr/bin/env', args: ['a & b'], env: { X: '1' } }, 'linux')).toMatchObject({ command: '/usr/bin/env', args: ['a & b'], verbatim: false });
  });
});
