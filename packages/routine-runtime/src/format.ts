// The routine package format (ADR 0175, 0176): `routine.json` in a folder, readable with no app and no brain. It is the
// contract for every later tool (the terminal CLI, the Routine UI, routine authoring): `parseRoutinePackage`
// validates it, `loadRoutinePackage` reads a folder, `convertFlowToPackage` migrates the app's JSON export
// (`second-brain-flow`) with its agent roles dropped. Embedded secrets (site logins, DevOps PAT, test DB logins) are
// allowed here only and are masked by the runtime everywhere they could be written.
import fs from 'node:fs';
import path from 'node:path';
import type { LoginSuccessRule } from './login-form';
import { refuseNeverAllowed } from './testdb-guard';
import { validateDeployTarget } from './devops-host/test-deployment';
import type { TestDeployTarget } from '../../../src/shared/flow-automation';

export const ROUTINE_FORMAT = 'second-brain-routine';
export const ROUTINE_FILE = 'routine.json';
/** What a package carries where a secret goes until its host fills it (the app) or the user types it. */
export const SECRET_PLACEHOLDER = '<set-by-user>';
const MAX_BYTES = 4 * 1024 * 1024;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** The write categories a package may grant; each step-result write op belongs to one (step-result.ts WRITE_CATEGORY). */
export const DEVOPS_OPS = ['comment', 'state', 'fields', 'tags', 'test-plans', 'test-results', 'pr-create', 'pr-links', 'related-links', 'pr-comment', 'pr-publish', 'pr-abandon', 'git-push', 'test-deploy', 'pr-validation', 'test-environment', 'downgrade', 'attachments'] as const;
export type RoutineDevOpsOp = typeof DEVOPS_OPS[number];

/** A run input; steps read it as {{name}}. `workItem` is the DevOps work item a run is about. */
export interface RoutineInput { name: string; label?: string; required?: boolean; default?: string }
export interface RoutineStep {
  id: string; title: string;
  /** the whole session prompt; {{input}} placeholders are filled at run time */
  prompt: string;
  model?: string; effort?: Effort;
  /** Claude Code --allowedTools entries */
  allowedTools?: string[];
  /** names of `mcpServers` this step's session gets */
  mcpServers?: string[];
  /** ids of `testDbs` this step may read (through the runtime's own MCP server) */
  testDbs?: string[];
  /** the step's session gets the runtime's browser (`routine-browser` MCP server, origins from `routine.browser`) */
  browser?: true;
  /** default 30 minutes */
  timeoutMs?: number;
  /** default 2 */
  maxAttempts?: number;
  /** review→fix: a done step may send the run back to the earlier step `to` (its result's `sendBack`), at most `max`
   *  times per run (default 2); past it the step needs a person */
  loop?: { to: string; max?: number };
}
/** The DevOps trigger rule (the app's FlowTrigger devops shape). */
export interface RoutineTrigger {
  kind: 'devops'; everyMinutes: number; organization: string; project: string; areaPath: string; workItemType: string;
  states: string[]; includeExisting: boolean;
  includeTags?: string[]; excludeTags?: string[]; workItemIds?: number[]; iterationPath?: string; maxPerHour?: number;
}
/** What step results may write on the run's work item; anything else is refused by the runtime. */
export interface RoutineDevOps {
  organization: string; projects: string[]; ops: RoutineDevOpsOp[]; fields: string[];
  /** DevOps identity ids (lowercase GUIDs) a work item comment, a PR comment or the downgrade comment may @mention */
  mentions?: string[];
  /** git-push: the only repository a run may publish its branch to, and the input naming the local checkout */
  pushTargets?: { project: string; repositoryId: string; workspaceInput: string }[];
  /** test-deploy / pr-validation / test-environment: the exact test targets (the app's TestDeployTarget shape) */
  deployTargets?: TestDeployTarget[];
  /** downgrade: what handing the item back to a person does (tag removed, tag added, state) */
  downgrade?: { removeTag: string; addTag: string; state: string };
}
/** Who is asked on DevOps when a step needs a person: a DevOps identity id (lowercase GUID). */
export interface RoutineEscalation { contact: string; contactName?: string; pollMinutes?: number; reminderMinutes?: number }
/** The runtime's browser (ADR 0175): the only origins its pages may open; logins come from `credentials`. `hide` =
 *  CSS selectors of overlays (a chat widget) the runtime hides on every page, so they never cover what a step clicks. */
export interface RoutineBrowser { origins: string[]; hide?: string[] }
export interface RoutineMcpServer { command: string; args?: string[]; env?: Record<string, string> }
/** A read-only SQL Server test target; its login is in `secrets.testDbs[id]`. */
export interface RoutineTestDb { id: string; server: string; port?: number; database: string; confirmedTestDatabase?: true }
export interface RoutineDefinition {
  id: string; title: string; description: string;
  inputs: RoutineInput[]; steps: RoutineStep[];
  trigger?: RoutineTrigger; devops?: RoutineDevOps; escalation?: RoutineEscalation;
  mcpServers?: Record<string, RoutineMcpServer>;
  testDbs?: RoutineTestDb[];
  browser?: RoutineBrowser;
  /** the login success rule per loginUrl (absent: the URL left the login page's path) */
  loginSuccess?: { loginUrl: string; success: LoginSuccessRule }[];
}
/** A site login: the same shape as the app's JSON export (PortableCredential). `id` names it for the browser's
 *  `login` / `fill_secret` tools: a second user of the same login page (the first one of a page is its default login). */
export interface PackageCredential { id?: string; loginUrl: string; user: string; password: string }
export interface PackageSecrets { devopsPat?: string; testDbs?: Record<string, { user: string; password: string }> }
export interface PackageFile { kind: 'script' | 'query' | 'asset'; ref: string; content: string }
export interface RoutinePackage {
  format: typeof ROUTINE_FORMAT; schemaVersion: 1;
  routine: RoutineDefinition;
  files?: PackageFile[];
  credentials?: PackageCredential[];
  secrets?: PackageSecrets;
}

export class RoutineFormatError extends Error {}
const fail = (message: string): never => { throw new RoutineFormatError(message); };
type Obj = Record<string, unknown>;
const obj = (v: unknown, what: string): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : fail(`${what}: expected an object`);
const only = (v: Obj, allowed: string[], what: string): void => { for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(`${what}: unknown field "${k}"`); };
const str = (v: unknown, what: string, max = 256, empty = false): string => typeof v === 'string' && (empty || v.trim()) && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v) ? v : fail(`${what}: expected text up to ${max} characters`);
const id = (v: unknown, what: string): string => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(str(v, what, 64)) ? v as string : fail(`${what}: letters, digits, - and _ only`);
const int = (v: unknown, what: string, min: number, max: number): number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? v as number : fail(`${what}: expected an integer ${min}-${max}`);
const list = (v: unknown, what: string, max = 64): unknown[] => Array.isArray(v) && v.length <= max ? v : fail(`${what}: expected a list of at most ${max}`);
const strs = (v: unknown, what: string, max = 64): string[] => list(v, what, max).map((s, i) => str(s, `${what}[${i}]`));
const opt = <T>(v: Obj, key: string, read: (value: unknown) => T): Partial<Record<string, T>> => v[key] === undefined ? {} : { [key]: read(v[key]) };
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ORG = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,49}$/;

function step(v: unknown, i: number): RoutineStep {
  const what = `steps[${i}]`, s = obj(v, what);
  only(s, ['id', 'title', 'prompt', 'model', 'effort', 'allowedTools', 'mcpServers', 'testDbs', 'browser', 'timeoutMs', 'maxAttempts', 'loop'], what);
  return {
    id: id(s.id, `${what}.id`), title: str(s.title, `${what}.title`, 200), prompt: str(s.prompt, `${what}.prompt`, 100_000),
    ...opt(s, 'model', m => str(m, `${what}.model`, 100)),
    ...opt(s, 'effort', e => EFFORTS.includes(e as Effort) ? e as Effort : fail(`${what}.effort: one of ${EFFORTS.join(', ')}`)),
    ...opt(s, 'allowedTools', t => strs(t, `${what}.allowedTools`)),
    ...opt(s, 'mcpServers', t => strs(t, `${what}.mcpServers`, 16)),
    ...opt(s, 'testDbs', t => strs(t, `${what}.testDbs`, 16)),
    ...opt(s, 'browser', b => b === true ? true as const : fail(`${what}.browser: true or absent`)),
    ...opt(s, 'timeoutMs', t => int(t, `${what}.timeoutMs`, 10_000, 24 * 3_600_000)),
    ...opt(s, 'maxAttempts', t => int(t, `${what}.maxAttempts`, 1, 10)),
    ...opt(s, 'loop', l => { const o = obj(l, `${what}.loop`); only(o, ['to', 'max'], `${what}.loop`); return { to: id(o.to, `${what}.loop.to`), ...opt(o, 'max', m => int(m, `${what}.loop.max`, 1, 10)) }; }),
  } as RoutineStep;
}

export function parseTrigger(v: unknown): RoutineTrigger {
  const t = obj(v, 'trigger');
  only(t, ['kind', 'everyMinutes', 'organization', 'project', 'areaPath', 'workItemType', 'states', 'includeExisting', 'includeTags', 'excludeTags', 'workItemIds', 'iterationPath', 'maxPerHour'], 'trigger');
  if (t.kind !== 'devops') fail('trigger.kind: only "devops"');
  const organization = str(t.organization, 'trigger.organization', 50);
  if (!ORG.test(organization)) fail('trigger.organization: invalid');
  if (typeof t.includeExisting !== 'boolean') fail('trigger.includeExisting: expected true or false');
  return {
    kind: 'devops', everyMinutes: int(t.everyMinutes, 'trigger.everyMinutes', 1, 1440), organization,
    project: str(t.project, 'trigger.project', 128), areaPath: str(t.areaPath, 'trigger.areaPath', 512),
    workItemType: str(t.workItemType, 'trigger.workItemType', 128), states: strs(t.states, 'trigger.states', 32),
    includeExisting: t.includeExisting as boolean,
    ...opt(t, 'includeTags', x => strs(x, 'trigger.includeTags')), ...opt(t, 'excludeTags', x => strs(x, 'trigger.excludeTags')),
    ...opt(t, 'workItemIds', x => list(x, 'trigger.workItemIds', 500).map((n, i) => int(n, `trigger.workItemIds[${i}]`, 1, Number.MAX_SAFE_INTEGER))),
    ...opt(t, 'iterationPath', x => str(x, 'trigger.iterationPath', 512)), ...opt(t, 'maxPerHour', x => int(x, 'trigger.maxPerHour', 1, 1000)),
  } as RoutineTrigger;
}

function devops(v: unknown): RoutineDevOps {
  const d = obj(v, 'devops'); only(d, ['organization', 'projects', 'ops', 'fields', 'mentions', 'pushTargets', 'deployTargets', 'downgrade'], 'devops');
  const organization = str(d.organization, 'devops.organization', 50);
  if (!ORG.test(organization)) fail('devops.organization: invalid');
  const ops = strs(d.ops, 'devops.ops', DEVOPS_OPS.length);
  for (const op of ops) if (!(DEVOPS_OPS as readonly string[]).includes(op)) fail(`devops.ops: "${op}" is not one of ${DEVOPS_OPS.join(', ')}`);
  const projects = strs(d.projects, 'devops.projects', 16);
  const inProjects = (p: string) => projects.some(x => x.toLowerCase() === p.toLowerCase());
  const mentions = d.mentions === undefined ? undefined : strs(d.mentions, 'devops.mentions', 10).map((m, i) => GUID.test(m.toLowerCase()) ? m.toLowerCase() : fail(`devops.mentions[${i}]: a DevOps identity id (GUID)`));
  const pushTargets = d.pushTargets === undefined ? undefined : list(d.pushTargets, 'devops.pushTargets', 4).map((x, i) => {
    const what = `devops.pushTargets[${i}]`, t = obj(x, what); only(t, ['project', 'repositoryId', 'workspaceInput'], what);
    const project = str(t.project, `${what}.project`, 128), repositoryId = str(t.repositoryId, `${what}.repositoryId`, 36).toLowerCase();
    if (!inProjects(project)) fail(`${what}.project: not one of devops.projects`);
    if (!GUID.test(repositoryId)) fail(`${what}.repositoryId: a repository id (GUID)`);
    return { project, repositoryId, workspaceInput: id(t.workspaceInput, `${what}.workspaceInput`) };
  });
  const deployTargets = d.deployTargets === undefined ? undefined : list(d.deployTargets, 'devops.deployTargets', 8).map((x, i) => {
    let target: TestDeployTarget;
    try { target = validateDeployTarget(x); } catch (e) { return fail(`devops.deployTargets[${i}]: ${e instanceof Error ? e.message : String(e)}`); }
    if (target.organization.toLowerCase() !== organization.toLowerCase() || !inProjects(target.project)) fail(`devops.deployTargets[${i}]: outside devops.organization / devops.projects`);
    return target;
  });
  if (deployTargets && new Set(deployTargets.map(t => t.id)).size !== deployTargets.length) fail('devops.deployTargets: duplicate id');
  let downgrade: RoutineDevOps['downgrade'];
  if (d.downgrade !== undefined) {
    const g = obj(d.downgrade, 'devops.downgrade'); only(g, ['removeTag', 'addTag', 'state'], 'devops.downgrade');
    downgrade = { removeTag: str(g.removeTag, 'devops.downgrade.removeTag', 100), addTag: str(g.addTag, 'devops.downgrade.addTag', 100), state: str(g.state, 'devops.downgrade.state', 128) };
  }
  if (ops.includes('downgrade') && !downgrade) fail('devops.downgrade: needed with the downgrade op');
  return {
    organization, projects, ops: ops as RoutineDevOpsOp[], fields: strs(d.fields ?? [], 'devops.fields', 64),
    ...(mentions ? { mentions } : {}), ...(pushTargets ? { pushTargets } : {}), ...(deployTargets ? { deployTargets } : {}), ...(downgrade ? { downgrade } : {}),
  };
}

function escalation(v: unknown): RoutineEscalation {
  const e = obj(v, 'escalation'); only(e, ['contact', 'contactName', 'pollMinutes', 'reminderMinutes'], 'escalation');
  const contact = str(e.contact, 'escalation.contact', 64).toLowerCase();
  if (!GUID.test(contact)) fail('escalation.contact: a DevOps identity id (GUID)');
  return { contact, ...opt(e, 'contactName', n => str(n, 'escalation.contactName', 120)), ...opt(e, 'pollMinutes', n => int(n, 'escalation.pollMinutes', 1, 1440)),
    ...opt(e, 'reminderMinutes', n => int(n, 'escalation.reminderMinutes', 0, 10_080)) } as RoutineEscalation;
}

function successRule(v: unknown, what: string): LoginSuccessRule {
  const r = obj(v, what);
  if ('urlNotContaining' in r) { only(r, ['urlNotContaining'], what); return { urlNotContaining: str(r.urlNotContaining, `${what}.urlNotContaining`, 512) }; }
  only(r, ['selector'], what); return { selector: str(r.selector, `${what}.selector`, 512) };
}

function url(v: unknown, what: string): string {
  const s = str(v, what, 2048);
  try { const u = new URL(s); if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(`${what}: http(s) only`); } catch (e) { if (e instanceof RoutineFormatError) throw e; fail(`${what}: not a URL`); }
  return s;
}

/** `browser.origins`: http(s) origins only (scheme://host[:port], no path), at least one; `browser.hide`: plain selectors. */
function browserRule(v: unknown): RoutineBrowser {
  const b = obj(v, 'browser'); only(b, ['origins', 'hide'], 'browser');
  const origins = strs(b.origins, 'browser.origins', 16).map((o, i) => {
    const u = url(o, `browser.origins[${i}]`);
    const origin = new URL(u).origin;
    if (origin !== u.replace(/\/$/, '')) fail(`browser.origins[${i}]: an origin only, e.g. https://host.example (no path)`);
    return origin;
  });
  if (!origins.length) fail('browser.origins: at least one origin');
  const hide = b.hide === undefined ? [] : strs(b.hide, 'browser.hide', 16).map((h, i) => {
    // a selector only: no braces, comments or tags, so it cannot add CSS rules of its own
    if (!h.trim() || h.length > 200 || /[{}<>;]|\/\*/.test(h)) fail(`browser.hide[${i}]: a CSS selector, e.g. #draggable`);
    return h.trim();
  });
  return { origins: [...new Set(origins)], ...(hide.length ? { hide } : {}) };
}

export function parseRoutineDefinition(v: unknown): RoutineDefinition {
  const r = obj(v, 'routine');
  only(r, ['id', 'title', 'description', 'inputs', 'steps', 'trigger', 'devops', 'escalation', 'mcpServers', 'testDbs', 'browser', 'loginSuccess'], 'routine');
  const steps = list(r.steps, 'steps', 50).map(step);
  if (!steps.length) fail('steps: at least one step');
  if (new Set(steps.map(s => s.id)).size !== steps.length) fail('steps: duplicate step id');
  steps.forEach((s, i) => { if (s.loop && !steps.slice(0, i).some(x => x.id === s.loop!.to)) fail(`steps[${i}].loop.to: an earlier step id`); });
  const inputs = list(r.inputs ?? [], 'inputs', 32).map((x, i) => {
    const p = obj(x, `inputs[${i}]`); only(p, ['name', 'label', 'required', 'default'], `inputs[${i}]`);
    return { name: id(p.name, `inputs[${i}].name`), ...opt(p, 'label', l => str(l, `inputs[${i}].label`, 120)),
      ...opt(p, 'required', b => typeof b === 'boolean' ? b : fail(`inputs[${i}].required: true or false`)), ...opt(p, 'default', d => str(d, `inputs[${i}].default`, 2000, true)) } as RoutineInput;
  });
  const mcpServers = r.mcpServers === undefined ? undefined : Object.fromEntries(Object.entries(obj(r.mcpServers, 'mcpServers')).map(([name, server]) => {
    const s = obj(server, `mcpServers.${name}`); only(s, ['command', 'args', 'env'], `mcpServers.${name}`);
    id(name, 'mcpServers name');
    return [name, { command: str(s.command, `mcpServers.${name}.command`, 1024), ...opt(s, 'args', a => strs(a, `mcpServers.${name}.args`)),
      ...opt(s, 'env', e => Object.fromEntries(Object.entries(obj(e, `mcpServers.${name}.env`)).map(([k, x]) => [k, str(x, `mcpServers.${name}.env.${k}`, 4096, true)]))) } as RoutineMcpServer];
  }));
  const testDbs = r.testDbs === undefined ? undefined : list(r.testDbs, 'testDbs', 16).map((x, i) => {
    const t = obj(x, `testDbs[${i}]`); only(t, ['id', 'server', 'port', 'database', 'confirmedTestDatabase'], `testDbs[${i}]`);
    const target: RoutineTestDb = { id: id(t.id, `testDbs[${i}].id`), server: str(t.server, `testDbs[${i}].server`, 253), database: str(t.database, `testDbs[${i}].database`, 128),
      ...(t.port === undefined ? {} : { port: int(t.port, `testDbs[${i}].port`, 1, 65535) }), ...(t.confirmedTestDatabase === true ? { confirmedTestDatabase: true as const } : {}) };
    const refused = refuseNeverAllowed(target);
    if (refused) fail(`testDbs[${i}]: ${refused}`);
    return target;
  });
  const definition: RoutineDefinition = {
    id: id(r.id, 'routine.id'), title: str(r.title, 'routine.title', 200), description: str(r.description ?? '', 'routine.description', 4000, true),
    inputs, steps,
    ...(r.trigger === undefined ? {} : { trigger: parseTrigger(r.trigger) }),
    ...(r.devops === undefined ? {} : { devops: devops(r.devops) }),
    ...(r.escalation === undefined ? {} : { escalation: escalation(r.escalation) }),
    ...(mcpServers ? { mcpServers } : {}), ...(testDbs ? { testDbs } : {}),
    ...(r.browser === undefined ? {} : { browser: browserRule(r.browser) }),
    ...(r.loginSuccess === undefined ? {} : { loginSuccess: list(r.loginSuccess, 'loginSuccess', 32).map((x, i) => {
      const l = obj(x, `loginSuccess[${i}]`); only(l, ['loginUrl', 'success'], `loginSuccess[${i}]`);
      return { loginUrl: url(l.loginUrl, `loginSuccess[${i}].loginUrl`), success: successRule(l.success, `loginSuccess[${i}].success`) };
    }) }),
  };
  for (const s of steps) {
    for (const name of s.mcpServers ?? []) if (!mcpServers?.[name]) fail(`steps.${s.id}.mcpServers: "${name}" is not declared`);
    for (const db of s.testDbs ?? []) if (!testDbs?.some(t => t.id === db)) fail(`steps.${s.id}.testDbs: "${db}" is not declared`);
    if (s.browser && !definition.browser) fail(`steps.${s.id}.browser: declare routine.browser.origins first`);
  }
  return definition;
}

/** Validates a parsed routine.json; throws RoutineFormatError with the first problem in plain words. */
export function parseRoutinePackage(value: unknown): RoutinePackage {
  const p = obj(value, ROUTINE_FILE);
  only(p, ['format', 'schemaVersion', 'routine', 'files', 'credentials', 'secrets'], ROUTINE_FILE);
  if (p.format !== ROUTINE_FORMAT || p.schemaVersion !== 1) fail(`${ROUTINE_FILE}: format must be "${ROUTINE_FORMAT}", schemaVersion 1`);
  const routine = parseRoutineDefinition(p.routine);
  const files = p.files === undefined ? undefined : list(p.files, 'files', 200).map((x, i) => {
    const f = obj(x, `files[${i}]`); only(f, ['kind', 'ref', 'content'], `files[${i}]`);
    if (!['script', 'query', 'asset'].includes(f.kind as string)) fail(`files[${i}].kind: script, query or asset`);
    return { kind: f.kind as PackageFile['kind'], ref: str(f.ref, `files[${i}].ref`, 256), content: str(f.content, `files[${i}].content`, 1_000_000, true) };
  });
  const credentials = p.credentials === undefined ? undefined : list(p.credentials, 'credentials', 100).map((x, i) => {
    const c = obj(x, `credentials[${i}]`); only(c, ['id', 'loginUrl', 'user', 'password'], `credentials[${i}]`);
    return { ...(c.id === undefined ? {} : { id: id(c.id, `credentials[${i}].id`) }), loginUrl: url(c.loginUrl, `credentials[${i}].loginUrl`), user: str(c.user, `credentials[${i}].user`, 256), password: str(c.password, `credentials[${i}].password`, 1024) };
  });
  let secrets: PackageSecrets | undefined;
  if (p.secrets !== undefined) {
    const s = obj(p.secrets, 'secrets'); only(s, ['devopsPat', 'testDbs'], 'secrets');
    secrets = {
      ...(s.devopsPat === undefined ? {} : { devopsPat: str(s.devopsPat, 'secrets.devopsPat', 1024) }),
      ...(s.testDbs === undefined ? {} : { testDbs: Object.fromEntries(Object.entries(obj(s.testDbs, 'secrets.testDbs')).map(([key, x]) => {
        const l = obj(x, `secrets.testDbs.${key}`); only(l, ['user', 'password'], `secrets.testDbs.${key}`);
        if (!routine.testDbs?.some(t => t.id === key)) fail(`secrets.testDbs.${key}: no such test DB`);
        return [key, { user: str(l.user, `secrets.testDbs.${key}.user`, 128), password: str(l.password, `secrets.testDbs.${key}.password`, 1024) }];
      })) }),
    };
  }
  return { format: ROUTINE_FORMAT, schemaVersion: 1, routine, ...(files ? { files } : {}), ...(credentials ? { credentials } : {}), ...(secrets ? { secrets } : {}) };
}

/** Reads `<dir>/routine.json` (or the file itself). */
export function loadRoutinePackage(location: string): RoutinePackage {
  const file = fs.statSync(location).isDirectory() ? path.join(location, ROUTINE_FILE) : location;
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES) fail(`${ROUTINE_FILE}: missing or larger than 4 MB`);
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fail(`${ROUTINE_FILE}: not valid JSON`); }
  return parseRoutinePackage(raw);
}

/** Every secret value a package carries, for the run's masker. */
export function packageSecrets(pkg: RoutinePackage): string[] {
  return [
    ...(pkg.credentials ?? []).map(c => c.password),
    ...(pkg.secrets?.devopsPat ? [pkg.secrets.devopsPat] : []),
    ...Object.values(pkg.secrets?.testDbs ?? {}).map(l => l.password),
  ].filter(Boolean);
}

export function writeRoutinePackage(dir: string, pkg: RoutinePackage): string {
  const valid = parseRoutinePackage(JSON.parse(JSON.stringify(pkg)));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ROUTINE_FILE);
  fs.writeFileSync(file, `${JSON.stringify(valid, null, 2)}\n`, { mode: 0o600 });
  return file;
}

// ── Migration from the app's JSON export ────────────────────────────────────────────────────────────────────────

/** What the conversion did besides copying: removed steps and dropped fields, for the user to review. */
export interface ConversionNotes { droppedSteps: { id: string; why: string }[]; droppedFields: string[] }
/** The app's automation rule for the routine, when known: its trigger, DevOps grant and mention identity. */
export interface ConversionAutomation {
  trigger?: unknown;
  devopsWrite?: { organization: string; projects: string[]; ops: string[]; fields: string[]; mentions?: string[]; deployTargets?: unknown[]; pushTargets?: { project: string; repositoryId: string; workspaceInput: string }[] };
}

/** App write categories -> the package's ops (same names since the runtime runs them all, ADR 0175). */
const OP_MAP: Record<string, RoutineDevOpsOp[]> = {
  comment: ['comment'], 'rich-comments': ['comment'], attachments: ['attachments'], tags: ['tags'], fields: ['fields', 'state'],
  ...Object.fromEntries((['test-plans', 'test-results', 'pr-create', 'pr-links', 'related-links', 'pr-comment', 'pr-publish', 'pr-abandon', 'git-push', 'test-deploy', 'pr-validation', 'test-environment'] as const).map(op => [op, [op]])),
};
/** Step fields that bound a step to an app chat, a role or an app tool: dropped by the conversion. */
const APP_STEP_FIELDS = ['role', 'tier', 'engine', 'agentPrompt', 'connector', 'adapter', 'writeVia', 'browserTargets', 'testEnvironment', 'mentionReason', 'onFail', 'effect', 'reviewOf', 'workspaceInput', 'testDbRead', 'env'];

/**
 * Converts the app's JSON export (`{ format: 'second-brain-flow', definition, files?, credentials? }`, text or parsed)
 * into a routine package. Every agent/check/manual step becomes a plain step whose prompt is its instructions, plus
 * its expected evidence, its package assets and its script/query text; approval steps are removed (no run-time
 * approvals). Model and effort are kept; role, tier, engine and app-only fields are dropped and listed in the notes.
 */
export function convertFlowToPackage(exported: unknown, automation: ConversionAutomation = {}): { pkg: RoutinePackage; notes: ConversionNotes } {
  const root = obj(typeof exported === 'string' ? (() => { try { return JSON.parse(exported) as unknown; } catch { return fail('export: not valid JSON'); } })() : exported, 'export');
  if (root.format !== 'second-brain-flow' || root.schemaVersion !== 1) fail('export: not a second-brain-flow JSON export (schemaVersion 1)');
  const d = obj(root.definition, 'export.definition');
  const notes: ConversionNotes = { droppedSteps: [], droppedFields: [] };
  const dropped = new Set<string>();
  const files = list(root.files ?? [], 'export.files', 200).map(f => obj(f, 'export.files[]'));
  const assets = list(obj(d.package ?? {}, 'export.definition.package').assets ?? [], 'package.assets', 200).map(a => obj(a, 'package.assets[]'));
  const steps: RoutineStep[] = [];
  for (const raw of list(d.steps, 'export.definition.steps', 50)) {
    const s = obj(raw, 'export step');
    const sid = id(s.id, 'export step id');
    for (const key of Object.keys(s)) if (APP_STEP_FIELDS.includes(key) && s[key] !== undefined) dropped.add(`steps.${key}`);
    if (s.kind === 'approval') { notes.droppedSteps.push({ id: sid, why: 'approval step: routines have no run-time approvals' }); continue; }
    const parts = [str(s.instructions ?? s.title, `steps.${sid}.instructions`, 100_000)];
    const evidence = Array.isArray(s.evidence) ? (s.evidence as unknown[]).filter((e): e is string => typeof e === 'string' && !!e.trim()) : [];
    if (evidence.length) parts.push(`Evidence to collect:\n${evidence.map(e => `- ${e}`).join('\n')}`);
    for (const assetId of Array.isArray(s.assets) ? s.assets as unknown[] : []) {
      const asset = assets.find(a => a.id === assetId);
      if (asset && typeof asset.content === 'string') parts.push(`Reference «${String(assetId)}»:\n${asset.content}`);
    }
    const action = s.action && typeof s.action === 'object' ? s.action as Obj : undefined;
    if (action && (action.kind === 'script' || action.kind === 'query')) {
      const file = files.find(f => f.kind === action.kind && f.ref === action.ref);
      parts.push(file && typeof file.content === 'string'
        ? `Run this ${String(action.kind)} (${String(action.ref)})${s.args ? ` with ${JSON.stringify(s.args)}` : ''}:\n~~~~\n${file.content}\n~~~~`
        : `Run the ${String(action.kind)} ${String(action.ref)}${s.args ? ` with ${JSON.stringify(s.args)}` : ''}.`);
    }
    if (s.kind === 'manual') parts.push('This step used to be done by hand: do it yourself if you can; otherwise answer needs-human with the exact question.');
    steps.push({
      id: sid, title: str(s.title ?? sid, `steps.${sid}.title`, 200), prompt: parts.join('\n\n'),
      ...(typeof s.model === 'string' && s.model ? { model: s.model } : {}),
      ...(EFFORTS.includes(s.effort as Effort) ? { effort: s.effort as Effort } : {}),
      ...(Number.isInteger(s.timeoutMs) && (s.timeoutMs as number) >= 10_000 ? { timeoutMs: s.timeoutMs as number } : {}),
      ...(Number.isInteger(s.maxAttempts) && (s.maxAttempts as number) >= 1 ? { maxAttempts: Math.min(10, s.maxAttempts as number) } : {}),
    });
  }
  const params = list(d.params ?? [], 'export.definition.params', 32).map(p => obj(p, 'param'));
  const inputs: RoutineInput[] = params.map(p => ({ name: id(p.name, 'param name'), ...(typeof p.label === 'string' ? { label: p.label } : {}),
    ...(typeof p.required === 'boolean' ? { required: p.required } : {}), ...(typeof p.default === 'string' ? { default: p.default } : {}) }));
  if (!inputs.some(i => i.name === 'workItem')) inputs.unshift({ name: 'workItem', label: 'DevOps work item id' });
  const grant = automation.devopsWrite;
  const pkgDowngrade = d.package && typeof d.package === 'object' && (d.package as Obj).downgrade && typeof (d.package as Obj).downgrade === 'object' ? (d.package as Obj).downgrade as Obj : undefined;
  const downgrade = pkgDowngrade && typeof pkgDowngrade.removeTag === 'string' && typeof pkgDowngrade.addTag === 'string' && typeof pkgDowngrade.state === 'string'
    ? { removeTag: pkgDowngrade.removeTag, addTag: pkgDowngrade.addTag, state: pkgDowngrade.state } : undefined;
  const ops: RoutineDevOpsOp[] = grant ? [...new Set([...grant.ops.flatMap(op => OP_MAP[op] ?? []), ...(downgrade ? ['downgrade' as const] : [])])] : [];
  if (grant) for (const op of grant.ops) if (!OP_MAP[op]) dropped.add(`devopsWrite.ops.${op}`);
  const trigger = automation.trigger && obj(automation.trigger, 'trigger').kind === 'devops' ? parseTrigger(automation.trigger) : undefined;
  const contact = grant?.mentions?.find(m => GUID.test(m.toLowerCase()));
  const credentials = list(root.credentials ?? [], 'export.credentials', 100).map(c => obj(c, 'credential'));
  const routine: RoutineDefinition = {
    id: id(d.id, 'definition.id'), title: str(d.title, 'definition.title', 200), description: str(d.description ?? '', 'definition.description', 4000, true),
    inputs, steps,
    ...(trigger ? { trigger } : {}),
    ...(grant && ops.length ? { devops: {
      organization: grant.organization, projects: [...grant.projects], ops, fields: [...grant.fields],
      ...(grant.mentions?.length ? { mentions: grant.mentions.map(m => m.toLowerCase()) } : {}),
      ...(grant.pushTargets?.length && ops.includes('git-push') ? { pushTargets: grant.pushTargets.map(t => ({ ...t })) } : {}),
      ...(grant.deployTargets?.length ? { deployTargets: grant.deployTargets as TestDeployTarget[] } : {}),
      ...(downgrade ? { downgrade } : {}),
    } } : {}),
    ...(contact ? { escalation: { contact: contact.toLowerCase() } } : {}),
  };
  if (d.package && typeof d.package === 'object') for (const key of ['requiredOps', 'intake', 'history', 'historyMentions', 'production', 'outputs']) if ((d.package as Obj)[key] !== undefined) dropped.add(`package.${key}`);
  // the downgrade's lesson text fed the app's learning loop: the runtime writes the reason to downgrade.md instead
  if (pkgDowngrade && pkgDowngrade.lessonOutput !== undefined) dropped.add('package.downgrade.lessonOutput');
  notes.droppedFields = [...dropped].sort();
  const pkg = parseRoutinePackage({
    format: ROUTINE_FORMAT, schemaVersion: 1, routine,
    ...(files.length ? { files: files.map(f => ({ kind: f.kind === 'query' ? 'query' : 'script', ref: f.ref, content: f.content })) } : {}),
    ...(credentials.length ? { credentials: credentials.map(c => ({ loginUrl: c.loginUrl, user: c.user, password: c.password })) } : {}),
  });
  return { pkg, notes };
}
