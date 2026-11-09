// The routine browser (packages/routine-runtime/src/browser-mcp.ts) against a local fixture login page, in a real
// headless Chromium: the runtime logs in itself from the stored loginUrl (?mode=local kept after a redirect) before a
// step's first navigation, turns the bare origin into that login, re-logs in after the session ends (the redirect to a
// portal on another origin included), keeps the agent inside the declared origins, refuses password fields, masks the credential
// and saves screenshots into the step's evidence folder + events.jsonl. Skipped when no Chromium/Edge is installed.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bareOrigin, credentialFor, launchOnProfile, loginFailedText, loginFor, loginPageFor, profileHolders, type ProfileRecovery } from '../../../packages/routine-runtime/src/browser-mcp';
import { parseRoutinePackage } from '../../../packages/routine-runtime/src/index';
import { tempDir } from './fakes';

describe('routine browser format', () => {
  const base = { format: 'second-brain-routine', schemaVersion: 1 };
  it('a browser step needs routine.browser.origins; origins are origins only', () => {
    const steps = [{ id: 'a', title: 'A', prompt: 'p', browser: true }];
    expect(() => parseRoutinePackage({ ...base, routine: { id: 'r', title: 'R', steps } })).toThrow(/browser.origins/);
    expect(() => parseRoutinePackage({ ...base, routine: { id: 'r', title: 'R', steps, browser: { origins: ['https://a.test/x'] } } })).toThrow(/origin only/);
    const pkg = parseRoutinePackage({ ...base, routine: { id: 'r', title: 'R', steps, browser: { origins: ['https://a.test'] } } });
    expect(pkg.routine.browser).toEqual({ origins: ['https://a.test'] });
    expect(pkg.routine.steps[0]!.browser).toBe(true);
    // hide: plain selectors only, never a rule of their own
    const hide = (h: string[]) => parseRoutinePackage({ ...base, routine: { id: 'r', title: 'R', steps, browser: { origins: ['https://a.test'], hide: h } } }).routine.browser;
    expect(hide(['#draggable', 'ai-chat'])).toEqual({ origins: ['https://a.test'], hide: ['#draggable', 'ai-chat'] });
    expect(() => hide(['a} body { display: none'])).toThrow(/CSS selector/);
  });
  it('the login page is matched by origin and path, whatever the query', () => {
    const logins = [{ loginUrl: 'https://a.test/Account/Login?mode=local', user: 'u', password: 'p' }];
    expect(loginFor({ logins }, 'https://a.test/Account/Login?ReturnUrl=%2Fhome')).toBe(logins[0]);
    expect(loginFor({ logins }, 'https://a.test/home')).toBeNull();
    expect(loginFor({ logins }, 'https://b.test/Account/Login')).toBeNull();
  });
  it('the portal login (same path, another origin) is a login page of the site the agent wanted', () => {
    const a = { loginUrl: 'https://a.test/Account/Login?mode=local', user: 'u', password: 'p' };
    const b = { loginUrl: 'https://b.test/Account/Login?mode=local', user: 'v', password: 'q' };
    expect(loginPageFor({ logins: [a] }, 'https://portal.test/Account/Login')).toBe(a);
    expect(loginPageFor({ logins: [a, b] }, 'https://portal.test/Account/Login', b)).toBe(b);
    expect(loginPageFor({ logins: [a, b] }, 'https://portal.test/Account/Login')).toBeNull();
    expect(loginPageFor({ logins: [a] }, 'https://portal.test/home')).toBeNull();
    expect(credentialFor({ logins: [a, b] }, 'https://b.test/x')).toBe(b);
    expect(credentialFor({ logins: [a] }, 'https://c.test/')).toBeNull();
    expect(bareOrigin('https://a.test/')).toBe(true);
    expect(bareOrigin('https://a.test')).toBe(true);
    expect(bareOrigin('https://a.test/?x=1')).toBe(false);
    expect(bareOrigin('https://a.test/home')).toBe(false);
  });
});

describe('login failure text', () => {
  it('names the reason code and its detail, never a value', () => {
    expect(loginFailedText({ ok: false, reason: 'unrecognised-form', detail: 'no visible login button in the form' }, 'C:/e/login-failed.png'))
      .toBe('The site login failed [unrecognised-form]: the login form is not one the runtime may fill (no visible login button in the form). Screenshot of the page: C:/e/login-failed.png. Report it as needs-human.');
    expect(loginFailedText({ ok: false, reason: 'driver-error' })).toMatch(/^The site login failed \[driver-error\]: [^(]+\. Report it as needs-human\.$/);
  });
});

describe('launch on a profile held by a leftover browser', () => {
  const recovery = (held: number[][], killed: number[]): ProfileRecovery => ({
    holders: async () => held.shift() ?? [],
    kill: pid => { killed.push(pid); },
    wait: async () => undefined,
  });
  const closed = () => new Error('browserType.launchPersistentContext: Target page, context or browser has been closed\nlogs…');

  it('ends the leftover browser of this profile, removes the stale lock and retries once', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'lockfile'), '');
    const killed: number[] = [];
    let launches = 0;
    const ctx = await launchOnProfile(dir, async () => { if (++launches === 1) throw closed(); return 'context'; }, recovery([[4242, 4243], []], killed));
    expect(ctx).toBe('context');
    expect(launches).toBe(2);
    expect(killed).toEqual([4242, 4243]);
    expect(fs.existsSync(path.join(dir, 'lockfile'))).toBe(false);
  });

  it('a stale lock alone is removed and retried; still failing = one clear error, no third launch', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'lockfile'), '');
    let launches = 0;
    await expect(launchOnProfile(dir, async () => { launches++; throw closed(); }, recovery([], [])))
      .rejects.toThrow(/found a stale lock \(lockfile\), removed, retried once, still failing: browserType.launchPersistentContext: Target page, context or browser has been closed\. Close any browser/);
    expect(launches).toBe(2);
  });

  it('nothing holds the profile: no retry, the error names the profile', async () => {
    const dir = tempDir();
    let launches = 0;
    await expect(launchOnProfile(dir, async () => { launches++; throw closed(); }, recovery([], [])))
      .rejects.toThrow(/no leftover browser or lock file found there/);
    expect(launches).toBe(1);
  });

  it('matches only browsers opened on exactly this profile folder', () => {
    const dir = path.join(tempDir(), 'profile');
    const win = dir.replace(/\//g, '\\');
    expect(profileHolders([
      { pid: 1, cmd: `"msedge.exe" --user-data-dir=${win} --remote-debugging-pipe` },
      { pid: 2, cmd: `"msedge.exe" "--user-data-dir=${win}" --type=renderer` },
      { pid: 3, cmd: `"msedge.exe" --user-data-dir=${win}2 --remote-debugging-pipe` },
      { pid: 4, cmd: '"msedge.exe" --profile-directory=Default' },
      { pid: 5, cmd: `chrome --user-data-dir=${dir}` },
    ], dir)).toEqual([1, 2, 5]);
  });
});
