// Routine package preflight (ADR 0175): the check run before a run and by the Orchestrator's authoring tool. Each case
// is a mistake an author makes, and the test pins that preflight names the field and gives a fix.
import { describe, expect, it } from 'vitest';
import { formatPreflight, preflightRoutinePackage, SECRET_PLACEHOLDER } from '../../../packages/routine-runtime/src/index';

const base = () => ({
  format: 'second-brain-routine', schemaVersion: 1,
  routine: { id: 'r', title: 'R', description: '', inputs: [{ name: 'topic' }], steps: [{ id: 'a', title: 'A', prompt: 'Look at {{topic}}.' }] },
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures are mutated freely per case
}) as Record<string, any>;
const paths = (v: unknown) => preflightRoutinePackage(v).errors.map(e => e.path);

describe('routine package preflight', () => {
  it('a minimal package passes with no warnings', () => {
    const r = preflightRoutinePackage(base());
    expect(r).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(formatPreflight(r)).toBe('preflight ok');
  });

  it('a role field from the old model is refused with a fix', () => {
    const p = base(); p.routine.steps[0].role = 'artisan';
    const r = preflightRoutinePackage(p);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ path: 'steps[0]' });
    expect(r.errors[0]!.fix).toMatch(/plain Claude Code session/);
  });

  it('undeclared placeholders, role names and app tools in prompts are errors', () => {
    const p = base(); p.routine.steps[0].prompt = 'Use {{repo}} as Artisan and call agent_report.';
    p.routine.steps[0].allowedTools = ['mcp__second-brain__navigate', 'mcp__playwright__browser_navigate'];
    const r = preflightRoutinePackage(p);
    expect(r.errors.map(e => e.message)).toEqual(expect.arrayContaining([
      '{{repo}} is not an input', 'mentions the app role "Artisan"', 'uses the app-only tool "agent_report"',
      '"mcp__second-brain__navigate" is an app-only tool',
      '"mcp__playwright__browser_navigate" belongs to MCP server "playwright", which this step does not get',
    ]));
  });

  it('{{workItem}} without a trigger or workItem input is an error; the runtime servers are always reachable', () => {
    const p = base(); p.routine.steps[0].prompt = 'Fix {{workItem}}'; p.routine.steps[0].allowedTools = ['mcp__routine-devops__get_work_item'];
    expect(paths(p)).toEqual(['steps[0].prompt']);
    p.routine.inputs.push({ name: 'workItem' });
    expect(preflightRoutinePackage(p).ok).toBe(true);
  });

  it('DevOps: trigger and grant must agree, fields need names, escalation and PAT are suggested', () => {
    const p = base();
    p.routine.trigger = { kind: 'devops', everyMinutes: 5, organization: 'contoso', project: 'Air', areaPath: 'Air', workItemType: 'Bug', states: ['New'], includeExisting: false };
    p.routine.devops = { organization: 'other', projects: ['X'], ops: ['comment', 'fields'], fields: [] };
    const r = preflightRoutinePackage(p);
    expect(r.errors.map(e => e.path)).toEqual(['devops.organization', 'devops.projects', 'devops.fields']);
    expect(r.warnings.map(e => e.path)).toEqual(['trigger', 'secrets.devopsPat', 'escalation']);
  });

  it('a login rule needs a credential with the same loginUrl, query included', () => {
    const p = base();
    p.routine.loginSuccess = [{ loginUrl: 'https://air.example.test/Account/Login?mode=local', success: { urlNotContaining: '/Account/Login' } }];
    expect(paths(p)).toEqual(['loginSuccess[0].loginUrl']);
    p.credentials = [{ loginUrl: 'https://air.example.test/Account/Login', user: 'u', password: 'pw-secret-1' }];
    expect(preflightRoutinePackage(p).warnings.map(w => w.path)).toEqual(['loginSuccess[0].loginUrl']);
    p.credentials[0].loginUrl = 'https://air.example.test/Account/Login?mode=local';
    const ok = preflightRoutinePackage(p);
    expect(ok).toMatchObject({ ok: true, warnings: [] });
    expect(ok.pkg!.credentials![0]!.loginUrl).toBe('https://air.example.test/Account/Login?mode=local');
    // a second user of the same login page needs its own id
    p.credentials.push({ loginUrl: p.credentials[0].loginUrl, user: 'v', password: 'pw-secret-2' });
    expect(paths(p)).toEqual(['credentials[1].loginUrl']);
    p.credentials[1].id = 'tester';
    expect(preflightRoutinePackage(p)).toMatchObject({ ok: true });
    p.credentials.push({ id: 'tester', loginUrl: 'https://air.example.test/x', user: 'w', password: 'pw-secret-3' });
    expect(paths(p)).toEqual(['credentials[2].id']);
    p.credentials.length = 1;
    p.routine.steps[0].prompt = 'Log in with pw-secret-1';
    expect(preflightRoutinePackage(p).errors[0]!.message).toContain('password');
  });

  it('test DBs: production refused, unknown to the host refused, login required', () => {
    const p = base();
    p.routine.testDbs = [{ id: 'db', server: 'sql-prod-01', database: 'Air' }];
    expect(preflightRoutinePackage(p).errors[0]!.fix).toMatch(/Production databases are never allowed/);
    p.routine.testDbs = [{ id: 'db', server: 'sql-test-01', database: 'Air' }];
    p.routine.steps[0].testDbs = ['db'];
    expect(paths(p)).toEqual(['secrets.testDbs.db']);
    p.secrets = { testDbs: { db: { user: 'reader', password: 'x' } } };
    expect(preflightRoutinePackage(p).ok).toBe(true);
    expect(preflightRoutinePackage(p, { recognisedTestDbs: [{ server: 'other', port: 1433, database: 'Air' }] }).errors[0]!.message).toMatch(/recognised/);
  });

  it('test DBs: a name that does not say "test" runs when the host recognises it, and only then', () => {
    const p = base();
    p.routine.testDbs = [{ id: 'tenant', server: 'sql-web.example.net', database: 'Db_TENANT1' }];
    p.routine.steps[0].testDbs = ['tenant'];
    p.secrets = { testDbs: { tenant: { user: 'reader', password: 'x' } } };
    expect(preflightRoutinePackage(p).errors.map(e => e.path)).toEqual(['testDbs[0]']);
    expect(preflightRoutinePackage(p, { recognisedTestDbs: [{ server: 'sql-web.example.net', port: 1433, database: 'Db_TENANT1' }] }).ok).toBe(true);
  });

  it('an MCP server pointing at the app is refused', () => {
    const p = base();
    p.routine.mcpServers = { app: { command: 'npx', args: ['mcp-remote', 'http://127.0.0.1:4319/mcp/app'] } };
    p.routine.steps[0].mcpServers = ['app'];
    expect(paths(p)).toEqual(['mcpServers.app']);
  });

  it('browser: a step needs routine.browser; an unused browser or a login outside its origins is a warning', () => {
    const p = base();
    p.routine.steps[0].browser = true;
    expect(paths(p)).toEqual(['steps.a.browser']);
    p.routine.browser = { origins: ['https://air.example.test'] };
    expect(preflightRoutinePackage(p)).toMatchObject({ ok: true, warnings: [] });
    p.credentials = [{ loginUrl: 'https://other.example.test/Account/Login?mode=local', user: 'u', password: SECRET_PLACEHOLDER }];
    expect(preflightRoutinePackage(p).warnings.map(w => w.path)).toEqual(['credentials[0].loginUrl']);
    delete p.routine.steps[0].browser; delete p.credentials;
    expect(preflightRoutinePackage(p).warnings.map(w => w.path)).toEqual(['browser']);
  });

  it('entries and retrigger tags: each mistake names its field and gives a fix (ADR 0323)', () => {
    const tagged = () => {
      const p = base();
      p.routine.steps = [{ id: 'fix', title: 'Fix', prompt: 'Fix {{workItem}} as {{entry}}; before: {{previousRun}}.' }, { id: 'verify', title: 'Verify', prompt: 'Verify.' }];
      p.routine.inputs = [];
      p.routine.trigger = { kind: 'devops', everyMinutes: 5, organization: 'contoso', project: 'Air', areaPath: 'Air', workItemType: 'Bug', states: ['New'], includeExisting: false, includeTags: ['ai-fixable'], retriggerTags: ['ai-retest'] };
      p.routine.devops = { organization: 'contoso', projects: ['Air'], ops: ['comment', 'tags'], fields: [] };
      p.routine.entries = [{ name: 'retest', when: { tag: 'ai-retest' }, startStep: 'verify' }];
      p.routine.escalation = { contact: [8, 4, 4, 4, 12].map(n => 'a'.repeat(n)).join('-') };
      p.secrets = { devopsPat: 'pat-value-123' };
      return p;
    };
    const issue = (p: unknown, kind: 'errors' | 'warnings' = 'errors') => preflightRoutinePackage(p)[kind].map(e => [e.path, e.fix]);
    // the whole thing right: runs, nothing to say; {{entry}} and {{previousRun}} are the runtime's
    expect(preflightRoutinePackage(tagged())).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(preflightRoutinePackage(tagged()).pkg!.routine).toMatchObject({ entries: [{ name: 'retest', when: { tag: 'ai-retest' }, startStep: 'verify' }], trigger: { retriggerTags: ['ai-retest'] } });
    // without the two options {{entry}} is an undeclared input, as before
    let p = tagged(); delete p.routine.entries; delete p.routine.trigger.retriggerTags;
    expect(preflightRoutinePackage(p).errors.map(e => e.message)).toEqual(['{{entry}} is not an input', '{{previousRun}} is not an input']);

    // format: the validator's message, with a fix that says what to write
    p = tagged(); p.routine.entries[0].startStep = 'nope';
    expect(issue(p)).toEqual([['entries[0].startStep', 'Use the id of one of routine.steps: the step a run of this entry starts from.']]);
    p = tagged(); p.routine.entries[0].when = { tags: ['ai-retest'] };
    expect(issue(p)).toEqual([['entries[0].when', expect.stringContaining('{ "tag": "ai-retest" }')]]);
    p = tagged(); p.routine.entries[0].name = 'default';
    expect(issue(p)).toEqual([['entries[0].name', expect.stringContaining('"default" is the first step')]]);
    p = tagged(); p.routine.entries.push({ ...p.routine.entries[0], startStep: 'fix' });
    expect(issue(p)[0]![0]).toBe('entries');
    p = tagged(); p.routine.trigger.retriggerTags = ['a;b'];
    expect(issue(p)).toEqual([['trigger.retriggerTags[0]', expect.stringContaining('without ";"')]]);
    p = tagged(); p.routine.trigger.retriggerTags = [];
    expect(issue(p)[0]![0]).toBe('trigger.retriggerTags');

    // the runtime must be able to take the tag off
    p = tagged(); p.routine.devops.ops = ['comment'];
    expect(issue(p)).toEqual([['trigger.retriggerTags', 'Add "tags" to devops.ops.']]);
    p = tagged(); delete p.routine.devops; delete p.secrets;
    expect(issue(p)).toEqual([['trigger.retriggerTags', expect.stringContaining('Add routine.devops')]]);
    // a retrigger tag every item already has, or the one a parked item gets, would start it again at once
    p = tagged(); p.routine.trigger.retriggerTags = ['AI-Fixable'];
    expect(issue(p)).toEqual([['trigger.retriggerTags[0]', expect.stringContaining('a tag of its own')]]);
    p = tagged(); p.routine.devops.ops.push('downgrade'); p.routine.devops.downgrade = { removeTag: 'ai-fixable', addTag: 'ai-retest', state: 'New' };
    expect(issue(p)).toEqual([['trigger.retriggerTags[0]', expect.stringContaining('a tag of its own')]]);
    // two entries on one tag: the second is never chosen
    p = tagged(); p.routine.entries.push({ name: 'again', when: { tag: 'AI-RETEST' }, startStep: 'fix' });
    expect(issue(p)).toEqual([['entries[1].when.tag', 'Give each entry its own tag, or remove this entry.']]);
    // the runtime's inputs cannot be declared
    p = tagged(); p.routine.inputs = [{ name: 'entry' }, { name: 'previousRun' }];
    expect(preflightRoutinePackage(p).errors.map(e => e.path)).toEqual(['inputs[0].name', 'inputs[1].name']);
    // entries need a work item, and an organization to read its tags from
    p = base(); p.routine.entries = [{ name: 'again', when: { tag: 'x' }, startStep: 'a' }];
    expect(issue(p)).toEqual([['entries', expect.stringContaining('workItem')]]);
    p.routine.inputs.push({ name: 'workItem' });
    expect(issue(p)).toEqual([['entries', expect.stringContaining('routine.devops')]]);

    // warnings: a retrigger with no entry reruns everything; an entry at the first step is the default one
    p = tagged(); delete p.routine.entries; p.routine.steps[0].prompt = 'Fix {{workItem}}.';
    expect(issue(p, 'warnings')).toEqual([['trigger.retriggerTags', expect.stringContaining('routine.entries')]]);
    p = tagged(); p.routine.entries[0].startStep = 'fix';
    expect(issue(p, 'warnings')).toEqual([['entries[0].startStep', expect.stringContaining('Name a later step')]]);
  });

  it('a secret placeholder is a missing-secret error, marked for the user', () => {
    const p = base();
    p.credentials = [{ loginUrl: 'https://air.example.test/Account/Login?mode=local', user: 'u', password: SECRET_PLACEHOLDER }];
    p.secrets = { devopsPat: SECRET_PLACEHOLDER };
    const r = preflightRoutinePackage(p);
    expect(r.errors.map(e => [e.path, e.secret])).toEqual([['credentials[0].password', true], ['secrets.devopsPat', true]]);
  });
});
