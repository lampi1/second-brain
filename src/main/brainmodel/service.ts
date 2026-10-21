// The brain model service (ADR 0077): the one entry point of the Brain pages and the maintenance jobs. It reads the
// model (model.ts), runs the jobs (jobs.ts) with the change log (changes.ts), adds the Memoria page's statistics
// (memory-stats.ts), each change's evidence claim and the Apprendimento page (evidence.ts, ADR 0109) and serves the read-only Classificatori view (classifiers.ts). Jobs run by themselves: the one-time migration shortly after start on a brain that has former
// runbook sections and no report yet, the corrections job right after a lesson is queued, every job every six hours,
// and all of them on the maintenance button. No job asks for approval (owner, 2026-10-19); each change is logged with
// an undo; a pass the app ran by itself that changed something is announced in the feed (`applied`: a quiet "Ruolo
// aggiornato" with Annulla, ADR 0102). Off in the test suites unless SB_BRAIN_JOBS=1 (the buttons and the IPC still work). Wired by wiring.ts and
// demo-wiring.ts; IPC 'brainmodel:*' and 'classifiers:state' (index.ts). Tests: test/unit/brainmodel/service.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { BrainChange, BrainModelState, ClassifiersState, MaintenanceJobId, MaintenanceRun, MigrationReport } from '../../shared/brain-model';
import { MAINTENANCE_JOBS } from '../../shared/brain-model';
import type { RoutingInfo } from '../../shared/contract';
import type { AgentCatalogService } from '../agents/catalog';
import type { AgentPackFlows } from '../agents/pack/flows';
import { portableId } from '../agents/pack/flows';
import type { AgentPackLearning } from '../agents/pack/learning';
import { readLocal, writeLocal } from '../agents/local-store';
import { errText, log } from '../log';
import { ChangeLog, type AgentRestorer, type AgentSnapshot } from './changes';
import { classifiersState, readJobs } from './classifiers';
import { claimOf, learningState, measurable, seal, type IntervalCache } from './evidence';
import { corrections, mergeMemory, mergeSkills, migrate, repeatedTask, type AgentWriter, type JobContext, type JobResult } from './jobs';
import { procedureSections } from './procedure-sources';
import { memoryStats } from './memory-stats';
import { readMemory, readRules, readSkills, type SkillDir } from './model';

export interface BrainModelDeps {
  userData: string;
  root: () => string | null;
  /** the user's home for their own skills (~/.claude/skills, ~/.agents/skills); null = none (demo, tests) */
  home: string | null;
  catalog: AgentCatalogService;
  packs: AgentPackFlows;
  learning: AgentPackLearning;
  runs: () => AgentRun[];
  routing: () => RoutingInfo;
  /** the skill names skills_suggest ranks for a request (skills/suggest.ts), best first */
  suggestSkills: (request: string) => Promise<string[]>;
  emit: () => void;
  /** a pass the app ran by itself (the timers, a new lesson) changed something: the feed's quiet "Ruolo aggiornato" event
   *  with its Annulla (wiring.ts → brain.publish, ADR 0102); never called for a pass the user started with the button */
  applied?: (changes: BrainChange[]) => void;
  /** run the jobs by themselves (timers); false in the test suites */
  auto: boolean;
  now?: () => number;
}

const SIX_HOURS = 6 * 3600e3;

export class BrainModelService {
  readonly log: ChangeLog;
  private readonly reportFile: string;
  private readonly runFile: string;
  private running: Promise<BrainModelState> | null = null;
  private readonly intervals: IntervalCache = new Map();
  private timers: NodeJS.Timeout[] = [];
  constructor(private readonly d: BrainModelDeps) {
    this.log = new ChangeLog(d.userData, d.now, c => seal(c, this.roles()));
    this.reportFile = path.join(d.userData, 'brain-migration.json');
    this.runFile = path.join(d.userData, 'brain-maintenance.json');
    d.learning.onProposed = () => { void this.maintain('corrections', { auto: true }).catch(() => { /* logged inside */ }); };
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private root(): string | null { const r = this.d.root(); try { return r && fs.statSync(r).isDirectory() ? fs.realpathSync(r) : null; } catch { return null; } }
  private profiles(): AgentProfile[] { try { return this.d.catalog.list().profiles; } catch { return []; } }
  private roles(): AgentProfile[] { return this.profiles().filter(p => p.scope === 'role'); }
  /** Each change with its evidence claim (sealed when it was made; an older entry is sealed with today's roles). */
  private withClaims(changes: BrainChange[], roles: AgentProfile[], runs: AgentRun[]): BrainChange[] {
    try { this.log.sealMissing(c => seal(c, roles)); } catch { /* sealed below for this read only */ }
    if (this.intervals.size > 4000) this.intervals.clear();
    const ok = measurable(runs);
    let failed = 0;
    const out = changes.map(c => {
      try { return { ...c, claim: claimOf(c, this.log.seedOf(c.id) ?? seal(c, roles), ok, this.intervals) }; }
      catch { failed++; return c; }
    });
    if (failed) log.warn('brain', 'evidence claims failed', { data: { failed }, hint: 'those changes are listed without their claim; the others keep theirs' });
    return out;
  }
  private skillDirs(root: string | null): SkillDir[] {
    const dirs: SkillDir[] = [];
    if (root) dirs.push({ dir: path.join(root, '.claude', 'skills'), home: 'brain' }, { dir: path.join(root, '.agents', 'skills'), home: 'brain' });
    if (this.d.home) dirs.push({ dir: path.join(this.d.home, '.claude', 'skills'), home: 'user' }, { dir: path.join(this.d.home, '.agents', 'skills'), home: 'user' });
    return dirs;
  }
  private restorer(): AgentRestorer {
    return {
      activeVersion: id => this.profiles().find(p => p.id === id)?.activeVersion ?? null,
      // a change that opened a trial: undoing it rejects the trial, as the feed's undo does
      restore: (id, version, expected) => {
        const p = this.profiles().find(x => x.id === id);
        if (p?.trial && p.trial.version === expected && p.activeVersion === expected && p.trial.baseline === version) this.d.catalog.rejectTrial(id, version);
        else this.d.catalog.maintainRestore(id, version, expected);
      },
    };
  }
  private writer(): AgentWriter {
    return {
      update: (id, patch, reason): AgentSnapshot | null => {
        const p = this.d.packs.profile(id);
        let knowhow: AgentProfile['knowhow'] | undefined;
        if (patch.linked !== undefined) {
          const files = this.d.packs.ownSkills(p, true);
          knowhow = this.d.packs.persistSkills(id, files, patch.linked ?? p.knowhow?.linked ?? []);
        }
        const r = this.d.catalog.maintain(id, { ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}), ...(knowhow ? { knowhow } : {}) }, reason);
        return r ? { id, before: r.before, after: r.profile.activeVersion } : null;
      },
    };
  }
  private context(root: string): JobContext {
    return {
      root, skillDir: path.join(root, '.claude', 'skills'),
      skills: () => readSkills(this.skillDirs(root), root, this.profiles()),
      profiles: () => this.profiles().filter(p => p.scope === 'role'),
      runs: () => { try { return this.d.runs(); } catch { return []; } },
      lessons: this.d.learning, agents: this.writer(), log: this.log,
      now: () => this.now(),
    };
  }
  report(): MigrationReport | null { try { return (readLocal(this.reportFile) as MigrationReport | undefined) ?? null; } catch { return null; } }
  private lastRun(): MaintenanceRun | null { try { return (readLocal(this.runFile) as MaintenanceRun | undefined) ?? null; } catch { return null; } }

  state(): BrainModelState {
    const root = this.root(), profiles = this.profiles(), restorer = this.restorer();
    const skills = readSkills(this.skillDirs(root), root, profiles).map(s => ({ ...s, madeBy: this.log.madeBy(s.file) }));
    const roles = profiles.filter(p => p.scope === 'role'), memory = readMemory(root, roles);
    const runs = (() => { try { return this.d.runs(); } catch { return []; } })();
    let stats: BrainModelState['memoryStats'];
    if (root) {
      try { stats = memoryStats({ root, memory, profiles: roles, runs, skills, now: this.now() }); }
      catch (e) { log.warn('brain', 'memory statistics failed', { cause: errText(e), hint: 'the Memoria page shows the files without the charts' }); }
    }
    const changes = this.withClaims(this.log.list(restorer), roles, runs);
    let learning: BrainModelState['learning'];
    try { learning = learningState(changes, roles, runs, this.now()); }
    catch (e) { log.warn('brain', 'learning page failed', { cause: errText(e), hint: 'the Apprendimento page shows no curves' }); }
    return {
      root,
      agents: profiles.filter(p => p.scope === 'role').map(p => ({ id: p.id, name: p.name, role: p.purpose, skills: [...new Set([...p.skills, ...(p.knowhow?.linked ?? [])])], memory: root ? `agents/${portableId(p.id)}/memory.md` : null })),
      skills, rules: readRules(root), memory,
      changes, migration: this.report(), lastRun: this.lastRun(),
      ...(stats ? { memoryStats: stats } : {}), ...(learning ? { learning } : {}),
    };
  }

  /** The change log alone, newest first, with what can still be undone (the morning block, ADR 0102): no skill or memory read. */
  changes(): BrainChange[] { return this.log.list(this.restorer()); }

  /** Runs every job (or one) once; a second call while one runs waits for it. `auto`: the app started it by itself (its
   *  changes are announced in the feed, `applied`). */
  maintain(job?: MaintenanceJobId, opts: { auto?: boolean } = {}): Promise<BrainModelState> {
    if (job !== undefined && !MAINTENANCE_JOBS.includes(job)) return Promise.reject(new Error('Unknown maintenance job'));
    if (this.running) return this.running.then(() => this.maintain(job, opts));
    const run = (async () => {
      const root = this.root();
      if (!root) throw new Error('Scegli prima la cartella del brain.');
      const ctx = this.context(root), done: JobResult[] = [];
      const before = new Set(this.log.all().map(c => c.id));
      for (const id of job ? [job] : MAINTENANCE_JOBS) {
        try {
          const r = id === 'migration' ? await migrate(ctx) : id === 'corrections' ? corrections(ctx) : id === 'repeated-task' ? repeatedTask(ctx) : id === 'merge-skills' ? mergeSkills(ctx) : mergeMemory(ctx);
          if (r.report) writeLocal(this.reportFile, mergeReport(this.report(), r.report));
          done.push(r);
        } catch (e) {
          log.warn('brain', 'maintenance job failed', { data: { job: id }, cause: errText(e), hint: 'the next pass retries; the change log shows what was applied' });
          done.push({ job: id, changes: 0, note: errText(e).slice(0, 200) });
        }
      }
      writeLocal(this.runFile, { at: this.now(), jobs: done.map(({ report: _r, ...x }) => { void _r; return x; }) } satisfies MaintenanceRun);
      if (done.some(r => r.changes)) log.info('brain', 'maintenance applied', { data: Object.fromEntries(done.map(r => [r.job, r.changes])) });
      this.d.emit();
      const state = this.state();
      const fresh = state.changes.filter(c => !before.has(c.id) && c.job !== 'user');
      if (opts.auto && fresh.length && this.d.applied) {
        try { this.d.applied(fresh); } catch (e) { log.warn('brain', 'maintenance changes not announced', { cause: errText(e), hint: 'the Skill, Regole and Memoria pages still list them with their Annulla' }); }
      }
      return state;
    })();
    this.running = run.finally(() => { this.running = null; });
    return this.running;
  }
  rollback(id: string): BrainModelState {
    const c = this.log.rollback(id, this.restorer());
    log.info('brain', 'maintenance change undone', { data: { job: c.job, kind: c.kind, target: c.target } });
    this.d.emit();
    return this.state();
  }
  /** The user declares or drops a skill for an agent (logged like a job's change, so it can be undone too). */
  link(skill: string, agentId: string, on: boolean): BrainModelState {
    const root = this.root();
    if (!root) throw new Error('Scegli prima la cartella del brain.');
    if (on && !readSkills(this.skillDirs(root), root, []).some(s => s.name === skill)) throw new Error('Skill non trovata.');
    const p = this.d.packs.profile(agentId), linked = new Set(p.knowhow?.linked ?? []);
    if (on) linked.add(skill); else linked.delete(skill);
    const snap = this.writer().update(agentId, { linked: [...linked] }, `${on ? 'Skill aggiunta' : 'Skill tolta'} dalla pagina Skill: ${skill}`);
    if (snap) this.log.record({ job: 'user', kind: 'agent', action: on ? 'link' : 'unlink', target: agentId, summary: `${p.name} ${on ? 'usa' : 'non usa più'} «${skill}»`, reason: 'Scelta tua sulla pagina Skill.', evidence: [skill] }, [], snap);
    this.d.emit();
    return this.state();
  }
  /** The brain's skills by name and description, for skills_suggest (skills/suggest.ts). */
  skillList(): { name: string; description: string }[] {
    const root = this.root();
    return readSkills(this.skillDirs(root), root, []).map(s => ({ name: s.name, description: s.description }));
  }
  /** The brain's skills with the tools each calls (model.ts skillTools), for the launch warnings (agents/skill-needs.ts). */
  skillTools(): { name: string; tools: string[] }[] {
    const root = this.root();
    return readSkills(this.skillDirs(root), root, []).map(s => ({ name: s.name, tools: s.tools }));
  }
  classifiers(): Promise<ClassifiersState> {
    return classifiersState({ root: this.root(), routing: this.d.routing(), runs: (() => { try { return this.d.runs(); } catch { return []; } })(), profiles: this.profiles(),
      suggest: goal => this.d.suggestSkills(goal), jobs: () => readJobs(path.join(this.d.userData, 'jobs.jsonl')) }, this.now());
  }

  /** Timers: the one-time migration a minute after start (when there is something to move), then every job every 6 h. */
  start(): void {
    if (!this.d.auto) return;
    const first = setTimeout(() => {
      const root = this.root();
      try { if (root && !this.report() && procedureSections(root).length) void this.maintain('migration', { auto: true }).catch(() => { /* logged */ }); } catch { /* unreadable brain */ }
    }, 60_000);
    const every = setInterval(() => { void this.maintain(undefined, { auto: true }).catch(() => { /* logged */ }); }, SIX_HOURS);
    first.unref?.(); every.unref?.();
    this.timers.push(first, every);
  }
  stop(): void { for (const t of this.timers) { clearTimeout(t); clearInterval(t); } this.timers = []; }
}

/** A re-run keeps the earlier report's items and adds the new ones (one line per former section). */
function mergeReport(old: MigrationReport | null, next: MigrationReport): MigrationReport {
  if (!old) return next;
  const items = new Map(old.items.map(i => [i.source, i]));
  for (const i of next.items) if (!items.has(i.source) || i.status === 'moved') items.set(i.source, i);
  return { at: next.at, items: [...items.values()] };
}
