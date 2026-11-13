// The user's permission rules from the brain (chats/permit-policy.ts, ADR 0254, #352), with the owner's own policy as
// fixture (test/fixtures/brain-policy/permissions.json): DB writes, prod deploys and Azure writes wait for Esegui (local
// dev DB free), mail and Teams ask, secrets are never printed, everything else passes; a missing file frees all, a
// broken one asks for all but reads.
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoPermit } from '../../../src/main/chats/auto-permit';
import { loadPolicy, parsePolicy, policyRead, POLICY_FILE } from '../../../src/main/chats/permit-policy';

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'brain-policy');
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pp-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const owner = loadPolicy(FIXTURE);
// a still clock: the rules' time budget never ends here, whatever the machine (its own test moves the clock)
const ask = (tool: string, input: unknown, policy = owner) => autoPermit({ type: 'permission', tool, input }, { cwd: tmp, ceiling: null, policy, now: () => 0 });
const cmd = (command: string, policy = owner) => ask('Bash', { command }, policy);
const ruleOf = (v: ReturnType<typeof ask>) => (v.kind === 'deny' || v.kind === 'ask' ? v.rule?.id : undefined);

describe('the owner\'s policy', () => {
  it('parses', () => expect(owner.state).toBe('ok'));

  it('holds database writes for Esegui, test and prod; reads and the local dev DB are free', () => {
    for (const c of [
      'sqlcmd -S prod-sql -d app -Q "UPDATE users SET active = 0"',
      'sqlcmd -S test-sql -Q "insert into t values (1)"',
      'sqlcmd -S test-sql -Q "DROP TABLE t"',
      'psql -h db -c "delete from orders"',
      'sqlcmd -S prod-sql -i migrate.sql',
      'dotnet ef database update',
    ]) {
      const v = cmd(c);
      expect(v.kind, c).toBe('deny');
      expect(ruleOf(v), c).toBe('db-write');
    }
    for (const c of ['sqlcmd -S prod-sql -Q "SELECT TOP 10 * FROM users"', 'sqlcmd -S localhost -E -C -Q "DELETE FROM t"', 'sqlcmd -S localhost -E -C -i seed.sql']) expect(cmd(c).kind, c).toBe('allow');
    // a local call chained to a remote write is not the local dev DB
    expect(cmd('sqlcmd -S localhost -E -C -Q "select 1"; sqlcmd -S prod -Q "delete from t"').kind).toBe('deny');
    expect(ruleOf(ask('mcp__mssql__execute_query', { query: 'UPDATE t SET a = 1' }))).toBe('db-write-tools');
    expect(ruleOf(ask('mcp__mssql__execute_query', { query: '\n  UPDATE t SET a = 1' }))).toBe('db-write-tools'); // formatted SQL
    // Codex names the tool's arguments one level down; a long input never pushes them out of what the rules read
    expect(ruleOf(ask('mcp__mssql__execute_query', { server: 'mssql', tool: 'mcp__mssql__execute_query', arguments: { query: 'DELETE FROM t' } }))).toBe('db-write-tools');
    expect(ruleOf(ask('mcp__mssql__execute_query', { params: 'p'.repeat(9000), query: 'DROP TABLE t' }))).toBe('db-write-tools');
    // a rule held in what they read wins over the length: a padded write is refused, not asked
    const pad = 'p'.repeat(3990);
    expect(ruleOf(ask('mcp__mssql__execute_query', { query: 'DROP TABLE t', a: pad, b: pad, c: pad }))).toBe('db-write-tools');
    expect(ask('mcp__mssql__execute_query', { query: 'DROP TABLE t', a: pad, b: pad, c: pad }).kind).toBe('deny');
    // a rule written on «tool + JSON» on one line still reads it
    const json = parsePolicy(JSON.stringify({ version: 1, rules: [{ id: 'j', action: 'esegui', why: 'w', tools: ['mcp'], match: ['execute_query \\{"query":"\\s*drop'] }] }));
    expect(ruleOf(ask('mcp__mssql__execute_query', { query: 'DROP TABLE t' }, json))).toBe('j');
    // longer than the rules read: the user's call
    expect(ask('mcp__mssql__execute_query', { query: 'SELECT 1', params: 'p'.repeat(120_000) }).kind).toBe('ask');
    // a long file is in what the rules read twice (its text, then the JSON): each is read up to the limit, so it is
    // «too long» only past the limit itself, not at half of it (ADR 0290: every Write of 10 KB asked the user under a rule on all tools)
    expect(ask('Write', { file_path: 'docs/a.md', content: 'riga di testo\n'.repeat(5000) }).kind).toBe('allow'); // 70 000 characters
    expect(ask('Write', { file_path: 'docs/a.md', content: 'x'.repeat(120_000) }).kind).toBe('ask');
    // what a rule holds is found far into a long input, in either part
    expect(ruleOf(ask('mcp__mssql__execute_query', { params: 'p'.repeat(60_000), query: 'DROP TABLE t' }))).toBe('db-write-tools');
    const tail = parsePolicy(JSON.stringify({ version: 1, rules: [{ id: 'tail', action: 'esegui', why: 'w', tools: ['*'], match: ['FINE-DEL-FILE'] }] }));
    expect(ruleOf(ask('Write', { file_path: 'docs/a.md', content: `${'x'.repeat(70_000)} FINE-DEL-FILE` }, tail))).toBe('tail');
    expect(ask('mcp__mssql__execute_query', { query: 'SELECT 1' }).kind).toBe('allow');
  });

  it('a rule means the same on a short and on a long request: its patterns read one text (ADR 0290)', () => {
    const rules = (r: object) => parsePolicy(JSON.stringify({ version: 1, rules: [{ id: 'r', action: 'esegui', why: 'w', tools: ['*'], ...r }] }));
    // a pattern that starts in the text values and ends in the JSON
    const cross = rules({ match: ['path: /prod/[\\s\\S]*"force":true'] });
    for (const n of [10, 45_000, 60_000]) expect(ruleOf(ask('mcp__fs__write', { path: '/prod/a.txt', force: true, content: 'x'.repeat(n) }, cross)), String(n)).toBe('r');
    // an exception anchored to the start of the text holds, or not, at any size
    const anchored = rules({ match: ['segreto'], unless: ['^Write \\{"file_path":"docs/'] });
    const kind = (n: number) => ask('Write', { file_path: 'docs/a.md', content: `segreto ${'x'.repeat(n)}` }, anchored).kind;
    expect(kind(60_000)).toBe(kind(10));
    expect(kind(45_000)).toBe(kind(10));
  });

  it('rules that would take too long ask instead of holding the app (ADR 0290)', () => {
    const one = parsePolicy(JSON.stringify({ version: 1, rules: [{ id: 'one', action: 'esegui', why: 'w', tools: ['command'], match: ['DROP TABLE'] }] }));
    // a clock that moves 30 ms at every look: one pattern on a short line is well inside the budget
    let t = 0;
    const step = () => (t += 30);
    expect(policyRead(one, 'Bash', { command: 'ls' }, ['Bash'], undefined, step)).toEqual({ rule: null, unread: false });
    expect(policyRead(one, 'Bash', { command: 'sqlcmd -Q "DROP TABLE t"' }, ['Bash'], undefined, step).rule?.id).toBe('one');
    // 96,000 characters: at 30 ms for the first 20,000, the whole text would take too long, so it is not read
    const long = 'ls -la docs\n'.repeat(8000);
    expect(policyRead(one, 'Bash', { command: long }, ['Bash'], undefined, step)).toEqual({ rule: null, unread: true });
    expect(autoPermit({ type: 'permission', tool: 'Bash', input: { command: long } }, { cwd: tmp, ceiling: null, policy: one, now: step }).kind).toBe('ask');
    // with a still clock the same text is read, and free
    expect(policyRead(one, 'Bash', { command: long }, ['Bash'], undefined, () => 0)).toEqual({ rule: null, unread: false });
    // the budget of one request: with 300 ms between two looks it is gone before the first pattern
    const jump = () => (t += 300);
    expect(policyRead(owner, 'Bash', { command: 'ls' }, ['Bash'], undefined, jump)).toEqual({ rule: null, unread: true });
    // a tool no rule looks at is not timed at all
    expect(policyRead(one, 'Write', { file_path: 'a.md', content: 'x' }, ['Bash'], undefined, jump)).toEqual({ rule: null, unread: false });
  });

  it('holds production deploys and Azure writes for Esegui; Azure reads and test deploys are free', () => {
    expect(ruleOf(cmd('npm run deploy -- --env prod'))).toBe('prod-deploy');
    expect(ruleOf(cmd('./release.ps1 -Target production'))).toBe('prod-deploy');
    for (const c of ['az webapp restart -n app -g rg', 'az group delete -n rg', 'az keyvault secret set --vault-name v -n k --value x', 'az rest --method post --url https://x', 'New-AzResourceGroup -Name x', 'az webapp deployment source config-zip -g rg -n app --src a.zip']) {
      expect(ruleOf(cmd(c)), c).toBe('azure-write');
    }
    for (const c of ['az group list', 'az webapp show -n start-app -g rg', 'az account set --subscription x', 'az monitor log-analytics query -w x --analytics-query "T | take 1"', 'npm run deploy -- --env test']) expect(cmd(c).kind, c).toBe('allow');
  });

  it('sends mail and Teams messages to the user, without an «always»', () => {
    const v = ask('mcp__Gmail__send_message', { to: 'a@b.c', body: 'x' });
    expect(v).toMatchObject({ kind: 'ask', rule: { id: 'mail-teams' } });
    expect(ruleOf(ask('mcp__teams__post_message', { text: 'x' }))).toBe('mail-teams');
    expect(ruleOf(cmd('Send-MailMessage -To a@b.c -Subject x'))).toBe('mail-teams');
    // Cursor and OpenCode name an MCP call only in its title (the tool is «Tool»)
    const acp = autoPermit({ type: 'permission', tool: 'Tool', title: 'gmail_send_message', input: { to: 'a@b.c' } }, { cwd: tmp, ceiling: null, policy: owner });
    expect(ruleOf(acp)).toBe('mail-teams');
    expect(ask('mcp__Gmail__search_threads', { q: 'x' }).kind).toBe('allow');
  });

  it('lets a secret be read and used, never printed', () => {
    for (const c of ['cat .env', 'type config\\secrets.json', 'Get-Content .env.local', 'printenv', 'echo $GITHUB_TOKEN', 'az keyvault secret show --vault-name v -n k']) {
      expect(cmd(c)).toMatchObject({ kind: 'deny', rule: { id: 'secrets-never-print' } });
    }
    expect(ask('Read', { file_path: path.join(tmp, '.env') }).kind).toBe('allow');
    for (const c of ['cat .env.example', 'TOKEN=$(az keyvault secret show --vault-name v -n k --query value -o tsv) node run.js', 'echo done']) expect(cmd(c).kind, c).toBe('allow');
  });

  it('frees everything else: prod reads, git push (force too), network, files, tools', () => {
    for (const c of ['git push origin main', 'git push --force origin feat', 'git reset --hard HEAD~1', 'rm -rf dist', 'curl https://example.com', 'az pipelines run --name ci', 'npx some-tool']) expect(cmd(c).kind, c).toBe('allow');
    expect(ask('WebFetch', { url: 'https://example.com' }).kind).toBe('allow');
    expect(ask('mcp__ado__add_pr_comment', { text: 'ok' }).kind).toBe('allow');
    expect(ask('Write', { file_path: path.join(tmp, 'x.ts') }).kind).toBe('allow');
  });

  it('tells the agent what to do instead, so the chat goes on', () => {
    const v = cmd('az webapp restart -n app -g rg');
    expect(v.kind === 'deny' && v.message).toMatch(/Esegui.*fenced code block.*go on/s);
    const tool = ask('mcp__mssql__execute_query', { query: 'DELETE FROM t' });
    expect(tool.kind === 'deny' && tool.message).toMatch(/Only the user does this.*Tell the user exactly what is needed/s); // not a command for Esegui
    const s = cmd('cat .env');
    expect(s.kind === 'deny' && s.message).toMatch(/never print.*go on/s);
  });
});

describe('the policy file', () => {
  it('missing: no rule, everything is free; a brain folder that cannot be reached is not «no rule»', () => {
    const none = loadPolicy(tmp);
    expect(none.state).toBe('none');
    expect(loadPolicy(path.join(tmp, 'unplugged-brain'))).toMatchObject({ state: 'broken', error: expect.stringMatching(/reached/) });
    expect(cmd('sqlcmd -S prod -Q "delete from t"', none).kind).toBe('allow');
    expect(loadPolicy(null).state).toBe('none');
  });

  it('broken: the app asks for everything but reads, never falls back to a list of its own', () => {
    const dir = path.join(tmp, 'broken');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, POLICY_FILE), '{ "version": 1, "rules": [ { "id": "x" ');
    const broken = loadPolicy(dir);
    expect(broken.state).toBe('broken');
    expect(cmd('npm test', broken).kind).toBe('ask');
    expect(ask('Write', { file_path: path.join(tmp, 'x.ts') }, broken).kind).toBe('ask');
    expect(cmd('git status', broken).kind).toBe('allow');
    expect(ask('Read', { file_path: path.join(tmp, 'x.ts') }, broken).kind).toBe('allow');
  });

  it('a file that is not exactly the format is broken as a whole', () => {
    const rule = { id: 'r', action: 'esegui', why: 'w', match: ['x'] };
    expect(parsePolicy(JSON.stringify({ version: 1, rules: [rule] })).state).toBe('ok');
    for (const bad of [
      { version: 2, rules: [rule] }, { version: 1 }, { version: 1, rules: [{ ...rule, action: 'deny' }] },
      { version: 1, rules: [{ ...rule, match: ['('] }] }, { version: 1, rules: [{ ...rule, match: [] }] }, { version: 1, rules: [rule, rule] },
      { version: 1, rules: [{ ...rule, why: '' }] }, { version: 1, rules: [{ ...rule, extra: 1 }] }, { version: 1, rules: [rule], other: 1 },
      { version: 1, rules: [{ ...rule, tools: ['commands'] }] },
    ]) expect(parsePolicy(JSON.stringify(bad)).state, JSON.stringify(bad)).toBe('broken');
    expect(parsePolicy('not json').state).toBe('broken');
    // a class written in capitals is that class
    for (const tools of [['Command'], ['MCP']]) expect(parsePolicy(JSON.stringify({ version: 1, rules: [{ ...rule, tools }] })).state).toBe('ok');
  });

  it('is read again when it changes', () => {
    const dir = path.join(tmp, 'live');
    fs.mkdirSync(dir);
    const file = path.join(dir, POLICY_FILE);
    fs.writeFileSync(file, JSON.stringify({ version: 1, rules: [] }));
    expect(loadPolicy(dir)).toEqual({ state: 'ok', rules: [] });
    fs.writeFileSync(file, JSON.stringify({ version: 1, rules: [{ id: 'r', action: 'ask-user', why: 'w', match: ['^npm publish'] }] }));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(cmd('npm publish', loadPolicy(dir))).toMatchObject({ kind: 'ask', rule: { id: 'r' } });
  });
});
