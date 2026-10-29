// The maintenance with research (ADR 0132; one click and invisible since ADR 0153). The «Manutenzione» button runs the
// free cleanup (the brain jobs and the log step, BrainModelService.maintain) and then this research, with the app's best
// choice (the strongest model of an engine that is on, a 5 $ cap, the web when the engine has it): one app chat
// («Manutenzione», no role, ChatManager `research`) the user never sees (the renderer keeps it out of every list),
// reading the brain and the zero-token data pack (research-pack.ts) through maintenance_pack and proposing through
// maintenance_propose (research-tools.ts). The chat is stopped when its live cost passes the cap. Every finding is a
// card in Memoria → Proposte (the 'research' source, proposals/sources.ts): brain changes and what to forget, applied
// through the change log only when the user approves; ideas and bugs about the app's code, each with its issue already
// written, opened on GitHub at once when the user approves (issue-open.ts). An app idea is also written to the brain's
// Idee, on the AI's side. The pass also makes cards by itself, at zero tokens: one app bug per new log group and the
// brain skills no job used in 60 days, the brain lint's findings (brain-lint.ts: orphans, broken links, concepts with no
// note, facts and skills citing files that are gone, ADR 0194) and the changes whose «riuscito se…» check a week after
// came out worse (success-check.ts, also at app start and hourly). When it is all over, `done` tells the renderer what
// it made (the end notice).
// ADR 0195 hooks: the brain-file findings of one research are held and, when it ends, gathered into ONE candidate brain
// (research-candidate.ts: a copy under userData, one card with a diff per file, one change and one «Annulla» when
// approved); and the research may propose one revised role text from that role's failed runs (role-reflect.ts), which
// becomes a trial version only when the user approves its card.
// Used by wiring.ts and demo-wiring.ts; IPC maintenance:* (index.ts); tests: test/unit/brainmodel/research.test.ts,
// research-candidate.test.ts, role-reflect.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { BrainModelState, LogScan, MaintenanceRun } from '../../shared/brain-model';
import type { ChatSummary, Effort, Harness, Lang, NewChat } from '../../shared/contract';
import { CANDIDATE_PENDING, RESEARCH_TOOL_KINDS, type LintCheck, type LintFinding, type ResearchRevert, familyOf, isAppKind, RESEARCH_CAP_USD, type BrainCandidate, type BrainCandidateView, RESEARCH_CAPS, type MaintenanceDone, type MaintenanceStatus, type ResearchChange, type ResearchForget,
  type ResearchIssue, type ResearchKind, type ResearchOptions, type ResearchProposal, type ResearchRunInfo, type ResearchSource } from '../../shared/maintenance-research';
import { isRoleId } from '../../shared/roles';
import { errText, log } from '../log';
import type { IssueOpened } from './issue-open';
import { buildPack, forgetCandidates, PACK_SECTIONS, type Pack, type PackSection } from './research-pack';
import { logSections, periodDays, type LogSections } from './research-pack-logs';
import { journal } from '../activity/journal';
import { JOURNAL_DIR } from '../log-digest';
import type { LogEvent } from '../../shared/activity-log';
import { readLedger } from '../proposals/ledger';
import { allPolicies } from '../proposals/policy';
import { defaultPrompt, MAX_PROMPT, researchFrame, researchMessage } from './research-prompt';
import { ResearchStore } from './research-store';
import { CandidateService, isCandidateFinding, type CandidatePorts } from './research-candidate';
import { guideMaintenanceSection } from '../guide/maintenance';
import { GUIDE_SECTION } from './research-tools';
import { checkRoleText, pickRole, reflectSection, REFLECT_BUDGET_SHARE, ROLE_REFLECT_SECTION, type ReflectPick } from './role-reflect';
import { readLocal, writeLocal } from '../agents/local-store';
import { readMemoryRecords } from '../rules/memory-records';
import { lintBrain } from './brain-lint';
import { lintCard, revertCard } from './lint-cards';
import { defaultSuccess, parseSuccess, successText } from './success-check';

/** At most this many lint cards of each check per pass (the worst first), so a messy brain is not one wall of cards. */
export const LINT_CAPS: Readonly<Record<LintCheck, number>> = { 'stale-fact': 5, 'stale-cite': 3, 'broken-link': 3, 'changed-fact': 3, concept: 3, orphan: 3 };
const LINT_ORDER: readonly LintCheck[] = ['stale-fact', 'stale-cite', 'broken-link', 'changed-fact', 'concept', 'orphan'];
/** The «riuscito se…» check runs this long after the app starts, then every hour. */
export const OUTCOMES_FIRST_MS = 90_000, OUTCOMES_EVERY_MS = 60 * 60_000;

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL_ID = /^[\w.:@/[\]][\w.:@/=[\],-]{0,119}$/;
/** A research that never ends its turn is stopped after this long. */
export const RESEARCH_MAX_MS = 60 * 60_000;
export const RESEARCH_TITLE = 'Manutenzione';
export const CAP_RANGE = { min: 0.5, max: 50 } as const;

export interface ResearchDeps {
  userData: string;
  lang: () => Lang;
  root: () => string | null;
  appVersion: () => string;
  /** the app repository's issues page (package.json bugs.url), null when unknown */
  issuesUrl: () => string | null;
  /** engines that are on, read files and report their cost (no API engines) */
  engines: () => { harness: Harness; label: string; web: boolean; effort: boolean }[];
  /** the strongest model the app knows for an engine (null = its CLI default) */
  bestModel: (h: Harness) => string | null;
  runs: () => readonly AgentRun[];
  roles: () => readonly AgentProfile[];
  /** maintain: the free cleanup of a click (every job, the log step and its cards), resolving with the pass it wrote */
  brain: { state(): BrainModelState; apply(p: ResearchProposal): string; noise(key: string, known: boolean): void; maintain(): Promise<BrainModelState>;
    /** the «riuscito se…» check (BrainModelService.checkOutcomes, ADR 0194): the changes that got worse; absent = none */
    outcomes?(): ResearchRevert[] };
  chats: { create(req: NewChat): Promise<ChatSummary>; get(id: string): ChatSummary | undefined; stop(id: string): Promise<void> };
  /** opens an approved app card's issue on GitHub (issue-open.ts); absent = app cards cannot be approved */
  issues?: { open(repo: string, issue: ResearchIssue): Promise<IssueOpened> };
  /** writes an app idea to the brain's Idee, on the AI's side (the Battito's save path); absent = not written */
  saveIdea?: (idea: { title: string; body: string; why: string }) => Promise<void>;
  /** the button and the Proposte deck read again */
  changed: () => void;
  /** one click's maintenance is over (the end notice) */
  done?: (d: MaintenanceDone) => void;
  now?: () => number;
  /** the user's home and name, removed from the issues' text (tests pass their own) */
  privacy?: { home: string; user: string };
  /** the app's own folder, removed from the issues' text like the brain's */
  appDir?: () => string;
  /** the technical logs' folder (the digest's too) for the pack's journal/perf/ui-errors/digest sections; default log.folder */
  logDir?: () => string | null;
  /** the Log page's events in memory; default the app's journal */
  events?: () => readonly LogEvent[];
  /** the candidate brain's ports (ADR 0195); absent = every brain finding stays its own card */
  candidates?: CandidatePorts;
  /** starts a trial version of a role with a revised text (catalog approveTrial), refused when the role is no longer on
   *  `baseVersion` (ADR 0195); absent = the research gets no role reflection */
  roleTrial?: (role: string, text: string, baseVersion: number, reason: string) => void;
  /** the app's own repository when run from a clone (guide/anchors.ts repoRootOf): the Guida cards whose code changed
   *  and the German left to translate (ADR 0196), read as the pack section «guide»; absent or null = not offered */
  guideRepo?: () => string | null;
}

/** The research's extra frame lines for the ADR 0195 steps (after the method and the fixed frame). */
const CANDIDATE_FRAME = 'Brain changes that only write brain files (skills without a role, rules for every role, what to forget) are gathered by the app into ONE candidate version of the brain when you end: the user sees one card with a before/after per file and keeps or discards all of it.';
const REFLECT_FRAME = `Role text: read maintenance_pack section "${ROLE_REFLECT_SECTION}" once; when it names a role, you may propose ONE revised full text for it with maintenance_role_trial (a trial version the user approves, measured against the current one).`;

type Input = Record<string, unknown>;
const str = (v: unknown, max: number, field: string, required = true): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && required) throw new Error(`${field}: required.`);
  if (s.length > max) throw new Error(`${field}: at most ${max} characters.`);
  return s;
};
const strList = (v: unknown, max: number, each: number, field: string): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== 'string' || !x.trim() || x.length > each)) throw new Error(`${field}: at most ${max} lines of ${each} characters.`);
  return (v as string[]).map(x => x.trim());
};

/** Removes from a public text what would identify the user: the brain's and the app's folders (wherever they are), the
 *  home folder, the user name, e-mails, tokens. */
export function scrub(text: string, privacy: { home: string; user: string; paths?: readonly { path: string; as: string }[] }): string {
  let t = text;
  for (const p of [...(privacy.paths ?? [])].sort((a, b) => b.path.length - a.path.length)) {
    if (p.path.length > 3) for (const v of new Set([p.path, p.path.replace(/\\/g, '/'), p.path.replace(/\//g, '\\')])) t = t.split(v).join(p.as);
  }
  const homes = [privacy.home, privacy.home.replace(/\\/g, '/')].filter(h => h.length > 3);
  for (const h of homes) t = t.split(h).join('~');
  t = t.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s'"`]+/gi, '~').replace(/\/(?:home|Users)\/[^/\s'"`]+/g, '~');
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>');
  t = t.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, '<token>');
  if (privacy.user.length > 2) t = t.replace(new RegExp(`\\b${privacy.user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '<user>');
  return t;
}

/** The words of the free cleanup's own cards, in the UI language (Italian, else English). */
const CLEANUP_WORDS = {
  it: {
    bugRemoves: (msg: string, n: number) => `L'avviso «${msg}» nei log dell'app (${n} volte).`,
    bugWhy: (n: number, lvl: string) => `Il controllo dei log ha trovato ${n} righe ${lvl === 'error' ? 'di errore' : 'di avviso'} uguali dall'ultima manutenzione.`,
    forgetTitle: (name: string) => `Dimenticare la skill «${name}»`,
    forgetRemoves: (name: string, desc: string, by: string[]) => `La skill «${name}»${desc ? `: ${desc}` : ''}${by.length ? ` (dichiarata da ${by.join(', ')})` : ''}.`,
    forgetWhy: (since: string | null) => `Nessun lavoro l'ha usata ${since ? `dal ${since}` : 'da quando l\'app tiene il conto'}: occupa spazio nella scelta delle skill senza aiutare.`,
    forgetExpected: 'Meno skill tra cui scegliere, nessun lavoro perso: se servisse, «Annulla» la rimette.',
    forgetRisk: 'Una skill usata di rado ma importante: in quel caso rifiuta.',
    issueLead: (lvl: string, n: number) => `L'app ha scritto ${n} volte questo ${lvl === 'error' ? 'errore' : 'avviso'} dall'ultima manutenzione.`,
    issueGroup: 'Gruppo di log', issueMessage: 'messaggio', issueCause: 'causa', issueSample: 'Riga di esempio',
    issueExpectedH: 'Cosa ci si aspetta', issueExpected: 'Nessun avviso o errore del genere nell\'uso normale, o un motivo chiaro per cui è atteso.',
    issueVerifyH: 'Come verificarlo', issueVerify: 'Dopo il fix rilancia la manutenzione: il gruppo non compare più in «Log dell\'app».',
    issueBy: 'Scritta dalla manutenzione dell\'app dai suoi log.',
  },
  en: {
    bugRemoves: (msg: string, n: number) => `The warning «${msg}» in the app's logs (${n} times).`,
    bugWhy: (n: number, lvl: string) => `The log check found ${n} identical ${lvl === 'error' ? 'error' : 'warning'} lines since the last maintenance.`,
    forgetTitle: (name: string) => `Forget the skill «${name}»`,
    forgetRemoves: (name: string, desc: string, by: string[]) => `The skill «${name}»${desc ? `: ${desc}` : ''}${by.length ? ` (declared by ${by.join(', ')})` : ''}.`,
    forgetWhy: (since: string | null) => `No job used it ${since ? `since ${since}` : 'since the app keeps count'}: it takes room in the choice of skills without helping.`,
    forgetExpected: 'Fewer skills to choose from, no work lost: if it is needed, «Undo» brings it back.',
    forgetRisk: 'A skill used rarely but important: then reject.',
    issueLead: (lvl: string, n: number) => `The app logged this ${lvl} ${n} times since the last maintenance.`,
    issueGroup: 'Log group', issueMessage: 'message', issueCause: 'cause', issueSample: 'Sample line',
    issueExpectedH: 'Expected', issueExpected: 'No such warning or error in normal use, or a clear reason why it is expected.',
    issueVerifyH: 'To verify', issueVerify: 'Run the maintenance again after the fix: the group no longer appears in «Log dell\'app».',
    issueBy: 'Written by the app\'s maintenance from its own logs.',
  },
} as const;
const oneLine = (s: string): string => s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

/** The app's own repository, where its issues open when package.json says nothing (a frozen release's package.json
 *  carried only name and version until 2026-10-24). */
export const APP_ISSUES_URL = 'https://github.com/lampi1/second-brain/issues';

/** The app repository's issues page: package.json `bugs.url` (or `bugs` as a string), else its GitHub `repository`,
 *  in the app's folder; the app's own repository when neither is there. */
export function issuesUrlOf(appDir: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')) as { bugs?: string | { url?: string }; repository?: string | { url?: string } };
    const url = typeof pkg.bugs === 'string' ? pkg.bugs : pkg.bugs?.url;
    if (typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url)) return url;
    const rep = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const gh = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(rep ?? '')?.[1];
    if (gh) return `https://github.com/${gh}/issues`;
  } catch { /* the app's own below */ }
  return APP_ISSUES_URL;
}

/** owner/name of a GitHub issues page, null otherwise. */
export const repoOf = (url: string | null): string | null => /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:\/issues)?\/?$/.exec(url ?? '')?.[1] ?? null;

/** A card that becomes a GitHub issue (not a brain change): the app's own code, or a bold idea that is an issue. */
export const isAppCard = (p: Pick<ResearchProposal, 'kind' | 'issue' | 'change'>): boolean => isAppKind(p.kind) || (p.kind === 'bold' && !!p.issue && !p.change);

export class ResearchService {
  readonly store: ResearchStore;
  private run: (ResearchRunInfo & { sawWork: boolean; pack: Pack; timer: NodeJS.Timeout | null; saves: Promise<void>[]; reflect: ReflectPick | null }) | null = null;
  /** the candidate brain (ADR 0195), when the app gives its ports */
  readonly candidates: CandidateService | null;
  /** a start between its checks and its chat: a second start is refused */
  private starting = false;
  constructor(private readonly d: ResearchDeps) {
    this.store = new ResearchStore(d.userData, () => this.now());
    // a research the app was closed during never ends by itself: it is closed as stopped (its chat ended with the app)
    for (const r of this.store.runs().filter(x => x.state === 'running')) this.store.saveRun({ ...r, state: 'stopped', endedAt: r.endedAt ?? this.now(), why: 'app chiusa durante la ricerca' });
    this.candidates = d.candidates ? new CandidateService(d.userData, d.candidates, d.lang, () => this.now()) : null;
    // findings held for a candidate the app was closed before building: their own cards again
    for (const p of this.store.all().filter(x => x.candidateId === CANDIDATE_PENDING)) this.store.update(p.id, { candidateId: undefined });
    // the «riuscito se…» check: soon after the start, then hourly (and at every click, afterPass); zero tokens
    if (d.brain.outcomes) {
      const tick = () => { try { if (this.outcomes()) this.d.changed(); } catch (e) { log.warn('brain', 'maintenance outcome check failed', { cause: errText(e), hint: 'it runs again within the hour and at the next «Manutenzione»' }); } };
      const first = setTimeout(tick, OUTCOMES_FIRST_MS), every = setInterval(tick, OUTCOMES_EVERY_MS);
      first.unref?.(); every.unref?.();
      this.outcomeTimers.push(first, every);
    }
  }
  /** Stops the hourly check (tests, shutdown). */
  dispose(): void { for (const t of this.outcomeTimers) { clearTimeout(t); clearInterval(t); } this.outcomeTimers = []; }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private privacy() {
    const base = this.d.privacy ?? { home: os.homedir(), user: (() => { try { return os.userInfo().username; } catch { return ''; } })() };
    const root = this.d.root(), appDir = this.d.appDir?.();
    return { ...base, paths: [...(root ? [{ path: root, as: '<brain>' }] : []), ...(appDir ? [{ path: appDir, as: '<app>' }] : [])] };
  }

  // ── the button ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The free cleanup of a click is running (before the research starts). */
  private passing = false;
  /** The free cleanup's cards of the click now running, added to the research's in the end notice. */
  private passCards = { bugs: 0, forget: 0, lint: 0, reverts: 0 };
  private outcomeTimers: NodeJS.Timeout[] = [];
  status(): MaintenanceStatus {
    return { running: this.passing || this.starting || !!this.run, research: this.run ? this.info(this.run) : null, last: this.store.lastDone() ?? null, canResearch: this.d.engines().length > 0 };
  }
  /** The app's best choice for a research: Claude when it is on (else the first engine), its strongest model, high
   *  effort where the engine has it, the web when it has it, the default cap, the shipped method. */
  defaults(): ResearchOptions | null {
    const engines = this.d.engines(), eng = engines.find(e => e.harness === 'claude') ?? engines[0];
    if (!eng) return null;
    return { harness: eng.harness, model: this.d.bestModel(eng.harness), effort: eng.effort ? 'high' : null, web: eng.web, capUsd: RESEARCH_CAP_USD, prompt: defaultPrompt(this.d.lang()) };
  }
  private info(r: ResearchRunInfo): ResearchRunInfo {
    const { chatId, startedAt, endedAt, harness, model, effort, capUsd, costUsd, state, proposals, why } = r;
    return { chatId, startedAt, ...(endedAt ? { endedAt } : {}), harness, model, effort, capUsd, costUsd, state, proposals, ...(why ? { why } : {}) };
  }

  /** The button's one click: the free cleanup, then the research in the background (when an engine can run it). Resolves
   *  once the research has started (or, with no engine, once the cleanup is over and the end notice is out). */
  async runAll(): Promise<MaintenanceStatus> {
    if (this.passing || this.starting || this.run) throw new Error('La manutenzione è già in corso.');
    if (!this.d.root()) throw new Error('Scegli prima la cartella del brain.');
    this.passing = true;
    this.passCards = { bugs: 0, forget: 0, lint: 0, reverts: 0 };
    this.store.setClickAt(this.now());
    this.d.changed();
    let pass: MaintenanceRun | null = null;
    try { pass = (await this.d.brain.maintain()).lastRun; }
    finally { this.passing = false; }
    this.passCards = { bugs: pass?.cards?.bugs ?? 0, forget: pass?.cards?.forget ?? 0, lint: pass?.cards?.lint ?? 0, reverts: pass?.cards?.reverts ?? 0 };
    const o = this.defaults();
    if (!o) { this.announce({ state: 'free', costUsd: 0 }, null); this.d.changed(); return this.status(); }
    try { await this.start(o); }
    catch (e) { this.announce({ state: 'failed', costUsd: 0, why: errText(e).slice(0, 200) }, null); this.d.changed(); }
    return this.status();
  }
  /** The end notice: what the click made, the cleanup's cards and the research's together. */
  private announce(end: { state: MaintenanceDone['state']; costUsd: number; why?: string }, chatId: string | null): void {
    const mine = chatId ? this.store.all().filter(p => p.chatId === chatId) : [];
    const d: MaintenanceDone = {
      at: this.now(), state: end.state, costUsd: end.costUsd, ...(end.why ? { why: end.why } : {}),
      proposals: this.passCards.forget + this.passCards.lint + this.passCards.reverts + mine.filter(p => !isAppCard(p)).length,
      ideas: mine.filter(p => p.kind === 'app-idea' && p.ideaSaved).length,
      issues: this.passCards.bugs + mine.filter(p => isAppCard(p)).length,
    };
    this.passCards = { bugs: 0, forget: 0, lint: 0, reverts: 0 };
    this.store.setLastDone(d);
    try { this.d.done?.(d); } catch (e) { log.warn('brain', 'maintenance end notice not sent', { cause: errText(e) }); }
  }

  async start(o: ResearchOptions): Promise<ResearchRunInfo> {
    if (this.run || this.starting) throw new Error('Una manutenzione con ricerca è già in corso.');
    const root = this.d.root();
    if (!root) throw new Error('Scegli prima la cartella del brain.');
    const engine = this.d.engines().find(e => e.harness === o?.harness);
    if (!engine) throw new Error('Motore non disponibile per la ricerca.');
    const model = o.model === null || o.model === undefined || o.model === '' ? null : String(o.model);
    if (model !== null && !MODEL_ID.test(model)) throw new Error('Modello non valido.');
    const effort = o.effort ?? null;
    if (effort !== null && (!engine.effort || !EFFORTS.includes(effort))) throw new Error('Effort non valido per questo motore.');
    const cap = Number(o.capUsd);
    if (!Number.isFinite(cap) || cap < CAP_RANGE.min || cap > CAP_RANGE.max) throw new Error(`Tetto di spesa tra ${CAP_RANGE.min} e ${CAP_RANGE.max} $.`);
    const method = typeof o.prompt === 'string' ? o.prompt.trim() : '';
    if (!method || method.length > MAX_PROMPT) throw new Error(`Il prompt va da 1 a ${MAX_PROMPT} caratteri.`);
    const web = o.web === true && engine.web, lang = this.d.lang();
    this.starting = true;
    try { return await this.open(engine.harness, model, effort, cap, method, web, lang, root); } finally { this.starting = false; }
  }
  /** The pack's sections about the period since the previous pass (ADR 0192); never throws (absent = not read). */
  private async logSections(state: BrainModelState): Promise<LogSections | undefined> {
    try {
      const dir = (this.d.logDir ?? (() => log.folder))(), now = this.now(), since = state.lastRun?.logs?.since ?? null;
      if (!dir) return undefined;
      const days = await periodDays(dir, path.join(this.d.userData, JOURNAL_DIR), since, now);
      return logSections({ now, since, days, events: (this.d.events ?? (() => journal.list().events))(), groups: state.lastRun?.logs?.groups ?? [] });
    } catch (e) { log.warn('brain', 'maintenance pack: log sections not read', { cause: errText(e), hint: 'the research runs without them; npm run logs -- --scope brain shows why' }); return undefined; }
  }
  private async open(harness: Harness, model: string | null, effort: Effort | null, cap: number, method: string, web: boolean, lang: Lang, root: string): Promise<ResearchRunInfo> {
    const state = this.d.brain.state(), logs = await this.logSections(state);
    const pack = buildPack({ now: this.now(), runs: this.d.runs(), state, roles: this.d.roles(), past: this.store.all(), appVersion: this.d.appVersion(), ...(logs ? { logs } : {}), decisions: allPolicies(readLedger(this.d.userData)) });
    const frame = researchFrame(lang, { web, capUsd: cap, brainRoot: root, issuesUrl: this.d.issuesUrl() });
    const reflect = this.d.roleTrial ? pickRole(this.d.runs(), this.d.roles(), this.now()) : null;
    const extra = [...(this.candidates ? [CANDIDATE_FRAME] : []), ...(this.d.roleTrial ? [REFLECT_FRAME] : [])];
    const chat = await this.d.chats.create({ harness, cwd: root, title: RESEARCH_TITLE, research: { web }, prompt: [researchMessage(method, frame), ...extra].join('\n'),
      ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
    const startedAt = this.now();
    this.run = { chatId: chat.id, startedAt, harness, model, effort, capUsd: cap, costUsd: 0, state: 'running', proposals: 0, sawWork: false, pack, timer: null, saves: [], reflect };
    const timer = setTimeout(() => { void this.finish('stopped', 'più di un\'ora senza finire').catch(() => { /* logged */ }); }, RESEARCH_MAX_MS);
    timer.unref?.();
    this.run.timer = timer;
    this.store.saveRun(this.info(this.run));
    log.info('brain', 'maintenance research started', { chat: chat.id, data: { harness, model, effort, web, cap } });
    this.d.changed();
    const info = this.info(this.run);
    // what the chat did while it was being created (an error, a quick end) counts too
    const now = this.d.chats.get(chat.id);
    if (now) this.chatUpdated(now);
    return info;
  }

  /** Every chat update (wiring: the 'chat:updated' event): the research's cost against its cap, and its end. */
  chatUpdated(c: ChatSummary): void {
    const r = this.run;
    if (!r || c.id !== r.chatId) return;
    r.costUsd = c.costUsd;
    if (c.costUsd > r.capUsd) { void this.finish('capped', `speso ${c.costUsd.toFixed(2)} $ su ${r.capUsd.toFixed(2)} $`).catch(() => { /* logged */ }); return; }
    if (c.state === 'starting' || c.state === 'running' || c.state === 'waiting') { r.sawWork = true; return; }
    if (c.state === 'error') void this.finish('failed', c.lastError ?? 'errore del motore').catch(() => { /* logged */ });
    else if (c.state === 'closed') void this.finish('stopped', 'chat chiusa').catch(() => { /* logged */ });
    else if (c.state === 'idle' && r.sawWork) void this.finish('done').catch(() => { /* logged */ });
  }

  async stop(): Promise<MaintenanceStatus> {
    if (this.run) await this.finish('stopped', 'fermata da te');
    return this.status();
  }

  private async finish(state: ResearchRunInfo['state'], why?: string): Promise<void> {
    const r = this.run;
    if (!r) return;
    this.run = null;
    if (r.timer) clearTimeout(r.timer);
    const c = this.d.chats.get(r.chatId);
    const info: ResearchRunInfo = { ...this.info(r), costUsd: c?.costUsd ?? r.costUsd, state, endedAt: this.now(), ...(why ? { why } : {}) };
    this.store.saveRun(info);
    if (state !== 'done' && c && !c.closedAt && (c.state === 'running' || c.state === 'starting' || c.state === 'waiting')) {
      try { await this.d.chats.stop(r.chatId); } catch (e) { log.warn('brain', 'maintenance research not stopped', { chat: r.chatId, cause: errText(e), hint: 'stop it from its chat' }); }
    }
    log.info('brain', 'maintenance research ended', { chat: r.chatId, data: { state, proposals: info.proposals, costUsd: info.costUsd } });
    // the ideas still being written to Idee count in the notice
    await Promise.allSettled(r.saves);
    this.gather(r.chatId, Math.max(info.costUsd, r.costUsd), r.capUsd);
    this.announce({ state, costUsd: info.costUsd, ...(why ? { why } : {}) }, r.chatId);
    this.d.changed();
  }

  // ── the research chat's tools ────────────────────────────────────────────────────────────────────────────────────
  /** The chat calling is the research running now (its token's chat): anything else is refused. */
  private mine(chatId: string): NonNullable<ResearchService['run']> {
    if (!this.run || this.run.chatId !== chatId) throw new Error('This tool works only in the maintenance research chat while it runs.');
    return this.run;
  }
  pack(chatId: string, section: unknown): string {
    const r = this.mine(chatId), s = (section ?? 'summary') as PackSection;
    if (section === GUIDE_SECTION) { const repo = this.d.guideRepo?.() ?? null; return repo ? guideMaintenanceSection(repo) : 'Not offered: the app is not running from its repository.'; }
    if (section === ROLE_REFLECT_SECTION) return reflectSection(r.reflect, { clean: t => scrub(t, this.privacy()), budgetLeft: this.reflectBudget(r) });
    if (!PACK_SECTIONS.includes(s)) throw new Error(`section: one of ${PACK_SECTIONS.join(', ')}.`);
    return r.pack[s];
  }

  propose(chatId: string, a: Input): { id: string; left: Record<string, number> } {
    const r = this.mine(chatId);
    const kind = a.kind as ResearchKind;
    if (!(RESEARCH_TOOL_KINDS as readonly string[]).includes(kind)) throw new Error(`kind: one of ${RESEARCH_TOOL_KINDS.join(', ')}.`);
    const card = this.card(kind, a, chatId);
    const fam = familyOf(kind), mine = this.store.all().filter(p => p.chatId === chatId);
    if (mine.filter(p => familyOf(p.kind) === fam).length >= RESEARCH_CAPS[fam]) throw new Error(`Limit reached: at most ${RESEARCH_CAPS[fam]} proposals of this family per research.`);
    const same = (p: ResearchProposal) => p.kind === kind && p.title.trim().toLowerCase() === card.title.trim().toLowerCase();
    if (this.store.all().some(p => same(p) && (p.state === 'open' || p.state === 'rejected'))) throw new Error('Duplicate: the same proposal is already open or was rejected.');
    // a better version of the bug card the log step wrote from the same log group: that card is rewritten
    const was = card.logKey ? this.store.all().find(p => p.logKey === card.logKey && p.state === 'open' && p.chatId === null) : undefined;
    // a brain-file finding waits for the candidate brain, built when the research ends (ADR 0195)
    if (this.candidates && isCandidateFinding(card)) card.candidateId = CANDIDATE_PENDING;
    const replaced = was ? this.store.replace(was.id, card) : null;
    const saved = replaced || this.store.add(card);
    // the cleanup's card the notice already counts is now this research's
    if (replaced) this.passCards.bugs = Math.max(0, this.passCards.bugs - 1);
    r.proposals++;
    // an idea about the app also lands in the brain's Idee, on the AI's side (its issue stays a card in Proposte)
    if (kind === 'app-idea' && this.d.saveIdea) {
      const id = saved.id;
      r.saves.push(this.d.saveIdea({ title: card.title, body: [card.adds, card.removes].filter(Boolean).join(' · ') || card.title, why: card.why })
        .then(() => { this.store.update(id, { ideaSaved: true }); this.d.changed(); })
        .catch(e => log.warn('brain', 'maintenance idea not written to Idee', { cause: errText(e), hint: 'its issue card is still in Proposte' })));
    }
    this.d.changed();
    const used = (f: keyof typeof RESEARCH_CAPS) => this.store.all().filter(p => p.chatId === chatId && familyOf(p.kind) === f).length;
    return { id: saved.id, left: Object.fromEntries((Object.keys(RESEARCH_CAPS) as (keyof typeof RESEARCH_CAPS)[]).map(f => [f, RESEARCH_CAPS[f] - used(f)])) };
  }

  /** A tool call's arguments as a card, checked: words in bounds, a change for brain kinds, a forget target, an issue
   *  for app kinds (its text cleaned of private data). */
  private card(kind: ResearchKind, a: Input, chatId: string | null): Omit<ResearchProposal, 'id' | 'at' | 'state'> {
    const sources: ResearchSource[] = (() => {
      if (a.sources === undefined) return [];
      if (!Array.isArray(a.sources) || a.sources.length > 8) throw new Error('sources: at most 8.');
      return a.sources.map((s, i) => {
        const o = (s ?? {}) as Input, url = str(o.url, 500, `sources[${i}].url`);
        if (!/^https:\/\/[^\s]+$/.test(url)) throw new Error(`sources[${i}].url: an https page.`);
        return { title: str(o.title, 200, `sources[${i}].title`), url };
      });
    })();
    const base = {
      chatId, kind, title: str(a.title, 120, 'title'), adds: str(a.adds, 1500, 'adds', false), removes: str(a.removes, 1500, 'removes', false),
      why: str(a.why, 1500, 'why'), evidence: strList(a.evidence, 12, 300, 'evidence'), sources,
      expected: str(a.expected, 600, 'expected', false), risk: str(a.risk, 600, 'risk', false),
    };
    if (!base.adds && !base.removes) throw new Error('adds or removes: say what the proposal adds or removes.');
    const out: Omit<ResearchProposal, 'id' | 'at' | 'state'> = { ...base };
    if (kind === 'forget') out.forget = this.forget(a.forget);
    else if (isAppKind(kind)) out.issue = this.issue(a.issue);
    else if (kind === 'bold') {
      if (a.change !== undefined) out.change = this.change(a.change);
      else if (a.issue !== undefined) out.issue = this.issue(a.issue);
      else throw new Error('bold: give a change (for the brain) or an issue (for the app).');
    } else out.change = this.change(a.change, kind);
    if (kind === 'app-bug' && typeof a.logKey === 'string' && a.logKey.trim()) out.logKey = str(a.logKey, 1000, 'logKey');
    // «riuscito se…» (ADR 0194): the research's criterion, else the default of a brain change; in the user's words
    const success = parseSuccess(a.success) ?? defaultSuccess(out.change);
    if (success && out.change) out.success = { ...success, text: successText(success, this.d.lang()) };
    return out;
  }
  private change(v: unknown, kind?: ResearchKind): ResearchChange {
    const o = (v ?? {}) as Input;
    const target = (kind && kind !== 'bold' ? kind : o.target) as ResearchChange['target'];
    if (!['skill', 'rule', 'role'].includes(target)) throw new Error('change.target: skill, rule or role (memory facts have their own review).');
    const role = typeof o.role === 'string' && o.role ? o.role : undefined;
    if (role !== undefined && !isRoleId(role)) throw new Error('change.role: a role id.');
    if (target === 'role' && !role) throw new Error('change.role: required for a change to a role.');
    const name = typeof o.name === 'string' && o.name.trim() ? str(o.name, 64, 'change.name') : undefined;
    if (target === 'skill' && (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))) throw new Error('change.name: the skill\'s kebab-case name.');
    const text = str(o.text, target === 'skill' ? 8000 : 800, 'change.text');
    if (/\b(permission|allowedTools|bypass|hooks?\b|settings\.json)/i.test(text) && /\b(allow|grant|skip|disable|bypass|add)\b/i.test(text)) throw new Error('A change never grants permissions or touches settings or hooks.');
    return { target, ...(role ? { role } : {}), ...(name ? { name } : {}), text };
  }
  private forget(v: unknown): ResearchForget {
    const o = (v ?? {}) as Input, what = o.what as ResearchForget['what'];
    if (!['skill', 'rule'].includes(what)) throw new Error('forget.what: skill or rule (memory facts are tidied by the free cleanup).');
    const name = str(o.name, 600, 'forget.name');
    if (what === 'skill' && !this.d.brain.state().skills.some(s => s.name === name && s.home === 'brain')) throw new Error('forget.name: no such skill in the brain (the user\'s own skills are never forgotten).');
    if (what === 'rule' && !/^rules\/[^/]+\.md$/i.test(name)) throw new Error('forget.name: a rules/ file (always-loaded files are edited, not forgotten).');
    return { what, name };
  }
  private issue(v: unknown): ResearchIssue {
    const o = (v ?? {}) as Input, p = this.privacy();
    const labels = strList(o.labels, 5, 40, 'issue.labels');
    const dup = (o.duplicateOf ?? null) as Input | null;
    const duplicateOf = dup && Number.isInteger(dup.number) && typeof dup.url === 'string' && /^https:\/\/github\.com\//.test(dup.url) ? { number: dup.number as number, url: dup.url } : undefined;
    return { title: scrub(str(o.title, 120, 'issue.title'), p), body: scrub(str(o.body, 8000, 'issue.body'), p), ...(labels.length ? { labels } : {}), ...(duplicateOf ? { duplicateOf } : {}) };
  }

  // ── the free cleanup's own cards (zero tokens) ───────────────────────────────────────────────────────────────────
  /** After the pass the user started: one app bug per new log group (never one already carded or dismissed), and the
   *  brain skills no job used in 60 days (never one already proposed in the last 90 days). */
  afterPass(logs: LogScan): { bugs: number; forget: number; lint: number; reverts: number } {
    const all = this.store.all(), p = this.privacy(), w = CLEANUP_WORDS[this.d.lang() === 'it' ? 'it' : 'en'];
    let bugs = 0, forget = 0;
    for (const g of logs.groups.filter(x => !x.known)) {
      if (all.some(x => x.logKey === g.key) || bugs >= RESEARCH_CAPS.app) continue;
      const where = `${g.scope} · ${g.msg}`;
      this.store.add({ chatId: null, kind: 'app-bug', title: scrub(where, p).slice(0, 120), adds: '', removes: scrub(w.bugRemoves(oneLine(g.msg), g.count), p),
        why: w.bugWhy(g.count, g.lvl), evidence: [], sources: [], expected: '', risk: '', logKey: g.key,
        issue: { title: scrub(`${g.scope}: ${g.msg}`, p).slice(0, 120), labels: ['bug'], body: scrub([
          w.issueLead(g.lvl, g.count), '',
          `**${w.issueGroup}**`, '', `- scope: \`${oneLine(g.scope).replace(/`/g, "'")}\``, `- ${w.issueMessage}: ${oneLine(g.msg)}`, ...(g.cause ? [`- ${w.issueCause}: ${oneLine(g.cause)}`] : []), '',
          // a sample with backticks cannot close the fence
          `**${w.issueSample}**`, '', '````', oneLine(g.sample).slice(0, 600).replace(/`{3,}/g, m => "'".repeat(m.length)), '````', '',
          `**${w.issueExpectedH}**`, '', w.issueExpected, '',
          `**${w.issueVerifyH}**`, '', w.issueVerify,
          '', `_${w.issueBy}_`,
        ].join('\n'), p).slice(0, 8000) } });
      bugs++;
    }
    const recent = (name: string) => all.some(x => x.kind === 'forget' && x.forget?.name === name && x.at >= this.now() - 90 * 86_400_000);
    for (const c of forgetCandidates(this.d.brain.state().skills, this.d.runs(), this.now())) {
      if (forget >= RESEARCH_CAPS.forget || recent(c.name)) continue;
      const since = c.lastUsed ? new Date(c.lastUsed).toISOString().slice(0, 10) : null;
      this.store.add({ chatId: null, kind: 'forget', title: w.forgetTitle(c.name), adds: '', removes: w.forgetRemoves(c.name, c.description.slice(0, 200), c.usedBy),
        why: w.forgetWhy(since), evidence: [`skill ${c.name}: 0 / 60d`], sources: [], expected: w.forgetExpected, risk: w.forgetRisk,
        forget: { what: 'skill', name: c.name, lastUsed: c.lastUsed ?? null, uses: 0 } });
      forget++;
    }
    const lint = this.lint();
    const reverts = this.outcomes();
    if (bugs || forget || lint || reverts) this.d.changed();
    return { bugs, forget, lint, reverts };
  }

  /** The brain lint (ADR 0194, M2), zero tokens: new findings become cards (never one already carded, approved or
   *  rejected: its key), at most LINT_CAPS per check; an open lint card whose problem is gone is dismissed. */
  lint(): number {
    // the real folder: the skills are listed by their real paths (BrainModelService), a linked brain root must match them
    let root: string;
    try { const r = this.d.root(); if (!r) return 0; root = fs.realpathSync(r); } catch { return 0; }
    const hashFile = path.join(this.d.userData, 'brain-lint.json');
    let hashes: Record<string, string> = {};
    try { const raw = readLocal(hashFile) as { hashes?: Record<string, string> } | undefined; if (raw?.hashes && typeof raw.hashes === 'object') hashes = { ...raw.hashes }; } catch { /* a fresh baseline */ }
    let records: ReturnType<typeof readMemoryRecords> = [];
    try { records = readMemoryRecords(root); } catch (e) { log.warn('brain', 'brain lint: memory not read', { cause: errText(e), hint: 'the fact checks wait for a readable memory/records.json; the note checks still run' }); }
    let found: LintFinding[];
    try { found = lintBrain({ root, skills: this.d.brain.state().skills, records, hashes }); }
    catch (e) { log.warn('brain', 'brain lint failed', { cause: errText(e), hint: 'the next «Manutenzione» tries again' }); return 0; }
    try { writeLocal(hashFile, { version: 1, hashes }); } catch (e) { log.warn('brain', 'brain lint hashes not saved', { cause: errText(e), hint: 'a changed cited file is noticed one pass later' }); }
    const all = this.store.all(), keys = new Set(found.map(f => f.key));
    // a problem fixed by hand (or by another card) takes its open card away
    for (const p of all.filter(x => x.kind === 'lint' && x.state === 'open' && x.lint && !keys.has(x.lint.key))) this.store.update(p.id, { state: 'dismissed', decidedAt: this.now() });
    const seen = new Set(all.filter(x => x.lint).map(x => x.lint!.key));
    const lang = this.d.lang();
    let made = 0;
    for (const check of LINT_ORDER) {
      let n = all.filter(x => x.kind === 'lint' && x.state === 'open' && x.lint?.check === check).length;
      for (const f of found.filter(x => x.check === check)) {
        if (n >= LINT_CAPS[check] || seen.has(f.key)) continue;
        this.store.add(lintCard(f, lang)); seen.add(f.key); n++; made++;
      }
    }
    log.info('brain', 'brain lint', { data: { found: found.length, cards: made, ...Object.fromEntries(LINT_ORDER.map(c => [c, found.filter(f => f.check === c).length])) } });
    return made;
  }

  /** The «riuscito se…» check (ADR 0194, M4): a card «Questo cambio non ha aiutato: lo annullo?» per change that got
   *  worse (never twice for one change). Returns the cards made. */
  outcomes(): number {
    const worse = this.d.brain.outcomes?.() ?? [];
    if (!worse.length) return 0;
    const all = this.store.all(), lang = this.d.lang();
    let made = 0;
    for (const r of worse) {
      if (all.some(p => p.revert?.changeId === r.changeId)) continue;
      this.store.add(revertCard(r, lang)); made++;
      log.info('brain', 'maintenance change did not help', { data: { change: r.changeId, metric: r.criterion.metric, before: r.check.before, after: r.check.after } });
    }
    return made;
  }

  // ── Proposte (the 'research' source) ─────────────────────────────────────────────────────────────────────────────
  /** Open findings, newest first: brain changes and what to forget, and the app cards that open an issue. */
  cards(): ResearchProposal[] { return this.store.all().filter(p => p.state === 'open' && !p.candidateId).reverse(); }
  /** The open candidate brains (ADR 0195): one card each. */
  candidateCards(): BrainCandidateView[] {
    const all = new Map(this.store.all().map(p => [p.id, p]));
    return (this.candidates?.open() ?? []).map(c => ({ ...c, items: c.proposalIds.flatMap(id => { const p = all.get(id); return p ? [{ kind: p.kind, title: p.title }] : []; }) }));
  }
  /** When the user last pressed «Manutenzione»: the other parts of the app's skill and rule proposals made after it
   *  wait for the next click (ADR 0153). null = never pressed. */
  clickAt(): number | null { return this.store.clickAt(); }
  /** The app repository as owner/name, null when unknown (an app card then cannot be approved). */
  repo(): string | null { return repoOf(this.d.issuesUrl()); }
  async approve(id: string): Promise<string> {
    if (this.candidates?.isId(id)) return this.approveCandidate(id);
    const p = this.store.get(id);
    if (!p || p.state !== 'open') throw new Error('Proposta non più aperta.');
    if (isAppCard(p)) {
      const repo = this.repo();
      if (!p.issue || !repo || !this.d.issues) throw new Error('Repository dell\'app sconosciuto: la issue non si può aprire.');
      const opened = await this.d.issues.open(repo, p.issue);
      // a second click while gh was working finds the card decided already
      if (this.store.get(id)?.state !== 'open') return opened.url;
      this.store.update(id, { state: 'approved', decidedAt: this.now(), issueUrl: opened.url });
      log.info('brain', 'maintenance issue opened', { data: { kind: p.kind, via: opened.via } });
      this.d.changed();
      return opened.url;
    }
    if (p.roleTrial) {
      // a revised role text (ADR 0195): a trial version through the catalog's own path, kept or rolled back on its card
      if (!this.d.roleTrial) throw new Error('Le prove dei ruoli non sono disponibili qui.');
      this.d.roleTrial(p.roleTrial.role, p.roleTrial.text, p.roleTrial.baseVersion, `Manutenzione: ${p.title}`.slice(0, 300));
      this.store.update(id, { state: 'approved', decidedAt: this.now() });
      log.info('brain', 'maintenance role trial started', { data: { role: p.roleTrial.role } });
      this.d.changed();
      return '';
    }
    const changeId = this.d.brain.apply(p);
    this.store.update(id, { state: 'approved', decidedAt: this.now(), changeId });
    log.info('brain', 'maintenance finding approved', { data: { kind: p.kind, change: changeId } });
    this.d.changed();
    return changeId;
  }
  reject(id: string): void {
    if (this.candidates?.isId(id)) {
      const c = this.candidates.reject(id);
      for (const pid of c.proposalIds) this.store.update(pid, { state: 'rejected', decidedAt: this.now() });
      this.d.changed();
      return;
    }
    const p = this.store.get(id);
    if (!p || p.state !== 'open') throw new Error('Proposta non più aperta.');
    this.store.update(id, { state: 'rejected', decidedAt: this.now() });
    // a bug from a log group: that group is known noise now, never carded again
    if (p.logKey) { try { this.d.brain.noise(p.logKey, true); } catch (e) { log.warn('brain', 'log group not marked known', { cause: errText(e) }); } }
    this.d.changed();
  }

  // ── ADR 0195: the candidate brain and the role reflection ─────────────────────────────────────────────────────────
  /** When the research ends: its held brain-file findings become one candidate (the ones it could not plan, and all of
   *  them when no candidate is built, are their own cards again). `capUsd - costUsd` is what the replay may spend. */
  private gather(chatId: string, costUsd: number, capUsd: number): void {
    const held = this.store.all().filter(p => p.chatId === chatId && p.candidateId === CANDIDATE_PENDING && p.state === 'open');
    if (!held.length) return;
    let built: BrainCandidate | null = null;
    try { built = this.candidates?.build(chatId, held, Math.max(0, capUsd - costUsd)).candidate ?? null; }
    catch (e) { log.warn('brain', 'candidate brain not built', { cause: errText(e), hint: 'its findings are shown as single cards in Proposte' }); }
    for (const p of held) this.store.update(p.id, { candidateId: built?.proposalIds.includes(p.id) ? built.id : undefined });
  }
  private async approveCandidate(id: string): Promise<string> {
    const c = this.candidates!.get(id);
    if (!c || c.state !== 'open') throw new Error('Versione candidata non più aperta.');
    const members = c.proposalIds.flatMap(pid => { const p = this.store.get(pid); return p ? [p] : []; });
    const summary = `Versione candidata del brain: ${members.length} ${members.length === 1 ? 'modifica' : 'modifiche'} in ${c.files.length} file`;
    const reason = members.map(p => `${p.title}: ${p.why}`).join(' · ').replace(/\s+/g, ' ').slice(0, 400);
    const evidence = [`maintenance:${id}`, ...members.slice(0, 8).map(p => `maintenance:${p.id}`)];
    let changeId: string;
    try { changeId = this.candidates!.approve(id, summary, reason, evidence); }
    catch (e) {
      // a stale candidate: its findings are their own cards again, each checked against the brain as it is now
      if (this.candidates!.get(id)?.state === 'stale') { for (const p of members) this.store.update(p.id, { candidateId: undefined }); this.d.changed(); }
      throw e;
    }
    for (const p of members) this.store.update(p.id, { state: 'approved', decidedAt: this.now(), changeId });
    this.d.changed();
    return changeId;
  }
  /** The role step runs only while the engine reports cost and the research spent less than its share of the cap. */
  private reflectBudget(r: NonNullable<ResearchService['run']>): boolean {
    const c = this.d.chats.get(r.chatId);
    return (c?.costUsd ?? r.costUsd) < r.capUsd * REFLECT_BUDGET_SHARE;
  }
  /** maintenance_role_trial: ONE revised text for the role the app picked this click, as a card whose approval starts a
   *  trial version (never a direct replacement). */
  proposeRoleTrial(chatId: string, a: Input): { id: string } {
    const r = this.mine(chatId);
    if (!this.d.roleTrial || !r.reflect) throw new Error('No role to reflect on in this research.');
    if (!this.reflectBudget(r)) throw new Error('Budget: the role step is skipped, the research has spent most of its cap.');
    const role = r.reflect.role;
    if (a.role !== role.id) throw new Error(`role: this research reflects only on ${role.id}.`);
    if (this.store.all().some(p => p.chatId === chatId && p.roleTrial)) throw new Error('Limit reached: one revised role text per research.');
    if (this.store.all().some(p => p.roleTrial?.role === role.id && p.state === 'open')) throw new Error('Duplicate: a revised text for this role is already waiting in Proposte.');
    const text = checkRoleText(role.instructions, a.text);
    const title = str(a.title, 120, 'title'), why = str(a.why, 1500, 'why');
    const saved = this.store.add({ chatId, kind: 'role', title, adds: str(a.adds, 1500, 'adds', false), removes: str(a.removes, 1500, 'removes', false), why,
      evidence: strList(a.evidence, 12, 300, 'evidence'), sources: [], expected: str(a.expected, 600, 'expected', false), risk: str(a.risk, 600, 'risk', false),
      roleTrial: { role: role.id, baseVersion: role.activeVersion, before: role.instructions, text } });
    r.proposals++;
    this.d.changed();
    return { id: saved.id };
  }
}
