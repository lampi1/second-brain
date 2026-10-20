// The shareable brain zip (ADR 0088): a colleague opens it in Claude Code, Cursor or Codex without the app. It carries
// the brain's rules, its own skills (in .agents/skills and .claude/skills, hooks dropped), the work roles as each tool's
// subagents, the scripts and a generated AGENTS.md / CLAUDE.md / README.md; never memory (me.md, now.md, the journal,
// agents/<id>/memory.md, memory/). Real catalog, temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { buildBrainShare } from '../../../src/main/agents/pack/brain-share';
import { portableId } from '../../../src/main/agents/pack/flows';
import { readAgentToml } from '../../../src/main/agents/pack/toml';
import { BRAIN_ZIP_LIMITS, readZip, writeZip } from '../../../src/main/agents/pack/zip';
import { isWorkRole } from '../../../src/shared/roles';
import type { AgentModelChoice } from '../../../src/shared/agents';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const put = (root: string, rel: string, data: string | Buffer) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), data); };
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];

function brain() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-brain-share-')); roots.push(base);
  const root = path.join(base, 'brain'), data = path.join(base, 'data'); fs.mkdirSync(root); fs.mkdirSync(data);
  put(root, 'brain.json', JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: ['code.md', 'now.md', 'Memory/notes.md', 'Agents/scout/memory.md'], appRules: true } }));
  put(root, 'code.md', '---\nwhen: {"prompt":["codice"],"tools":[],"paths":[]}\n---\n# Code\nSmall commits.\n');
  put(root, 'rules/qa.md', '# QA\nTest first.\n');
  put(root, 'me.md', '# Me\nPRIVATE-ME\n'); put(root, 'now.md', 'PRIVATE-NOW\n'); put(root, 'journal/2026-10-20.md', 'PRIVATE-JOURNAL\n');
  put(root, 'agents/scout/memory.md', 'PRIVATE-AGENT-MEMORY\n'); put(root, 'memory/shared.md', 'PRIVATE-SHARED\n'); put(root, 'Memory/notes.md', 'PRIVATE-CASED\n'); put(root, 'Agents/scout/memory.md', 'PRIVATE-CASED\n');
  put(root, '.agents/skills/deploy-check/SKILL.md', '---\nname: deploy-check\ndescription: "Check a deploy"\nhooks: {"Stop":[]}\n---\nRun the checks.\n');
  put(root, '.agents/skills/deploy-check/references/steps.md', '1. look\n');
  put(root, '.agents/skills/deploy-check/logo.png', Buffer.from([0x89, 0x50, 0, 1]));
  put(root, '.claude/skills/review-pr/SKILL.md', '---\nname: review-pr\ndescription: Review a PR\n---\nRead the diff.\n');
  put(root, '.claude/skills/deploy-check/SKILL.md', '---\nname: deploy-check\ndescription: shadowed\n---\nOld.\n');
  put(root, 'scripts/backup.mjs', '// @title Backup\nconsole.log(1);\n'); put(root, 'scripts/.deleted/old.mjs', 'gone\n'); put(root, 'scripts/notes.txt', 'not a script\n');
  const catalog = new AgentCatalogService({ userData: data, models });
  const roles = catalog.list().profiles.filter(p => isWorkRole(p.id)).map(profile => ({ profile, skillName: portableId(profile.id), own: new Map<string, Buffer>() }));
  return { root, roles };
}

describe('buildBrainShare', () => {
  it('carries rules, skills, roles and scripts for every tool, and never memory', () => {
    const { root, roles } = brain();
    const { files, summary } = buildBrainShare({ root, name: 'brain', date: '2026-10-20', roles });
    const names = [...files.keys()];
    const all = [...files.values()].map(b => b.toString('utf8')).join('\n');
    for (const secret of ['PRIVATE-ME', 'PRIVATE-NOW', 'PRIVATE-JOURNAL', 'PRIVATE-AGENT-MEMORY', 'PRIVATE-SHARED', 'PRIVATE-CASED']) expect(all).not.toContain(secret);
    expect(names.some(n => /(^|\/)(me|now)\.md$|journal|memory/.test(n))).toBe(false);
    expect(summary.rules.sort()).toEqual(['rules/code.md', 'rules/qa.md']);
    expect(summary.skills.sort()).toEqual(['deploy-check', 'review-pr']);
    for (const dir of ['.agents/skills', '.claude/skills']) {
      const md = files.get(`${dir}/deploy-check/SKILL.md`)!.toString('utf8');
      expect(md).toContain('Run the checks.'); expect(md).not.toContain('hooks'); // .agents wins over .claude; hooks dropped
      expect(files.has(`${dir}/deploy-check/references/steps.md`)).toBe(true);
      expect(files.has(`${dir}/review-pr/SKILL.md`)).toBe(true);
      expect(files.has(`${dir}/deploy-check/logo.png`)).toBe(false);
    }
    expect(summary.skipped).toContain('.agents/skills/deploy-check/logo.png');
    expect(summary.scripts).toEqual(['scripts/backup.mjs']);
    expect(summary.roles).toHaveLength(8);
    for (const id of summary.roles) {
      expect(files.get(`.claude/agents/${id}.md`)!.toString('utf8')).toMatch(/^---\nname: /);
      expect(files.get(`.cursor/agents/${id}.md`)!.toString('utf8')).not.toContain('tools:');
      expect(readAgentToml(files.get(`.codex/agents/${id}.toml`)!.toString('utf8')).name).toBe(id);
    }
    const agents = files.get('AGENTS.md')!.toString('utf8');
    expect(agents).toContain('`rules/qa.md`'); expect(agents).toContain('`deploy-check`: Check a deploy'); expect(agents).toContain('`scripts/backup.mjs`');
    expect(agents).toContain('| When the request mentions codice | `rules/code.md` |'); expect(agents).toContain('| Always | `rules/qa.md` |');
    expect(files.get('CLAUDE.md')!.toString('utf8')).toContain('@AGENTS.md');
    expect(files.get('README.md')!.toString('utf8')).toContain('Claude Code');
  });

  it('round-trips through the zip writer within the brain limits', () => {
    const { root, roles } = brain();
    const { files } = buildBrainShare({ root, name: 'brain', date: '2026-10-20', roles });
    const back = readZip(writeZip(files, BRAIN_ZIP_LIMITS), BRAIN_ZIP_LIMITS);
    expect([...back.keys()].sort()).toEqual([...files.keys()].sort());
  });

  it('works on an empty brain', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-brain-share-')); roots.push(base);
    const { files, summary } = buildBrainShare({ root: base, name: 'vuoto', date: '2026-10-20', roles: [] });
    expect(summary).toMatchObject({ skills: [], rules: [], roles: [], scripts: [] });
    expect([...files.keys()].sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'README.md']);
  });
});
