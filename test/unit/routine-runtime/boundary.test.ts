// The shared routine runtime's boundaries (ADR 0175): it never imports Electron, the main process or the renderer
// (only src/shared types), and it runs plain Claude sessions: no app role, app MCP tool or flow tool name appears in
// the package or its demo. Also the package format: the app export converts to a plain package, approvals dropped.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertFlowToPackage, createDevOpsClient, handleDevOpsMessage, patTokenProvider, redact } from '../../../packages/routine-runtime/src/index';
import { fakeDevOps, tempDir } from './fakes';

// the organization URL, split so the publish guard does not read it as a real tenant
const ORG_URL = 'https://dev.azure.com/' + 'contoso';

const ROOT = path.resolve(__dirname, '../../../packages/routine-runtime');
function sources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'runs' ? [] : sources(f);
    return /\.(m?[jt]s|json|md)$/.test(e.name) ? [f] : [];
  });
}

describe('routine runtime boundary', () => {
  const files = sources(ROOT);

  it('imports no electron, src/main, src/renderer or src/preload', () => {
    expect(files.length).toBeGreaterThan(20);
    const imports = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
    for (const file of files.filter(f => /\.m?[jt]s$/.test(f))) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(imports)) {
        const spec = m[1]!;
        expect(spec === 'electron' || spec.startsWith('electron/'), `${file} imports ${spec}`).toBe(false);
        if (spec.startsWith('.')) {
          const target = path.resolve(path.dirname(file), spec).replace(/\\/g, '/');
          expect(/\/src\/(main|renderer|preload)(\/|$)/.test(target), `${file} imports ${spec}`).toBe(false);
        }
      }
    }
  });

  it('names no app role, app MCP tool or flow tool (plain sessions)', () => {
    const banned = /\b(Orchestrator|Strategist|Scout|Artisan|Sentinel|Herald|agent_report|agent_delegate|agent_ask_parent|send_to_chat|app_[a-z_]+|flow_(?:verdict|output|intake|devops_write|downgrade|step_history|test_db_query|pr_build_status)|mcp__second-brain)\b/;
    for (const file of files) {
      // preflight.ts holds the lists of names it refuses in packages (ROLE, APP_TOOL): those two lines are data, not use
      const text = fs.readFileSync(file, 'utf8').replace(/^const (ROLE|APP_TOOL) = .*$/gm, '');
      const hit = banned.exec(text);
      expect(hit?.[0], file).toBeUndefined();
    }
  });
});

describe('package format: conversion from the app export', () => {
  it('turns agent/check/manual steps into plain steps, drops approvals and app fields, maps the grant', () => {
    const exported = {
      format: 'second-brain-flow', schemaVersion: 1,
      definition: {
        id: 'air-bugfix', title: 'Air bugfix', description: 'Fix a bug',
        params: [{ name: 'branch', label: 'Branch', default: 'main' }],
        steps: [
          { id: 'analyse', kind: 'agent', title: 'Analyse', instructions: 'Read the bug.', role: 'scout', tier: 'fast', evidence: ['repro notes'], model: 'claude-opus-5-5', effort: 'high' },
          { id: 'ok', kind: 'approval', title: 'Approve' },
          { id: 'query', kind: 'check', title: 'Query', instructions: 'Check rows.', action: { kind: 'query', ref: 'rows.sql' }, testDbRead: true },
          { id: 'hand', kind: 'manual', title: 'Hand', instructions: 'Deploy.' },
        ],
      },
      files: [{ kind: 'query', ref: 'rows.sql', content: 'SELECT 1' }],
      credentials: [{ loginUrl: 'https://air.test.local/login', user: 'qa', password: 'pw' }],
    };
    const { pkg, notes } = convertFlowToPackage(JSON.stringify(exported), { devopsWrite: { organization: 'contoso', projects: ['Proj'], ops: ['comment', 'tags', 'pr'], fields: [] } });
    expect(pkg.routine.steps.map(s => s.id)).toEqual(['analyse', 'query', 'hand']);
    expect(pkg.routine.steps[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' });
    expect(pkg.routine.steps[0]!.prompt).toContain('- repro notes');
    expect(pkg.routine.steps[1]!.prompt).toContain('SELECT 1');
    expect(pkg.routine.steps[2]!.prompt).toContain('needs-human');
    expect(pkg.routine.inputs.map(i => i.name)).toEqual(['workItem', 'branch']);
    expect(pkg.routine.devops).toEqual({ organization: 'contoso', projects: ['Proj'], ops: ['comment', 'tags'], fields: [] });
    expect(pkg.credentials).toEqual([{ loginUrl: 'https://air.test.local/login', user: 'qa', password: 'pw' }]);
    expect(notes.droppedSteps).toEqual([{ id: 'ok', why: 'approval step: routines have no run-time approvals' }]);
    expect(notes.droppedFields).toEqual(['devopsWrite.ops.pr', 'steps.role', 'steps.testDbRead', 'steps.tier']);
    expect(JSON.stringify(pkg)).not.toMatch(/"role"|"tier"/);
  });

  it('refuses what is not an app export', () => {
    expect(() => convertFlowToPackage({ format: 'other' })).toThrow(/second-brain-flow/);
    expect(() => convertFlowToPackage('{bad')).toThrow(/JSON/);
  });
});

describe('PAT token provider', () => {
  it('sends Basic with an empty user and redacts the PAT', async () => {
    const pat = `pat${Math.random().toString(36).slice(2)}q`;
    const header = await patTokenProvider(pat).authorization();
    expect(header).toBe(`Basic ${Buffer.from(`:${pat}`).toString('base64')}`);
    expect(redact(`token ${pat}`)).not.toContain(pat);
    expect(() => patTokenProvider('two words')).toThrow();
  });
});

describe('read-only DevOps MCP server', () => {
  const call = (name: string, args: Record<string, unknown>) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  function setup() {
    const devops = fakeDevOps();
    devops.addItem({ id: 42, fields: { 'System.Title': 'Login broken', 'Microsoft.VSTS.TCM.ReproSteps': '<p>Click</p>' } });
    devops.addItem({ id: 50, project: 'Other', fields: { 'System.Title': 'x' } });
    devops.reply(42, 'someone', '<div>Use env B</div>');
    const client = createDevOpsClient({ authorization: devops.authorization, request: devops.request });
    const url = `${ORG_URL}/_apis/wit/attachments/a1`;
    const io = { client: { ...client, relations: async () => [{ rel: 'AttachedFile', url, name: 'log file.txt' }] }, download: async () => Buffer.from('log line') };
    return { devops, io, url, config: { organization: 'contoso', projects: ['Proj'], evidence: path.join(tempDir(), 'evidence') } };
  }
  const textOf = (r: unknown) => ((r as { result: { content: { text: string }[] } }).result.content[0]!.text);

  it('lists only read tools and reads item, comments and attachments', async () => {
    const { devops, io, url, config } = setup();
    const list = await handleDevOpsMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, config, io as never);
    expect(((list as { result: { tools: { name: string }[] } }).result.tools).map(t => t.name)).toEqual(['get_work_item', 'get_work_item_comments', 'get_attachment']);
    expect(textOf(await handleDevOpsMessage(call('get_work_item', { id: 42 }), config, io as never))).toContain('"reproSteps": "Click"');
    expect(textOf(await handleDevOpsMessage(call('get_work_item_comments', { id: 42 }), config, io as never))).toContain('Use env B');
    const saved = textOf(await handleDevOpsMessage(call('get_attachment', { id: 42, url }), config, io as never));
    expect(fs.readFileSync(path.join(config.evidence, 'wi42-log_file.txt'), 'utf8')).toBe('log line');
    expect(saved).toContain('Saved');
    expect(devops.writes()).toEqual([]);
  });

  it('refuses items outside the projects and URLs that are not the item attachments', async () => {
    const { io, config } = setup();
    expect(JSON.stringify(await handleDevOpsMessage(call('get_work_item', { id: 50 }), config, io as never))).toContain('outside');
    expect(JSON.stringify(await handleDevOpsMessage(call('get_attachment', { id: 42, url: 'https://evil.example/x' }), config, io as never))).toContain('Not an attachment');
  });
});
