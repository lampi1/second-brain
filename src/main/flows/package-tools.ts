// The Orchestrator's routine package tools (ADR 0175, 0176), mounted only on its authenticated app-control endpoint:
// app_flow_capabilities and app_flow_connectors say what a package can do, app_flow_propose validates an agent-written
// package with the runtime's preflight and saves it in the package store (status ready | needs-secrets | invalid),
// app_flow_packages reads saved packages with every secret masked. Saving never runs a routine or enables a trigger.
// Used by appctl/tools.ts; the content comes from capabilities.ts and package-authoring.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { ToolDef } from '../appctl/tools';
import { DEVOPS_SERVER_NAME, TESTDB_SERVER_NAME } from '../../../packages/routine-runtime/src/index';
import { flowCapabilities, ROUTINE_CAPABILITY_SECTIONS } from './capabilities';
import { flowBrainContextKey } from './context';
import { readDefinitionFile } from './definition-file';
import { authorPackage, maskPackage, SecretFromAgent, type RoutinePackageStore } from './package-authoring';

export interface PackageToolsDeps {
  store: () => RoutinePackageStore;
  brainRoot: () => string | null;
  /** live check that the caller is still the authenticated Orchestrator */
  authed: () => boolean;
}

const string = { type: 'string' };
const schema = (properties: Record<string, unknown>, required: string[] = []): object => ({ type: 'object', properties, required, additionalProperties: false });
const keysOnly = (args: Record<string, unknown>, allowed: string[]): void => {
  for (const k of Object.keys(args)) if (!allowed.includes(k)) throw new Error(`Unknown field "${k}"`);
};

/** Reads a package JSON from the selected brain with the same confined, bounded reader as routine definition files. */
function readPackageFile(brainRoot: string | null, value: unknown): unknown {
  if (!brainRoot) throw new Error('Connect a brain before proposing a routine from a file');
  let key: string;
  try { key = flowBrainContextKey(fs.realpathSync(path.resolve(brainRoot))); } catch { throw new Error('The selected brain folder cannot be read'); }
  return readDefinitionFile(brainRoot, value, key);
}

const CONNECTORS = {
  runtime: [
    { name: DEVOPS_SERVER_NAME, given: 'automatically to every step of a run about a work item', tools: ['get_work_item', 'get_work_item_comments', 'get_attachment', 'current_iteration'], allowedTools: `mcp__${DEVOPS_SERVER_NAME}__*`, note: 'read only; writes go in step-result.json devopsWrites' },
    { name: TESTDB_SERVER_NAME, given: 'to a step that lists testDbs', tools: ['test_db_query'], allowedTools: `mcp__${TESTDB_SERVER_NAME}__test_db_query`, note: 'read only, recognised test databases only' },
    { name: 'routine-browser', given: 'to a step with browser: true (routine.browser.origins set)', tools: ['navigate', 'snapshot', 'click', 'type', 'select_option', 'screenshot'], allowedTools: 'mcp__routine-browser__*', note: 'already signed in with the package credentials; type refuses password fields' },
  ],
  own: {
    declare: 'routine.mcpServers {name: {command, args?, env?}} (stdio, e.g. {"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}) and the step\'s mcpServers [name]; allowedTools mcp__<name>__<tool>.',
    rules: ['Never the second-brain app server (refused by preflight).', 'No secrets in env or args: a server that needs a token reads it from the user\'s environment.', 'Pin a version in args when the package is shared.'],
  },
};

export function packageTools(deps: PackageToolsDeps): ToolDef[] {
  const guard = (): void => { if (!deps.authed()) throw new Error('Authenticated Orchestrator required'); };
  const tool = (name: string, description: string, properties: Record<string, unknown>, readOnly: boolean, run: (args: Record<string, unknown>) => unknown, required: string[] = []): ToolDef => ({
    name, description, inputSchema: schema(properties, required),
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
    run: args => { guard(); keysOnly(args, Object.keys(properties)); return run(args) as object; },
  });
  return [
    tool('app_flow_capabilities', 'Read before writing a routine package from the user\'s need: what a package is and what it can do. section: overview (default: shape, workflow, placeholders, what is never allowed), steps, devops (trigger, write grant, escalation), browser (runtime-owned signed-in browser), test-db, secrets, examples. A step is a plain Claude Code session: no app roles, no app tools, no approval steps.',
      { section: { type: 'string', enum: [...ROUTINE_CAPABILITY_SECTIONS] } }, true, args => flowCapabilities(args.section ?? 'overview')),
    tool('app_flow_connectors', 'MCP servers a routine step can use: the runtime\'s own (routine-devops, routine-testdb, routine-browser: their tools and allowedTools) and how to declare a standalone stdio MCP server in the package. Calls nothing.',
      {}, true, () => CONNECTORS),
    tool('app_flow_propose', 'Validate and save a routine package (routine.json) written from the user\'s plain-language need. Supply exactly one of package (the object {format:"second-brain-routine",schemaVersion:1,routine:{...},credentials?,secrets?}) or packagePath (a JSON file inside the selected brain, at most 1 MiB). ' +
      'Runs the runtime\'s preflight: status invalid = nothing saved, fix each error (path, message, fix) and call again; needs-secrets = saved, the user must type the listed secrets (secret: true) on the Routine page; ready = saved. ' +
      'Never pass a password, PAT or test DB password: leave it out (refused otherwise); the ones the user already stored for the same routine id are kept. Re-proposing the same routine.id replaces it. dryRun: true validates only. ' +
      'Saving never runs a routine nor enables its trigger: the user does that on the Routine page. Read app_flow_capabilities first.',
      { package: { type: 'object' }, packagePath: { type: 'string', maxLength: 4096 }, dryRun: { type: 'boolean' } }, false, args => {
        const inline = args.package !== undefined, file = args.packagePath !== undefined;
        if (inline === file) throw new Error('Supply exactly one of package or packagePath');
        const raw = inline ? args.package : readPackageFile(deps.brainRoot(), args.packagePath);
        try { return authorPackage(raw, deps.store(), { dryRun: args.dryRun === true }); }
        catch (error) {
          if (error instanceof SecretFromAgent) return { status: 'invalid', errors: [{ path: error.message.split(':')[0], message: 'a secret value came from the agent', fix: 'Leave the secret out; the user types it on the Routine page.', secret: true }], warnings: [], preflight: error.message, next: 'Remove the secret value and propose again. Nothing was saved.' };
          throw error;
        }
      }),
    tool('app_flow_packages', 'Saved routine packages: no id = the list (id, title, steps, trigger, missingSecrets); id = that package with every secret masked (*** = stored, <set-by-user> = still missing). Read one before revising it with app_flow_propose.',
      { id: string }, true, args => {
        if (args.id === undefined) return { packages: deps.store().list() };
        if (typeof args.id !== 'string') throw new Error('id: expected text');
        const pkg = deps.store().get(args.id);
        if (!pkg) throw new Error(`No saved routine "${args.id}"; app_flow_packages without id lists them`);
        return maskPackage(pkg);
      }),
  ];
}
