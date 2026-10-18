// Deterministic portable pack emission and tool-directory projections. The flow must guard staging before saving.
import { createHash } from 'node:crypto';
import { checkedPack, claudePackTools, SKILL_SPEC_KEYS, type AgentPackManifest, type PackTarget } from '../../../shared/agent-pack';
import { checkMd, field, parseMd, setFields } from '../../../shared/skillmd';
import { emitAgentToml } from './toml';
import { checkPackPath, writeZip, type PackFiles } from './zip';

export function hashFiles(files: PackFiles): string {
  const hash = createHash('sha256');
  for (const [name, data] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) hash.update(name).update('\0').update(String(data.length)).update('\0').update(data);
  return hash.digest('hex');
}
export const skillFiles = (files: PackFiles, name: string): PackFiles => new Map([...files].filter(([p]) => p.startsWith(`skills/${name}/`)));

export function validateSkill(name: string, body: string, allowExtra = false): string[] {
  const parsed = parseMd(body), extras = parsed.fields.filter(f => !(SKILL_SPEC_KEYS as readonly string[]).includes(f.key)).map(f => f.key);
  if (checkMd('skill', body).some(i => i.level === 'error') || field(parsed, 'name') !== name || !allowExtra && extras.length) throw new Error('Invalid portable skill frontmatter');
  return extras;
}

export function agentBody(manifest: AgentPackManifest, instructions: string): string {
  const m = manifest.agent.manifest;
  return `${instructions.trim()}\n\n## Contratto\n\n${[
    m.whenNotToUse && `Non usare: ${m.whenNotToUse}`, m.input && `Input: ${m.input}`, m.output && `Output: ${m.output}`,
    ...(m.successCriteria ?? []).map(s => `- ${s}`),
  ].filter(Boolean).join('\n')}\n\nUsa la skill \`${manifest.agent.id}\`: regole imparate e file di riferimento.\n`;
}

function agentMd(manifest: AgentPackManifest, body: string, cursor: boolean): string {
  const a = manifest.agent, desc = `${a.role}${a.manifest.whenToUse ? `. ${a.manifest.whenToUse}` : ''}`.slice(0, 1024);
  const lines = ['---', `name: ${a.id}`, `description: ${JSON.stringify(desc)}`, 'model: inherit'];
  if (!cursor) {
    if (a.effort) lines.push(`effort: ${a.effort}`);
    lines.push(`tools: ${JSON.stringify(claudePackTools(a.tools))}`, `skills: ${JSON.stringify(manifest.skills.filter(s => s.ownership === 'owned').map(s => s.name))}`);
  }
  if (!a.tools.allow.includes('edit') && !a.tools.allow.includes('shell')) lines.push('readonly: true');
  return [...lines, '---', '', body].join('\n');
}

/** Input is only skills; callers cannot accidentally include hooks, MCP, run records or raster avatars. */
export function emitPack(input: AgentPackManifest, instructions: string, skills: PackFiles, allowExtraKeys = false): PackFiles {
  const manifest = checkedPack(input), files: PackFiles = new Map();
  for (const [name, data] of skills) {
    checkPackPath(name);
    if (!/^skills\/[^/]+\/.+/.test(name) || !manifest.skills.some(s => name.startsWith(`skills/${s.name}/`))
      || /\.(exe|dll|com|so|dylib)$/i.test(name) || name.split('/').some(part => part.toLowerCase() === 'bin' || part.toLowerCase() === '.git')) throw new Error('Unsupported skill file');
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (data.includes(0)) throw new Error('Binary skill file');
    files.set(name, name.endsWith('/SKILL.md') ? Buffer.from(setFields(data.toString('utf8'), {}, ['hooks'])) : Buffer.from(data));
  }
  for (const s of manifest.skills) {
    const md = files.get(`skills/${s.name}/SKILL.md`);
    if (!md) throw new Error('Missing SKILL.md');
    validateSkill(s.name, md.toString('utf8'), allowExtraKeys);
    s.hash = hashFiles(skillFiles(files, s.name));
  }
  const a = manifest.agent, body = agentBody(manifest, instructions);
  const plugin = { name: a.id, version: `1.0.${manifest.revision}`, description: a.role };
  const json = (v: unknown): Buffer => Buffer.from(JSON.stringify(v, null, 2) + '\n');
  // Claude's strict validator requires attribution. Identify the generator, never the user's personal identity.
  files.set('.claude-plugin/plugin.json', json({ ...plugin, author: { name: 'second-brain' } })); files.set('.cursor-plugin/plugin.json', json(plugin));
  files.set('plugin.json', json({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...plugin }));
  files.set(a.instructionsFile, Buffer.from(agentMd(manifest, body, false)));
  files.set(`codex/agents/${a.id}.toml`, Buffer.from(emitAgentToml({ name: a.id, description: a.role, developer_instructions: body,
    ...(a.effort ? { model_reasoning_effort: a.effort === 'max' ? 'xhigh' : a.effort } : {}),
    ...(!a.tools.allow.includes('shell') ? { features: { shell_tool: false } } : {}) })));
  manifest.contentHash = hashFiles(files);
  files.set('sbagent.json', json(manifest));
  // Validate archive constraints before flows spend time staging/scanning.
  writeZip(files);
  return files;
}

/** Tool exports are projections of the reviewed bytes, never reads from a renderer-supplied path. */
export function emitTarget(files: PackFiles, target: PackTarget): PackFiles {
  if (target === 'sbagent') return new Map(files);
  const manifest = checkedPack(JSON.parse(files.get('sbagent.json')!.toString('utf8'))), result: PackFiles = new Map();
  const prefix = target === 'codex' ? '.agents' : `.${target}`;
  for (const [name, data] of files) if (name.startsWith('skills/')) result.set(`${prefix}/${name}`, Buffer.from(data));
  const a = manifest.agent;
  if (target === 'codex') result.set(`.codex/agents/${a.id}.toml`, Buffer.from(files.get(`codex/agents/${a.id}.toml`)!));
  else result.set(`.${target}/agents/${a.id}.md`, target === 'cursor'
    ? Buffer.from(agentMd(manifest, parseMd(files.get(a.instructionsFile)!.toString('utf8')).body, true)) : Buffer.from(files.get(a.instructionsFile)!));
  return result;
}
