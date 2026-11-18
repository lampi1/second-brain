// Routine package preflight (ADR 0175, 0176): the one check that says whether a routine.json can run, used before a
// run starts (terminal CLI run/watch, the app host) and by the app's routine authoring tool. It
// runs the format validator (parseRoutinePackage), then the cross-field checks the format cannot express: undeclared
// {{placeholders}}, DevOps trigger/grant/escalation coherence, entries and retrigger tags (ADR 0323), login rules without a login, test DB logins, MCP tools
// a step cannot reach, and anything left from the old role-based routines (roles, app MCP tools). Every problem comes
// with the field path and the fix in plain words. Pure: no network, no file system, no secrets in the messages.
import { parseRoutinePackage, RoutineFormatError, SECRET_PLACEHOLDER, usesEntries, type RoutinePackage } from './format';
import { checkTestDbTarget, type RecognisedTestDb } from './testdb-guard';

export interface PreflightIssue { path: string; message: string; fix: string; /** a secret only the user can type */ secret?: true }
export interface PreflightResult {
  ok: boolean;
  /** each one stops the package from running */
  errors: PreflightIssue[];
  /** it runs, but probably not as meant */
  warnings: PreflightIssue[];
  /** the validated package when the format check passed */
  pkg?: RoutinePackage;
}
export interface PreflightOptions {
  /** the host's recognised test databases (the app's test DB configuration); without it the name rule applies */
  recognisedTestDbs?: readonly RecognisedTestDb[];
}

/** Placeholders the runtime fills by itself (runtime.ts fillPlaceholders). */
const BUILTIN = new Set(['workItem', 'work-item-id', 'work-item-url']);
/** Inputs the runtime fills for a package with entries or retrigger tags (ADR 0323): the entry's name and the folder
 *  of the previous run of the same work item. */
const TAGGED = new Set(['entry', 'previousRun']);
const foldTag = (t: string): string => t.normalize('NFKC').trim().toLowerCase();
/** The app's role names: a package step is a plain Claude Code session, never a role (ADR 0175 item 2). */
const ROLE = /\b(Orchestrator|Strategist|Scout|Artisan|Sentinel|Herald)\b/;
/** App-only MCP tools and servers a plain session does not have. */
const APP_TOOL = /\b(agent_[a-z_]+|flow_(?:intake|output|verdict|devops_write|downgrade|step_history|test_db_query|pr_build_status)|app_(?:flow|guide|state|chats|ui|config|send_to_chat|screenshot)\w*|handoff_to_user|browser_login|show_ui|memory_propose|mcp__second-brain__\w*)\b/;
/** MCP servers the runtime adds by itself (devops-mcp.ts, testdb-mcp.ts). */
const RUNTIME_SERVERS = new Set(['routine-devops', 'routine-testdb', 'routine-browser']);

/** Hints for the format errors authors hit most, by the field name in the validator's message. */
function formatFix(message: string): string {
  // entries and retrigger tags (ADR 0323): the fix shows the whole shape, whatever part of it is wrong
  if (/^entries\[\d+\]\.startStep/.test(message)) return 'Use the id of one of routine.steps: the step a run of this entry starts from.';
  if (/^entries\[\d+\]\.when/.test(message)) return 'Write when as { "tag": "<one DevOps tag>" }, e.g. { "tag": "ai-retest" }.';
  if (/^entries/.test(message)) return 'Write entries as [{ "name": "retest", "when": { "tag": "ai-retest" }, "startStep": "<step id>" }]: a name of its own each ("default" is the first step).';
  if (/^trigger\.retriggerTags/.test(message)) return 'List one or more DevOps tags, each once and without ";", e.g. ["ai-retest"]; or leave retriggerTags out.';
  const unknown = /unknown field "([^"]+)"/.exec(message)?.[1];
  if (unknown && ['role', 'roleId', 'tier', 'engine', 'agentPrompt', 'kind'].includes(unknown))
    return `Remove "${unknown}": a step is a plain Claude Code session (prompt, optional model, effort, allowedTools, mcpServers, testDbs, timeoutMs, maxAttempts).`;
  if (unknown && ['adapter', 'action', 'writeVia', 'connector', 'effect', 'browserTargets'].includes(unknown))
    return `Remove "${unknown}": DevOps writes go in step-result.json devopsWrites (granted by routine.devops); a browser or other tool is an MCP server in routine.mcpServers.`;
  if (unknown) return `Remove "${unknown}" or move it where the format expects it (docs/routines/authoring.md, "Package fields").`;
  if (message.startsWith('routine.json: format')) return 'Start the file with "format": "second-brain-routine", "schemaVersion": 1.';
  if (/escalation\.contact/.test(message)) return 'Use the DevOps identity id (GUID) of the person to mention, not a name or an e-mail.';
  if (/testDbs\[\d+\]: looks like a production/.test(message)) return 'Production databases are never allowed: point it at a test database.';
  if (/testDbs\[\d+\]: not recognisable/.test(message)) return 'Use a test server/database (name with test, dev, qa...) or one the host recognises.';
  if (/is not declared/.test(message)) return 'Declare it at routine level (routine.mcpServers or routine.testDbs) or remove it from the step.';
  return 'Correct this field (docs/routines/authoring.md, "Package fields").';
}

const pathOf = (message: string): string => message.split(':')[0] ?? 'routine.json';

/** Checks a parsed routine.json (or an object meant to become one) before a run or before saving it. Never throws. */
export function preflightRoutinePackage(value: unknown, options: PreflightOptions = {}): PreflightResult {
  const errors: PreflightIssue[] = [], warnings: PreflightIssue[] = [];
  let pkg: RoutinePackage;
  try { pkg = parseRoutinePackage(value); } catch (e) {
    if (!(e instanceof RoutineFormatError)) throw e;
    return { ok: false, errors: [{ path: pathOf(e.message), message: e.message, fix: formatFix(e.message) }], warnings };
  }
  const r = pkg.routine;
  const err = (path: string, message: string, fix: string) => errors.push({ path, message, fix });
  const missing = (path: string, what: string) => errors.push({ path, message: `${what} not set yet`, fix: 'The user types it in the routine\'s Credenziali (app) or in routine.json (terminal); never in a chat.', secret: true });
  const warn = (path: string, message: string, fix: string) => warnings.push({ path, message, fix });
  const inputs = new Set(r.inputs.map(i => i.name));
  const hasWorkItem = Boolean(r.trigger) || inputs.has('workItem');
  const tagged = usesEntries(r);

  r.steps.forEach((s, i) => {
    const at = `steps[${i}]`;
    for (const m of s.prompt.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)) {
      const name = m[1]!.startsWith('input.') ? m[1]!.slice(6) : m[1]!;
      if (tagged && TAGGED.has(name)) continue;
      if (!BUILTIN.has(name) && !inputs.has(name)) err(`${at}.prompt`, `{{${m[1]}}} is not an input`, `Add { "name": "${name}" } to routine.inputs, or remove the placeholder.`);
      if (BUILTIN.has(name) && !hasWorkItem) err(`${at}.prompt`, `{{${m[1]}}} needs a work item, but the routine has no trigger and no workItem input`, 'Add { "name": "workItem", "label": "DevOps work item id" } to routine.inputs.');
    }
    const role = ROLE.exec(s.prompt) ?? ROLE.exec(s.title);
    if (role) err(`${at}.prompt`, `mentions the app role "${role[1]}"`, 'A step is a plain Claude Code session: describe the work itself, without app roles.');
    const tool = APP_TOOL.exec(s.prompt);
    if (tool) err(`${at}.prompt`, `uses the app-only tool "${tool[1]}"`, 'Steps finish by writing step-result.json (the runtime appends how); DevOps writes go in its devopsWrites; logins are done by the runtime.');
    for (const [j, t] of (s.allowedTools ?? []).entries()) {
      if (APP_TOOL.test(t)) err(`${at}.allowedTools[${j}]`, `"${t}" is an app-only tool`, 'Remove it: package sessions get only Claude Code tools and the package\'s MCP servers.');
      const server = /^mcp__(.+?)__/.exec(t)?.[1];
      if (server && !RUNTIME_SERVERS.has(server) && !(s.mcpServers ?? []).includes(server))
        err(`${at}.allowedTools[${j}]`, `"${t}" belongs to MCP server "${server}", which this step does not get`, `Add "${server}" to ${at}.mcpServers (declared in routine.mcpServers) or remove the tool.`);
    }
  });

  for (const [name, server] of Object.entries(r.mcpServers ?? {})) {
    if (RUNTIME_SERVERS.has(name)) err(`mcpServers.${name}`, `"${name}" is reserved for the runtime's own server`, 'Rename it; the runtime adds routine-devops, routine-testdb and routine-browser by itself.');
    const line = [server.command, ...(server.args ?? [])].join(' ');
    if (/second-brain|\/mcp\/app\b|127\.0\.0\.1:43[12]9/i.test(line)) err(`mcpServers.${name}`, 'points at the second-brain app', 'A package must run without the app: use a standalone MCP server; the browser is the runtime\'s own routine-browser.');
    if (!r.steps.some(s => s.mcpServers?.includes(name))) warn(`mcpServers.${name}`, 'no step uses it', 'Add it to the mcpServers of the steps that need it, or remove it.');
  }

  if (r.trigger) {
    if (!r.devops) warn('trigger', 'the routine is started from DevOps but may not write anything back', 'Add routine.devops (organization, projects, ops) if the steps should comment, change state, fields or tags.');
    else {
      if (r.devops.organization.toLowerCase() !== r.trigger.organization.toLowerCase()) err('devops.organization', `differs from trigger.organization "${r.trigger.organization}"`, 'Writes go to the run\'s work item: use the trigger\'s organization.');
      for (const project of new Set([r.trigger.project, ...(r.trigger.areas ?? []).map(a => a.project)]))
        if (!r.devops.projects.some(p => p.toLowerCase() === project.toLowerCase())) err('devops.projects', `does not include the trigger project "${project}"`, `Add "${project}" to devops.projects.`);
    }
    if (!r.trigger.states.length) err('trigger.states', 'no state to watch', 'List the states that start a run, e.g. ["New"].');
    if (!r.trigger.includeTags?.length && !r.trigger.workItemIds?.length) warn('trigger', 'every work item of that type and state starts a run', 'Narrow it with includeTags (e.g. ["ai-fixable"]) or workItemIds.');
  }
  // entries and retrigger tags (ADR 0323)
  if (tagged) r.inputs.forEach((input, i) => {
    if (TAGGED.has(input.name)) err(`inputs[${i}].name`, `"${input.name}" is filled by the runtime in a package with entries or retrigger tags`, 'Rename the input: steps read {{entry}} (the entry\'s name) and {{previousRun}} (the folder of the previous run of the work item) as they are.');
  });
  (r.entries ?? []).forEach((e, i) => {
    const same = r.entries!.findIndex(x => foldTag(x.when.tag) === foldTag(e.when.tag));
    if (same < i) err(`entries[${i}].when.tag`, `the same tag as entries[${same}], which is always chosen first`, 'Give each entry its own tag, or remove this entry.');
    if (e.startStep === r.steps[0]!.id) warn(`entries[${i}].startStep`, 'is the first step: the same start as the default entry', 'Name a later step, or remove the entry if only its name is not needed by the steps.');
  });
  if (r.entries?.length) {
    if (!hasWorkItem) err('entries', 'an entry is chosen from the work item\'s tags, but the routine has no trigger and no workItem input', 'Add { "name": "workItem", "label": "DevOps work item id" } to routine.inputs (or a trigger), or remove entries.');
    else if (!r.trigger && !r.devops) err('entries', 'an entry is chosen from the work item\'s tags, but the package names no DevOps organization to read them from', 'Add routine.devops { organization, projects, ops } or a trigger.');
  }
  const retags = r.trigger?.retriggerTags ?? [];
  if (r.trigger && retags.length) {
    if (!r.devops?.ops.includes('tags')) err('trigger.retriggerTags', 'the runtime takes the retrigger tag off the work item when the run starts, but the package may not write tags', r.devops ? 'Add "tags" to devops.ops.' : 'Add routine.devops { organization, projects, ops: ["tags"], fields: [] }.');
    const include = new Set([...(r.trigger.includeTags ?? []), ...(r.trigger.areas ?? []).flatMap(a => a.includeTags ?? [])].map(foldTag));
    retags.forEach((t, i) => {
      if (include.has(foldTag(t))) err(`trigger.retriggerTags[${i}]`, `"${t}" is also in includeTags: every item would run a second time as soon as its first run ends`, 'Use a tag of its own that a person adds to ask for another run, e.g. "ai-retest".');
      if (r.devops?.downgrade && foldTag(r.devops.downgrade.addTag) === foldTag(t)) err(`trigger.retriggerTags[${i}]`, `"${t}" is the tag a downgraded or parked item gets (devops.downgrade.addTag): it would start again at once`, 'Use a tag of its own that a person adds to ask for another run, e.g. "ai-retest".');
    });
    if (!(r.entries ?? []).some(e => retags.some(t => foldTag(t) === foldTag(e.when.tag)))) warn('trigger.retriggerTags', 'no entry is chosen by a retrigger tag: an item started again runs every step from the first', 'Add routine.entries [{ "name": "retest", "when": { "tag": "<the retrigger tag>" }, "startStep": "<step id>" }], or leave it so if the whole routine must run again.');
  }
  if (r.devops) {
    if (r.devops.ops.includes('fields') && !r.devops.fields.length) err('devops.fields', 'the "fields" op is granted but no field is listed', 'List the field reference names steps may set (e.g. "Microsoft.VSTS.Common.Priority"), or drop "fields" from devops.ops.');
    if (!hasWorkItem) err('devops', 'DevOps writes need a run about a work item, but the routine has no trigger and no workItem input', 'Add { "name": "workItem", "label": "DevOps work item id" } to routine.inputs (or a trigger).');
    const ops = r.devops.ops;
    if (ops.includes('git-push') && !r.devops.pushTargets?.length) err('devops.pushTargets', 'the "git-push" op is granted but no push target is listed', 'Add { "project", "repositoryId", "workspaceInput" } (the input naming the local checkout), or drop "git-push".');
    for (const [i, t] of (r.devops.pushTargets ?? []).entries()) if (!r.inputs.some(x => x.name === t.workspaceInput)) err(`devops.pushTargets[${i}].workspaceInput`, `"${t.workspaceInput}" is not one of routine.inputs`, 'Add that input (the local checkout path the run pushes from).');
    for (const op of ['test-deploy', 'pr-validation', 'test-environment'] as const) if (ops.includes(op) && !r.devops.deployTargets?.length) err('devops.deployTargets', `the "${op}" op is granted but no deploy target is listed`, `Add the test target (the app's deploy target shape), or drop "${op}".`);
    if ((ops.includes('test-deploy') || ops.includes('pr-validation')) && !ops.includes('pr-create')) warn('devops.ops', 'test deployments and PR validation work on the run own PR, but "pr-create" is not granted', 'Add "pr-create" (and "git-push") so a run can create the PR it deploys.');
    if (ops.includes('pr-comment') && !r.devops.mentions?.length) warn('devops.mentions', 'PR comments may not @mention anybody', 'List the identity GUIDs a PR comment may mention, if any.');
    if (ops.includes('downgrade') && !r.escalation && !r.devops.mentions?.length) warn('devops.downgrade', 'the downgrade comment mentions nobody', 'Add escalation.contact or devops.mentions so a person is notified.');
    if (!pkg.secrets?.devopsPat) warn('secrets.devopsPat', 'no PAT: DevOps calls use the Azure CLI login of the machine that runs it', 'Embed a PAT (Work Items read & write) if it must run on a machine without az login.');
  }
  if (r.escalation?.park && !r.devops?.ops.includes('downgrade')) err('escalation.park', 'parking a run needs the downgrade op (its tag and state mark the parked item)', 'Add "downgrade" to devops.ops and devops.downgrade, or drop escalation.park.');
  if ((r.devops || r.trigger) && !r.escalation) warn('escalation', 'a step that needs a person ends the run', 'Add escalation.contact (the DevOps identity GUID to mention) so the runtime asks on the work item and waits.');
  if (r.escalation && !hasWorkItem) err('escalation', 'escalation asks on the work item, but the routine has no trigger and no workItem input', 'Add the workItem input or remove escalation.');

  const credentials = pkg.credentials ?? [];
  const loginKey = (u: string) => { const x = new URL(u); return `${x.origin}${x.pathname.replace(/\/+$/, '')}`.toLowerCase(); };
  const seen = new Map<string, number>();
  credentials.forEach((c, i) => {
    // a second login of the same page needs its own id (the first one of a page is the default login)
    const key = loginKey(c.loginUrl), idKey = `id:${c.id}`;
    if (c.id && seen.has(idKey)) err(`credentials[${i}].id`, `the same id as credentials[${seen.get(idKey)}]`, 'Give each credential its own id.');
    else if (!c.id && seen.has(key)) err(`credentials[${i}].loginUrl`, `the same login page as credentials[${seen.get(key)}]`, 'Give each further login of a page its own "id" (the first one stays the default); the runtime could not tell them apart.');
    if (!seen.has(key)) seen.set(key, i);
    if (c.id) seen.set(idKey, i);
    if (c.password === SECRET_PLACEHOLDER) missing(`credentials[${i}].password`, `the password for ${c.loginUrl}`);
  });
  (r.loginSuccess ?? []).forEach((l, i) => {
    if (!credentials.some(c => loginKey(c.loginUrl) === loginKey(l.loginUrl))) err(`loginSuccess[${i}].loginUrl`, 'no credential has this login page', 'Add credentials[] with the exact same loginUrl (query included, e.g. ?mode=local), or remove the rule.');
    else if (!credentials.some(c => c.loginUrl === l.loginUrl)) warn(`loginSuccess[${i}].loginUrl`, 'matches a credential only without its query', 'Use the exact same loginUrl string, query included, in both places.');
  });
  if (r.browser) {
    if (!r.steps.some(s => s.browser)) warn('browser', 'no step uses the browser', 'Add "browser": true to the steps that open the site, or remove routine.browser.');
    credentials.forEach((c, i) => {
      if (!r.browser!.origins.includes(new URL(c.loginUrl).origin)) warn(`credentials[${i}].loginUrl`, `its origin is not in browser.origins, so the browser never logs in with it`, `Add "${new URL(c.loginUrl).origin}" to routine.browser.origins, or remove the credential.`);
    });
  }
  if (pkg.secrets?.devopsPat === SECRET_PLACEHOLDER) missing('secrets.devopsPat', 'the DevOps PAT');
  for (const [i, c] of credentials.entries()) for (const s of r.steps) if (c.password !== SECRET_PLACEHOLDER && s.prompt.includes(c.password)) err(`steps.${s.id}.prompt`, `contains the password of credentials[${i}]`, 'Never put a secret in a prompt: the runtime logs in with the embedded credential.');

  for (const [i, db] of (r.testDbs ?? []).entries()) {
    const refused = checkTestDbTarget(db, options.recognisedTestDbs);
    if (refused) err(`testDbs[${i}]`, refused, 'Point it at a test database this host recognises; production is never allowed.');
    const login = pkg.secrets?.testDbs?.[db.id];
    if (!login) err(`secrets.testDbs.${db.id}`, 'no login for this test database', `Add secrets.testDbs.${db.id} = { "user": "<read-only test login>", "password": "${SECRET_PLACEHOLDER}" }.`);
    else if (login.password === SECRET_PLACEHOLDER) missing(`secrets.testDbs.${db.id}.password`, `the password of test database ${db.id}`);
    if (!r.steps.some(s => s.testDbs?.includes(db.id))) warn(`testDbs[${i}]`, 'no step reads it', 'Add its id to the testDbs of the steps that need it, or remove it.');
  }
  return { ok: !errors.length, errors, warnings, pkg };
}

/** The issues as short lines, for a terminal or a tool result. */
export function formatPreflight(result: PreflightResult): string {
  const line = (kind: string) => (i: PreflightIssue) => `${kind} ${i.path}: ${i.message}. Fix: ${i.fix}`;
  return [...result.errors.map(line('error')), ...result.warnings.map(line('warning'))].join('\n') || 'preflight ok';
}
