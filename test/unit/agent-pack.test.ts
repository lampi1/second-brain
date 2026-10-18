// Agent pack interoperability and hostile-input regression tests: all processing stays local and executes no skill.
import { describe, expect, it } from 'vitest';
import { checkedPack, type AgentPackManifest } from '../../src/shared/agent-pack';
import { parseMd } from '../../src/shared/skillmd';
import { emitPack, emitTarget } from '../../src/main/agents/pack/emit';
import { approvedFiles, inspectPack } from '../../src/main/agents/pack/read';
import { emitAgentToml, readAgentToml } from '../../src/main/agents/pack/toml';
import { checkPackPath, readZip, writeZip, ZIP_LIMITS } from '../../src/main/agents/pack/zip';
import { sameBehaviour } from '../../src/main/agents/versions';

const hash = 'a'.repeat(64);
const manifest = (): AgentPackManifest => ({
  format: 1, packId: 'reviewer-0123456789abcdef', revision: 1, contentHash: hash,
  agent: { id: 'reviewer', name: 'Reviewer', role: 'Review changes', category: 'development', instructionsFile: 'agents/reviewer.md',
    manifest: { whenToUse: 'Before merging', input: 'Diff', output: 'Findings', successCriteria: ['Cite evidence'] },
    engine: 'claude', model: null, effort: 'high', tools: { allow: ['read'] }, permissionCeiling: 'default' },
  icon: { symbol: 'eye', tone: 'blue' }, skills: [{ name: 'reviewer', ownership: 'owned', hash }],
  createdAt: '2026-10-18T00:00:00Z', exportedAt: '2026-10-18T00:00:00Z', appVersion: '0.1.0',
});
const skills = () => new Map([
  ['skills/reviewer/SKILL.md', Buffer.from('---\nname: reviewer\ndescription: Review changes\n---\nRead learned-rules.md and references/checklist.md.\n')],
  ['skills/reviewer/learned-rules.md', Buffer.from('# Learned rules\n\n- Cite evidence.\n')],
  ['skills/reviewer/references/checklist.md', Buffer.from('Check boundary conditions.\n')],
]);

describe('portable agent packs', () => {
  it('round trips every byte and emits all three plugin manifests', () => {
    const files = emitPack(manifest(), 'Review the diff.', skills());
    const zip = writeZip(files), restored = readZip(zip);
    expect(writeZip(restored)).toEqual(zip);
    for (const [name, bytes] of files) expect(restored.get(name)).toEqual(bytes);
    for (const name of ['.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', 'plugin.json']) {
      expect(JSON.parse(restored.get(name)!.toString())).toMatchObject({ name: 'reviewer', version: '1.0.1', description: 'Review changes' });
    }
    expect(inspectPack(restored)).toMatchObject({ kind: 'sbagent', skills: ['reviewer'], agents: [{ name: 'reviewer' }] });
    expect(JSON.parse(restored.get('sbagent.json')!.toString())).not.toHaveProperty('stats');
  });
  it('projects portable skills and engine-specific agent fields', () => {
    const files = emitPack(manifest(), 'Review the diff.', skills());
    for (const target of ['claude', 'cursor', 'codex'] as const) {
      const projected = emitTarget(files, target), root = target === 'codex' ? '.agents' : `.${target}`;
      for (const [name, bytes] of skills()) expect(projected.get(`${root}/${name}`)).toEqual(bytes);
      if (target === 'codex') {
        const agent = readAgentToml(projected.get('.codex/agents/reviewer.toml')!.toString());
        expect(agent).toMatchObject({ name: 'reviewer', description: 'Review changes', features: { shell_tool: false }, model_reasoning_effort: 'high' });
        expect(agent.developer_instructions).toContain('## Contratto'); expect(agent).not.toHaveProperty('model');
      } else {
        const md = parseMd(projected.get(`.${target}/agents/reviewer.md`)!.toString());
        const allowed = target === 'cursor' ? ['name', 'description', 'model', 'readonly'] : ['name', 'description', 'model', 'readonly', 'effort', 'tools', 'skills'];
        expect(md.fields.every(f => allowed.includes(f.key))).toBe(true);
        expect(md.body).toContain('Usa la skill `reviewer`');
      }
    }
  });
  it('detects tampering, unsupported versions, missing own skills and unsafe identities', () => {
    const files = emitPack(manifest(), 'Review.', skills()); files.set('skills/reviewer/learned-rules.md', Buffer.from('Changed'));
    expect(() => inspectPack(files)).toThrow('hash');
    expect(() => checkedPack({ ...manifest(), format: 2 })).toThrow('update');
    expect(() => checkedPack({ ...manifest(), skills: [] })).toThrow();
    expect(() => checkedPack({ ...manifest(), agent: { ...manifest().agent, id: '../escape' } })).toThrow();
  });
  it('never carries excluded metadata and validates anonymous counts', () => {
    const pack = checkedPack({ ...manifest(), metrics: { private: true }, stats: { runs: 10, successHuman: 8, failHuman: 1, versions: 2, monthsUsed: 1, repo: 'private' } });
    expect(pack).not.toHaveProperty('metrics'); expect(pack.stats).not.toHaveProperty('repo');
    expect(() => checkedPack({ ...manifest(), stats: { runs: 0, successHuman: 1, failHuman: 0, versions: 1, monthsUsed: 0 } })).toThrow();
  });
  it('ignores foreign hooks/MCP/rules and requires script approval', () => {
    const files = skills(); files.set('plugin.json', Buffer.from('{"name":"reviewer"}'));
    files.set('hooks/hooks.json', Buffer.from('{}')); files.set('.mcp.json', Buffer.from('{}')); files.set('rules/team.mdc', Buffer.from('alwaysApply: true'));
    files.set('skills/reviewer/scripts/check.py', Buffer.from('print("review")'));
    files.set('skills/reviewer/SKILL.md', Buffer.from('---\nname: reviewer\ndescription: Review changes\nhooks: dangerous\n---\n!`echo dynamic`\nReview changes.\n'));
    const review = inspectPack(files);
    expect(review.ignored).toEqual(expect.arrayContaining(['hooks/hooks.json', '.mcp.json', 'rules/team.mdc']));
    expect(review.scripts.map(s => s.kind).sort()).toEqual(['dynamic', 'file', 'hooks']);
    const safe = approvedFiles(review, false);
    expect(safe.has('skills/reviewer/scripts/check.py')).toBe(false);
    expect(safe.get('skills/reviewer/SKILL.md')!.toString()).not.toMatch(/hooks:|!`/);
    const approved = approvedFiles(review, true);
    expect(approved.has('skills/reviewer/scripts/check.py')).toBe(true);
    expect(approved.get('skills/reviewer/SKILL.md')!.toString()).not.toContain('hooks:');
    files.set('skills/reviewer/SKILL.md', Buffer.from('---\nname: reviewer\ndescription: Review changes\n---\n!`echo\nmultiline`\nReview changes.\n'));
    const multiline = approvedFiles(inspectPack(files), false).get('skills/reviewer/SKILL.md')!.toString();
    expect(multiline).not.toContain('!`'); expect(multiline).not.toContain('multiline'); expect(multiline).toContain('Review changes.');
    files.set('payload.exe', Buffer.from('MZ')); expect(() => inspectPack(files)).toThrow('Executable');
  });
  it('rejects unsupported skill keys unless explicitly requested on export', () => {
    const files = skills(); files.set('skills/reviewer/SKILL.md', Buffer.from('---\nname: reviewer\ndescription: Review changes\ncontext: fork\n---\nReview.'));
    expect(() => emitPack(manifest(), 'Review.', files)).toThrow('frontmatter');
    expect(() => emitPack(manifest(), 'Review.', files, true)).not.toThrow();
    files.set('skills/reviewer/SKILL.md', Buffer.from('---\nname: reviewer\ndescription: Review changes\nhooks:\n  PreToolUse: dangerous\n---\nReview.'));
    expect(emitPack(manifest(), 'Review.', files, true).get('skills/reviewer/SKILL.md')!.toString()).not.toContain('hooks:');
  });
  it('round trips escaped backslashes and decodes TOML Unicode escapes', () => {
    const agent = { name: 'reviewer', description: 'Review', developer_instructions: 'Literal \\U00000041 and \\u0042, quoted "text".' };
    expect(readAgentToml(emitAgentToml(agent))).toEqual(agent);
    expect(readAgentToml('name = "reviewer"\ndescription = "Review"\ndeveloper_instructions = "\\U00000041\\u0042"').developer_instructions).toBe('AB');
  });
  it('reads standalone skills, Markdown agents and strict Codex TOML', () => {
    expect(inspectPack(new Map([['SKILL.md', skills().get('skills/reviewer/SKILL.md')!]]))).toMatchObject({ kind: 'skill', skills: ['reviewer'] });
    expect(inspectPack(new Map([['reviewer.md', Buffer.from('---\nname: reviewer\ndescription: Review\n---\nCheck changes.')]]))).toMatchObject({ kind: 'agent', agents: [{ name: 'reviewer' }] });
    const raw = "name = 'reviewer'\ndescription = 'Review'\ndeveloper_instructions = '''\nCheck changes.\nCite evidence.'''\n[features]\nshell_tool = false\n";
    expect(readAgentToml(raw).developer_instructions).toBe('Check changes.\nCite evidence.');
    for (const suffix of ['\n[mcp_servers]\na = true', '\nname = "duplicate"', '\nother = 5']) expect(() => readAgentToml(raw + suffix)).toThrow();
  });
  it('makes know-how content changes behavioral while preserving location-only moves', () => {
    const original = { instructions: 'Review.', engine: 'claude', model: null, knowhow: { folder: 'agents/reviewer', linked: [], hash } };
    expect(sameBehaviour(original, { ...original, knowhow: { ...original.knowhow, hash: 'b'.repeat(64) } })).toBe(false);
    expect(sameBehaviour(original, { ...original, knowhow: { ...original.knowhow, folder: 'other/reviewer' } })).toBe(true);
  });
});

describe('bounded ZIP reader', () => {
  it.each(['../evil', '/absolute', 'C:/drive', 'a\\b', 'a/../b', 'a//b', 'NUL.txt', 'a/COM1', 'name.', 'name ', 'a:b', 'a/'.repeat(9) + 'b'])('rejects unsafe path %s', name => {
    expect(() => checkPackPath(name)).toThrow();
  });
  it('rejects duplicates ignoring case and file/directory aliases', () => {
    expect(() => writeZip(new Map([['File', Buffer.from('a')], ['file', Buffer.from('b')]]))).toThrow();
    expect(() => writeZip(new Map([['file', Buffer.from('a')], ['file/child', Buffer.from('b')]]))).toThrow();
  });
  it('rejects damaged CRC, encrypted entries, symlinks, ZIP64, unknown methods and truncation', () => {
    const good = writeZip(new Map([['note.md', Buffer.from('hello')]]));
    const central = good.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const mutations = [
      (b: Buffer) => b.writeUInt16LE(1, central + 8),
      (b: Buffer) => b.writeUInt32LE(0xa0000000, central + 38),
      (b: Buffer) => b.writeUInt32LE(0xffffffff, central + 24),
      (b: Buffer) => b.writeUInt16LE(99, central + 10),
      (b: Buffer) => b.writeUInt32LE(7, central + 16),
      (b: Buffer) => b.writeUInt32LE(0xffffffff, b.length - 6),
    ];
    for (const mutate of mutations) { const bad = Buffer.from(good); mutate(bad); expect(() => readZip(bad)).toThrow(); }
    expect(() => readZip(good.subarray(0, good.length - 1))).toThrow();
  });
  it('enforces count, size and ratio without inflating a bomb', () => {
    expect(() => writeZip(new Map(Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => [`file-${i}`, Buffer.alloc(0)])))).toThrow();
    expect(() => writeZip(new Map([['large', Buffer.alloc(ZIP_LIMITS.file + 1)]]))).toThrow();
    const bomb = writeZip(new Map([['note', Buffer.from('hello')]]));
    const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bomb.writeUInt32LE(1000, central + 24);
    expect(() => readZip(bomb)).toThrow();
    const repetitive = Buffer.alloc(10000, 65);
    expect(readZip(writeZip(new Map([['text', repetitive]]))).get('text')).toEqual(repetitive);
  });
});
