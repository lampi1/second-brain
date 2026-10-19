// The app's MCP server store (ADR 0086): strict definitions (no shell, no secret in plain fields, https or loopback
// only, reserved names), tokens write-only and encrypted (never in clear on disk, bound to where they may go), role
// access validated and fail-closed when the file is damaged, and the shared access rules a chat is checked with.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { McpServerStore, checkDef, fingerprint } from '../../../src/main/mcp-servers/store';
import { chainAllows, chainOffers, checkAccess, idFrom, toolAllowed } from '../../../src/shared/mcp-servers';
import type { SecretCipher } from '../../../src/main/engines/secrets';
import { tmp } from '../chats/helpers';

/** A reversible fake that is visibly not clear text on disk. */
const cipher: SecretCipher = { unavailable: () => null, encrypt: s => Buffer.from([...Buffer.from(s)].map(b => b ^ 0x5a)), decrypt: b => Buffer.from([...b].map(x => x ^ 0x5a)).toString() };
const stdio = { id: 'azure-devops', label: 'Azure DevOps', transport: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp', 'contoso'], secrets: [{ where: 'env', name: 'AZURE_DEVOPS_PAT' }], enabled: true };
const http = { id: 'github', label: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', secrets: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }], enabled: true };

describe('checkDef', () => {
  it('accepts a stdio and an http server', () => {
    expect(checkDef(stdio)).toMatchObject({ id: 'azure-devops', command: 'npx', args: ['-y', '@azure-devops/mcp', 'contoso'] });
    expect(checkDef(http)).toMatchObject({ url: 'https://api.githubcopilot.com/mcp/' });
    expect(checkDef({ ...http, url: 'http://127.0.0.1:8123/mcp' }).url).toBe('http://127.0.0.1:8123/mcp');
  });
  it('refuses shell characters, reserved or invalid names and secrets in plain fields', () => {
    expect(() => checkDef({ ...stdio, command: 'npx && calc' })).toThrow(/Comando/);
    expect(() => checkDef({ ...stdio, command: '"C:\\x.exe"' })).toThrow(/Comando/);
    expect(() => checkDef({ ...stdio, id: 'second-brain' })).toThrow(/riservato/);
    expect(() => checkDef({ ...stdio, id: 'Has Space' })).toThrow(/Nome tecnico/);
    expect(() => checkDef({ ...stdio, env: { GITHUB_TOKEN: 'ghp_x' } })).toThrow(/segreto/);
    expect(checkDef({ ...stdio, env: { ORG: 'contoso' } }).env).toEqual({ ORG: 'contoso' });
    expect(() => checkDef({ ...http, headers: { Authorization: 'Bearer x' } })).toThrow(/segreto/);
    expect(() => checkDef({ ...http, headers: { Host: 'x' } })).toThrow(/app/);
    expect(() => checkDef({ ...http, url: 'https://u:p@example.com/mcp' })).toThrow(/password/);
    expect(() => checkDef({ ...http, url: 'https://example.com/mcp?api_key=1' })).toThrow(/segreto/);
    expect(() => checkDef({ ...http, url: 'http://example.com/mcp' })).toThrow(/https/);
    expect(() => checkDef({ ...http, secrets: [{ where: 'env', name: 'X' }] })).toThrow(/intestazione/);
    expect(() => checkDef({ ...stdio, args: ['a\nb'] })).toThrow(/Argomento 1/);
  });
});

describe('McpServerStore', () => {
  it('stores a token encrypted and write-only, shows only its mask, gives it back only to main', () => {
    const dir = tmp('mcp-store');
    const s = new McpServerStore(dir, cipher);
    s.upsert(stdio);
    expect(s.masks('azure-devops')).toEqual({ 'env:AZURE_DEVOPS_PAT': null });
    const token = 'pat-1234567890abcdefghijklmnop';
    s.setSecret('azure-devops', 'env:AZURE_DEVOPS_PAT', token);
    expect(s.masks('azure-devops')['env:AZURE_DEVOPS_PAT']).toBe('pat-…mnop');
    for (const f of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toContain(token);
    expect(s.secret('azure-devops', { where: 'env', name: 'AZURE_DEVOPS_PAT' })).toBe(token);
    // a fresh store reads it back
    expect(new McpServerStore(dir, cipher).secret('azure-devops', { where: 'env', name: 'AZURE_DEVOPS_PAT' })).toBe(token);
    expect(() => s.setSecret('azure-devops', 'env:OTHER', 'x')).toThrow(/sconosciuto/);
    expect(() => s.setSecret('azure-devops', 'env:AZURE_DEVOPS_PAT', 'has space')).toThrow(/spazi/);
    s.deleteSecret('azure-devops', 'env:AZURE_DEVOPS_PAT');
    expect(s.secret('azure-devops', { where: 'env', name: 'AZURE_DEVOPS_PAT' })).toBeNull();
  });

  it('drops a token when its server now points to another host, keeps it for a path change', () => {
    const s = new McpServerStore(tmp('mcp-store'), cipher);
    s.upsert(http);
    s.setSecret('github', 'header:Authorization', 'ghp_aaaaaaaaaaaaaaaaaaaa');
    s.upsert({ ...http, url: 'https://api.githubcopilot.com/other/' }, 'github');
    expect(s.masks('github')['header:Authorization']).not.toBeNull();
    s.upsert({ ...http, url: 'https://evil.example.com/mcp' }, 'github');
    expect(s.masks('github')['header:Authorization']).toBeNull();
    expect(fingerprint(checkDef(http), { where: 'header', name: 'Authorization' })).not.toBe(fingerprint(checkDef({ ...http, url: 'https://evil.example.com/' }), { where: 'header', name: 'Authorization' }));
  });

  it('refuses tokens without a keyring and duplicate ids; renames move access and tests', () => {
    const none = new McpServerStore(tmp('mcp-store'), { ...cipher, unavailable: () => 'manca un portachiavi' });
    none.upsert(stdio);
    expect(() => none.setSecret('azure-devops', 'env:AZURE_DEVOPS_PAT', 'pat-123456789012345')).toThrow(/portachiavi/);
    const s = new McpServerStore(tmp('mcp-store'), cipher);
    s.upsert(stdio);
    expect(() => s.upsert(stdio)).toThrow(/Esiste già/);
    s.setAccess('herald', 'azure-devops', 'read');
    s.upsert({ ...stdio, id: 'ado' }, 'azure-devops');
    expect(s.access()).toEqual({ herald: { servers: { ado: 'read' } } });
    s.setAccess('herald', 'ado', 'all');
    expect(s.access()).toEqual({});
    s.remove('ado');
    expect(s.servers()).toEqual([]);
  });

  it('a damaged access entry narrows to none; a broken file loads empty', () => {
    const dir = tmp('mcp-store');
    fs.writeFileSync(path.join(dir, 'mcp-servers.json'), JSON.stringify({ version: 1, servers: [stdio, { id: 'bad', transport: 'stdio', command: 'x;y' }], access: { herald: { servers: { 'azure-devops': { tools: 'oops' } } } }, tests: {} }));
    const s = new McpServerStore(dir, cipher);
    expect(s.servers().map(x => x.id)).toEqual(['azure-devops']);
    expect(s.roleAccess('herald')).toEqual({ servers: { 'azure-devops': 'none' } });
    fs.writeFileSync(path.join(dir, 'mcp-servers.json'), '{not json');
    expect(new McpServerStore(dir, cipher).servers()).toEqual([]);
  });
});

describe('access rules', () => {
  const read = { name: 'list', readOnly: true }, write = { name: 'update', readOnly: false };
  it('all, read, none and named tools', () => {
    expect([toolAllowed(undefined, write), toolAllowed('all', write), toolAllowed('read', read), toolAllowed('read', write), toolAllowed('none', read)]).toEqual([true, true, true, false, false]);
    expect(toolAllowed({ tools: ['update'] }, write)).toBe(true);
    expect(toolAllowed({ tools: ['update'] }, read)).toBe(false);
    expect(() => checkAccess('everything')).toThrow();
    expect(checkAccess({ tools: ['a', 'a'] })).toEqual({ tools: ['a'] });
  });
  it('a child never gets more than its parent', () => {
    const parent = { servers: { ado: 'read' as const } }, child = { servers: {} };
    expect(chainAllows([child, parent], 'ado', write)).toBe(false);
    expect(chainAllows([child, parent], 'ado', read)).toBe(true);
    expect(chainAllows([child, undefined], 'ado', write)).toBe(true);
    expect(chainOffers([child, { servers: { ado: 'none' as const } }], 'ado')).toBe(false);
  });
  it('ids from labels', () => {
    expect(idFrom('Azure DevOps (lavoro)')).toBe('azure-devops-lavoro');
    expect(idFrom('second-brain')).toBe('server');
    expect(idFrom('Città')).toBe('citta');
  });
});
