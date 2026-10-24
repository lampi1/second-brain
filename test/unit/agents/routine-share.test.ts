// The routine package (ADR 0156): one zip with everything a routine needs for the same results outside the app (the
// files its steps cite, rules, skills, roles, pinned scripts, the roles' memory on request), never private files; and its
// import, which writes only the items picked, never over a different file unless picked, and pinned scripts only exact.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { portableId } from '../../../src/main/agents/pack/flows';
import { applyImport, buildRoutinePackage, citedPaths, parsePackage, previewImport, routineRoles, routineSkills, type ImportProbe, type ImportWriter } from '../../../src/main/agents/pack/routine-share';
import { BRAIN_ZIP_LIMITS, readZip, writeZip } from '../../../src/main/agents/pack/zip';
import { exportFlow } from '../../../src/main/flows/portable';
import { FlowService } from '../../../src/main/flows/service';
import type { FlowDefinition } from '../../../src/shared/flows';
import type { AgentModelChoice } from '../../../src/shared/agents';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const put = (root: string, rel: string, data: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), data); };
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];
const script = 'Write-Output "{{id}}"\n', sha = createHash('sha256').update(script).digest('hex');

const definition: FlowDefinition = { id: 'bugfix', title: 'Bugfix', description: 'Fix a bug from DevOps, see https://example.com/x/y.md', aliases: [], scope: {}, params: [{ name: 'id', type: 'int', required: true }],
  steps: [
    { id: 'tag', title: 'Tag', kind: 'agent', role: 'scout', instructions: 'Read rules/air-dev-qa.md and brain-v2/reviews/ then decide the tag. Never read me.md. Use `/deploy-check`.', workspaceInput: 'workspace', inputs: ['workspace'], evidence: ['tag'], timeoutMs: 5000, maxAttempts: 1, effect: 'read-only' },
    { id: 'fix', title: 'Fix', kind: 'agent', instructions: 'Fix it following notes/missing.md.', workspaceInput: 'workspace', inputs: ['workspace'], evidence: [], timeoutMs: 5000, maxAttempts: 1, effect: 'code' },
    { id: 'run', title: 'Run', kind: 'check', instructions: 'Run the script.', inputs: [], evidence: [], timeoutMs: 5000, maxAttempts: 1, effect: 'read-only', action: { kind: 'script', ref: 'tag.ps1', hash: sha }, env: 'test', args: { id: '{{id}}' } },
  ] };

function brain(name = 'brain-v2') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-routine-share-')); roots.push(base);
  const root = path.join(base, name), data = path.join(base, 'data'); fs.mkdirSync(root); fs.mkdirSync(data);
  put(root, 'brain.json', JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: [], appRules: true } }));
  return { root, data };
}
function source() {
  const { root, data } = brain();
  put(root, 'rules/air-dev-qa.md', '# QA\nTag ai-fixable when the UI can create the data.\n');
  put(root, 'rules/other.md', '# Other\nUnrelated rule.\n');
  put(root, 'reviews/contract-v7.json', '{"v":7}\n'); put(root, 'reviews/deep/notes.md', 'deep\n');
  put(root, 'me.md', 'PRIVATE-ME\n'); put(root, 'journal/2026.md', 'PRIVATE-JOURNAL\n');
  put(root, 'agents/scout/memory.md', '# Memoria\n\n- 2026-10-20 · Il login di test usa la firma semplice.\n');
  put(root, 'agents/artisan/memory.md', '# Memoria\n\n- 2026-10-21 · Build con npm run build.\n');
  put(root, '.agents/skills/deploy-check/SKILL.md', '---\nname: deploy-check\ndescription: "Check a deploy"\nhooks: {"Stop":[]}\n---\nRun the checks.\n');
  put(root, '.agents/skills/unused/SKILL.md', '---\nname: unused\ndescription: no\n---\nx\n');
  put(root, 'scripts/tag.ps1', script);
  const catalog = new AgentCatalogService({ userData: data, models });
  const flows = new FlowService({ file: path.join(data, 'flows.json'), contextKey: 'k', now: () => 10 });
  const draft = flows.propose({ definition, expectedRevision: 0 });
  flows.decideDefinition({ id: definition.id, expectedRevision: draft.revision, answer: 'yes' });
  const flowJson = exportFlow(flows.snapshot(), { flowId: definition.id, version: 1, format: 'json' }, (kind, ref) => fs.readFileSync(path.join(root, kind === 'script' ? 'scripts' : 'queries', ref), 'utf8')).content;
  const wanted = routineRoles(definition);
  const roles = catalog.list().profiles.filter(p => wanted.includes(portableId(p.id))).map(profile => ({ role: { profile, skillName: portableId(profile.id), own: new Map<string, Buffer>() }, memory: fs.readFileSync(path.join(root, `agents/${portableId(profile.id)}/memory.md`), 'utf8') }));
  const names = routineSkills(definition, roles.map(r => r.role), ['deploy-check', 'unused']);
  const skills = new Map(names.filter(n => n === 'deploy-check').map(n => [n, new Map([['SKILL.md', fs.readFileSync(path.join(root, '.agents/skills', n, 'SKILL.md'))]])]));
  return { root, flowJson, roles, skills, names };
}
const probe = (root: string): ImportProbe => ({ root, skill: name => fs.existsSync(path.join(root, '.agents/skills', name, 'SKILL.md')) ? { folder: path.join(root, '.agents/skills', name), inBrain: true } : null });
const writer = (): ImportWriter & { entries: { kind: string; files: string[] }[]; facts: string[] } => {
  const entries: { kind: string; files: string[] }[] = [], facts: string[] = [];
  return { entries, facts, apply: (kind, _t, _s, writes) => { for (const w of writes) { fs.mkdirSync(path.dirname(w.file), { recursive: true }); fs.writeFileSync(w.file, w.text); } entries.push({ kind, files: writes.map(w => w.file) }); return true; }, remember: (role, line) => { facts.push(`${role}: ${line}`); } };
};

describe('routine package', () => {
  it('finds the brain paths the steps cite, dropping URLs and the brain folder name', () => {
    expect(citedPaths(definition, 'brain-v2').sort()).toEqual(['me.md', 'notes/missing.md', 'reviews/', 'rules/air-dev-qa.md'].sort());
  });

  it('carries the routine, cited files, rules, roles, skills, scripts and memory, never private files', () => {
    const s = source();
    expect(s.names).toContain('deploy-check'); expect(s.names).not.toContain('unused');
    const { files, summary } = buildRoutinePackage({ root: s.root, brainName: 'brain-v2', date: '2026-10-24', definition, version: 1, flowJson: s.flowJson, roles: s.roles, skills: s.skills, memory: true });
    expect(summary.cited.sort()).toEqual(['reviews/contract-v7.json', 'reviews/deep/notes.md', 'rules/air-dev-qa.md']);
    expect(summary.missing.sort()).toEqual(['notes/missing.md']);
    expect(summary.skipped).toContain('me.md');
    expect(summary.roles.sort()).toEqual(['artisan', 'scout']);
    expect(summary.memory.sort()).toEqual(['artisan', 'scout']);
    expect(summary.scripts).toEqual(['scripts/tag.ps1']);
    for (const name of ['routine.json', 'ROUTINE.md', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'routine-package.json', 'rules/other.md', 'scripts/tag.ps1', '.claude/agents/scout.md', '.codex/agents/artisan.toml', '.agents/skills/deploy-check/SKILL.md', '.claude/skills/deploy-check/SKILL.md', 'agents/scout/memory.md']) expect(files.has(name), name).toBe(true);
    const all = [...files.values()].map(b => b.toString('utf8')).join('\n');
    expect(all).not.toContain('PRIVATE-ME'); expect(all).not.toContain('PRIVATE-JOURNAL');
    expect(files.get('.agents/skills/deploy-check/SKILL.md')!.toString()).not.toContain('hooks');
    const agents = files.get('AGENTS.md')!.toString();
    expect(agents).toContain('ROUTINE.md'); expect(agents).toContain('never run it'); expect(agents).toContain('`brain-v2/` means this folder');
    const without = buildRoutinePackage({ root: s.root, brainName: 'brain-v2', date: '2026-10-24', definition, version: 1, flowJson: s.flowJson, roles: s.roles, skills: s.skills, memory: false });
    expect(without.summary.memory).toEqual([]); expect([...without.files.keys()].some(n => n.endsWith('memory.md'))).toBe(false);
  });

  it('imports into another brain only what is picked, keeps a different file unless picked, and adds memory as facts', () => {
    const s = source();
    const zip = writeZip(buildRoutinePackage({ root: s.root, brainName: 'brain-v2', date: '2026-10-24', definition, version: 1, flowJson: s.flowJson, roles: s.roles, skills: s.skills, memory: true }).files, BRAIN_ZIP_LIMITS);
    const target = brain('mine').root;
    put(target, 'rules/air-dev-qa.md', '# My QA\n');
    const pkg = parsePackage(readZip(zip, BRAIN_ZIP_LIMITS)), preview = previewImport(pkg, probe(target));
    const status = Object.fromEntries(preview.items.map(i => [i.key, i.status]));
    expect(status).toMatchObject({ 'file:rules/air-dev-qa.md': 'different', 'file:reviews/contract-v7.json': 'new', 'file:rules/other.md': 'new', 'skill:deploy-check': 'new', 'script:scripts/tag.ps1': 'new' });
    expect(preview.items.find(i => i.key === 'script:scripts/tag.ps1')!.text).toBe(script);
    expect(preview.items.find(i => i.key === 'file:rules/other.md')!.kind).toBe('rule');
    expect(preview.memory.map(m => m.role).sort()).toEqual(['artisan', 'scout']);
    const w = writer();
    const done = applyImport(pkg, probe(target), ['file:reviews/contract-v7.json', 'skill:deploy-check', 'script:scripts/tag.ps1'], true, w, 'Bugfix');
    expect(done.failed).toEqual([]);
    expect(fs.readFileSync(path.join(target, 'rules/air-dev-qa.md'), 'utf8')).toBe('# My QA\n');
    expect(fs.existsSync(path.join(target, 'rules/other.md'))).toBe(false);
    expect(fs.readFileSync(path.join(target, 'reviews/contract-v7.json'), 'utf8')).toBe('{"v":7}\n');
    expect(fs.readFileSync(path.join(target, 'scripts/tag.ps1'), 'utf8')).toBe(script);
    expect(fs.existsSync(path.join(target, '.agents/skills/deploy-check/SKILL.md'))).toBe(true);
    expect(w.facts).toContain('scout: Il login di test usa la firma semplice.');
    expect(previewImport(pkg, probe(target)).items.find(i => i.key === 'file:reviews/contract-v7.json')!.status).toBe('same');
  });

  it('refuses a zip that is not a routine package, and a script whose text no longer matches its pin', () => {
    expect(() => parsePackage(new Map([['README.md', Buffer.from('x')]]))).toThrow('pacchetto di routine');
    const s = source();
    const { files } = buildRoutinePackage({ root: s.root, brainName: 'brain-v2', date: '2026-10-24', definition, version: 1, flowJson: s.flowJson, roles: s.roles, skills: s.skills, memory: false });
    files.set('scripts/tag.ps1', Buffer.from('Remove-Item -Recurse C:\\\n'));
    files.set('me.md', Buffer.from('x'));
    const manifest = JSON.parse(files.get('routine-package.json')!.toString()); manifest.cited.push('me.md', '../escape.md'); files.set('routine-package.json', Buffer.from(JSON.stringify(manifest)));
    const keys = [...parsePackage(files).writes.keys()];
    expect(keys).not.toContain('script:scripts/tag.ps1'); expect(keys).not.toContain('file:me.md'); expect(keys).not.toContain('file:../escape.md');
  });
});
