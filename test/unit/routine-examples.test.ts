// The worked examples of docs/routines/authoring.md (and of app_routine_capabilities section examples) are real packages:
// both pass the runtime preflight (the Air bugfix only lacks the user's secrets), name no app role or app-only tool,
// and the Orchestrator's authoring tool saves them as they are.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { preflightRoutinePackage } from '../../packages/routine-runtime/src/index';
import { authorPackage, createFolderPackageStore } from '../../src/main/flows/package-authoring';
import { flowCapabilities } from '../../src/main/flows/capabilities';

const root = path.resolve(__dirname, '../..');
const example = (name: string) => path.join(root, 'docs/routines/examples', name, 'routine.json');
const read = (name: string) => JSON.parse(fs.readFileSync(example(name), 'utf8')) as unknown;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

it('the Air bugfix example passes preflight except for the secrets the user types', () => {
  const r = preflightRoutinePackage(read('air-bugfix'));
  expect(r.warnings).toEqual([]);
  expect(r.errors.map(e => [e.path, e.secret])).toEqual([['credentials[0].password', true], ['secrets.devopsPat', true]]);
  expect(r.pkg!.routine).toMatchObject({ trigger: { states: ['New'], includeTags: ['ai-fixable'] }, browser: { origins: ['https://air.example.test'] } });
  expect(r.pkg!.credentials![0]!.loginUrl).toBe('https://air.example.test/Account/Login?mode=local');
});

it('the simple example passes preflight with nothing missing', () => {
  expect(preflightRoutinePackage(read('release-notes'))).toMatchObject({ ok: true, errors: [], warnings: [] });
});

it('no example names an app role, an app-only tool or an old role-model field', () => {
  for (const name of ['air-bugfix', 'release-notes']) {
    const text = fs.readFileSync(example(name), 'utf8');
    expect(text).not.toMatch(/\b(Orchestrator|Strategist|Scout|Artisan|Sentinel|Herald|Router|Judge|Scribe)\b/i);
    expect(text).not.toMatch(/\b(agent_[a-z_]+|app_[a-z_]+|flow_[a-z_]+|handoff_to_user|browser_login|show_ui|send_to_chat|mcp__second-brain__\w*)\b/);
    expect(text).not.toMatch(/"(role|roleId|tier|engine|agentPrompt|writeVia|connector|workspaceInput)"/);
  }
});

it('the authoring tool saves the examples as they are, and the catalog points at them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-examples-')); dirs.push(dir);
  const store = createFolderPackageStore(dir);
  expect(authorPackage(read('air-bugfix'), store)).toMatchObject({ status: 'needs-secrets', routineId: 'air-bugfix' });
  expect(authorPackage(read('release-notes'), store)).toMatchObject({ status: 'ready', routineId: 'release-notes', errors: [] });
  const refs = JSON.stringify(flowCapabilities('examples'));
  for (const name of ['air-bugfix', 'release-notes']) { expect(refs).toContain(`docs/routines/examples/${name}/routine.json`); expect(fs.existsSync(example(name))).toBe(true); }
  expect(fs.existsSync(path.join(root, 'docs/routines/authoring.md'))).toBe(true);
});
