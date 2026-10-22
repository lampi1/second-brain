// Content hashes and skill checks of a role's know-how files (pack/flows.ts snapshots and runtime plugin, pack/read.ts
// sanitizer). The agent pack emission is gone with its export (ADR 0125).
import { createHash } from 'node:crypto';
import { SKILL_SPEC_KEYS } from '../../../shared/agent-pack';
import { checkMd, field, parseMd } from '../../../shared/skillmd';
import type { PackFiles } from './zip';

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
