// Adding an MCP server the easy way (ADR 0207): a pasted JSON (Claude Desktop / Cursor / VS Code shapes), command line
// or URL becomes a definition whose secrets are token slots (their values apart, never in the definition); the popular
// catalog; Flash's access (off by default, reading tools only); undoable changes (snapshot / restore with the tokens
// still encrypted); app_config's connector actions for the Orchestrator (add, edit, remove, undo, test, form), gated by
// the user's words and never answering a secret; the add panel's form helpers and the Orchestrator's drafts.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MCP_CATALOG, SECRET_MASK, catalogDraft, maskSnippet, nameFromPackage, parseMcpSnippet, publicDraft, readPaste, shellWords } from '../../../src/shared/mcp-paste';
import { FLASH_MCP_ROLE, MCP_ACCESS_ROLES, accessOn, effectiveAccess, runsOf, toggleAccess, toolAllowed } from '../../../src/shared/mcp-servers';
import { McpServerStore, checkDef } from '../../../src/main/mcp-servers/store';
import { McpServersService } from '../../../src/main/mcp-servers/service';
import { serversFor, toolFor } from '../../../src/main/mcp-servers/access';
import { McpServer } from '../../../src/main/mcp/server';
import { configTool, type ConfigDeps } from '../../../src/main/appctl/config';
import { addFormOf, commandLine, defOfAdd, emptyAddForm, onMcpDraft, openMcpDraft, takeMcpDraft } from '../../../src/renderer/lib/mcp-servers';
import type { SecretCipher } from '../../../src/main/engines/secrets';
import { tmp } from '../chats/helpers';

const cipher: SecretCipher = { unavailable: () => null, encrypt: s => Buffer.from([...Buffer.from(s)].map(b => b ^ 0x5a)), decrypt: b => Buffer.from([...b].map(x => x ^ 0x5a)).toString() };
const TOKEN = ['ghp', 'x'.repeat(36)].join('_'); // built at run time: a test value, never a real token

describe('the paste box never shows a token (maskSnippet, readPaste)', () => {
  const SHORT = ['s3cr', 'et42'].join(''); // short: found only because the parser kept it apart
  it('masks the values the parser kept apart, keeping the rest of the text as typed', () => {
    const raw = JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: TOKEN, API_KEY: SHORT, LOG: 'info' } } } });
    const r = parseMcpSnippet(raw);
    const shown = maskSnippet(raw, r.ok ? r.drafts : []);
    expect(shown).not.toContain(TOKEN);
    expect(shown).not.toContain(SHORT);
    expect(shown).toContain(`"GITHUB_PERSONAL_ACCESS_TOKEN":"${SECRET_MASK}"`);
    expect(shown).toContain('@modelcontextprotocol/server-github');
    expect(shown).toContain('"LOG":"info"');
  });
  it('masks what still looks like a credential: Bearer, a secret URL parameter, credentials in an address, a token word', () => {
    const word = ['Ab3', 'x'.repeat(10), 'Q9', 'z'.repeat(12)].join('');
    const shown = maskSnippet(`npx mcp-remote https://u:${SHORT}@mcp.example.com/sse?api_key=${SHORT}&v=2 --header "Authorization: Bearer ${SHORT}" --x ${word} ${TOKEN}`);
    for (const s of [SHORT, word, TOKEN]) expect(shown).not.toContain(s);
    expect(shown).toContain('mcp.example.com/sse?api_key=');
    expect(shown).toContain('&v=2');
    // package names, hosts, paths and plain words stay readable
    const plain = 'npx -y @modelcontextprotocol/server-filesystem /home/user/projects-2026-archive https://api.context7.com/mcp';
    expect(maskSnippet(plain)).toBe(plain);
  });
  it('an edit of the masked text keeps the token read before, and a masked value never becomes a plain variable', () => {
    const raw = `BRAVE_API_KEY=${TOKEN} npx -y @brave/brave-search-mcp-server`;
    const first = readPaste(raw, null);
    const shown = maskSnippet(raw, first.ok ? first.drafts : []);
    expect(shown).toBe(`BRAVE_API_KEY=${SECRET_MASK} npx -y @brave/brave-search-mcp-server`);
    const again = readPaste(`${shown} --verbose`, first);
    expect(again.ok && again.drafts[0]!.values['env:BRAVE_API_KEY']).toBe(TOKEN);
    const fresh = readPaste(`{"x":{"command":"npx","env":{"PLAIN":"${SECRET_MASK}"}}}`, null);
    expect(fresh.ok && fresh.drafts[0]!.def.env).toBeUndefined();
    expect(fresh.ok && fresh.drafts[0]!.def.secrets.map(x => x.name)).toEqual(['PLAIN']);
    expect(fresh.ok && fresh.drafts[0]!.values).toEqual({});
  });
});

describe('parseMcpSnippet', () => {
  it('reads a Claude Desktop / Cursor mcpServers JSON, a token going to a slot with its value apart', () => {
    const r = parseMcpSnippet(JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: TOKEN, LOG: 'info' } } } }));
    expect(r.ok && r.kind).toBe('json');
    if (!r.ok) return;
    const d = r.drafts[0]!;
    expect(d.def).toMatchObject({ id: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { LOG: 'info' }, secrets: [{ where: 'env', name: 'GITHUB_PERSONAL_ACCESS_TOKEN' }] });
    expect(JSON.stringify(d.def)).not.toContain(TOKEN);
    expect(d.values).toEqual({ 'env:GITHUB_PERSONAL_ACCESS_TOKEN': TOKEN });
    expect(() => checkDef(d.def)).not.toThrow();
  });
  it('reads VS Code "servers", a bare entry, a fragment without braces, several servers and an http one with Bearer', () => {
    const vs = parseMcpSnippet('{"servers":{"fetch":{"type":"stdio","command":"uvx","args":["mcp-server-fetch"]},"docs":{"type":"http","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer abc123"}}}}');
    expect(vs.ok && vs.drafts.map(d => d.def.id)).toEqual(['fetch', 'docs']);
    if (vs.ok) {
      expect(vs.drafts[1]!.def).toMatchObject({ transport: 'http', secrets: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }] });
      expect(vs.drafts[1]!.def.headers).toBeUndefined();
      expect(vs.drafts[1]!.values).toEqual({ 'header:Authorization': 'abc123' });
    }
    const bare = parseMcpSnippet('{"command":"npx","args":["-y","@playwright/mcp@latest"]}');
    expect(bare.ok && bare.drafts[0]!.def.id).toBe('playwright');
    const frag = parseMcpSnippet('"memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] },');
    expect(frag.ok && frag.drafts[0]!.def.id).toBe('memory');
  });
  it('reads command lines: env prefixes, quotes, claude mcp add', () => {
    const a = parseMcpSnippet(`BRAVE_API_KEY=${TOKEN} npx -y @brave/brave-search-mcp-server`);
    expect(a.ok && a.kind).toBe('command');
    if (a.ok) { expect(a.drafts[0]!.def).toMatchObject({ id: 'brave-search', command: 'npx', args: ['-y', '@brave/brave-search-mcp-server'], secrets: [{ name: 'BRAVE_API_KEY' }] }); expect(a.drafts[0]!.values['env:BRAVE_API_KEY']).toBe(TOKEN); }
    const b = parseMcpSnippet('npx -y @modelcontextprotocol/server-filesystem "C:\\My files"');
    expect(b.ok && b.drafts[0]!.def.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', 'C:\\My files']);
    const c = parseMcpSnippet('claude mcp add sentry -e ORG=acme -- npx -y @sentry/mcp-server');
    expect(c.ok && c.drafts[0]!.def).toMatchObject({ id: 'sentry', env: { ORG: 'acme' }, args: ['-y', '@sentry/mcp-server'] });
    const d = parseMcpSnippet('claude mcp add --transport http notion https://mcp.notion.com/mcp');
    expect(d.ok && d.drafts[0]!.def).toMatchObject({ id: 'notion', transport: 'http', url: 'https://mcp.notion.com/mcp' });
    expect(parseMcpSnippet('npx foo | rm -rf /').ok).toBe(true); // the pipe is an argument; main refuses shell characters on save
    expect(parseMcpSnippet('"unclosed').ok).toBe(false);
  });
  it('reads a URL, drops a token argument, and explains what it cannot read', () => {
    const u = parseMcpSnippet('https://mcp.context7.com/mcp');
    expect(u.ok && u.drafts[0]!.def).toMatchObject({ id: 'context7', label: 'Context7', transport: 'http' });
    const t = parseMcpSnippet(`npx -y some-mcp --api-key ${TOKEN}`);
    expect(t.ok && t.drafts[0]!.def.args).toEqual(['-y', 'some-mcp']);
    expect(t.ok && t.drafts[0]!.dropped.join()).toMatch(/argomento --api-key/);
    expect(parseMcpSnippet('')).toEqual({ ok: false, error: 'empty' });
    expect(parseMcpSnippet('{nope')).toEqual({ ok: false, error: 'json' });
    expect(parseMcpSnippet('{"a":1}')).toEqual({ ok: false, error: 'nothing' });
  });
  it('names, words, public drafts and the catalog', () => {
    expect(['@modelcontextprotocol/server-github', 'mcp-server-fetch', '@playwright/mcp@latest', '@upstash/context7-mcp', 'my-tool@1.2.0'].map(nameFromPackage)).toEqual(['github', 'fetch', 'playwright', 'context7', 'my-tool']);
    expect(shellWords(`a "b c" 'd e' "x \\" y"`)).toEqual(['a', 'b c', 'd e', 'x " y']);
    expect(shellWords('a "open')).toBeNull();
    const r = parseMcpSnippet(`GITHUB_TOKEN=${TOKEN} npx -y @modelcontextprotocol/server-github`);
    expect(r.ok && JSON.stringify(publicDraft(r.drafts[0]!))).not.toContain(TOKEN);
    for (const e of MCP_CATALOG) { const d = catalogDraft(e, e.ask?.placeholder ?? ''); expect(d, e.id).not.toBeNull(); expect(() => checkDef(d!.def), e.id).not.toThrow(); }
    expect(catalogDraft(MCP_CATALOG.find(e => e.id === 'filesystem')!, 'D:\\docs')!.def.args!.at(-1)).toBe('D:\\docs');
  });
});

describe('Flash and the per-role toggles', () => {
  it('Flash is off by default and never more than reading; the others default to every tool', () => {
    expect(MCP_ACCESS_ROLES).toEqual(['orchestrator', 'strategist', 'scout', 'artisan', 'sentinel', 'herald', 'flash']);
    expect(effectiveAccess(FLASH_MCP_ROLE, undefined)).toBe('none');
    expect(effectiveAccess(FLASH_MCP_ROLE, 'all')).toBe('read');
    expect(effectiveAccess('orchestrator', undefined)).toBe('all');
    expect(accessOn('orchestrator', undefined)).toBe(true);
    expect(accessOn(FLASH_MCP_ROLE, undefined)).toBe(false);
    expect(toggleAccess(FLASH_MCP_ROLE, true)).toBe('read');
    expect(toggleAccess('scout', false)).toBe('none');
  });
  it('the store keeps Flash explicit and the gateway gives it only reading tools of servers turned on for it', () => {
    const s = new McpServerStore(tmp('easy-flash'), cipher);
    s.upsert({ id: 'docs', label: 'Docs', transport: 'stdio', command: 'npx', args: ['-y', 'docs-mcp'], secrets: [], enabled: true });
    const ctx = { roles: [FLASH_MCP_ROLE], policy: null };
    expect(serversFor(s.servers(), ctx, r => s.roleAccess(r))).toEqual([]);
    s.setAccess(FLASH_MCP_ROLE, 'docs', 'read');
    expect(s.access().flash?.servers.docs).toBe('read');
    expect(serversFor(s.servers(), ctx, r => s.roleAccess(r))).toEqual(['docs']);
    expect(toolFor(ctx, r => s.roleAccess(r), 'docs', { name: 'search', readOnly: true })).toBe(true);
    expect(toolFor(ctx, r => s.roleAccess(r), 'docs', { name: 'write', readOnly: false })).toBe(false);
    // a tool list for Flash: refused unless every tool is one the last test saw as reading
    expect(() => s.setAccess(FLASH_MCP_ROLE, 'docs', { tools: ['write'] })).toThrow(/solo strumenti di lettura/);
    s.recordTest('docs', { ok: true, at: 1, ms: 1, tools: [{ name: 'search', description: '', readOnly: true }, { name: 'write', description: '', readOnly: false }] } as never);
    expect(() => s.setAccess(FLASH_MCP_ROLE, 'docs', { tools: ['search', 'write'] })).toThrow(/write/);
    s.setAccess(FLASH_MCP_ROLE, 'docs', { tools: ['search'] });
    s.setAccess(FLASH_MCP_ROLE, 'docs', 'all');
    expect(s.access().flash?.servers.docs).toBe('read');
    // and the gateway refuses a writing tool to Flash whatever is stored (an old file, a hand edit), at any level
    const forced = () => ({ servers: { docs: { tools: ['write'] } } });
    expect(toolFor(ctx, forced, 'docs', { name: 'write', readOnly: false })).toBe(false);
    expect(toolFor({ roles: ['scout', FLASH_MCP_ROLE], policy: null }, () => ({ servers: { docs: 'all' } }), 'docs', { name: 'write', readOnly: false })).toBe(false);
    expect(toolAllowed({ tools: ['write'] }, { name: 'write', readOnly: false }, FLASH_MCP_ROLE)).toBe(false);
    expect(toolAllowed({ tools: ['write'] }, { name: 'write', readOnly: false }, 'scout')).toBe(true);
    s.setAccess(FLASH_MCP_ROLE, 'docs', 'none');
    expect(s.access().flash).toBeUndefined();
    // the Orchestrator: every tool by default, off by its toggle
    expect(serversFor(s.servers(), { roles: ['orchestrator'], policy: null }, r => s.roleAccess(r))).toEqual(['docs']);
    s.setAccess('orchestrator', 'docs', 'none');
    expect(serversFor(s.servers(), { roles: ['orchestrator'], policy: null }, r => s.roleAccess(r))).toEqual([]);
  });
});

function service(userData = tmp('easy-svc')) {
  const svc = new McpServersService({ userData, cipher, mcp: new McpServer({ name: 't', version: '1' }), context: () => null, home: tmp('easy-home'),
    connect: () => ({ serverInfo: 'fake', tools: async () => [{ name: 'read_doc', description: 'reads', readOnly: true, inputSchema: {} }, { name: 'edit_doc', description: 'writes', readOnly: false, inputSchema: {} }], call: async () => ({ content: [] }), close() {} }) });
  return svc;
}

describe('undoable changes', () => {
  it('a removal comes back with its access, test and encrypted token; an add goes away; an edit returns', async () => {
    const svc = service();
    svc.save({ def: { id: 'gh', label: 'GitHub', transport: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'], secrets: [{ where: 'env', name: 'GITHUB_TOKEN' }], enabled: true } });
    svc.setSecret({ id: 'gh', slot: 'env:GITHUB_TOKEN', value: TOKEN });
    svc.setAccess({ role: 'scout', server: 'gh', access: 'read' });
    await svc.test('gh');
    const r = svc.agentRemove('gh');
    expect(svc.state().servers).toEqual([]);
    const back = svc.undo(r.undo).servers[0]!;
    expect(back.secretMasks['env:GITHUB_TOKEN']).toMatch(/…/);
    expect(back.lastTest?.ok).toBe(true);
    expect(svc.state().access.scout?.servers.gh).toBe('read');
    expect(svc.store.secret('gh', { where: 'env', name: 'GITHUB_TOKEN' })).toBe(TOKEN);
    expect(() => svc.undo(r.undo)).toThrow(/Niente da annullare/);
    const add = svc.agentSave({ id: 'docs', label: 'Docs', transport: 'http', url: 'https://docs.example.com/mcp', secrets: [], enabled: true });
    expect(svc.state().servers.map(s => s.id)).toEqual(['gh', 'docs']);
    svc.undo(add.undo);
    expect(svc.state().servers.map(s => s.id)).toEqual(['gh']);
    const edit = svc.agentSave({ ...svc.store.def('gh')!, label: 'GH', enabled: false }, 'gh');
    expect(svc.store.def('gh')).toMatchObject({ label: 'GH', enabled: false });
    svc.undo(edit.undo);
    expect(svc.store.def('gh')).toMatchObject({ label: 'GitHub', enabled: true });
    svc.stop();
  });
  it('«Annulla» survives a restart: the journal holds no secret, the removed token waits encrypted in the secret file', () => {
    const dir = tmp('easy-restart');
    const a = service(dir);
    a.save({ def: { id: 'gh', label: 'GitHub', transport: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'], secrets: [{ where: 'env', name: 'GITHUB_TOKEN' }], enabled: true } });
    a.setSecret({ id: 'gh', slot: 'env:GITHUB_TOKEN', value: TOKEN });
    const r = a.agentRemove('gh');
    a.stop();
    const journal = fs.readFileSync(path.join(dir, 'mcp-undo.json'), 'utf8');
    expect(journal).toContain(r.undo);
    expect(journal).not.toContain(TOKEN);
    expect(journal).not.toContain('cipher');
    const secrets = fs.readFileSync(path.join(dir, 'mcp-secrets.json'), 'utf8');
    expect(secrets).not.toContain(TOKEN); // encrypted, as every token there
    expect(JSON.parse(secrets).undo[r.undo]['env:GITHUB_TOKEN']).toBeTruthy();
    const b = service(dir);
    expect(b.undo(r.undo).servers.map(s => s.id)).toEqual(['gh']);
    expect(b.store.secret('gh', { where: 'env', name: 'GITHUB_TOKEN' })).toBe(TOKEN);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'mcp-secrets.json'), 'utf8')).undo).toBeUndefined();
    expect(() => service(dir).undo(r.undo)).toThrow(/Niente da annullare/);
    b.stop();
  });
});

describe('app_config connector actions (the Orchestrator)', () => {
  function deps(over: Partial<ConfigDeps> = {}) {
    const svc = service();
    const announce = vi.fn(), openForm = vi.fn();
    const d: ConfigDeps = {
      callerId: 'orch', userAsked: () => true, brain: {} as ConfigDeps['brain'], announce, openForm,
      mcp: { state: () => svc.state(), save: a => svc.save(a), setAccess: a => svc.setAccess(a), agentSave: (def, prev) => svc.agentSave(def, prev), agentRemove: id => svc.agentRemove(id),
        agentAccess: (r, s, a) => svc.agentAccess(r, s, a), undo: k => svc.undo(k), test: id => svc.test(id) },
      ...over,
    };
    return { d, svc, announce, openForm, tool: configTool(d) };
  }
  it('adds from a paste without keeping or answering the token, announces it with Annulla, tests, edits, removes and undoes', async () => {
    const { tool, svc, announce } = deps();
    const r = await tool.run({ action: 'add', area: 'connector', snippet: JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: TOKEN } } } }) }) as { added: string; changeId: string; tokensMissing: string[] };
    expect(r).toMatchObject({ added: 'github', tokensMissing: ['GITHUB_TOKEN'] });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(svc.state())).not.toContain(TOKEN);
    // saved off, waiting for the user's own «Attiva», with exactly what it will start on the card
    const runs = 'npx -y @modelcontextprotocol/server-github';
    expect(svc.store.def('github')).toMatchObject({ enabled: false, awaiting: { runs } });
    expect(announce).toHaveBeenCalledWith(expect.objectContaining({ kind: 'connector-changed', action: { kind: 'connector-undo', undo: r.changeId, activate: { server: 'github', runs } } }));
    await expect(Promise.resolve().then(() => tool.run({ action: 'test', area: 'connector', server: 'github' }))).rejects.toThrow(/Attiva/);
    await expect(Promise.resolve().then(() => tool.run({ action: 'set', area: 'connector', server: 'github', key: 'enabled', value: true }))).rejects.toThrow(/Attiva/);
    await expect(svc.test('github')).rejects.toThrow(/Attiva/);
    expect(() => svc.activate({ id: 'github', runs: 'npx evil' })).toThrow(/cambiato/);
    svc.activate({ id: 'github', runs });
    expect(svc.store.def('github')).toMatchObject({ enabled: true });
    expect(svc.store.def('github')?.awaiting).toBeUndefined();
    expect(await tool.run({ action: 'test', area: 'connector', server: 'github' })).toMatchObject({ ok: false, error: { code: 'secret' } });
    await tool.run({ action: 'set', area: 'connector', server: 'github', key: 'access', role: 'flash', value: 'all' });
    expect((await tool.run({ action: 'get', area: 'connector' }) as { servers: { roles: Record<string, unknown> }[] }).servers[0]!.roles.flash).toBe('read');
    await tool.run({ action: 'set', area: 'connector', server: 'github', key: 'purpose', value: 'PR e issue' });
    expect(svc.store.def('github')?.purpose).toBe('PR e issue');
    await expect(Promise.resolve().then(() => tool.run({ action: 'set', area: 'connector', server: 'github', key: 'env', value: { GITHUB_TOKEN: TOKEN } }))).rejects.toThrow(/segreto/);
    const rm = await tool.run({ action: 'remove', area: 'connector', server: 'github' }) as { changeId: string };
    expect(svc.state().servers).toEqual([]);
    await tool.run({ action: 'undo', area: 'connector', changeId: rm.changeId });
    expect(svc.store.def('github')?.purpose).toBe('PR e issue');
    svc.stop();
  });
  it('a change of what a server starts puts it back off until «Attiva»; an agent def never carries the user\'s confirmations', async () => {
    const { tool, svc, announce } = deps();
    svc.save({ def: { id: 'docs', label: 'Docs', transport: 'stdio', command: 'npx', args: ['-y', 'docs-mcp'], secrets: [], enabled: true } });
    await tool.run({ action: 'set', area: 'connector', server: 'docs', key: 'label', value: 'Documenti' });
    expect(svc.store.def('docs')).toMatchObject({ label: 'Documenti', enabled: true });
    expect(svc.store.def('docs')?.awaiting).toBeUndefined();
    const r = await tool.run({ action: 'set', area: 'connector', server: 'docs', key: 'args', value: ['-y', 'other-mcp', '--flag value'] }) as { runs: string };
    expect(r.runs).toBe('npx -y other-mcp "--flag value"');
    expect(svc.store.def('docs')).toMatchObject({ enabled: false, awaiting: { runs: r.runs } });
    expect(announce).toHaveBeenLastCalledWith(expect.objectContaining({ action: expect.objectContaining({ activate: { server: 'docs', runs: r.runs } }) }));
    await tool.run({ action: 'set', area: 'connector', server: 'docs', key: 'env', value: { NODE_OPTIONS: '--require x' } });
    expect(svc.store.def('docs')?.awaiting?.runs).toBe('NODE_OPTIONS="--require x" npx -y other-mcp "--flag value"');
    // the user's own save of the form (they see the command there) is their approval
    svc.save({ def: { ...svc.store.def('docs')!, enabled: true }, previousId: 'docs' });
    expect(svc.store.def('docs')).toMatchObject({ enabled: true });
    expect(svc.store.def('docs')?.awaiting).toBeUndefined();
    await tool.run({ action: 'add', area: 'connector', def: { label: 'Prod', transport: 'http', url: 'https://prod.example.com/mcp', routineTest: true, importedFrom: 'claude', awaiting: null, enabled: true } });
    expect(svc.store.def('prod')).toMatchObject({ enabled: false, awaiting: { runs: 'https://prod.example.com/mcp' } });
    expect(svc.store.def('prod')?.routineTest).toBeUndefined();
    expect(svc.store.def('prod')?.importedFrom).toBeUndefined();
    expect(runsOf({ transport: 'http', url: 'https://x.example.com/' })).toBe('https://x.example.com/');
    // the card's action is checked again in main: a script's event never names anything else
    const { feedAction } = await import('../../../src/main/brain/live');
    expect(feedAction({ kind: 'connector-undo', undo: 'a'.repeat(12), activate: { server: 'docs', runs: 'npx x' } })).toEqual({ kind: 'connector-undo', undo: 'a'.repeat(12), activate: { server: 'docs', runs: 'npx x' } });
    expect(feedAction({ kind: 'connector-undo', undo: 'a'.repeat(12), activate: { server: '../x', runs: 1 } })).toEqual({ kind: 'connector-undo', undo: 'a'.repeat(12) });
    svc.stop();
  });
  it('opens the add form prefilled without the secret, and refuses changes without the user\'s words', async () => {
    const { tool, openForm, svc } = deps();
    await tool.run({ action: 'form', area: 'connector', snippet: `GITHUB_TOKEN=${TOKEN} npx -y @modelcontextprotocol/server-github` });
    expect(openForm).toHaveBeenCalledWith({ def: expect.objectContaining({ id: 'github' }), tokens: ['GITHUB_TOKEN'] });
    expect(JSON.stringify(openForm.mock.calls)).not.toContain(TOKEN);
    const quiet = deps({ userAsked: () => false });
    await expect(Promise.resolve().then(() => quiet.tool.run({ action: 'add', area: 'connector', snippet: 'npx -y x-mcp' }))).rejects.toThrow(/solo quando l'utente/);
    expect(quiet.svc.state().servers).toEqual([]);
    svc.stop(); quiet.svc.stop();
  });
});

describe('the add panel form', () => {
  it('a draft fills the form (token values in the masked fields) and the form gives the definition back', () => {
    const r = parseMcpSnippet(`GITHUB_TOKEN=${TOKEN} npx -y @modelcontextprotocol/server-filesystem "C:\\My files"`);
    if (!r.ok) throw new Error('parse');
    const f = addFormOf(r.drafts[0]!);
    expect(f.line).toBe('npx -y @modelcontextprotocol/server-filesystem "C:\\My files"');
    expect(f.tokens).toEqual([{ name: 'GITHUB_TOKEN', value: TOKEN }]);
    expect(f.roles).toMatchObject({ orchestrator: true, flash: false });
    const def = defOfAdd(f)!;
    expect(def).toMatchObject({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\My files'], secrets: [{ where: 'env', name: 'GITHUB_TOKEN' }] });
    expect(JSON.stringify(def)).not.toContain(TOKEN);
    expect(defOfAdd({ ...emptyAddForm(), label: 'x', line: '"open' })).toBeNull();
    expect(commandLine('node', ['a b', 'c'])).toBe('node "a b" c');
  });
  it('an Orchestrator draft waits for the Connettori section', () => {
    const seen = vi.fn();
    const off = onMcpDraft(seen);
    expect(openMcpDraft('{"def":{"id":"x","label":"X","transport":"http","url":"https://x.dev/mcp"},"tokens":["Authorization"]}')).toBe(true);
    expect(seen).toHaveBeenCalled();
    expect(takeMcpDraft()).toMatchObject({ def: { id: 'x', secrets: [] }, tokens: ['Authorization'] });
    expect(takeMcpDraft()).toBeNull();
    expect(openMcpDraft('{"def":{"transport":"ftp"}}')).toBe(false);
    off();
  });
});
