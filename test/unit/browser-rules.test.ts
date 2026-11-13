// Browser rules the tools enforce with any model (browser/rules.ts, ADR 0063): local stacks only in environment
// "local" and "local" only for them; login hand-offs need a page, never on a local stack with test accounts, and name
// an account when the credentials file has entries for the host. Plus Credentials.accountsFor (browser/logins.ts).
import { describe, expect, it } from 'vitest';
import { envRefusal, loginRefusal } from '../../src/main/browser/rules';
import { Credentials } from '../../src/main/browser/logins';

describe('envRefusal', () => {
  it('keeps local stacks in "local"', () => {
    expect(envRefusal('https://localhost:44319/', 'local')).toBeNull();
    expect(envRefusal('http://127.0.0.1:5000/x', 'local')).toBeNull();
    for (const env of ['stack-it', 'example-test-3', 'scratch']) {
      const no = envRefusal('https://localhost:44319/', env);
      expect(no, env).toMatch(/Refused: localhost:44319 is a local stack/);
      expect(no).toContain('env "local"');
    }
    expect(envRefusal('http://app.localhost/', 'other')).toMatch(/local stack/);
  });

  it('keeps remote hosts out of "local"', () => {
    const no = envRefusal('https://test-3.example.com/app', 'local');
    expect(no).toMatch(/holds only local stacks/);
    expect(no).toContain('"example-test-3"');
    expect(envRefusal('https://test-3.example.com/app', 'example-test-3')).toBeNull();
    expect(envRefusal('https://test-3.example.com/app', 'shared-qa')).toBeNull();   // any other name stays the caller's choice
    expect(envRefusal('http://app.example.test/', 'local')).toBeNull();              // *.test is a local stack too
  });

  it('ignores non-web urls', () => {
    expect(envRefusal('about:blank', 'x')).toBeNull();
    expect(envRefusal('back', 'x')).toBeNull();
  });
});

describe('loginRefusal', () => {
  const base = { account: '', accounts: [] as string[], file: 'ops/credentials.md' };
  it('needs a page in the tab', () => {
    expect(loginRefusal({ ...base, url: 'about:blank' })).toMatch(/no page yet.*tabs_create/);
  });

  it('refuses a local stack that has test accounts, allows one without', () => {
    const no = loginRefusal({ ...base, url: 'https://localhost:44319/login', accounts: ['dev.local'] });
    expect(no).toMatch(/local stack.*"dev\.local".*sign in yourself/);
    expect(loginRefusal({ ...base, url: 'https://localhost:44319/login' })).toBeNull();
  });

  it('on a remote host with entries, wants one of them as account', () => {
    const c = { ...base, url: 'https://test-3.example.com/login', accounts: ['qa@example.com', 'admin'] };
    expect(loginRefusal(c)).toMatch(/no account given.*"qa@example\.com", "admin"/);
    expect(loginRefusal({ ...c, account: 'nobody' })).toMatch(/account "nobody" is not among/);
    expect(loginRefusal({ ...c, account: 'QA@example.com' })).toBeNull();
    expect(loginRefusal({ ...base, url: 'https://elsewhere.example.org/' })).toBeNull();
  });
});

describe('Credentials.accountsFor', () => {
  const file = '```json\n' + JSON.stringify({
    local: { username: 'dev.local', password: 'x', url: 'https://localhost:44319/' },
    test3: [{ email: 'qa@example.com', password: 'y', url: 'https://test-3.example.com/' }, { username: 'admin', password: 'z', url: 'https://test-3.example.com/login' }],
    other: { username: 'nourl', password: 'w' },
  }) + '\n```';
  const creds = new Credentials(() => 'C:/brain', f => { if (f.endsWith('brain-settings.json')) throw new Error('none'); return file; });

  it('lists the users whose entry URL host (with port) is the page host, never passwords', () => {
    expect(creds.accountsFor('https://test-3.example.com/app/x')).toEqual(['qa@example.com', 'admin']);
    expect(creds.accountsFor('https://localhost:44319/login')).toEqual(['dev.local']);
    expect(creds.accountsFor('https://localhost:45319/login')).toEqual([]);
    expect(creds.accountsFor('about:blank')).toEqual([]);
  });
});
