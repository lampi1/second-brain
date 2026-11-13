// The brain's rules as shareable files (pack/rules.ts packRules, for the shareable brain zip, ADR 0088): the topic files
// and rules/, never memory, the journal, now.md or the always-loaded files; and a role's know-how at launch: its own
// skill and the shared ones it declares preload, its memory stays in the brain. The agent pack export/import that used
// to carry them is gone (ADR 0125). Real catalog and flows, temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { AgentPackFlows, portableId } from '../../../src/main/agents/pack/flows';
import { packRules } from '../../../src/main/agents/pack/rules';
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
  const catalog = new AgentCatalogService({ userData: data, models });
  const flows = new AgentPackFlows({ catalog, brainRoot: () => brain, tempRoot: base,
    sharedSkills: () => { const dir = path.join(brain, '.claude', 'skills'); try { return fs.readdirSync(dir).map(name => ({ name, folder: path.join(dir, name) })); } catch { return []; } } });
  return { base, brain, catalog, flows };
}

describe('packRules', () => {
  it('takes the topic files and rules/, never memory, the profile or the always-loaded files', () => {
    const w = world(b => {
      put(b, 'brain.json', JSON.stringify({ rules: { topicFiles: ['rules/stile.md', 'me.md', 'agents/x/memory.md', 'code.md'] } }));
      put(b, 'rules/stile.md', `${WHEN}# Stile\nFrasi brevi.\n`); put(b, 'rules/altro.md', '# Altro\nSempre il percorso.\n'); put(b, 'code.md', '# Codice\nTest prima.\n');
      put(b, 'me.md', '# Io\n'); put(b, 'agents/x/memory.md', '- ricordo\n'); put(b, 'now.md', '- filo\n'); put(b, 'rules/db-credentials.md', 'x');
    });
    expect([...packRules(w.brain).keys()]).toEqual(['rules/stile.md', 'rules/code.md', 'rules/altro.md']);
  });
});

describe('a role\'s know-how at launch', () => {
  it('preloads its own skill and the shared ones it declares; its memory stays in the brain', () => {
    const w = world(b => {
      put(b, '.claude/skills/fatture/SKILL.md', '---\nname: fatture\ndescription: Esportare le fatture\nallowed-tools: Bash\n---\n1. Esporta.\n');
    });
    const saved = w.catalog.list().profiles.find(p => p.id === 'sentinel')!;
    const knowhow = w.flows.persistSkills(saved.id, w.flows.ownSkills(saved, true), ['fatture']);
    const agent = w.catalog.save({ ...saved, knowhow }, saved.id);
    put(w.brain, `agents/${portableId(agent.id)}/memory.md`, '- ricordo privato\n');
    const runtime = w.flows.runtime(agent.id);
    expect(fs.existsSync(path.join(runtime.skillRoot, 'fatture/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(runtime.skillRoot, `${portableId(agent.id)}/SKILL.md`))).toBe(true);
    expect(fs.readdirSync(runtime.pluginDir, { recursive: true }).map(String).some(f => /memory/.test(f))).toBe(false);
    expect(runtime.memory).not.toContain('- ricordo privato');
    expect(runtime.memory).toContain('memory_recall');
    expect(fs.readFileSync(path.join(w.brain, `agents/${portableId(agent.id)}/memory.md`), 'utf8')).toBe('- ricordo privato\n');
  });
});
