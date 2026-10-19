// Inspect foreign packs without executing content or writing to the brain. Apply flows consume only reviewed files.
// A pack's rules (rules/<name>.md) and TOOLS.md are kept as reviewed text (ADR 0077); TOOLS.md never grants anything.
import fs from 'node:fs';
import path from 'node:path';
import { checkedPack, packName, type AgentPackManifest } from '../../../shared/agent-pack';
import { checkMd, field, parseMd, setFields } from '../../../shared/skillmd';
import { hashFiles, skillFiles, validateSkill } from './emit';
import { RULE_FILE, TOOLS_FILE } from './rules';
import { emitAgentToml, readAgentToml } from './toml';
import { checkPackPath, readZip, ZIP_LIMITS, type PackFiles } from './zip';

export interface PackInspection {
  kind: 'sbagent' | 'claude' | 'cursor' | 'codex' | 'skill' | 'agent';
  manifest?: AgentPackManifest;
  files: PackFiles;
  agents: { name: string; description: string; instructions: string; file: string }[];
  skills: string[];
  /** the brain rules it carries (rules/<name>.md) */
  rules: string[];
  scripts: { file: string; text: string; kind: 'file' | 'dynamic' | 'hooks' }[];
  ignored: string[];
  warnings: string[];
}
const textOf = (data: Buffer): string => {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  if (text.includes('\0')) throw new Error('Binary files cannot be imported');
  return text;
};
const executable = (name: string): boolean => /\.(exe|dll|com|so|dylib)$/i.test(name);
const script = (name: string): boolean => name.split('/').includes('scripts') || /\.(sh|ps1|py|js|mjs|cjs|cmd|bat)$/i.test(name);

/** Folder imports use the same limits as archives and refuse symlinks, even when their targets are inside the folder. */
export function readPackSource(source: string): PackFiles {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links cannot be imported');
  if (stat.isFile()) {
    if (stat.size > ZIP_LIMITS.packed) throw new Error('Pack too large');
    if (/\.(sbagent|zip)$/i.test(source)) return readZip(fs.readFileSync(source));
    const name = path.basename(source);
    if (!/\.(md|toml)$/i.test(name) || stat.size > ZIP_LIMITS.file) throw new Error('Unsupported import file');
    checkPackPath(name);
    return new Map([[name, fs.readFileSync(source)]]);
  }
  if (!stat.isDirectory()) throw new Error('Unsupported import source');
  const files: PackFiles = new Map(), names = new Set<string>(); let total = 0, entries = 0;
  const walk = (folder: string, prefix: string): void => {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const name = prefix + item.name; checkPackPath(name);
      if (++entries > ZIP_LIMITS.entries || names.has(name.toLowerCase())) throw new Error('Too many or duplicate entries');
      names.add(name.toLowerCase());
      const full = path.join(folder, item.name), info = fs.lstatSync(full);
      if (info.isSymbolicLink()) throw new Error('Symbolic links cannot be imported');
      if (info.isDirectory()) walk(full, name + '/');
      else if (info.isFile()) {
        total += info.size;
        if (info.size > ZIP_LIMITS.file || total > ZIP_LIMITS.unpacked) throw new Error('Pack too large');
        files.set(name, fs.readFileSync(full));
      } else throw new Error('Unsupported file type');
    }
  };
  walk(source, ''); return files;
}

export function inspectPack(input: PackFiles): PackInspection {
  let kind: PackInspection['kind'];
  let manifest: AgentPackManifest | undefined;
  if (input.has('sbagent.json')) {
    kind = 'sbagent'; manifest = checkedPack(JSON.parse(textOf(input.get('sbagent.json')!)));
    if (manifest.contentHash !== hashFiles(new Map([...input].filter(([name]) => name !== 'sbagent.json')))) throw new Error('Pack content hash mismatch');
    for (const skill of manifest.skills) if (skill.hash !== hashFiles(skillFiles(input, skill.name))) throw new Error('Skill hash mismatch');
  } else if (input.has('.claude-plugin/plugin.json')) kind = 'claude';
  else if (input.has('.cursor-plugin/plugin.json')) kind = 'cursor';
  else if (input.has('plugin.json') || input.has('.codex-plugin/plugin.json')) kind = 'codex';
  else if (input.has('SKILL.md')) kind = 'skill';
  else if (input.size === 1 && /\.(md|toml)$/.test([...input.keys()][0]!)) kind = 'agent';
  else throw new Error('Unsupported agent pack layout');
  const result: PackInspection = { kind, ...(manifest ? { manifest } : {}), files: new Map(), agents: [], skills: [], rules: [], scripts: [], ignored: [], warnings: [] };
  let plainSkill: string | undefined;
  if (kind === 'skill') { plainSkill = field(parseMd(textOf(input.get('SKILL.md')!)), 'name'); if (!packName(plainSkill)) throw new Error('Invalid skill name'); }
  for (const [original, data] of input) {
    checkPackPath(original);
    const name = plainSkill ? `skills/${plainSkill}/${original}` : original;
    if (executable(name)) throw new Error('Executable files cannot be imported');
    // Ignore configs and auto-applied content before interpreting anything as a skill or agent.
    if (/(^|\/)(hooks|bin|commands|\.git)(\/|$)/i.test(name) || /(^|\/)(\.?mcp\.json|settings\.json)$/i.test(name) || /\.mdc$/i.test(name)) { result.ignored.push(original); continue; }
    if (manifest && name === `codex/agents/${manifest.agent.id}.toml`) { result.warnings.push('Generated Codex agent is regenerated from the source agent'); continue; }
    if (/^skills\/[^/]+\//.test(name)) {
      const content = textOf(data), skillName = name.split('/')[1]!;
      if (!packName(skillName)) throw new Error('Invalid skill folder');
      if (name === `skills/${skillName}/SKILL.md`) {
        const extras = validateSkill(skillName, content, true);
        result.skills.push(skillName);
        if (extras.length) result.warnings.push(`${name}: nonstandard frontmatter: ${extras.join(', ')}`);
        if (parseMd(content).fields.some(f => f.key === 'hooks')) result.scripts.push({ file: name, text: content, kind: 'hooks' });
        if (/!`[^`]*`/.test(content)) result.scripts.push({ file: name, text: content, kind: 'dynamic' });
      }
      if (script(name)) result.scripts.push({ file: name, text: content, kind: 'file' });
      result.files.set(name, Buffer.from(data)); continue;
    }
    if (!plainSkill && (RULE_FILE.test(name) || name === TOOLS_FILE)) {
      textOf(data);
      if (data.length > 256 * 1024) throw new Error('Pack file too large');
      if (name !== TOOLS_FILE) result.rules.push(name);
      result.files.set(name, Buffer.from(data)); continue;
    }
    if (/^(?:(?:\.claude|\.cursor)\/)?agents\/[^/]+\.md$/.test(name) || kind === 'agent' && name.endsWith('.md')) {
      const content = textOf(data), parsed = parseMd(content);
      if (checkMd('agent', content).some(i => i.level === 'error')) throw new Error('Invalid agent markdown');
      const agentName = field(parsed, 'name')!;
      result.agents.push({ name: agentName, description: field(parsed, 'description')!, instructions: parsed.body, file: name });
      // Foreign configuration is not copied even if it is embedded in agent frontmatter.
      result.files.set(name, Buffer.from(setFields(content, {}, parsed.fields.filter(f => !['name', 'description', 'model', 'effort', 'tools', 'readonly', 'skills'].includes(f.key)).map(f => f.key))));
      continue;
    }
    if (/^(?:codex|\.codex)\/agents\/[^/]+\.toml$/.test(name) || kind === 'agent' && name.endsWith('.toml')) {
      const agent = readAgentToml(textOf(data));
      if (!packName(agent.name) || agent.description.length > 1024) throw new Error('Invalid Codex agent identity');
      result.agents.push({ name: agent.name, description: agent.description, instructions: agent.developer_instructions, file: name });
      result.files.set(name, Buffer.from(emitAgentToml(agent))); continue;
    }
    result.ignored.push(original);
  }
  for (const name of result.files.keys()) if (name.startsWith('skills/') && !result.skills.includes(name.split('/')[1]!)) throw new Error('Skill files without SKILL.md');
  if (manifest && (!result.agents.some(a => a.file === manifest.agent.instructionsFile && a.name === manifest.agent.id)
    || result.skills.length !== manifest.skills.length || manifest.skills.some(s => !result.skills.includes(s.name)))) throw new Error('Incomplete agent pack');
  if (!result.agents.length && !result.skills.length) throw new Error('Empty agent pack');
  return result;
}

/** Approval is explicit. Unapproved dynamic shell, hooks and script files are removed from the imported copy only. */
export function approvedFiles(review: PackInspection, approveScripts: boolean): PackFiles {
  const files = new Map(review.files);
  for (const [name, data] of files) {
    if (!approveScripts && script(name)) { files.delete(name); continue; }
    if (name.endsWith('/SKILL.md')) {
      // Foreign hooks never travel, even when script files are approved.
      let text = setFields(textOf(data), {}, ['hooks']);
      if (!approveScripts) text = text.replace(/^.*!`[^`]*`.*(?:\r?\n|$)/gm, '');
      files.set(name, Buffer.from(text));
    }
  }
  return files;
}
