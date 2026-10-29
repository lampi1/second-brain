// The candidate brain (ADR 0195), after Anthropic's «dreaming» for managed agents: a job reads the sessions and a memory
// store and writes a NEW store (duplicates merged, superseded values replaced, new insights), never touching its input;
// the user compares and keeps it or throws it away. Here: the brain-file findings one maintenance research proposes (a
// skill written or extended, a line for every role in rules/lessons.md, a skill or a rules/ file to forget) are not
// separate cards any more; when the research ends they are planned together on a virtual copy of the brain, the
// affected files are copied under userData/brain-candidates/<id>/files (the brain is never written), zero-token checks
// run, the recorded-task replay (evaluation.ts) is started only when an anonymized holdout set exists and the research's
// remaining budget covers its estimate (else skipped with the reason), and one Proposte card shows a before/after diff
// per file. Approving applies every file as ONE change-log entry (one «Annulla» restores all of them); a brain file
// changed in between makes the candidate stale (never applied over the user's edit). Findings that change a role (its
// text, a skill linked to it) and the app's issues stay individual cards. Used by research.ts (the hooks) and wiring.ts
// (the ports); tests: test/unit/brainmodel/research-candidate.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AgentRun } from '../../shared/agents';
import type { BrainRule, BrainSkill } from '../../shared/brain-model';
import type { Lang } from '../../shared/contract';
import type { BrainCandidate, CandidateEvaluation, CandidateFile, ResearchProposal } from '../../shared/maintenance-research';
import { NAME_RE, parseMd, setBody } from '../../shared/skillmd';
import { readLocal, writeLocal } from '../agents/local-store';
import { checkPermissionText } from '../agents/tool-policy';
import { errText, log } from '../log';
import { appendUnder, brainJsonWithTopic, LESSONS_RULE, LESSONS_WHEN, skillText } from './jobs';
import { ignoreWrite, sourceOfSkill } from './migration-ignore';
import { readSmall } from './model';
import type { ProcedureSection } from './procedure-sources';

const DAY = 86_400_000;
/** A file the change log can keep a copy of (changes.ts SNAP): a bigger one leaves the finding out of the candidate. */
const MAX_FILE = 256 * 1024;
/** Candidates kept on disk (the newest; open ones are never dropped). */
const KEEP = 12;
/** The replay's estimate: each holdout case is one role run and one independent review. */
const RUNS_PER_CASE = 2;

/** A finding that only writes brain files (no role, no issue): it goes into the candidate instead of its own card. */
export function isCandidateFinding(p: Pick<ResearchProposal, 'chatId' | 'kind' | 'change' | 'forget' | 'issue' | 'roleTrial'>): boolean {
  if (!p.chatId || p.roleTrial || p.issue) return false;
  if (p.kind === 'forget') return !!p.forget && (p.forget.what === 'skill' || p.forget.what === 'rule');
  if (p.kind !== 'skill' && p.kind !== 'rule' && p.kind !== 'bold') return false;
  // a change for one role touches that role (its text, or a skill linked to it): its own card, applied as today
  return !!p.change && p.change.target !== 'role' && !p.change.role;
}

export interface PlanInput {
  /** the brain's real path */
  root: string;
  /** every skill the app sees (the brain's and the user's own: the user's are never changed) */
  skills: readonly BrainSkill[];
  rules: readonly BrainRule[];
  /** the brain's procedure sections (a forgotten migrated skill records its decision, like Memoria's trash) */
  sections?: () => ProcedureSection[];
  now: number;
}
export interface PlannedFile { file: string; rel: string; before: string | null; after: string | null }
export interface CandidatePlan {
  files: PlannedFile[];
  /** the findings the plan holds */
  used: string[];
  /** the findings left out, with why (they become individual cards again) */
  skipped: { id: string; why: string }[];
  /** brain skills the plan removes: their role links go after the apply (as Memoria's trash does) */
  forgetSkills: string[];
}

const oneLine = (s: string, n: number): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const relOf = (root: string, file: string): string | null => {
  const rel = path.relative(root, file);
  return !rel || rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep).join('/');
};
function filesUnder(dir: string): string[] | null {
  const out: string[] = [];
  const walk = (d: string): boolean => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length > 64) return false;
      const f = path.join(d, e.name);
      if (e.isSymbolicLink()) return false;
      if (e.isDirectory()) { if (!walk(f)) return false; } else if (e.isFile()) out.push(f);
    }
    return true;
  };
  try { return walk(dir) && out.length <= 64 ? out : null; } catch { return null; }
}

/** The findings applied in order on a virtual copy of the brain: what each file is now and would be. Reads the brain,
 *  never writes it. A finding that cannot be planned (a user skill, a file too big or unreadable, a forgotten file a
 *  later finding writes) is skipped with the reason. The texts are the ones approving a single card writes (service.ts
 *  applyResearch), so the candidate never says something else than a card would. */
export function planCandidate(input: PlanInput, proposals: readonly ResearchProposal[]): CandidatePlan {
  const root = input.root, stamp = `(${new Date(input.now).toISOString().slice(0, 10)}; manutenzione)`;
  const files = new Map<string, PlannedFile>();
  const used: string[] = [], skipped: CandidatePlan['skipped'] = [], forgetSkills: string[] = [];
  const now = (file: string): string | null => (files.has(file) ? files.get(file)!.after : readSmall(file));
  for (const p of proposals) {
    // all of one finding or none of it
    const writes = new Map<string, string | null>();
    const read = (file: string): string | null => (writes.has(file) ? writes.get(file)! : now(file));
    const put = (file: string, text: string | null) => {
      if (relOf(root, file) === null) throw new Error('fuori dal brain');
      if ((text?.length ?? 0) > MAX_FILE) throw new Error('file troppo grande per poterlo annullare');
      writes.set(file, text);
    };
    try {
      if (p.kind === 'forget') {
        const f = p.forget!;
        if (f.what === 'skill') {
          const s = input.skills.find(x => x.name === f.name && x.home === 'brain');
          if (!s) throw new Error('skill del brain non trovata');
          const dir = path.dirname(s.file), list = filesUnder(dir);
          if (!list?.length) throw new Error('cartella della skill non leggibile o con collegamenti');
          for (const file of list) {
            const text = read(file);
            if (text === null) throw new Error('la skill ha file non di testo o troppo grandi');
            put(file, null);
          }
          const source = input.sections ? sourceOfSkill(read(s.file) ?? '', input.sections()) : null;
          if (source) { const w = ignoreWrite(root, source, s.name, input.now); put(w.file, w.text); }
          forgetSkills.push(s.name);
        } else {
          const rel = f.name.replace(/\\/g, '/');
          const r = input.rules.find(x => x.file === rel);
          if (!r || !/^rules\/[^/]+\.md$/i.test(r.file) || r.loaded === 'always') throw new Error('regola non trovata o sempre caricata');
          const file = path.join(root, r.file);
          if (read(file) === null) throw new Error('regola non leggibile');
          put(file, null);
        }
      } else {
        const ch = p.change!, text = ch.text.trim();
        checkPermissionText(text);
        if (!text || text.length > 8000) throw new Error('testo vuoto o troppo lungo');
        if (ch.target === 'skill') {
          const name = ch.name ?? '';
          if (!NAME_RE.test(name) || name.length > 64) throw new Error('nome della skill non valido');
          const have = input.skills.find(s => s.name === name);
          if (have && have.home !== 'brain') throw new Error('skill dell\'utente, fuori dal brain');
          const file = have?.file ?? path.join(root, '.claude', 'skills', name, 'SKILL.md');
          const before = read(file);
          if (have && before === null) throw new Error(writes.has(file) || files.has(file) ? 'la skill è tolta da un\'altra proposta' : 'skill non leggibile');
          put(file, before !== null ? setBody(before, appendUnder(parseMd(before).body, 'Dalla manutenzione', text)) : skillText(name, oneLine(p.title, 300), text));
        } else {
          const file = path.join(root, LESSONS_RULE), had = read(file);
          if (had === null && fs.existsSync(file) && !files.has(file)) throw new Error(`${LESSONS_RULE} non leggibile`);
          put(file, appendUnder(had ?? LESSONS_WHEN, 'Dalla manutenzione', `- ${oneLine(text, 600)} ${stamp}`));
          const cfg = files.has(path.join(root, 'brain.json')) ? null : brainJsonWithTopic(root, LESSONS_RULE);
          if (cfg) put(cfg.file, cfg.text);
        }
      }
    } catch (e) { skipped.push({ id: p.id, why: errText(e).slice(0, 200) }); continue; }
    if (![...writes].some(([file, text]) => text !== now(file))) { skipped.push({ id: p.id, why: 'niente da cambiare' }); continue; }
    for (const [file, text] of writes) {
      const cur = files.get(file);
      if (cur) cur.after = text;
      else files.set(file, { file, rel: relOf(root, file)!, before: readSmall(file), after: text });
    }
    used.push(p.id);
  }
  // a file the findings put back as it was is no change
  return { files: [...files.values()].filter(f => f.before !== f.after), used, skipped, forgetSkills };
}

const lines = (s: string | null): number => (s ? s.replace(/\n$/, '').split('\n').length : 0);
/** Zero-token checks on the candidate, one line each in the UI language: what it touches, the skills' headers, the
 *  rule lines every job will load, the size before and after. */
export function candidateChecks(files: readonly CandidateFile[], rules: readonly BrainRule[], lang: Lang): string[] {
  const it = lang === 'it';
  const out: string[] = [];
  const added = files.reduce((n, f) => n + Math.max(0, lines(f.after) - lines(f.before)), 0);
  const removed = files.reduce((n, f) => n + Math.max(0, lines(f.before) - lines(f.after)), 0);
  out.push(it ? `${files.length} file: ${files.filter(f => f.before === null).length} nuovi, ${files.filter(f => f.after === null).length} tolti; +${added} / −${removed} righe.`
    : `${files.length} files: ${files.filter(f => f.before === null).length} new, ${files.filter(f => f.after === null).length} removed; +${added} / −${removed} lines.`);
  const bad = files.filter(f => /(^|\/)SKILL\.md$/.test(f.rel) && f.after !== null).filter(f => {
    const md = parseMd(f.after!), name = md.fields.find(x => x.key === 'name')?.value ?? '', desc = md.fields.find(x => x.key === 'description')?.value ?? '';
    return !md.front || !NAME_RE.test(name) || !desc.trim();
  });
  out.push(bad.length ? (it ? `Intestazione da controllare in: ${bad.map(f => f.rel).join(', ')}.` : `Header to check in: ${bad.map(f => f.rel).join(', ')}.`)
    : (it ? 'Ogni skill scritta ha nome e descrizione validi.' : 'Every skill written has a valid name and description.'));
  const loaded = files.filter(f => rules.some(r => r.file === f.rel && r.loaded === 'always'));
  const always = loaded.reduce((n, f) => n + lines(f.after) - lines(f.before), 0);
  if (loaded.length) out.push(it ? `${always >= 0 ? '+' : ''}${always} righe nelle regole caricate in ogni lavoro (costano token ogni volta).` : `${always >= 0 ? '+' : ''}${always} lines in rules loaded in every job (they cost tokens every time).`);
  out.push(it ? 'Nessun testo concede permessi o tocca impostazioni e hook (controllato).' : 'No text grants permissions or touches settings and hooks (checked).');
  return out;
}

/** What a replay of `cases` holdout cases would cost: each case is a role run and its review, at the median cost of the
 *  ended runs of the last 30 days whose engine reports one. null = no run with a cost to judge by. */
export function replayEstimate(cases: number, runs: readonly AgentRun[], now: number): number | null {
  const costs = runs.filter(r => r.endedAt !== undefined && r.endedAt >= now - 30 * DAY && typeof r.costUsd === 'number' && r.costUsd > 0 && r.source !== 'oneshot')
    .map(r => r.costUsd as number).sort((a, b) => a - b);
  if (!costs.length || cases < 1) return null;
  const m = costs.length >> 1, median = costs.length % 2 ? costs[m]! : (costs[m - 1]! + costs[m]!) / 2;
  return Math.round(median * RUNS_PER_CASE * cases * 100) / 100;
}

/** The text a replay follows as the candidate (evaluation.ts ReplayCandidate): every changed file, after the change. */
export function replayText(files: readonly CandidateFile[], max = 12_000): string {
  const text = files.map(f => `### ${f.rel}${f.after === null ? ' (removed)' : ''}\n\n${f.after ?? ''}`).join('\n\n');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The app's side the candidate needs: the brain now, the apply as one change, the replay. */
export interface CandidatePorts {
  /** the brain's real path and what it holds now (fresh: no cache); null = no brain */
  input(): Omit<PlanInput, 'now'> | null;
  /** applies every write as one change-log entry and returns its id; then unlinks the forgotten skills from roles */
  apply(meta: { kind: 'skill' | 'rule'; summary: string; reason: string; evidence: string[]; target: string }, writes: { file: string; text: string | null }[], forgetSkills: string[]): string;
  /** starts the replay of the candidate when it is possible and paid for by the budget left (else why not) */
  replay?(c: { name: string; text: string; budgetUsd: number }): { replayId?: string; note: string };
  /** a started replay's state now (null = gone) */
  replayStatus?(id: string): CandidateEvaluation['replay']['status'] | null;
}

interface Stored extends BrainCandidate { forgetSkills: string[] }
const ID = /^bc-[a-z0-9]+-[a-f0-9]{6}$/;

/** The candidates on disk: userData/brain-candidates/<id>/candidate.json beside files/<rel> (the copy of the affected
 *  files as the candidate has them; a removed file has none). */
export class CandidateStore {
  readonly dir: string;
  constructor(userData: string) { this.dir = path.join(userData, 'brain-candidates'); }
  private file(id: string): string { if (!ID.test(id)) throw new Error('Versione candidata non valida.'); return path.join(this.dir, id, 'candidate.json'); }
  list(): Stored[] {
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir).filter(n => ID.test(n)); } catch { return []; }
    return names.flatMap(n => { const c = this.get(n); return c ? [c] : []; }).sort((a, b) => a.at - b.at);
  }
  get(id: string): Stored | undefined {
    try { const c = readLocal(this.file(id)) as Stored | undefined; return c && c.id === id && Array.isArray(c.files) ? c : undefined; }
    catch (e) { log.warn('brain', 'candidate brain not read', { cause: errText(e), hint: 'the folder is kept; the next maintenance builds a new one' }); return undefined; }
  }
  save(c: Stored, copy = false): void {
    const base = path.join(this.dir, c.id);
    if (copy) {
      for (const f of c.files) {
        if (f.after === null) continue;
        const out = path.resolve(base, 'files', ...f.rel.split('/'));
        if (!out.startsWith(path.resolve(base, 'files') + path.sep)) throw new Error('Percorso della versione candidata non valido.');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, f.after, 'utf8');
      }
    }
    fs.mkdirSync(base, { recursive: true });
    writeLocal(this.file(c.id), c);
  }
  /** The oldest decided candidates go (their copies with them); open ones stay. */
  prune(): void {
    const all = this.list(), drop = all.filter(c => c.state !== 'open').slice(0, Math.max(0, all.length - KEEP));
    for (const c of drop) { try { fs.rmSync(path.join(this.dir, c.id), { recursive: true, force: true }); } catch { /* next time */ } }
  }
}

export class CandidateService {
  readonly store: CandidateStore;
  constructor(userData: string, private readonly ports: CandidatePorts, private readonly lang: () => Lang, private readonly now: () => number = Date.now) {
    this.store = new CandidateStore(userData);
  }
  /** Builds the candidate of one research from its held findings. null when nothing could be planned (the findings in
   *  `plan.skipped` go back to individual cards: the caller does it). `budgetUsd` = what is left of the research's cap. */
  build(chatId: string, proposals: readonly ResearchProposal[], budgetUsd: number): { candidate: BrainCandidate | null; skipped: CandidatePlan['skipped'] } {
    const input = this.ports.input();
    if (!input) return { candidate: null, skipped: proposals.map(p => ({ id: p.id, why: 'nessun brain' })) };
    const plan = planCandidate({ ...input, now: this.now() }, proposals);
    if (!plan.files.length) return { candidate: null, skipped: [...plan.skipped, ...plan.used.map(id => ({ id, why: 'niente da cambiare' }))] };
    const at = this.now(), id = `bc-${at.toString(36)}-${randomBytes(3).toString('hex')}`;
    const files: CandidateFile[] = plan.files.map(f => ({ rel: f.rel, before: f.before, after: f.after }));
    const checks = candidateChecks(files, input.rules, this.lang());
    const c: Stored = { id, chatId, at, state: 'open', proposalIds: plan.used, files, evaluation: { checks, replay: { state: 'skipped', note: '' } }, forgetSkills: plan.forgetSkills };
    c.evaluation.replay = this.replay(c, budgetUsd);
    this.store.save(c, true);
    this.store.prune();
    log.info('brain', 'candidate brain built', { data: { files: files.length, findings: plan.used.length, skipped: plan.skipped.length, replay: c.evaluation.replay.state } });
    return { candidate: this.view(c), skipped: plan.skipped };
  }
  private replay(c: Stored, budgetUsd: number): CandidateEvaluation['replay'] {
    const it = this.lang() === 'it';
    if (!this.ports.replay) return { state: 'skipped', note: it ? 'Replay non disponibile in questa app.' : 'Replay not available in this app.' };
    if (!(budgetUsd > 0)) return { state: 'skipped', note: it ? 'Replay saltato: il budget della manutenzione è finito.' : 'Replay skipped: the maintenance budget is spent.' };
    try { const r = this.ports.replay({ name: c.id, text: replayText(c.files), budgetUsd }); return { state: r.replayId ? 'started' : 'skipped', ...(r.replayId ? { replayId: r.replayId, status: 'running' as const } : {}), note: r.note }; }
    catch (e) { return { state: 'skipped', note: (it ? 'Replay non avviato: ' : 'Replay not started: ') + errText(e).slice(0, 200) }; }
  }
  private view(c: Stored): BrainCandidate {
    const { forgetSkills: _f, ...rest } = c; void _f;
    const id = rest.evaluation.replay.replayId, status = id ? this.ports.replayStatus?.(id) : undefined;
    return structuredClone(status ? { ...rest, evaluation: { ...rest.evaluation, replay: { ...rest.evaluation.replay, status } } } : rest);
  }
  /** The open candidates (each one card in Proposte). */
  open(): BrainCandidate[] { return this.store.list().filter(c => c.state === 'open').map(c => this.view(c)); }
  get(id: string): BrainCandidate | undefined { const c = ID.test(id) ? this.store.get(id) : undefined; return c ? this.view(c) : undefined; }
  isId(id: string): boolean { return ID.test(id); }
  /** Applies the whole candidate as one change. Refused (and the candidate marked stale) when a brain file is not what
   *  the candidate started from any more: the user's edit is never overwritten. */
  approve(id: string, summary: string, reason: string, evidence: string[]): string {
    const c = this.store.get(id);
    if (!c || c.state !== 'open') throw new Error('Versione candidata non più aperta.');
    const input = this.ports.input();
    if (!input) throw new Error('Scegli prima la cartella del brain.');
    const writes = c.files.map(f => ({ file: path.join(input.root, ...f.rel.split('/')), text: f.after }));
    if (c.files.some((f, i) => readSmall(writes[i]!.file) !== f.before)) {
      this.store.save({ ...c, state: 'stale', decidedAt: this.now() });
      throw new Error('Il brain è cambiato dopo la versione candidata: non la applico sopra le modifiche nuove. Rilancia la manutenzione.');
    }
    const kind = c.files.some(f => /(^|\/)SKILL\.md$/.test(f.rel)) ? 'skill' : 'rule';
    const changeId = this.ports.apply({ kind, summary, reason, evidence, target: `candidate:${c.id}` }, writes, c.forgetSkills);
    this.store.save({ ...c, state: 'approved', decidedAt: this.now(), changeId });
    log.info('brain', 'candidate brain applied', { data: { files: c.files.length, findings: c.proposalIds.length } });
    return changeId;
  }
  reject(id: string): BrainCandidate {
    const c = this.store.get(id);
    if (!c || c.state !== 'open') throw new Error('Versione candidata non più aperta.');
    const next: Stored = { ...c, state: 'rejected', decidedAt: this.now() };
    this.store.save(next);
    return this.view(next);
  }
}
