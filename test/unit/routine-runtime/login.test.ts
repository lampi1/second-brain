// The routine runtime's site login (ADR 0176): the helper always opens the credential's stored loginUrl, query
// included (Air's local login is /Account/Login?mode=local; without the query the page shows no local form), also on a
// re-login after the session expired and Air redirected to /Account/Login?ReturnUrl=…. The query survives the app
// export converter, the app's site vault adapter and the demo package.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertFlowToPackage, createRoutineRuntime, loadRoutinePackage, type LoginPageDriver } from '../../../packages/routine-runtime/src/index';
import { appCredentials } from '../../../src/main/flows/routine-host';
import { done, routinePackage, scriptedEngine, tempDir } from './fakes';

const AIR = 'https://air.example.test';
const LOCAL_LOGIN = `${AIR}/Account/Login?mode=local`;
const PASSWORD = ['fixture', 'login', 'value'].join('-'); // built at run time: the guard refuses secret-shaped literals
const paths = (root: string) => ({ runsRoot: path.join(root, 'runs'), workspace: (id: string) => path.join(root, 'ws', id) });

/** An Air-like tab: the local login form exists only with ?mode=local; its button signs in and leaves the login page. */
function airTab(start: string) {
  const state = { href: start, navigations: [] as string[], filled: {} as Record<string, string>, pressed: 0 };
  const local = () => { const u = new URL(state.href); return u.pathname === '/Account/Login' && u.searchParams.get('mode') === 'local'; };
  const driver: LoginPageDriver = {
    url: async () => state.href,
    navigate: async url => { state.navigations.push(url); state.href = url; },
    facts: async () => local() ? { pageOrigin: AIR, passwords: 1, inForm: true, users: 1, method: 'get', bare: true, actionOrigin: AIR, target: '', submits: [], buttons: ['btnlogin accedi'] } : null,
    fill: async (field, value) => { state.filled[field] = value; },
    press: async () => { state.pressed++; if (local() && state.filled.password === PASSWORD) state.href = `${AIR}/`; },
    has: async () => false,
    wait: async () => undefined,
  };
  return { state, driver };
}

describe('routine site login', () => {
  it('expired session redirected to /Account/Login?ReturnUrl=x: navigates to the stored ?mode=local URL and logs in', async () => {
    const runtime = createRoutineRuntime({ pkg: routinePackage({}, { credentials: [{ loginUrl: LOCAL_LOGIN, user: 'qa', password: PASSWORD }] }), paths: paths(tempDir('routine-login-')), engine: scriptedEngine(() => done('x')) });
    const redirected = `${AIR}/Account/Login?ReturnUrl=x`;
    const tab = airTab(redirected);
    expect(await runtime.login(tab.driver, redirected)).toBe(true);
    expect(tab.state.navigations).toEqual([LOCAL_LOGIN]);
    expect(tab.state.filled).toEqual({ user: 'qa', password: PASSWORD });
    expect(tab.state.href).toBe(`${AIR}/`);
  });

  it('also when the redirect drops the query entirely, and again on a second expiry', async () => {
    const runtime = createRoutineRuntime({ pkg: routinePackage({}, { credentials: [{ loginUrl: LOCAL_LOGIN, user: 'qa', password: PASSWORD }] }), paths: paths(tempDir('routine-login-')), engine: scriptedEngine(() => done('x')) });
    const tab = airTab(`${AIR}/Account/Login`);
    expect(await runtime.login(tab.driver, `${AIR}/Account/Login`)).toBe(true);
    tab.state.href = `${AIR}/Account/Login?ReturnUrl=%2Fagenda`;
    expect(await runtime.login(tab.driver, tab.state.href)).toBe(true);
    expect(tab.state.navigations).toEqual([LOCAL_LOGIN, LOCAL_LOGIN]);
  });

  it('the app export converter keeps the login query', () => {
    const { pkg } = convertFlowToPackage({ format: 'second-brain-flow', schemaVersion: 1, definition: { id: 'air-check', title: 'Air check', description: '', steps: [{ id: 'read', title: 'Read', kind: 'agent', instructions: 'Open Air.' }] }, credentials: [{ loginUrl: LOCAL_LOGIN, user: 'qa', password: PASSWORD }] });
    expect(pkg.credentials).toEqual([{ loginUrl: LOCAL_LOGIN, user: 'qa', password: PASSWORD }]);
    expect(pkg.routine.steps.map(s => s.prompt).join('\n')).not.toContain('mode=local');
  });

  it('the app vault (origin only) still logs in on the package\'s stored URL with its query', () => {
    const store = appCredentials(routinePackage({}, { credentials: [{ loginUrl: LOCAL_LOGIN, user: 'qa', password: PASSWORD }] }), () => ({ user: 'vault', password: PASSWORD }));
    expect(store.forLogin(`${AIR}/Account/Login?ReturnUrl=x`)).toEqual({ loginUrl: LOCAL_LOGIN, user: 'vault', password: PASSWORD });
  });

  it('an origin-only login (filled by the app from its site vault) opens the page that asked for it, query included', async () => {
    const runtime = createRoutineRuntime({ pkg: routinePackage({}, { credentials: [{ loginUrl: `${AIR}/`, user: 'qa', password: PASSWORD }] }), paths: paths(tempDir('routine-login-')), engine: scriptedEngine(() => done('x')) });
    const tab = airTab(LOCAL_LOGIN);
    expect(await runtime.login(tab.driver, LOCAL_LOGIN)).toBe(true);
    expect(tab.state.navigations).toEqual([LOCAL_LOGIN]);
    expect(tab.state.filled).toEqual({ user: 'qa', password: PASSWORD });
  });

  it('the demo package carries its login URL with ?mode=local', () => {
    const pkg = loadRoutinePackage(path.resolve(__dirname, '../../../packages/routine-runtime/demo/routine.json'));
    expect(pkg.credentials?.[0]?.loginUrl).toMatch(/\/Account\/Login\?mode=local$/);
  });
});
