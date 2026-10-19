// Portable agent-pack contracts and validation, shared by import/export and their review surfaces (ADR 0069).
import { AGENT_CATEGORIES, AGENT_SYMBOLS, AGENT_TONES, TOOL_CLASSES, PERMISSION_CEILINGS, type AgentCategory, type AgentManifest, type AgentSymbol, type AgentTone, type AgentToolPolicy, type PermissionCeiling } from './agents';
import type { Effort } from './contract';
import { NAME_RE } from './skillmd';

export type PackTarget = 'sbagent' | 'claude' | 'cursor' | 'codex';
export interface PackFinding { file: string; line: number | null; rule: string }
export interface PackExportPlan { token: string; items: { id: string; label: string; included: boolean; required: boolean; ownership?: 'owned' | 'shared' }[]; findings: PackFinding[]; warnings: string[] }
export interface PackImportReview {
  token: string; kind: string; agents: { name: string; description: string }[]; skills: string[];
  /** the brain rules the pack carries (rules/<name>.md), written to the brain when absent (ADR 0077) */
  rules: string[];
  scripts: { file: string; text: string; kind: 'file' | 'dynamic' | 'hooks' }[]; ignored: string[]; findings: PackFinding[]; clamps: string[];
  collision: { kind: 'none' | 'update' | 'present' | 'rename'; agentId?: string }; warnings: string[];
}
/** Where a lesson goes (ADR 0077): the agent's role, a skill, or the brain's rules. */
export type LessonTarget = 'role' | 'skill' | 'rule';
/** A lesson from the user's corrections. approved = applied by the maintenance job (note says where), never by a click.
 *  fromChat = proposed by a work chat on its own endpoint: it waits (the job skips it) until the authenticated
 *  Orchestrator, with the user, accepts it (agent_lessons_waiting), so a work chat never writes instructions on its own. */
export interface LearnedRuleProposal { id: string; agentId: string; rule: string; evidence: string; createdAt: number; status: 'pending' | 'approved' | 'discarded'; target?: LessonTarget; skill?: string; note?: string; fromChat?: string }
export interface AgentKnowhow { folder: string; linked: string[]; hash: string }
export interface AgentPackIdentity { id: string; revision: number; importedFrom?: string }
export interface PackStats { runs: number; successHuman: number; failHuman: number; versions: number; monthsUsed: number }
export interface PackAgent {
  id: string; name: string; role: string; category: AgentCategory; instructionsFile: string;
  manifest: AgentManifest; engine: string; model: string | null; effort?: Effort;
  tools: AgentToolPolicy; permissionCeiling: PermissionCeiling;
}
export interface AgentPackManifest {
  format: 1; packId: string; revision: number; contentHash: string; agent: PackAgent;
  icon: { symbol: AgentSymbol; tone: AgentTone };
  skills: { name: string; ownership: 'owned' | 'shared'; hash: string }[];
  createdAt: string; exportedAt: string; appVersion: string; stats?: PackStats;
}
export const SKILL_SPEC_KEYS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'] as const;
export const PACK_HASH = /^[a-f0-9]{64}$/;
export function packName(v: unknown): v is string { return typeof v === 'string' && v.length <= 64 && NAME_RE.test(v); }
export function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid agent pack object');
  return v as Record<string, unknown>;
}
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const oneOf = <T>(values: readonly T[], v: unknown): v is T => values.includes(v as T);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export function checkedPackIdentity(v: unknown): AgentPackIdentity {
  const p = record(v);
  if (typeof p.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{16}$/.test(p.id) || p.id.length > 81 || !count(p.revision) || p.revision < 1
    || !(p.importedFrom === undefined || text(p.importedFrom, 100))) throw new Error('Invalid agent pack identity');
  return { id: p.id, revision: p.revision, ...(p.importedFrom ? { importedFrom: p.importedFrom as string } : {}) };
}
export function checkedKnowhow(v: unknown): AgentKnowhow {
  const k = record(v);
  if (!text(k.folder, 240) || k.folder.startsWith('/') || /[\\:]/.test(k.folder) || k.folder.split('/').some(p => !p || p === '.' || p === '..')
    || !Array.isArray(k.linked) || k.linked.length > 100 || !k.linked.every(packName) || new Set(k.linked).size !== k.linked.length
    || typeof k.hash !== 'string' || !PACK_HASH.test(k.hash)) throw new Error('Invalid agent know-how');
  return { folder: k.folder, linked: [...k.linked], hash: k.hash };
}

/** Whitelist every persisted/exported field; untrusted manifests cannot smuggle run data or executable config. */
export function checkedPack(v: unknown): AgentPackManifest {
  const p = record(v), a = record(p.agent), icon = record(p.icon), policy = record(a.tools), manifest = record(a.manifest);
  if (p.format !== 1) throw new Error('Unsupported agent pack format; update the app');
  if (!packName(a.id) || a.id.startsWith('claude-') || !text(a.name, 80) || !text(a.role, 160) || !oneOf(AGENT_CATEGORIES, a.category)
    || a.instructionsFile !== `agents/${a.id}.md` || !text(a.engine, 60) || !/^[a-z][a-z0-9_-]*$/.test(a.engine)
    || !(a.model === null || text(a.model, 200)) || !(a.effort === undefined || oneOf(['low', 'medium', 'high', 'xhigh', 'max'] as const, a.effort))
    || !oneOf(PERMISSION_CEILINGS, a.permissionCeiling) || !Array.isArray(policy.allow) || !policy.allow.every(x => oneOf(TOOL_CLASSES, x))
    || !(policy.mcp === undefined || Array.isArray(policy.mcp) && policy.mcp.every(x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(x)))) throw new Error('Invalid packed agent');
  if (typeof p.packId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{16}$/.test(p.packId) || p.packId.length > 81 || !count(p.revision) || p.revision < 1
    || typeof p.contentHash !== 'string' || !PACK_HASH.test(p.contentHash) || !Array.isArray(p.skills) || p.skills.length > 100
    || !text(p.createdAt, 40) || !Number.isFinite(Date.parse(p.createdAt)) || !text(p.exportedAt, 40) || !Number.isFinite(Date.parse(p.exportedAt))
    || !text(p.appVersion, 60)) throw new Error('Invalid agent pack metadata');
  const skills = p.skills.map(value => {
    const s = record(value);
    if (!packName(s.name) || !oneOf(['owned', 'shared'] as const, s.ownership) || typeof s.hash !== 'string' || !PACK_HASH.test(s.hash)) throw new Error('Invalid packed skill');
    return { name: s.name, ownership: s.ownership, hash: s.hash };
  });
  if (new Set(skills.map(s => s.name)).size !== skills.length || !skills.some(s => s.name === a.id && s.ownership === 'owned')) throw new Error('Missing own skill or duplicate skill');
  const m: AgentManifest = {};
  for (const key of ['whenToUse', 'whenNotToUse', 'input', 'output'] as const) {
    if (manifest[key] !== undefined) { if (!text(manifest[key], 2000)) throw new Error('Invalid agent contract'); m[key] = manifest[key]; }
  }
  for (const key of ['declaredTools', 'accessScopes', 'successCriteria'] as const) {
    const values = manifest[key];
    if (values !== undefined) { if (!Array.isArray(values) || values.length > 50 || !values.every(x => text(x, 500))) throw new Error('Invalid agent contract'); m[key] = values; }
  }
  let stats: PackStats | undefined;
  if (p.stats !== undefined) {
    const s = record(p.stats);
    if (!['runs', 'successHuman', 'failHuman', 'versions', 'monthsUsed'].every(k => count(s[k]))) throw new Error('Invalid anonymous summary');
    stats = { runs: Number(s.runs), successHuman: Number(s.successHuman), failHuman: Number(s.failHuman), versions: Number(s.versions), monthsUsed: Number(s.monthsUsed) };
    if (stats.successHuman + stats.failHuman > stats.runs) throw new Error('Invalid anonymous summary');
  }
  return { format: 1, packId: p.packId, revision: p.revision, contentHash: p.contentHash,
    agent: { id: a.id, name: a.name, role: a.role, category: a.category, instructionsFile: a.instructionsFile as string, manifest: m,
      engine: a.engine, model: a.model as string | null, ...(a.effort === undefined ? {} : { effort: a.effort }),
      tools: { allow: [...policy.allow], ...(policy.mcp ? { mcp: [...policy.mcp as string[]] } : {}) }, permissionCeiling: a.permissionCeiling },
    icon: { symbol: oneOf(AGENT_SYMBOLS, icon.symbol) ? icon.symbol : a.category === 'development' ? 'code' : a.category === 'ops' ? 'server' : 'briefcase', tone: oneOf(AGENT_TONES, icon.tone) ? icon.tone : 'blue' },
    skills, createdAt: p.createdAt, exportedAt: p.exportedAt, appVersion: p.appVersion, ...(stats ? { stats } : {}) };
}

export function claudePackTools(policy: AgentToolPolicy): string[] {
  const names: string[] = [];
  if (policy.allow.includes('read')) names.push('Read', 'Grep', 'Glob');
  if (policy.allow.includes('edit') || policy.allow.includes('brain-write')) names.push('Edit', 'Write');
  if (policy.allow.includes('shell')) names.push('Bash', 'PowerShell');
  if (policy.allow.includes('web')) names.push('WebFetch', 'WebSearch');
  if (policy.allow.includes('mcp') || policy.allow.includes('browser')) names.push(...(policy.mcp ?? []).map(s => `mcp__${s}__*`));
  return names;
}
