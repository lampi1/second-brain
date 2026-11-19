// The worked examples of docs/routines/authoring.md are real packages: both pass the runtime preflight (the Air bugfix
// only lacks the secrets its owner types) and name no app role, app tool or old role-model field.
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { preflightRoutinePackage } from '../../../packages/routine-runtime/src/index';

const root = path.resolve(__dirname, '../../..');
const example = (name: string) => path.join(root, 'docs/routines/examples', name, 'routine.json');
const read = (name: string) => JSON.parse(fs.readFileSync(example(name), 'utf8')) as unknown;

it('the Air bugfix example passes preflight except for the secrets its owner types', () => {
  const r = preflightRoutinePackage(read('air-bugfix'));
  expect(r.warnings).toEqual([]);
  expect(r.errors.map(e => [e.path, e.secret])).toEqual([['credentials[0].password', true], ['secrets.devopsPat', true]]);
  expect(r.pkg!.routine).toMatchObject({ trigger: { states: ['New'], includeTags: ['ai-fixable'] }, browser: { origins: ['https://air.example.test'] } });
  expect(r.pkg!.credentials![0]!.loginUrl).toBe('https://air.example.test/Account/Login?mode=local');
});

it('the simple example passes preflight with nothing missing', () => {
  expect(preflightRoutinePackage(read('release-notes'))).toMatchObject({ ok: true, errors: [], warnings: [] });
});

it('no example names an app role, an app tool or an old role-model field', () => {
  for (const name of ['air-bugfix', 'release-notes']) {
    const text = fs.readFileSync(example(name), 'utf8');
    expect(text).not.toMatch(/\b(Orchestrator|Strategist|Scout|Artisan|Sentinel|Herald|Router|Judge|Scribe)\b/i);
    expect(text).not.toMatch(/\b(agent_[a-z_]+|app_[a-z_]+|flow_[a-z_]+|handoff_to_user|browser_login|show_ui|send_to_chat|mcp__second-brain__\w*)\b/);
    expect(text).not.toMatch(/"(role|roleId|tier|engine|agentPrompt|writeVia|connector|workspaceInput)"/);
  }
});
