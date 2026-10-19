// A role's pack brings everything the role needs and nothing private (ADR 0077, 0083): the role, all its skills (its own
// and the shared ones it declares), the tools they call as a list (TOOLS.md) and the brain's rules; never memory, the
// journal, now.md or the always-loaded files. Import attaches it to a built-in role: shared skills back to the brain's
// shared skills and declared by the role, rules written when absent and listed as topic files. Real catalog and flows,
// temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { AgentPackFlows, portableId } from '../../../src/main/agents/pack/flows';
import { installRules, packRules, packTools } from '../../../src/main/agents/pack/rules';
import { readZip } from '../../../src/main/agents/pack/zip';
import type { AgentModelChoice } from '../../../src/shared/agents';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const put = (root: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];
const WHEN = '---\nwhen: {"prompt":["stile"],"tools":[],"paths":[]}\n---\n';

function world(seed: (brain: string) => void) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pack-rules-')); roots.push(base);
  const brain = path.join(base, 'brain'), data = path.join(base, 'data'); fs.mkdirSync(brain); fs.mkdirSync(data);
  put(brain, 'brain.json', JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: [], appRules: true } }));
  seed(brain);
  const catalog = new AgentCatalogService({ userData: data, models }), destination = path.join(base, 'out.sbagent');
  const flows = new AgentPackFlows({ catalog, brainRoot: () => brain, version: '0.1.0', guards: () => [], scan: async () => ({ ok: true }),
    pickImport: async () => null, pickExport: async () => destination, tempRoot: base,
    sharedSkills: () => { const dir = path.join(brain, '.claude', 'skills'); try { return fs.readdirSync(dir).map(name => ({ name, folder: path.join(dir, name) })); } catch { return []; } } });
  return { base, brain, catalog, flows, destination };
}

describe('packRules and packTools', () => {
  it('takes the topic files and rules/, never memory, the profile or the always-loaded files', () => {
    const w = world(b => {
      put(b, 'brain.json', JSON.stringify({ rules: { topicFiles: ['rules/stile.md', 'me.md', 'agents/x/memory.md', 'code.md'] } }));
      put(b, 'rules/stile.md', `${WHEN}# Stile\nFrasi brevi.\n`); put(b, 'rules/altro.md', '# Altro\nSempre il percorso.\n'); put(b, 'code.md', '# Codice\nTest prima.\n');
      put(b, 'me.md', '# Io\n'); put(b, 'agents/x/memory.md', '- ricordo\n'); put(b, 'now.md', '- filo\n'); put(b, 'rules/db-credentials.md', 'x');
    });
    expect([...packRules(w.brain).keys()]).toEqual(['rules/stile.md', 'rules/code.md', 'rules/altro.md']);
  });
  it('lists tool classes, MCP servers and what each skill calls', () => {
    const text = packTools({ id: 'r', name: 'Judge', role: 'judge', summary: 'x', instructionsFile: 'agents/r.md', engine: 'claude', model: null, tools: { allow: ['read', 'mcp'], mcp: ['jira'] }, permissionCeiling: 'plan' },
      new Map([['skills/r/SKILL.md', Buffer.from('---\nname: r\ndescription: d\nallowed-tools: Read Grep\n---\nx')], ['skills/r/scripts/check.py', Buffer.from('print(1)')]]));
    expect(text).toContain('Classi di strumenti: read, mcp');
    expect(text).toContain('Server MCP: jira');
    expect(text).toContain('allowed-tools: Read Grep');
    expect(text).toContain('Script: scripts/check.py');
    expect(text).toContain('non concede nessun permesso');
  });
  it('installRules keeps the user\'s own file and lists only the topic ones', () => {
    const w = world(b => put(b, 'rules/stile.md', '# Mio\n'));
    const r = installRules(w.brain, new Map([['rules/stile.md', Buffer.from(`${WHEN}# Loro\n`)], ['rules/nuova.md', Buffer.from(`${WHEN}# Nuova\n`)], ['rules/libera.md', Buffer.from('# Libera\n')]]));
    expect(r.kept).toEqual(['rules/stile.md']); expect(r.written).toEqual(['rules/nuova.md', 'rules/libera.md']);
    expect(fs.readFileSync(path.join(w.brain, 'rules/stile.md'), 'utf8')).toBe('# Mio\n');
    expect(JSON.parse(fs.readFileSync(path.join(w.brain, 'brain.json'), 'utf8')).rules.topicFiles).toEqual(['rules/nuova.md']);
  });
});

describe('export and import of a whole role', () => {
  it('round-trips the profile, its own and shared skills, TOOLS.md and the rules; memory stays home', async () => {
    const src = world(b => {
      put(b, 'brain.json', JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: ['rules/stile.md'], appRules: true } }));
      put(b, 'rules/stile.md', `${WHEN}# Stile\nFrasi brevi.\n`);
      put(b, '.claude/skills/fatture/SKILL.md', '---\nname: fatture\ndescription: Esportare le fatture\nallowed-tools: Bash\n---\n1. Esporta.\n');
      put(b, 'now.md', '- filo privato\n');
    });
    const saved = src.catalog.list().profiles.find(p => p.id === 'sentinel')!;
    const knowhow = src.flows.persistSkills(saved.id, src.flows.ownSkills(saved, true), ['fatture']);
    const agent = src.catalog.save({ ...saved, knowhow }, saved.id);
    put(src.brain, `agents/${portableId(agent.id)}/memory.md`, '- ricordo privato\n');
    const plan = await src.flows.exportPlan(agent.id, 'sbagent');
    expect(plan.items.map(i => i.id)).toEqual(expect.arrayContaining(['skills/fatture', 'rules/stile.md', 'TOOLS.md']));
    expect((await src.flows.export(plan.token, false)).ok).toBe(true);
    const zip = readZip(fs.readFileSync(src.destination));
    expect([...zip.keys()]).toEqual(expect.arrayContaining(['rules/stile.md', 'TOOLS.md', 'skills/fatture/SKILL.md', `skills/${portableId(agent.id)}/SKILL.md`]));
    expect([...zip.keys()].some(k => /memory|now\.md|journal/.test(k))).toBe(false);
    expect(zip.get('TOOLS.md')!.toString()).toContain('allowed-tools: Bash');

    const dst = world(() => {});
    const review = (await dst.flows.importInspect({ dropped: src.destination }))!;
    expect(review.rules).toEqual(['rules/stile.md']);
    const [imported] = await dst.flows.importApply(review.token, false, 'sentinel');
    expect(imported!.knowhow!.linked).toEqual(['fatture']);
    expect(fs.existsSync(path.join(dst.brain, '.claude/skills/fatture/SKILL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(dst.brain, 'rules/stile.md'), 'utf8')).toContain('Frasi brevi.');
    expect(JSON.parse(fs.readFileSync(path.join(dst.brain, 'brain.json'), 'utf8')).rules.topicFiles).toEqual(['rules/stile.md']);
    expect(fs.existsSync(path.join(dst.brain, 'now.md'))).toBe(false);
    const runtime = dst.flows.runtime(imported!.id);
    expect(fs.existsSync(path.join(runtime.skillRoot, 'fatture/SKILL.md'))).toBe(true); // preloaded at start
  });
});
