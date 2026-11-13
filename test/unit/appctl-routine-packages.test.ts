// The Orchestrator's routine package tools through the real app-control wiring (ADR 0175, AGENTS rule 12): mounted only
// on the authenticated Orchestrator, preflight errors come back with their fix, secrets never come from or go back to
// the agent, the live app_guide explains authoring, and the role-run recovery tools are gone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { appControlTools, type AppCtlDeps } from '../../src/main/appctl/tools';
import { ORCHESTRATOR_ROLE } from '../../src/main/agents/orchestrator-role';
import { createFolderPackageStore } from '../../src/main/flows/package-authoring';
import { SECRET_PLACEHOLDER, type RoutinePackage } from '../../packages/routine-runtime/src/index';

const dirs: string[] = [];
const typed = ['typed', 'by', 'user'].join('-'); // built at run time: the guard refuses secret-shaped literals
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'routine-pkgs-'))); dirs.push(dir);
  const brainRoot = path.join(dir, 'brain'), storeRoot = path.join(dir, 'routines');
  fs.mkdirSync(brainRoot);
  let open = true;
  const store = createFolderPackageStore(storeRoot);
  const deps = {
    chats: { list: () => open ? [{ id: 'owner', isOrchestrator: true }] : [] }, browser: {},
    brain: { info: () => ({ brainRoot }), settingsSchema: () => [], settings: () => ({}) },
    window: () => null, emitUi: () => {}, version: 'test', routinePackages: () => store,
  } as unknown as AppCtlDeps;
  const tools = appControlTools(deps, 'owner');
  const run = (name: string, args: Record<string, unknown> = {}) => tools.find(t => t.name === name)!.run(args) as Promise<Record<string, unknown>>;
  return { deps, tools, run, store, storeRoot, brainRoot, close: () => { open = false; } };
}

/** What an Orchestrator writes for "check that the Air test login works": no roles, no secrets. */
const pkg = () => ({
  format: 'second-brain-routine', schemaVersion: 1,
  routine: {
    id: 'air-login-check', title: 'Controllo login Air', description: 'Checks that Air test login works.',
    inputs: [{ name: 'page', default: '/Agenda' }],
    steps: [{ id: 'check', title: 'Controlla', prompt: 'Open {{page}} on the Air test site and say whether it loads.' }],
  },
  credentials: [{ loginUrl: 'https://dent-1.test.air.example.test/Account/Login?mode=local', user: 'qa-user' }],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures are changed per case
}) as Record<string, any>;

it('mounts the package tools only on the authenticated Orchestrator, without role-run recovery tools', () => {
  const f = fixture(), names = f.tools.map(t => t.name);
  for (const name of ['app_routine_save', 'app_routine_capabilities', 'app_routine_connectors', 'app_routine_packages']) expect(names).toContain(name);
  for (const gone of ['app_flow_reconciliation', 'app_flow_reconcile_propose', 'app_flow_bind', 'app_flow_report', 'app_flow_preflight']) expect(names).not.toContain(gone);
  expect(appControlTools(f.deps).map(t => t.name).filter(n => n.startsWith('app_flow_'))).toEqual([]);
  f.close();
  expect(() => f.tools.find(t => t.name === 'app_routine_save')!.run({ package: pkg() })).toThrow('Authenticated Orchestrator');
});

it('returns each preflight problem with its field and fix and saves nothing when invalid', async () => {
  const f = fixture(), p = pkg();
  p.routine.steps[0].role = 'artisan';
  const r1 = await f.run('app_routine_save', { package: p });
  expect(r1).toMatchObject({ status: 'invalid', errors: [{ path: 'steps[0]' }] });
  expect((r1.errors as { fix: string }[])[0]!.fix).toMatch(/plain Claude Code session/);
  delete p.routine.steps[0].role;
  p.routine.steps[0].prompt = 'As Artisan use {{repo}} and call agent_report.';
  const r2 = await f.run('app_routine_save', { package: p });
  expect((r2.errors as { message: string }[]).map(e => e.message)).toEqual(expect.arrayContaining(['{{repo}} is not an input', 'mentions the app role "Artisan"', 'uses the app-only tool "agent_report"']));
  expect(r2.preflight).toContain('Fix:');
  expect(fs.existsSync(f.storeRoot)).toBe(false);
});

it('saves with needs-secrets, refuses a secret from the agent and keeps the user\'s stored one on revision', async () => {
  const f = fixture();
  const r = await f.run('app_routine_save', { package: pkg() });
  expect(r).toMatchObject({ status: 'needs-secrets', routineId: 'air-login-check', errors: [{ path: 'credentials[0].password', secret: true }] });
  const file = path.join(f.storeRoot, 'air-login-check', 'routine.json');
  expect(r.file).toBe(file);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).credentials[0]).toEqual({ loginUrl: 'https://dent-1.test.air.example.test/Account/Login?mode=local', user: 'qa-user', password: SECRET_PLACEHOLDER });
  expect(await f.run('app_routine_packages')).toEqual({ packages: [{ id: 'air-login-check', title: 'Controllo login Air', steps: 1, trigger: false, missingSecrets: 1 }] });

  const leaked = pkg(); leaked.credentials[0].password = 'hunter2';
  const refused = await f.run('app_routine_save', { package: leaked });
  expect(refused).toMatchObject({ status: 'invalid', errors: [{ path: 'credentials[0].password', secret: true }] });
  expect(fs.readFileSync(file, 'utf8')).not.toContain('hunter2');

  // the user types the password on the Routine page (the store), then the Orchestrator revises the routine
  const stored = f.store.get('air-login-check')! as RoutinePackage;
  f.store.save({ ...stored, credentials: [{ ...stored.credentials![0]!, password: typed }] });
  const revised = pkg(); revised.routine.title = 'Controllo login Air v2';
  const r2 = await f.run('app_routine_save', { package: revised });
  expect(r2).toMatchObject({ status: 'ready', errors: [] });
  expect(JSON.stringify(r2)).not.toContain(typed);
  expect(f.store.get('air-login-check')!.credentials![0]!.password).toBe(typed);
  const read = await f.run('app_routine_packages', { id: 'air-login-check' });
  expect(JSON.stringify(read)).not.toContain(typed);
  expect(read).toMatchObject({ routine: { title: 'Controllo login Air v2' }, credentials: [{ password: '***' }] });
});

it('reads a package from a JSON file in the brain, validates only on dryRun, and refuses files outside it', async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.brainRoot, 'drafts'));
  fs.writeFileSync(path.join(f.brainRoot, 'drafts', 'routine.json'), JSON.stringify(pkg()));
  expect(await f.run('app_routine_save', { packagePath: 'drafts/routine.json', dryRun: true })).toMatchObject({ status: 'needs-secrets', routineId: 'air-login-check', next: 'dryRun: nothing saved.' });
  expect(fs.existsSync(f.storeRoot)).toBe(false);
  expect(() => f.tools.find(t => t.name === 'app_routine_save')!.run({ packagePath: '../outside.json' })).toThrow(/inside the selected brain/);
  expect(() => f.tools.find(t => t.name === 'app_routine_save')!.run({ package: pkg(), packagePath: 'drafts/routine.json' })).toThrow('exactly one');
  expect(() => f.tools.find(t => t.name === 'app_routine_save')!.run({ package: pkg(), approved: true })).toThrow('Unknown field');
});

it('describes the package model in capabilities, connectors, the live guide and the role text', async () => {
  const f = fixture();
  const overview = await f.run('app_routine_capabilities');
  expect(JSON.stringify(overview)).toContain('plain Claude Code session');
  expect(await f.run('app_routine_capabilities', { section: 'browser' })).toMatchObject({ prompt: expect.stringContaining('already logged into') });
  expect(() => f.tools.find(t => t.name === 'app_routine_capabilities')!.run({ section: 'roles' })).toThrow('Unknown section');
  const connectors = await f.run('app_routine_connectors') as { runtime: { name: string }[] };
  expect(connectors.runtime.map(s => s.name)).toEqual(['routine-devops', 'routine-testdb', 'routine-browser']);
  const guide = f.tools.find(t => t.name === 'app_guide')!;
  expect(await guide.run({ topic: 'app_routine_save' })).toContain(f.tools.find(t => t.name === 'app_routine_save')!.description);
  const topic = String(await guide.run({ topic: 'routine pacchetto' }));
  expect(topic).toContain('app_routine_save'); expect(topic).toContain('never an app role');
  expect(ORCHESTRATOR_ROLE).toContain('app_routine_save'); expect(ORCHESTRATOR_ROLE).toContain('plain Claude Code session');
  expect(ORCHESTRATOR_ROLE).not.toMatch(/app_flow_(bind|report|reconcil|preflight)/);
});
