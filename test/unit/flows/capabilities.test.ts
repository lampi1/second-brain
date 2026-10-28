// The routine package catalog (app_routine_capabilities) describes the package model: plain Claude Code steps, runtime
// DevOps writes, the runtime-owned browser, user-typed secrets. Discovery changes nothing and grants nothing.
import { expect, it } from 'vitest';
import { flowCapabilities, ROUTINE_CAPABILITY_SECTIONS } from '../../../src/main/flows/capabilities';
import { DEVOPS_OPS, SECRET_PLACEHOLDER } from '../../../packages/routine-runtime/src/index';

it('every section answers and none mentions the retired role model as something to use', () => {
  for (const section of ROUTINE_CAPABILITY_SECTIONS) {
    const text = JSON.stringify(flowCapabilities(section));
    expect(text).not.toMatch(/app_flow_(bind|report|reconcil|preflight)|workspaceInput|agentPrompt|flow_devops_write/);
  }
  expect(flowCapabilities()).toMatchObject({ sections: [...ROUTINE_CAPABILITY_SECTIONS] });
});

it('names the DevOps ops, the secret placeholder and the browser contract from the runtime', () => {
  expect(JSON.stringify(flowCapabilities('devops'))).toContain(DEVOPS_OPS.join('|'));
  expect(JSON.stringify(flowCapabilities('secrets'))).toContain(SECRET_PLACEHOLDER);
  expect(JSON.stringify(flowCapabilities('browser'))).toContain('?mode=local');
});

it('refuses an invented section', () => {
  for (const section of ['execute', 'roles', null, 1]) expect(() => flowCapabilities(section)).toThrow('Unknown section');
});
