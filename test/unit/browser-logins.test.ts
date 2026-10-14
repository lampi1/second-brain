// The credentials file of login hand-offs (browser/logins.ts): JSON or Markdown with JSON blocks, entries found at
// any depth, account matching (case, several entries for one user), the file path kept inside the brain, and nothing
// but user, URL and note leaving lookup(); the "Credenziali" panel's list() (group, user, URL, note, id: never a password)
// and byId() on a fixture shaped like the user's file (test/fixtures/logins, fake values).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Credentials, parseEntries, pick } from '../../src/main/browser/logins';
import { PASTE_KEYS } from '../../src/main/browser/tools';

const ROOT = path.resolve('/brain');
const md = (obj: unknown) => ['# Accounts', 'text before', '```json', JSON.stringify(obj, null, 2), '```', '```bash', 'echo not json', '```'].join('\n');
const FILE = md({
  air: {
    prod: [{ note: 'prod holding\nsecond line', email: 'mario@example.com', password: 'pw-prod' }],
    test: [
      { url: 'https://test-3.example.com/Account/Login', email: 'mario@example.com', password: 'pw-test' },
      { username: 'luigi', password: 'pw-luigi' },
      { email: 'nopass@example.com' },
    ],
  },
});

function creds(files: Record<string, string>, root: string | null = ROOT): Credentials {
  return new Credentials(() => root, f => {
    const k = path.relative(ROOT, f).replace(/\\/g, '/');
    if (!(k in files)) throw new Error('ENOENT');
    return files[k]!;
  });
}

describe('credentials file', () => {
  it('parses entries from Markdown JSON blocks at any depth (password and a user key required)', () => {
    const e = parseEntries(FILE);
    expect(e.map(x => x.user)).toEqual(['mario@example.com', 'mario@example.com', 'luigi']);
    expect(e[0]!.note).toBe('prod holding second line');
    expect(parseEntries(JSON.stringify([{ login: 'x', password: 'y' }]))).toEqual([{ user: 'x', password: 'y', group: '' }]);
    expect(parseEntries('no json here')).toEqual([]);
  });

  it('picks the entry of the page host when one user has several, ignoring case', () => {
    const e = parseEntries(FILE);
    expect(pick(e, 'MARIO@example.com', 'https://test-3.example.com/Account/Login?x=1')?.password).toBe('pw-test');
    expect(pick(e, 'mario@example.com', 'https://elsewhere.example.com/')?.password).toBe('pw-prod');   // first one
    expect(pick(e, 'nobody', 'https://x/')).toBeUndefined();
  });

  it('lookup shows user, URL and note, never the password; password() reads it for the clipboard', () => {
    const c = creds({ 'ops/credentials.md': FILE });
    const a = c.lookup('mario@example.com', 'https://test-3.example.com/login');
    expect(a).toEqual({ user: 'mario@example.com', found: true, url: 'https://test-3.example.com/Account/Login' });
    expect(JSON.stringify(c.lookup('mario@example.com', ''))).not.toContain('pw-');
    expect(c.lookup('  ghost@example.com ', '')).toEqual({ user: 'ghost@example.com', found: false });
    expect(c.password('luigi', '')).toBe('pw-luigi');
    expect(c.password('ghost', '')).toBeNull();
    expect(c.describe()).toBe('ops/credentials.md');
  });

  it('blocks agents\' paste keys while a copied password is on the clipboard', () => {
    const c = creds({});
    expect(c.pasteBlocked(1000)).toBe(false);
    c.markCopied(30_000, 1000);
    expect(c.pasteBlocked(30_999)).toBe(true);
    expect(c.pasteBlocked(31_000)).toBe(false);
    c.markCopied(30_000, 1000);
    c.cleared();
    expect(c.pasteBlocked(2000)).toBe(false);
    for (const k of ['ctrl+v', 'Control+V', 'ctrl+shift+v', 'shift+Insert', 'ctrl+a ctrl+v', 'meta+v']) expect(PASTE_KEYS.test(k), k).toBe(true);
    for (const k of ['v', 'ctrl+a', 'ctrl+c', 'Insert', 'ctrl+vv']) expect(PASTE_KEYS.test(k), k).toBe(false);
  });

  it('follows credentialsFile in brain-settings.json, but never outside the brain', () => {
    const inside = creds({ 'brain-settings.json': JSON.stringify({ credentialsFile: 'secret/accounts.json' }), 'secret/accounts.json': JSON.stringify({ username: 'u', password: 'p' }) });
    expect(inside.password('u', '')).toBe('p');
    const outside = creds({ 'brain-settings.json': JSON.stringify({ credentialsFile: '../.env' }) });
    expect(outside.file()).toBeNull();
    expect(outside.lookup('u', '').found).toBe(false);
    expect(outside.describe()).toBe('no credentials file');
    expect(creds({}, null).file()).toBeNull();
    expect(creds({}).lookup('u', '')).toEqual({ user: 'u', found: false });     // no file: not found, no throw
  });

  describe('the Credenziali panel', () => {
    const FIXTURE = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'fixtures', 'logins', 'sample.md'), 'utf8');
    const PASSWORDS = ['fake-prod-1', 'fake-test-1', 'fake-test-2', 'fake-local-1', 'fake-ts-1'];

    it('lists every entry with its group from the file keys, user, URL and one-line note, never a password', () => {
      const list = creds({ 'ops/credentials.md': FIXTURE }).list();
      expect(list.map(e => [e.group, e.user])).toEqual([
        ['air · prod', 'prod.user@example.com'],
        ['air · test', 'mario@example.com'],
        ['air · test', 'rci@example.com'],
        ['air · local', 'admin@localhost.test'],
        ['sistemaTsTest', 'MEDICO01'],
      ]);
      expect(list[2]).toMatchObject({ url: 'https://test-3.example.test/Account/Login', note: 'holding with module X enabled (for module X checks)' });
      expect(list[1]!.url).toBeUndefined();
      expect(Object.keys(list[4]!).sort()).toEqual(['group', 'id', 'note', 'user']);
      const text = JSON.stringify(list);
      for (const pw of [...PASSWORDS, '0000']) expect(text).not.toContain(pw);
      expect(new Set(list.map(e => e.id)).size).toBe(list.length);
    });

    it('byId reads the password at the click; ids are stable, and a changed file finds nothing rather than another entry', () => {
      const files = { 'ops/credentials.md': FIXTURE };
      const c = creds(files);
      const list = c.list();
      expect(list.map(e => c.byId(e.id)?.password)).toEqual(PASSWORDS);
      expect(c.byId(list[4]!.id)?.user).toBe('MEDICO01');
      expect(creds(files).list().map(e => e.id)).toEqual(list.map(e => e.id));
      expect(c.byId('nope')).toBeNull();
      // an entry inserted before the module X one: its old id must not copy someone else's password
      files['ops/credentials.md'] = FIXTURE.replace('"test": [', '"test": [ { "email": "new@example.com", "password": "fake-new" },');
      expect(c.byId(list[2]!.id)).toBeNull();
      expect(c.byId(list[0]!.id)?.password).toBe('fake-prod-1');
    });

    it('a stale id never copies a twin entry: removing the first of two same-user entries shifts the second to its place', () => {
      const twin = (note: string, pw: string) => ({ note, url: 'https://x.example.test/', email: 'mario@example.com', password: pw });
      const files = { 'ops/credentials.md': md({ air: { test: [twin('vecchia', 'pw-old'), twin('nuova', 'pw-new')] } }) };
      const c = creds(files);
      const [first] = c.list();
      files['ops/credentials.md'] = md({ air: { test: [twin('nuova', 'pw-new')] } });
      expect(c.byId(first!.id)).toBeNull();
    });

    it('no brain or no file: an empty list, no throw', () => {
      expect(creds({}, null).list()).toEqual([]);
      expect(creds({}).list()).toEqual([]);
    });
  });
});
