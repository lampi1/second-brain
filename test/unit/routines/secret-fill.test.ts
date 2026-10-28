// The host filling of a routine package's secrets (src/main/routines/secret-fill.ts, ADR 0176) and the terminal export
// (routines/service.ts exportForTerminal): with fake sources, what the app holds is filled, what it lacks keeps the
// placeholder with the reason, a production database is never filled, and no value reaches the outcome rows, the
// export's answer, the logs, the run folder (run.json, events.jsonl, report) or any folder but the packages one.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutineRuntime, type RoutinePackage } from '../../../packages/routine-runtime/src/index';
import { devopsPatFromConnectors, devopsPatFromCursorConfig, fillPackageSecrets, type SecretSources } from '../../../src/main/routines/secret-fill';
import { createRoutines } from '../../../src/main/routines/service';
import { SECRET_PLACEHOLDER } from '../../../src/main/routines/store';
import { readZip } from '../../../src/main/agents/pack/zip';
import { log } from '../../../src/main/log';
import type { McpServerDef } from '../../../src/shared/mcp-servers';
import { appControlTools } from '../../../src/main/appctl/tools';
import type { BrainService, BrowserService, ChatService } from '../../../src/main/services';
import { LoginVault } from '../../../src/main/personal/vault';
import { SiteVault } from '../../../src/main/browser/site-vault';
import type { SecretCipher } from '../../../src/main/engines/secrets';
import { done, fakeDevOps, folderText, routinePackage, scriptedEngine, tempDir } from '../routine-runtime/fakes';

// built at run time: the repo guard refuses secret-shaped literals
const rnd = () => Math.random().toString(36).slice(2);
const SITE_PW = `site-${rnd()}-pw`, PAT = `pat${rnd()}xyz`, DB_PW = `db-${rnd()}-pw`;
const VALUES = [SITE_PW, PAT, DB_PW];
const AIR = 'https://air.example.test', CRM = 'https://crm.example.test';
const P = SECRET_PLACEHOLDER;

/** A package with every slot still a placeholder: Air login, DevOps PAT, a test DB and a production DB. */
const placeholders = (): RoutinePackage => routinePackage({
  testDbs: [{ id: 'qa', server: 'qa-sql.test.local', database: 'AirTest' }, { id: 'live', server: 'sql-prod.example.net', database: 'Air' }],
}, {
  credentials: [{ loginUrl: `${AIR}/Account/Login?mode=local`, user: P, password: P }],
  secrets: { devopsPat: P, testDbs: { qa: { user: P, password: P }, live: { user: P, password: P } } },
});
const allSources = (): SecretSources => ({
  devopsPat: () => ({ value: PAT }),
  siteLogin: origin => origin === AIR ? { value: { user: 'qa', password: SITE_PW } } : { reason: 'nessuna password salvata per questo sito' },
  testDbLogin: () => ({ value: { user: 'reader', password: DB_PW } }),
});
const noValues = (text: string) => { for (const v of VALUES) expect(text.includes(v), 'a secret value leaked').toBe(false); };

afterEach(() => { vi.restoreAllMocks(); });

describe('routine package secrets filled by the app', () => {
  it('fills what the sources hold; a production DB is never filled; rows carry names and reasons only', () => {
    const { pkg, rows, changed } = fillPackageSecrets(placeholders(), allSources());
    expect(changed).toBe(true);
    expect(pkg.credentials![0]).toEqual({ loginUrl: `${AIR}/Account/Login?mode=local`, user: 'qa', password: SITE_PW });
    expect(pkg.secrets?.devopsPat).toBe(PAT);
    expect(pkg.secrets?.testDbs?.qa).toEqual({ user: 'reader', password: DB_PW });
    expect(pkg.secrets?.testDbs?.live).toEqual({ user: P, password: P });
    expect(rows.map(r => [r.secret, r.source, r.filled])).toEqual([
      ['Login air.example.test', 'Password dei siti (routine)', true],
      ['DevOps PAT', 'Connettore Azure DevOps', true],
      ['DB di test qa-sql.test.local/AirTest', 'Login DB di test dell’app', true],
      ['DB di test sql-prod.example.net/Air', 'Login DB di test dell’app', false],
    ]);
    expect(rows[3]!.reason).toMatch(/production/);
    noValues(JSON.stringify(rows));
  });

  it('what the sources lack stays <set-by-user> with the reason', () => {
    const { pkg, rows, changed } = fillPackageSecrets(placeholders(), {
      devopsPat: () => ({ reason: 'nessun connettore Azure DevOps in Impostazioni → Connettori' }),
      siteLogin: () => ({ reason: 'nessuna password salvata per questo sito' }),
    });
    expect(changed).toBe(false);
    expect(pkg.credentials![0]!.password).toBe(P);
    expect(pkg.secrets?.devopsPat).toBe(P);
    expect(pkg.secrets?.testDbs?.qa?.password).toBe(P);
    expect(rows.filter(r => !r.filled).map(r => `${r.secret}: ${r.reason}`)).toEqual([
      'Login air.example.test: nessuna password salvata per questo sito',
      'DevOps PAT: nessun connettore Azure DevOps in Impostazioni → Connettori',
      'DB di test qa-sql.test.local/AirTest: l’app non ha questa fonte qui',
      expect.stringMatching(/^DB di test sql-prod\.example\.net\/Air: non riempito: .*production/),
    ]);
  });

  it('keeps values already set, refuses another user, and a source that throws is a reason', () => {
    const pkg = routinePackage({}, { credentials: [{ loginUrl: `${AIR}/`, user: 'someone-else', password: P }], secrets: { devopsPat: 'already-set' } });
    const { rows } = fillPackageSecrets(pkg, { ...allSources(), devopsPat: () => { throw new Error(PAT); } });
    expect(rows).toEqual([
      expect.objectContaining({ secret: 'Login air.example.test', filled: false, reason: expect.stringMatching(/altro utente/) }),
      expect.objectContaining({ secret: 'DevOps PAT', source: 'Pacchetto', filled: true }),
    ]);
    const thrown = fillPackageSecrets(routinePackage({}, { secrets: { devopsPat: P } }), { devopsPat: () => { throw new Error(PAT); } });
    expect(thrown.rows[0]).toEqual(expect.objectContaining({ filled: false, reason: 'la fonte non ha risposto' }));
    noValues(JSON.stringify(thrown.rows));
  });

  it('a migrated routine gains the site logins the vault holds; the others are reported, never added empty', () => {
    const pkg = routinePackage({ devops: undefined });
    const { pkg: out, rows } = fillPackageSecrets(pkg, allSources(), { loginOrigins: [`${AIR}/agenda`, CRM] });
    expect(out.credentials).toEqual([{ loginUrl: `${AIR}/`, user: 'qa', password: SITE_PW }]);
    expect(rows.map(r => [r.secret, r.filled, r.reason])).toEqual([
      ['Login air.example.test', true, 'aggiunto dalla password salvata per questo sito'],
      ['Login crm.example.test', false, 'nessuna password salvata per questo sito (login non aggiunto al pacchetto)'],
    ]);
  });

  it('adds the DevOps PAT to a routine that talks to DevOps; says az login is the fallback when there is none', () => {
    expect(fillPackageSecrets(routinePackage(), allSources()).pkg.secrets?.devopsPat).toBe(PAT);
    const none = fillPackageSecrets(routinePackage(), { devopsPat: () => ({ reason: 'nessun connettore Azure DevOps in Impostazioni → Connettori' }) });
    expect(none.pkg.secrets).toBeUndefined();
    expect(none.rows[0]!.reason).toMatch(/az login/);
  });

  it('finds the DevOps token among the connectors: one value only, never a guess', () => {
    const server = (over: Partial<McpServerDef>): McpServerDef => ({ id: 'x', label: 'x', transport: 'stdio', secrets: [], enabled: true, ...over });
    const ado = server({ id: 'oris-devops', label: 'DevOps', command: 'npx', args: ['@azure-devops/mcp', 'contoso'], secrets: [{ where: 'env', name: 'ADO_PAT' }, { where: 'header', name: 'Authorization', prefix: 'Basic ' }] });
    const other = server({ id: 'github', label: 'GitHub', secrets: [{ where: 'env', name: 'GITHUB_TOKEN' }] });
    const secret = vi.fn((id: string, slot: { name: string }) => id === 'oris-devops' && slot.name === 'ADO_PAT' ? PAT : 'unrelated');
    expect(devopsPatFromConnectors([other, ado], secret)).toEqual({ value: PAT });
    expect(secret).not.toHaveBeenCalledWith('github', expect.anything());
    expect(devopsPatFromConnectors([other], secret)).toEqual({ reason: expect.stringMatching(/nessun connettore/) });
    expect(devopsPatFromConnectors([ado], () => null)).toEqual({ reason: expect.stringMatching(/non ha un token/) });
    const second = server({ id: 'ado-2', label: 'Azure DevOps 2', url: ['https://dev', 'azure', 'com/contoso'].join('.'), transport: 'http', secrets: [{ where: 'header', name: 'X-Token' }] });
    expect(devopsPatFromConnectors([ado, second], (id) => id === 'ado-2' ? 'other-token' : PAT)).toEqual({ reason: expect.stringMatching(/più token/) });
  });
});

describe('the DevOps PAT from the Cursor MCP config (read only)', () => {
  /** A fake ~/.cursor/mcp.json: the Azure DevOps server for one organization, plus an unrelated server. */
  const cursorConfig = (org: string, token = PAT) => JSON.stringify({ mcpServers: {
    'azure-devops': { command: 'npx', args: ['-y', '@azure-devops/mcp@latest', org, '-a', 'envvar'], env: { ADO_MCP_AUTH_TOKEN: token } },
    mssql: { command: 'npx', args: ['-y', 'mcp-node-mssql'], env: { DB_PASSWORD: DB_PW } },
  } });
  const fromCursor = (text: string | null): SecretSources => ({
    devopsPat: () => ({ reason: 'nessun connettore Azure DevOps in Impostazioni → Connettori' }),
    cursorDevopsPat: org => devopsPatFromCursorConfig(text, org),
  });

  it('fills the package PAT when the organization matches', () => {
    const { pkg, rows, changed } = fillPackageSecrets(routinePackage({}, { secrets: { devopsPat: P } }), fromCursor(cursorConfig('Contoso')));
    expect(changed).toBe(true);
    expect(pkg.secrets?.devopsPat).toBe(PAT);
    expect(rows).toEqual([{ secret: 'DevOps PAT', source: 'Configurazione MCP di Cursor', filled: true, reason: 'dal server MCP azure-devops di Cursor (contoso)' }]);
    noValues(JSON.stringify(rows));
  });

  it('another organization or no file keeps the placeholder with the reason', () => {
    const other = fillPackageSecrets(routinePackage({}, { secrets: { devopsPat: P } }), fromCursor(cursorConfig('fabrikam')));
    expect(other.changed).toBe(false);
    expect(other.pkg.secrets?.devopsPat).toBe(P);
    expect(other.rows[0]).toEqual(expect.objectContaining({ filled: false, reason: expect.stringMatching(/Cursor: .*altra organizzazione \(non contoso\)/) }));
    const missing = fillPackageSecrets(routinePackage({}, { secrets: { devopsPat: P } }), fromCursor(null));
    expect(missing.pkg.secrets?.devopsPat).toBe(P);
    expect(missing.rows[0]!.reason).toMatch(/Cursor: configurazione MCP di Cursor non trovata/);
    for (const r of [...other.rows, ...missing.rows]) noValues(JSON.stringify(r));
  });

  it('the connector wins; the file is never consulted then', () => {
    const cursor = vi.fn((org: string) => devopsPatFromCursorConfig(cursorConfig(org, 'cursor-token'), org));
    const { pkg, rows } = fillPackageSecrets(routinePackage({}, { secrets: { devopsPat: P } }), { devopsPat: () => ({ value: PAT }), cursorDevopsPat: cursor });
    expect(pkg.secrets?.devopsPat).toBe(PAT);
    expect(rows[0]!.source).toBe('Connettore Azure DevOps');
    expect(cursor).not.toHaveBeenCalled();
  });

  it('reads the file shape strictly: no DevOps server, two tokens, bad JSON are reasons that never quote it', () => {
    const none = JSON.stringify({ mcpServers: { mssql: { args: ['contoso'], env: { ADO_MCP_AUTH_TOKEN: PAT } } } });
    expect(devopsPatFromCursorConfig(none, 'contoso')).toEqual({ reason: expect.stringMatching(/nessun server Azure DevOps/) });
    const two = JSON.stringify({ mcpServers: {
      'azure-devops': { args: ['@azure-devops/mcp', 'contoso'], env: { ADO_MCP_AUTH_TOKEN: PAT } },
      'azure-devops-2': { args: ['@azure-devops/mcp', 'contoso'], env: { ADO_MCP_AUTH_TOKEN: 'other-token' } },
    } });
    expect(devopsPatFromCursorConfig(two, 'contoso')).toEqual({ reason: expect.stringMatching(/più token/) });
    const broken = devopsPatFromCursorConfig(`{ "mcpServers": ${PAT}`, 'contoso');
    expect(broken).toEqual({ reason: 'configurazione MCP di Cursor non leggibile' });
    noValues(JSON.stringify(broken));
  });

  it('logs nothing about the value', () => {
    const spies = (['info', 'warn', 'error'] as const).map(level => vi.spyOn(log, level));
    fillPackageSecrets(routinePackage({}, { secrets: { devopsPat: P } }), fromCursor(cursorConfig('contoso')));
    for (const spy of spies) noValues(JSON.stringify(spy.mock.calls));
  });
});

describe('a filled package at run time', () => {
  it('masks the filled values as *** in run.json, events.jsonl and the report', async () => {
    const { pkg } = fillPackageSecrets(routinePackage({ testDbs: [{ id: 'qa', server: 'qa-sql.test.local', database: 'AirTest' }] }, {
      credentials: [{ loginUrl: `${AIR}/`, user: P, password: P }], secrets: { devopsPat: P, testDbs: { qa: { user: P, password: P } } },
    }), allSources());
    const root = tempDir('routine-fill-run-');
    const leak = VALUES.join(' ');
    const devops = fakeDevOps();
    devops.addItem({ id: 7, fields: { 'System.Title': 'Item' } });
    const runtime = createRoutineRuntime({ pkg, paths: { runsRoot: path.join(root, 'runs'), workspace: id => path.join(root, 'ws', id) }, engine: scriptedEngine(() => done(`used ${leak}`), { leak }), devops: { authorization: devops.authorization, request: devops.request } });
    await runtime.startItem(7).finished;
    const files = folderText(path.join(root, 'runs'));
    for (const name of ['run.json', 'events.jsonl']) expect(files.some(f => path.basename(f.file) === name), name).toBe(true);
    expect(files.some(f => /report/i.test(path.basename(f.file)))).toBe(true);
    for (const { text } of files) noValues(text);
    expect(files.find(f => f.file.endsWith('events.jsonl'))!.text).toContain('***');
  });
});

describe('export for the terminal', () => {
  const setup = (forbidden: () => string[] = () => []) => {
    const userData = tempDir('routines-export-'), packagesDir = path.join(tempDir('routine-runtime-'), 'packages');
    const svc = createRoutines({ userData, packagesDir, terminalRuns: tempDir('routines-term-'), secrets: allSources(), forbiddenRoots: forbidden });
    return { svc, userData, packagesDir };
  };

  /** What the format accepts (a production DB is refused at parse time already): Air and CRM logins, PAT, a test DB. */
  const savable = (): RoutinePackage => routinePackage({ testDbs: [{ id: 'qa', server: 'qa-sql.test.local', database: 'AirTest' }] }, {
    credentials: [{ loginUrl: `${AIR}/Account/Login?mode=local`, user: P, password: P }, { loginUrl: `${CRM}/login`, user: P, password: P }],
    secrets: { devopsPat: P, testDbs: { qa: { user: P, password: P } } },
  });

  it('writes the filled zip only under the packages folder and answers names, never values', () => {
    const info = vi.spyOn(log, 'info'), warn = vi.spyOn(log, 'warn');
    const { svc, packagesDir } = setup();
    svc.store.save(savable());
    const out = svc.exportForTerminal('demo');
    expect(out.path).toBe(path.join(packagesDir, 'demo', 'demo.routine.zip'));
    expect(fs.readdirSync(packagesDir)).toEqual(['demo']);
    expect(fs.readdirSync(path.join(packagesDir, 'demo'))).toEqual(['demo.routine.zip']);
    const inZip = JSON.parse(readZip(fs.readFileSync(out.path)).get('routine.json')!.toString('utf8')) as RoutinePackage;
    expect(inZip.credentials![0]!.password).toBe(SITE_PW);
    expect(inZip.secrets?.devopsPat).toBe(PAT);
    expect(out.filled).toEqual(['Login air.example.test', 'DevOps PAT', 'DB di test qa-sql.test.local/AirTest']);
    expect(out.missing).toEqual([{ secret: 'Login crm.example.test', reason: 'nessuna password salvata per questo sito' }]);
    expect(inZip.credentials![1]!.password).toBe(P);
    noValues(JSON.stringify(out));
    noValues(JSON.stringify([...info.mock.calls, ...warn.mock.calls]));
    // the snapshot the renderer gets carries no value either
    noValues(JSON.stringify(svc.snapshot()));
  });

  it('refuses a packages folder inside the repository or the brain', () => {
    const { svc, packagesDir } = setup(() => [path.dirname(packagesDir)]);
    svc.store.save(savable());
    expect(() => svc.exportForTerminal('demo')).toThrow(/repository o il brain/);
    expect(fs.existsSync(packagesDir)).toBe(false);
  });

  it('app_routine_export: only on the Orchestrator endpoint, answering path and names, never values', async () => {
    const { svc, packagesDir } = setup();
    svc.store.save(savable());
    const chats = { list: () => [{ id: 'orch', isOrchestrator: true, harness: 'claude' }, { id: 'w', isOrchestrator: false, harness: 'claude' }] } as unknown as ChatService;
    const deps = { chats, browser: {} as BrowserService, brain: {} as BrainService, window: () => null, emitUi: () => {}, version: '0', routines: { snapshot: () => svc.snapshot(), run: svc.run, has: (id: string) => svc.has(id), exportForTerminal: (id: string) => svc.exportForTerminal(id) } };
    expect(appControlTools(deps).some(t => t.name === 'app_routine_export')).toBe(false);
    expect(appControlTools(deps, 'w').some(t => t.name === 'app_routine_export')).toBe(false);
    const tool = appControlTools(deps, 'orch').find(t => t.name === 'app_routine_export')!;
    const out = await tool.run({ id: 'demo' }) as { path: string; filled: string[]; missing: unknown[] };
    expect(out.path.startsWith(packagesDir)).toBe(true);
    expect(Object.keys(out)).toEqual(['path', 'filled', 'missing']);
    noValues(JSON.stringify(out));
    await expect(Promise.resolve().then(() => tool.run({ id: '../x' }))).rejects.toThrow(/non trovata/);
  });
});

describe('site vault for a package', () => {
  it('one exact-origin login, else a reason without values', () => {
    const cipher: SecretCipher = { unavailable: () => null, encrypt: s => Buffer.from(s.split('').reverse().join('')), decrypt: b => b.toString().split('').reverse().join('') };
    const file = path.join(tempDir('site-vault-'), 'vault.json');
    const old = new LoginVault(file, cipher, Date.now, url => new URL(String(url)).origin);
    const vault = { forPackage: (origin: string) => new SiteVault(file, cipher).forPackage(origin) };
    expect(vault.forPackage(AIR)).toEqual({ reason: 'nessuna password salvata per questo sito' });
    expect(vault.forPackage('not a url')).toEqual({ reason: 'indirizzo di login non valido' });
    old.save(AIR, 'qa', SITE_PW);
    expect(vault.forPackage(AIR)).toEqual({ value: { user: 'qa', password: SITE_PW } });
    expect('reason' in vault.forPackage('https://www.air.example.test')).toBe(true);
    old.save(AIR, 'qa2', DB_PW);
    const two = vault.forPackage(AIR);
    expect(two).toEqual({ reason: expect.stringMatching(/più account/) });
    noValues(JSON.stringify(two));
  });
});
