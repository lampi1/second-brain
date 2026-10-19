// "Importa da Claude e Cursor" (ADR 0086): servers read from Claude Code, Claude desktop, Cursor and Codex configs in
// a temp home; a secret is never copied (named variables and headers, token-looking values, ${VAR} references, token
// arguments become empty slots or are dropped and listed); the engines' files are byte-for-byte unchanged; an import
// lands in the app store with its token still to type.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { codexServers, convert, scanImports } from '../../../src/main/mcp-servers/import';
import { McpServersService } from '../../../src/main/mcp-servers/service';
import { McpServer } from '../../../src/main/mcp/server';
import { tmp } from '../chats/helpers';

const TOKEN = 'ghp_ABCdef1234567890ghijKLMNOP';
function home(): string {
  const h = tmp('import-home');
  fs.writeFileSync(path.join(h, '.claude.json'), JSON.stringify({
    mcpServers: { 'azure-devops': { type: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp', 'contoso'], env: { AZURE_DEVOPS_PAT: TOKEN, ORG: 'contoso' } } },
    projects: { '/repo': { mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: `Bearer ${TOKEN}`, 'X-Team': 'web' } } } } },
  }));
  fs.mkdirSync(path.join(h, '.cursor'));
  fs.writeFileSync(path.join(h, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { jira: { url: `https://mcp.atlassian.com/v1/mcp?api_key=${TOKEN}` }, 'second-brain': { url: 'http://127.0.0.1:4319/mcp' } } }));
  fs.mkdirSync(path.join(h, '.codex'));
  fs.writeFileSync(path.join(h, '.codex', 'config.toml'), [
    'model = "gpt-5"', '', '[mcp_servers.sentry]', 'command = "npx"', `args = ["-y", "@sentry/mcp", "--access-token", "${TOKEN}"]`, 'env = { SENTRY_HOST = "sentry.io" }', '',
    '[mcp_servers.docs]', 'url = "https://mcp.context7.com/mcp"', 'bearer_token_env_var = "CTX7_KEY"', '', '[profiles.x]', 'model = "o3"',
  ].join('\n'));
  return h;
}
const hashes = (h: string) => ['.claude.json', '.cursor/mcp.json', '.codex/config.toml'].map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(h, f))).digest('hex'));

describe('import', () => {
  it('finds the servers of every source without copying a secret, and changes no file', () => {
    const h = home(), before = hashes(h);
    const found = scanImports(h, ['github'], 'linux', {});
    expect(found.map(f => [f.source, f.def.id, f.exists])).toEqual([
      ['claude', 'azure-devops', false], ['claude', 'github', true], ['cursor', 'jira', false], ['codex', 'sentry', false], ['codex', 'docs', false],
    ]);
    expect(JSON.stringify(found)).not.toContain(TOKEN);
    const by = Object.fromEntries(found.map(f => [f.def.id, f]));
    expect(by['azure-devops']!.def).toMatchObject({ transport: 'stdio', command: 'npx', env: { ORG: 'contoso' }, secrets: [{ where: 'env', name: 'AZURE_DEVOPS_PAT' }] });
    expect(by.github!.def).toMatchObject({ headers: { 'X-Team': 'web' }, secrets: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }] });
    expect(by.jira!.def.url).toBe('https://mcp.atlassian.com/v1/mcp');
    expect(by.jira!.secretsDropped).toEqual(['parametro api_key']);
    expect(by.sentry!.def.args).toEqual(['-y', '@sentry/mcp']);
    expect(by.sentry!.secretsDropped).toEqual(['argomento --access-token']);
    expect(by.docs!.def.secrets).toEqual([{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }]);
    expect(hashes(h)).toEqual(before);
  });

  it('reads only the mcp_servers tables of a Codex config', () => {
    expect(Object.keys(codexServers('[mcp_servers."a-b"]\ncommand = \'x\'\n[mcp_servers.a-b.env]\nK = "v"\n[other]\ncommand = "no"'))).toEqual(['a-b']);
    expect(codexServers('[mcp_servers.a]\ncommand = "x"\n[mcp_servers.a.env]\nK = "v"').a).toEqual({ command: 'x', env: { K: 'v' } });
  });

  it('a token-looking value under an innocent name is still not copied; the app\'s own servers are skipped', () => {
    expect(convert('x', { command: 'node', env: { CONFIG: 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA' } }, 'claude')!.def.secrets).toEqual([{ where: 'env', name: 'CONFIG' }]);
    expect(convert('second-brain', { url: 'http://127.0.0.1:4319/mcp' }, 'cursor')).toBeNull();
    expect(convert('y', { command: 'node', env: { HOME_DIR: '${HOME}' } }, 'claude')!.def.env).toBeUndefined();
  });

  it('applies the chosen ones to the app, their tokens still to type', () => {
    const h = home();
    const svc = new McpServersService({ userData: tmp('import-ud'), cipher: { unavailable: () => null, encrypt: s => Buffer.from(s), decrypt: b => b.toString() }, mcp: new McpServer({ name: 't', version: '1' }), context: () => null, home: h });
    const keys = svc.importScan().map(c => c.key);
    const r = svc.importApply(keys);
    expect(r.added).toEqual(['azure-devops', 'github', 'jira', 'sentry', 'docs']);
    expect(r.errors).toEqual([]);
    expect(r.state.servers.find(s => s.id === 'azure-devops')).toMatchObject({ importedFrom: 'claude', secretMasks: { 'env:AZURE_DEVOPS_PAT': null } });
    expect(svc.importApply([keys[0]]).errors[0]!.message).toMatch(/Esiste già/);
    svc.stop();
  });
});
