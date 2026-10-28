// Brain pages and maintenance dispatch. Structural migration, approved lessons and non-loadable candidates may run
// automatically; semantic rewrites require an exact proposal and the existing explicit user review (ADR 0137).
// Timers and the generic maintenance button never authorize new rules, skill merges or memory rewrites.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { BrainChange, BrainModelState, ClassifiersState, LogScan, MaintenanceJobId, MaintenanceRun, MigrationReport } from '../../shared/brain-model';
import { MAINTENANCE_JOBS } from '../../shared/brain-model';
import type { RoutingInfo } from '../../shared/contract';
import type { AgentCatalogService } from '../agents/catalog';
import type { AgentPackFlows } from '../agents/pack/flows';
import type { AgentPackLearning } from '../agents/pack/learning';
import { readLocal, writeLocal } from '../agents/local-store';
import { errText, log } from '../log';
import { ChangeLog, type AgentRestorer, type AgentSnapshot } from './changes';
import { classifiersState, readJobs } from './classifiers';
import { seal, type IntervalCache } from './evidence';
import { appendUnder, brainJsonWithTopic, corrections, LESSONS_RULE, LESSONS_WHEN, migrate, repeatedTask, skillText, type AgentWriter, type JobContext, type JobResult } from './jobs';
import { ignoreWrite, sourceOfSkill } from './migration-ignore';
import { procedureSections } from './procedure-sources';
import type { UpgradeAsk } from './upgrade';
import { readBrainView, type BrainViewInput } from './view';
import { readWorker } from '../read-work';
import { readNoise, scanLogs, writeNoise } from './log-scan';
import { readRules, readSkills, readSmall, type SkillDir } from './model';
import type { ResearchProposal } from '../../shared/maintenance-research';
import { NAME_RE, parseMd, setBody } from '../../shared/skillmd';
import { checkPermissionText } from '../agents/tool-policy';
import { canUndoMemoryTidy, undoMemoryTidy } from '../rules/memory-records';

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
  /** the app's log folder (log.ts): the log step of a pass the user starts (#150); absent = no log step */
  logDir?: () => string | null;
  /** the cards the pass the user started makes from its log step and the skills nobody uses (ADR 0132, before it the
   *  pass's result went to the Orchestrator, #150); absent = no cards */
  findings?: (logs: LogScan) => { bugs: number; forget: number };
  /** Compatibility input for a future reviewed upgrade; generic maintenance does not rewrite layout metadata. */
  appVersion?: () => string;
  /** Compatibility input for reviewed rewrites; never invoked by automatic or generic manual maintenance. */
  upgradeAsk?: UpgradeAsk;
  /** the brain's scripts (brain/scripts.ts): a script's file by its id, and the hook that tells the Script tab it changed;
   *  absent = scripts cannot be removed here (ADR 0122) */
  scripts?: { file: (id: string) => string; changed: () => void };
  /** run the jobs by themselves (timers); false in the test suites */
  auto: boolean;
  now?: () => number;
}

export class BrainModelService {
  readonly log: ChangeLog;
  private readonly reportFile: string;
  private readonly runFile: string;
  /** the log groups the user marked "noto, ignora" (#150) */
  private readonly noiseFile: string;
  private running: Promise<BrainModelState> | null = null;
  private readonly intervals: IntervalCache = new Map();
  private timers: NodeJS.Timeout[] = [];
  constructor(private readonly d: BrainModelDeps) {
    this.log = new ChangeLog(d.userData, d.now, c => seal(c, this.roles()));
    this.reportFile = path.join(d.userData, 'brain-migration.json');
    this.runFile = path.join(d.userData, 'brain-maintenance.json');
    this.noiseFile = path.join(d.userData, 'maintenance-noise.json');
    d.learning.onProposed = () => { void this.maintain('corrections', { auto: true }).catch(() => { /* logged inside */ }); };
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private root(): string | null { const r = this.d.root(); try { return r && fs.statSync(r).isDirectory() ? fs.realpathSync(r) : null; } catch { return null; } }
  private profiles(): AgentProfile[] { try { return this.d.catalog.list().profiles; } catch { return []; } }
  private roles(): AgentProfile[] { return this.profiles().filter(p => p.scope === 'role'); }
  private skillDirs(root: string | null): SkillDir[] {
    const dirs: SkillDir[] = [];
    if (root) dirs.push({ dir: path.join(root, '.claude', 'skills'), home: 'brain' }, { dir: path.join(root, '.agents', 'skills'), home: 'brain' });
    if (this.d.home) dirs.push({ dir: path.join(this.d.home, '.claude', 'skills'), home: 'user' }, { dir: path.join(this.d.home, '.agents', 'skills'), home: 'user' });
    return dirs;
  }
  private restorer(profiles?: readonly AgentProfile[]): AgentRestorer {
    return {
      activeVersion: id => (profiles ?? this.profiles()).find(p => p.id === id)?.activeVersion ?? null,
      // a change that opened a trial: undoing it rejects the trial, as the feed's undo does
      restore: (id, version, expected) => {
        const p = this.profiles().find(x => x.id === id);
        if (p?.trial && p.trial.version === expected && p.activeVersion === expected && p.trial.baseline === version) this.d.catalog.rejectTrial(id, version);
        else this.d.catalog.maintainRestore(id, version, expected);
      },
      // a memory tidy-up (ADR 0129): undone in the store of the brain it was made in, only while its facts are unchanged
      memory: {
        canUndo: u => { const root = this.root(); return !!root && canUndoMemoryTidy(root, u); },
        undo: u => { const root = this.root(); if (!root) throw new Error('Scegli prima la cartella del brain.'); undoMemoryTidy(root, u); },
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
        const r = this.d.catalog.maintain(id, { ...(patch.skills !== undefined ? { skills: patch.skills } : {}), ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}), ...(knowhow ? { knowhow } : {}) }, reason);
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
  /** A requested maintenance pass repairs only absent declarations. Each role correction has its own Undo. */
  private repairMissingSkills(): JobResult {
    const plans = this.roles().filter(p => !p.trial).map(p => ({ p, missing: this.d.packs.missingSkills(p) }));
    let changes = 0;
    for (const { p, missing } of plans) {
      if (!missing.length) continue;
      const result = this.d.catalog.maintain(p.id, { skills: p.skills.filter(s => !missing.includes(s)),
        ...(p.knowhow ? { knowhow: { ...p.knowhow, linked: p.knowhow.linked.filter(s => !missing.includes(s)) } } : {}) },
      'Manutenzione: rimossi riferimenti a skill non più disponibili');
      const snap = result ? { id: p.id, before: result.before, after: result.profile.activeVersion } : null;
      if (snap) {
        this.log.record({ job: 'merge-skills', kind: 'agent', action: 'unlink', target: p.id,
          summary: `${p.name}: riferimenti a skill mancanti rimossi`, reason: 'Inventario completo del runtime: skill assenti anche nelle copie personali e incorporate.', evidence: missing }, [], snap);
        changes++;
      }
    }
    return { job: 'merge-skills', changes, note: 'Solo riferimenti mancanti rimossi; per fondere i contenuti serve approvazione esplicita.' };
  }
  report(): MigrationReport | null { try { return (readLocal(this.reportFile) as MigrationReport | undefined) ?? null; } catch { return null; } }
  private lastRun(): MaintenanceRun | null { try { return (readLocal(this.runFile) as MaintenanceRun | undefined) ?? null; } catch { return null; } }

  private viewInput(): BrainViewInput {
    const profiles = this.profiles();
    // Old entries are sealed once, in the writer process; the read worker never changes evidence scope.
    try { this.log.sealMissing(c => seal(c, profiles.filter(p => p.scope === 'role'))); } catch { /* view retains the previous fail-soft fallback */ }
    let runs: AgentRun[] = []; try { runs = this.d.runs(); } catch { /* unavailable history */ }
    return { userData: this.d.userData, root: this.d.root(), home: this.d.home, profiles, runs, now: this.now() };
  }
  state(): BrainModelState { return readBrainView(this.viewInput(), this.log, this.intervals); }
  stateAsync(): Promise<BrainModelState> { return readWorker.call({ op: 'brain', input: this.viewInput() }); }

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
          // A timer or the generic maintenance button is not approval of unseen semantic edits. Keep this an
          // allowlist: future jobs must supply a concrete reviewed proposal before entering the mutation path.
          const r: JobResult = id === 'migration' ? migrate(ctx)
            : id === 'corrections' ? { ...corrections(ctx), note: 'Solo lezioni già approvate; gli errori ricorrenti restano da proporre con evidenze e approvare.' }
            : id === 'repeated-task' ? repeatedTask(ctx)
            : id === 'merge-skills' && !opts.auto ? this.repairMissingSkills()
            : { job: id, changes: 0, note: 'Modifica rinviata: serve una proposta concreta in Proposte e l’approvazione esplicita prima di cambiare skill, memoria o struttura.' };
          if (r.report) writeLocal(this.reportFile, mergeReport(this.report(), r.report));
          done.push(r);
        } catch (e) {
          log.warn('brain', 'maintenance job failed', { data: { job: id }, cause: errText(e), hint: 'the next pass retries; the change log shows what was applied' });
          done.push({ job: id, changes: 0, note: errText(e).slice(0, 200) });
        }
      }
      const previous = this.lastRun();
      // logsAt goes forward through every pass (a timer's too): the next log step reads only what came after the last one
      const pass: MaintenanceRun = { at: this.now(), jobs: done.map(({ report: _r, ...x }) => { void _r; return x; }), ...(previous?.logsAt !== undefined ? { logsAt: previous.logsAt } : {}) };
      // the full pass the user started also reads the logs (#150) and turns what it found into cards: app bugs in «Idee
      // dell'app», skills nobody uses in Proposte (ADR 0132); a timer's pass does not
      const dir = !job && !opts.auto ? this.d.logDir?.() ?? null : null;
      if (dir) {
        pass.logs = scanLogs(dir, previous?.logsAt ?? null, readNoise(this.noiseFile), this.now());
        pass.logsAt = this.now();
        try { if (this.d.findings) pass.cards = this.d.findings(pass.logs); }
        catch (e) { log.warn('brain', 'maintenance cards not made', { cause: errText(e), hint: 'the log groups stay listed in the dialog; the next pass tries again' }); }
        log.info('brain', 'maintenance log step', { data: { files: pass.logs.files.length, groups: pass.logs.groups.length, fresh: pass.logs.groups.filter(g => !g.known).length, ...pass.cards } });
      }
      writeLocal(this.runFile, pass);
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
  /** The user marks a log group as known noise (or not any more): it is listed apart and never handed on again (#150). */
  noise(key: string, known: boolean): BrainModelState {
    const set = readNoise(this.noiseFile);
    if (known) set.add(key); else set.delete(key);
    writeNoise(this.noiseFile, set);
    const run = this.lastRun();
    // the last pass's list shows the new mark at once
    if (run?.logs) writeLocal(this.runFile, { ...run, logs: { ...run.logs, groups: run.logs.groups.map(g => { const { known: _k, ...rest } = g; void _k; return g.key === key ? { ...rest, ...(known ? { known: true as const } : {}) } : g; }) } });
    log.info('brain', 'log group marked', { data: { known } });
    this.d.emit();
    return this.state();
  }
  rollback(id: string): BrainModelState {
    const c = this.log.rollback(id, this.restorer());
    log.info('brain', 'maintenance change undone', { data: { job: c.job, kind: c.kind, target: c.target } });
    if (c.kind === 'script') this.d.scripts?.changed();
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
  /** The Memoria hub's trash (ADR 0122): removes one brain skill (its whole folder), one rules/ file or one script
   *  through the change log, so its «Annulla» puts every file back. Only what lives in the brain: the user's own and
   *  Cursor's skills, the always-loaded files (CLAUDE.md and the like) and files too big to keep a copy of are refused. */
  remove(kind: 'skill' | 'rule' | 'script', target: string, by?: { job: 'research'; reason: string; evidence: string[] }): { state: BrainModelState; changeId: string } {
    const root = this.root();
    if (!root) throw new Error('Scegli prima la cartella del brain.');
    const decisions: { file: string; text: string }[] = [];
    let files: string[] = [], summary = '', reason = by?.reason ?? 'Eliminata da te in Memoria → Approvate.', evidence: string[] = [];
    if (kind === 'skill') {
      const skill = readSkills(this.skillDirs(root), root, []).find(x => x.name === target && x.home === 'brain');
      if (!skill) throw new Error('Skill del brain non trovata.');
      const dir = path.dirname(skill.file);
      if (!insideBrain(root, dir)) throw new Error('Questa skill è un collegamento fuori dal brain: eliminala dal disco.');
      files = listFiles(dir);
      if (files.some(f => !isText(f))) throw new Error('La skill ha file non di testo (modelli, immagini): non si potrebbero rimettere con Annulla, eliminala dal disco.');
      const source = sourceOfSkill(readSmall(skill.file) ?? '', procedureSections(root));
      if (source) decisions.push(ignoreWrite(root, source, skill.name, this.now()));
      summary = `Skill «${skill.name}» eliminata`; evidence = [skill.rel ?? skill.file];
    } else if (kind === 'rule') {
      const rel = target.replace(/\\/g, '/');
      const r = readRules(root).find(x => x.file === rel);
      if (!r) throw new Error('Regola non trovata.');
      if (!/^rules\/[^/]+\.md$/i.test(r.file) || r.loaded === 'always') throw new Error('Questo file è sempre caricato: si modifica, non si elimina da qui.');
      files = [path.join(root, r.file)];
      summary = `Regola «${r.title}» eliminata`; evidence = [r.file];
    } else {
      if (!this.d.scripts) throw new Error('Gli script non si possono eliminare qui.');
      files = [this.d.scripts.file(target)];
      summary = `Script «${target}» eliminato`; reason = by?.reason ?? 'Eliminato da te in Memoria → Approvate.'; evidence = [`scripts/${target}`];
    }
    if (!files.length) throw new Error('Niente da eliminare.');
    if (files.length > 64 || files.some(f => { try { return fs.statSync(f).size > 256 * 1024; } catch { return true; } })) throw new Error('Troppo grande per poterlo annullare: eliminalo dal disco.');
    const c = this.log.apply({ job: by?.job ?? 'user', kind, action: 'remove', target, summary, reason, evidence: [...evidence, ...(by?.evidence ?? [])], ...(decisions.length ? { migrationIgnored: true } : {}) }, [...files.map(file => ({ file, text: null })), ...decisions]);
    if (!c) throw new Error('Niente da eliminare.');
    log.info('brain', by ? 'item forgotten (maintenance card)' : 'item removed by the user', { data: { kind, files: files.length } });
    if (kind === 'script') this.d.scripts?.changed();
    this.d.emit();
    return { state: this.state(), changeId: c.id };
  }
  /** A maintenance finding the user approved in Proposte (ADR 0132), through the change log (its «Annulla» puts the brain
   *  back): a skill (new, or a section added to one of the brain's), a rule (a role's text, or rules/lessons.md for
   *  every role), a memory line (a role's memory or the shared one), a line in a role's text, or what to forget (a brain
   *  skill, a rules/ file, one memory line). Returns the change's id. Never grants permissions (checkPermissionText). */
  applyResearch(p: ResearchProposal): string {
    const root = this.root();
    if (!root) throw new Error('Scegli prima la cartella del brain.');
    const why = oneLine(p.why, 400), evidence = [`maintenance:${p.id}`, ...p.evidence.slice(0, 5).map(e => oneLine(e, 200))];
    const roleOf = (id: string | undefined) => {
      if (!id) return null;
      const r = this.roles().find(x => x.id === id);
      if (!r) throw new Error(`Ruolo sconosciuto: ${id}.`);
      return r;
    };
    if (p.kind === 'forget') {
      const f = p.forget;
      if (!f) throw new Error('Proposta senza cosa dimenticare.');
      if (f.what !== 'skill' && f.what !== 'rule') throw new Error('Si dimenticano solo skill e regole.');
      return this.remove(f.what, f.name, { job: 'research', reason: why, evidence }).changeId;
    }
    const ch = p.change;
    if (!ch) throw new Error('Proposta senza modifica da applicare.');
    checkPermissionText(ch.text);
    const text = ch.text.trim(), stamp = `(${new Date(this.now()).toISOString().slice(0, 10)}; manutenzione)`;
    if (!text || text.length > 8000) throw new Error('Testo della modifica vuoto o troppo lungo.');
    const role = roleOf(ch.role);
    if (ch.target === 'skill') {
      const name = ch.name ?? '';
      if (!NAME_RE.test(name) || name.length > 64) throw new Error('Nome della skill non valido.');
      const have = readSkills(this.skillDirs(root), root, []).find(s => s.name === name);
      if (have && have.home !== 'brain') throw new Error('Questa skill è tua (fuori dal brain): la manutenzione non la cambia.');
      const file = have?.file ?? path.join(root, '.claude', 'skills', name, 'SKILL.md');
      const before = have ? readSmall(file) : null;
      if (have && before === null) throw new Error('Skill non leggibile.');
      const next = before !== null ? setBody(before, appendUnder(parseMd(before).body, 'Dalla manutenzione', text)) : skillText(name, oneLine(p.title, 300), text);
      // the role it is for declares it, in the same change: «Annulla» takes back the skill and the link together
      const linked = role ? this.d.packs.profile(role.id).knowhow?.linked ?? [] : null;
      const snap = role && linked && !linked.includes(name) ? this.writer().update(role.id, { linked: [...linked, name] }, `Manutenzione: skill ${name}`) : null;
      const c = this.log.apply({ job: 'research', kind: 'skill', action: have ? 'update' : 'create', target: name, summary: `${have ? 'Skill aggiornata' : 'Nuova skill'} «${name}»${role && snap ? ` per ${role.name}` : ''}: ${oneLine(p.title, 100)}`, reason: why, evidence }, [{ file, text: next }], snap ?? undefined);
      if (!c) throw new Error('Niente da cambiare.');
      return this.done(c.id);
    }
    if (ch.target === 'rule' && !role) {
      const file = path.join(root, LESSONS_RULE), had = readSmall(file);
      // a lessons file that is there but not readable here (a link, too big) is never replaced by a new one
      if (had === null && fs.existsSync(file)) throw new Error(`${LESSONS_RULE} non si può leggere qui: la manutenzione non lo riscrive.`);
      const writes = [{ file, text: appendUnder(had ?? LESSONS_WHEN, 'Dalla manutenzione', `- ${oneLine(text, 600)} ${stamp}`) }];
      const cfg = brainJsonWithTopic(root, LESSONS_RULE);
      if (cfg) writes.push(cfg);
      const c = this.log.apply({ job: 'research', kind: 'rule', action: 'update', target: LESSONS_RULE, summary: `Regola: ${oneLine(text, 120)}`, reason: why, evidence }, writes);
      if (!c) throw new Error('Niente da cambiare.');
      return this.done(c.id);
    }
    // a rule for one role, or a line of its text: in the role's own text (a new version, like the corrections job)
    if (!role) throw new Error('Manca il ruolo a cui va la modifica.');
    const instructions = appendUnder(role.instructions, 'Dalla manutenzione', `- ${oneLine(text, 800)} ${stamp}`);
    if (instructions.length > 8000) throw new Error(`Il testo di ${role.name} è al limite di 8000 caratteri: prima va accorciato.`);
    const snap = this.writer().update(role.id, { instructions }, `Manutenzione: ${oneLine(p.title, 100)}`);
    if (!snap) throw new Error('Il ruolo non si può cambiare adesso (forse è in prova).');
    const c = this.log.record({ job: 'research', kind: 'agent', action: 'update', target: role.id, summary: `${role.name}: ${oneLine(text, 140)}`, reason: why, evidence }, [], snap);
    return this.done(c.id);
  }
  private done(changeId: string): string { this.d.emit(); return changeId; }
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

  /** The structural migration once, a minute after the start. Nothing else runs by itself: the cleanup, the memory's
   *  tidy-up and every proposal wait for the user's «Manutenzione» (owner, 2026-10-24, ADR 0153; until then a timer
   *  ran the safe jobs every six hours). */
  start(): void {
    if (!this.d.auto) return;
    const first = setTimeout(() => {
      const root = this.root();
      try { if (root && !this.report() && procedureSections(root).length) void this.maintain('migration', { auto: true }).catch(() => { /* logged */ }); } catch { /* unreadable brain */ }
    }, 60_000);
    first.unref?.();
    this.timers.push(first);
  }
  stop(): void { for (const t of this.timers) { clearTimeout(t); clearInterval(t); } this.timers = []; }
}

const oneLine = (s: string, n: number): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The folder and every folder up to the brain are real folders inside it, none a link (a skill folder linked to
 *  ~/.claude/skills would delete the files at the link's target). */
function insideBrain(root: string, dir: string): boolean {
  try {
    const top = path.resolve(root);
    for (let d = path.resolve(dir); d !== top; d = path.dirname(d)) {
      if (d === path.dirname(d) || fs.lstatSync(d).isSymbolicLink()) return false;
    }
    return fs.realpathSync(dir).startsWith(fs.realpathSync(root));
  } catch { return false; }
}
/** A file the change log can keep a copy of: UTF-8 text without NUL bytes (it snapshots text only). */
function isText(file: string): boolean {
  try {
    const b = fs.readFileSync(file);
    return !b.includes(0) && Buffer.from(b.toString('utf8'), 'utf8').equals(b);
  } catch { return false; }
}

/** Every file under a folder (a skill's SKILL.md and what sits beside it), at most 65: more is refused by the caller. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length > 64) return;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else if (e.isFile()) out.push(f);
    }
  };
  walk(dir);
  return out;
}

/** A re-run keeps the earlier report's items and adds the new ones (one line per former section). */
function mergeReport(old: MigrationReport | null, next: MigrationReport): MigrationReport {
  if (!old) return next;
  const items = new Map(old.items.map(i => {
    const stable = /#\d+$/.test(i.source) ? next.items.find(n => n.title === i.title && n.skill === i.skill && n.source.split('#')[0] === i.source.split('#')[0]) : undefined;
    const source = stable?.source ?? i.source;
    return [source, { ...i, source }];
  }));
  for (const i of next.items) {
    const prior = items.get(i.source);
    items.set(i.source, prior?.status === 'moved' && i.status === 'existing' ? { ...i, status: 'moved' } : i);
  }
  return { at: next.at, items: [...items.values()] };
}
