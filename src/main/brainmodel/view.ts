// Read-only Memoria projection for the UI and maintenance. The on-demand read worker runs all disk scans,
// rollback checks and evidence statistics away from Electron's main thread; this function never writes or starts jobs.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { BrainModelState, LessonStub, MigrationReport, MaintenanceRun } from '../../shared/brain-model';
import { ChangeLog } from './changes';
import { claimOf, learningState, measurable, seal, type IntervalCache } from './evidence';
import { readMemory, readRules, readSkills, type SkillDir } from './model';
import { memoryStats } from './memory-stats';
import { canUndoMemoryTidy } from '../rules/memory-records';
import { portableId } from '../agents/pack/flows';
import { readLocal } from '../agents/local-store';
import { errText, log } from '../log';

export interface BrainViewInput { userData: string; root: string | null; home: string | null; profiles: AgentProfile[]; runs: AgentRun[]; now: number; lessons?: LessonStub[] }
const optionalReport = <T>(file: string): T | null => { try { return (readLocal(file) as T | undefined) ?? null; } catch { return null; } };
export function readBrainView(i: BrainViewInput, changes = new ChangeLog(i.userData), intervals: IntervalCache = new Map()): BrainModelState {
  let root: string | null = null;
  try { if (i.root && fs.statSync(i.root).isDirectory()) root = fs.realpathSync(i.root); } catch { /* disconnected brain */ }
  const profiles = i.profiles, roles = profiles.filter(p => p.scope === 'role'), dirs: SkillDir[] = [];
  if (root) for (const dir of ['.claude', '.agents']) dirs.push({ dir: path.join(root, dir, 'skills'), home: 'brain' });
  if (i.home) for (const dir of ['.claude', '.agents']) dirs.push({ dir: path.join(i.home, dir, 'skills'), home: 'user' });
  const skills = readSkills(dirs, root, profiles).map(s => ({ ...s, madeBy: changes.madeBy(s.file) }));
  const memory = readMemory(root, roles), runs = i.runs, measurableRuns = measurable(runs);
  const list = changes.list({ activeVersion: id => profiles.find(p => p.id === id)?.activeVersion ?? null,
    restore: () => { throw new Error('Read-only brain view'); },
    memory: { canUndo: u => !!root && canUndoMemoryTidy(root, u), undo: () => { throw new Error('Read-only brain view'); } } });
  if (intervals.size > 4000) intervals.clear();
  const claims = list.map(c => {
    try { return { ...c, claim: claimOf(c, changes.seedOf(c.id) ?? seal(c, roles), measurableRuns, intervals) }; }
    catch { return c; } // malformed historical evidence must not hide the rest of Memoria
  });
  let stats: BrainModelState['memoryStats'];
  if (root) try { stats = memoryStats({ root, memory, profiles: roles, runs, skills, now: i.now }); }
  catch (e) { log.warn('brain', 'memory statistics failed', { cause: errText(e), hint: 'the Memoria page shows the files without the charts' }); }
  let learning: BrainModelState['learning'];
  try { learning = learningState(claims, roles, runs, i.now, i.lessons); }
  catch (e) { log.warn('brain', 'learning page failed', { cause: errText(e), hint: 'the Apprendimento page shows no curves' }); }
  return { root, agents: roles.map(p => ({ id: p.id, name: p.name, role: p.purpose,
    skills: [...new Set([...p.skills, ...(p.knowhow?.linked ?? [])])], memory: root ? `agents/${portableId(p.id)}/memory.md` : null })),
    skills, rules: readRules(root), memory, changes: claims,
    migration: optionalReport<MigrationReport>(path.join(i.userData, 'brain-migration.json')),
    lastRun: optionalReport<MaintenanceRun>(path.join(i.userData, 'brain-maintenance.json')),
    ...(stats ? { memoryStats: stats } : {}), ...(learning ? { learning } : {}) };
}
