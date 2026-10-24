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
// brain skills no job used in 60 days. When it is all over, `done` tells the renderer what it made (the end notice).
// Used by wiring.ts and demo-wiring.ts; IPC maintenance:* (index.ts); tests: test/unit/brainmodel/research.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { BrainModelState, LogScan, MaintenanceRun } from '../../shared/brain-model';
import type { ChatSummary, Effort, Harness, Lang, NewChat } from '../../shared/contract';
import { familyOf, isAppKind, RESEARCH_CAP_USD, RESEARCH_CAPS, RESEARCH_KINDS, type MaintenanceDone, type MaintenanceStatus, type ResearchChange, type ResearchForget,
  type ResearchIssue, type ResearchKind, type ResearchOptions, type ResearchProposal, type ResearchRunInfo, type ResearchSource } from '../../shared/maintenance-research';
import { isRoleId } from '../../shared/roles';
import { errText, log } from '../log';
import type { IssueOpened } from './issue-open';
import { buildPack, forgetCandidates, PACK_SECTIONS, type Pack, type PackSection } from './research-pack';
import { defaultPrompt, MAX_PROMPT, researchFrame, researchMessage } from './research-prompt';
import { ResearchStore } from './research-store';

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
  brain: { state(): BrainModelState; apply(p: ResearchProposal): string; noise(key: string, known: boolean): void; maintain(): Promise<BrainModelState> };
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
}

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
  },
  en: {
    bugRemoves: (msg: string, n: number) => `The warning «${msg}» in the app's logs (${n} times).`,
    bugWhy: (n: number, lvl: string) => `The log check found ${n} identical ${lvl === 'error' ? 'error' : 'warning'} lines since the last maintenance.`,
    forgetTitle: (name: string) => `Forget the skill «${name}»`,
    forgetRemoves: (name: string, desc: string, by: string[]) => `The skill «${name}»${desc ? `: ${desc}` : ''}${by.length ? ` (declared by ${by.join(', ')})` : ''}.`,
    forgetWhy: (since: string | null) => `No job used it ${since ? `since ${since}` : 'since the app keeps count'}: it takes room in the choice of skills without helping.`,
    forgetExpected: 'Fewer skills to choose from, no work lost: if it is needed, «Undo» brings it back.',
    forgetRisk: 'A skill used rarely but important: then reject.',
  },
} as const;
const oneLine = (s: string): string => s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

/** The app repository's issues page: package.json `bugs.url` (or `bugs` as a string) in the app's folder; null when
 *  missing or not an https page. */
export function issuesUrlOf(appDir: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')) as { bugs?: string | { url?: string } };
    const url = typeof pkg.bugs === 'string' ? pkg.bugs : pkg.bugs?.url;
    return typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url) ? url : null;
  } catch { return null; }
}

/** owner/name of a GitHub issues page, null otherwise. */
export const repoOf = (url: string | null): string | null => /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:\/issues)?\/?$/.exec(url ?? '')?.[1] ?? null;

/** A card that becomes a GitHub issue (not a brain change): the app's own code, or a bold idea that is an issue. */
export const isAppCard = (p: Pick<ResearchProposal, 'kind' | 'issue' | 'change'>): boolean => isAppKind(p.kind) || (p.kind === 'bold' && !!p.issue && !p.change);

export class ResearchService {
  readonly store: ResearchStore;
  private run: (ResearchRunInfo & { sawWork: boolean; pack: Pack; timer: NodeJS.Timeout | null; saves: Promise<void>[] }) | null = null;
  /** a start between its checks and its chat: a second start is refused */
  private starting = false;
  constructor(private readonly d: ResearchDeps) {
    this.store = new ResearchStore(d.userData, () => this.now());
    // a research the app was closed during never ends by itself: it is closed as stopped (its chat ended with the app)
    for (const r of this.store.runs().filter(x => x.state === 'running')) this.store.saveRun({ ...r, state: 'stopped', endedAt: r.endedAt ?? this.now(), why: 'app chiusa durante la ricerca' });
  }
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
  private passCards = { bugs: 0, forget: 0 };
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
    this.passCards = { bugs: 0, forget: 0 };
    this.store.setClickAt(this.now());
    this.d.changed();
    let pass: MaintenanceRun | null = null;
    try { pass = (await this.d.brain.maintain()).lastRun; }
    finally { this.passing = false; }
    this.passCards = { bugs: pass?.cards?.bugs ?? 0, forget: pass?.cards?.forget ?? 0 };
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
      proposals: this.passCards.forget + mine.filter(p => !isAppCard(p)).length,
      ideas: mine.filter(p => p.kind === 'app-idea' && p.ideaSaved).length,
      issues: this.passCards.bugs + mine.filter(p => isAppCard(p)).length,
    };
    this.passCards = { bugs: 0, forget: 0 };
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
  private async open(harness: Harness, model: string | null, effort: Effort | null, cap: number, method: string, web: boolean, lang: Lang, root: string): Promise<ResearchRunInfo> {
    const pack = buildPack({ now: this.now(), runs: this.d.runs(), state: this.d.brain.state(), roles: this.d.roles(), past: this.store.all(), appVersion: this.d.appVersion() });
    const frame = researchFrame(lang, { web, capUsd: cap, brainRoot: root, issuesUrl: this.d.issuesUrl() });
    const chat = await this.d.chats.create({ harness, cwd: root, title: RESEARCH_TITLE, research: { web }, prompt: researchMessage(method, frame),
      ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
    const startedAt = this.now();
    this.run = { chatId: chat.id, startedAt, harness, model, effort, capUsd: cap, costUsd: 0, state: 'running', proposals: 0, sawWork: false, pack, timer: null, saves: [] };
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
    if (!PACK_SECTIONS.includes(s)) throw new Error(`section: one of ${PACK_SECTIONS.join(', ')}.`);
    return r.pack[s];
  }

  propose(chatId: string, a: Input): { id: string; left: Record<string, number> } {
    const r = this.mine(chatId);
    const kind = a.kind as ResearchKind;
    if (!RESEARCH_KINDS.includes(kind)) throw new Error(`kind: one of ${RESEARCH_KINDS.join(', ')}.`);
    const card = this.card(kind, a, chatId);
    const fam = familyOf(kind), mine = this.store.all().filter(p => p.chatId === chatId);
    if (mine.filter(p => familyOf(p.kind) === fam).length >= RESEARCH_CAPS[fam]) throw new Error(`Limit reached: at most ${RESEARCH_CAPS[fam]} proposals of this family per research.`);
    const same = (p: ResearchProposal) => p.kind === kind && p.title.trim().toLowerCase() === card.title.trim().toLowerCase();
    if (this.store.all().some(p => same(p) && (p.state === 'open' || p.state === 'rejected'))) throw new Error('Duplicate: the same proposal is already open or was rejected.');
    // a better version of the bug card the log step wrote from the same log group: that card is rewritten
    const was = card.logKey ? this.store.all().find(p => p.logKey === card.logKey && p.state === 'open' && p.chatId === null) : undefined;
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
  afterPass(logs: LogScan): { bugs: number; forget: number } {
    const all = this.store.all(), p = this.privacy(), w = CLEANUP_WORDS[this.d.lang() === 'it' ? 'it' : 'en'];
    let bugs = 0, forget = 0;
    for (const g of logs.groups.filter(x => !x.known)) {
      if (all.some(x => x.logKey === g.key) || bugs >= RESEARCH_CAPS.app) continue;
      const where = `${g.scope} · ${g.msg}`;
      this.store.add({ chatId: null, kind: 'app-bug', title: scrub(where, p).slice(0, 120), adds: '', removes: scrub(w.bugRemoves(oneLine(g.msg), g.count), p),
        why: w.bugWhy(g.count, g.lvl), evidence: [scrub(oneLine(g.sample), p).slice(0, 300)], sources: [], expected: '', risk: '', logKey: g.key,
        issue: { title: scrub(`${g.scope}: ${g.msg}`, p).slice(0, 120), labels: ['bug'], body: scrub([
          `The app logged this ${g.lvl} ${g.count} times since the last maintenance.`, '',
          '**Log group**', '', `- scope: \`${oneLine(g.scope).replace(/`/g, "'")}\``, `- message: ${oneLine(g.msg)}`, ...(g.cause ? [`- cause: ${oneLine(g.cause)}`] : []), '',
          // a sample with backticks cannot close the fence
          '**Sample line**', '', '````', oneLine(g.sample).slice(0, 600).replace(/`{3,}/g, m => "'".repeat(m.length)), '````', '',
          '**Expected**', '', 'No such warning or error in normal use, or a clear reason why it is expected.', '',
          '**To verify**', '', 'Run the maintenance again after the fix: the group no longer appears in «Log dell\'app».',
          '', '_Written by the app\'s maintenance from its own logs._',
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
    if (bugs || forget) this.d.changed();
    return { bugs, forget };
  }

  // ── Proposte (the 'research' source) ─────────────────────────────────────────────────────────────────────────────
  /** Open findings, newest first: brain changes and what to forget, and the app cards that open an issue. */
  cards(): ResearchProposal[] { return this.store.all().filter(p => p.state === 'open').reverse(); }
  /** When the user last pressed «Manutenzione»: the other parts of the app's skill and rule proposals made after it
   *  wait for the next click (ADR 0153). null = never pressed. */
  clickAt(): number | null { return this.store.clickAt(); }
  /** The app repository as owner/name, null when unknown (an app card then cannot be approved). */
  repo(): string | null { return repoOf(this.d.issuesUrl()); }
  async approve(id: string): Promise<string> {
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
    const changeId = this.d.brain.apply(p);
    this.store.update(id, { state: 'approved', decidedAt: this.now(), changeId });
    log.info('brain', 'maintenance finding approved', { data: { kind: p.kind, change: changeId } });
    this.d.changed();
    return changeId;
  }
  reject(id: string): void {
    const p = this.store.get(id);
    if (!p || p.state !== 'open') throw new Error('Proposta non più aperta.');
    this.store.update(id, { state: 'rejected', decidedAt: this.now() });
    // a bug from a log group: that group is known noise now, never carded again
    if (p.logKey) { try { this.d.brain.noise(p.logKey, true); } catch (e) { log.warn('brain', 'log group not marked known', { cause: errText(e) }); } }
    this.d.changed();
  }
}
