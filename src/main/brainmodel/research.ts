// The maintenance with research (ADR 0132). The «Manutenzione» dialog always runs the free cleanup (the brain jobs and
// the log step, BrainModelService.maintain) and, when the user ticks «Ricerca e miglioramento», this research: one app
// chat («Manutenzione», no role, ChatManager `research`) on the engine, model and effort the user picked, reading the
// brain and the zero-token data pack (research-pack.ts) through maintenance_pack, the web when allowed, and proposing
// through maintenance_propose (research-tools.ts). The chat is stopped when its live cost passes the user's cap.
// Every finding is a card: brain changes and what to forget in Memoria → Proposte (the 'research' source,
// proposals/sources.ts), applied through the change log only when the user approves; ideas and bugs about the app's code
// in Memoria → «Idee dell'app», each with its issue already written: «Apri issue» / «Apri tutte» hand them to the
// Orchestrator as the user's request (gh opens them; the user's permission rules still apply). The pass the user starts
// also makes cards by itself, at zero tokens: one app bug per new log group and the brain skills no job used in 60
// days. Used by wiring.ts and demo-wiring.ts; IPC maintenance:* (index.ts); tests:
// test/unit/brainmodel/research.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { BrainModelState, LogScan } from '../../shared/brain-model';
import type { ChatSummary, Effort, Harness, Lang, NewChat } from '../../shared/contract';
import { familyOf, isAppKind, RESEARCH_CAP_USD, RESEARCH_CAPS, RESEARCH_KINDS, type AppIdeasState, type MaintenanceSetup, type ResearchChange, type ResearchForget,
  type ResearchIssue, type ResearchKind, type ResearchOptions, type ResearchProposal, type ResearchRunInfo, type ResearchSource } from '../../shared/maintenance-research';
import { isRoleId } from '../../shared/roles';
import { errText, log } from '../log';
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
  /** engines that are on and can read files (no API engines) */
  engines: () => MaintenanceSetup['engines'];
  /** the strongest model the app knows for an engine (null = its CLI default) */
  bestModel: (h: Harness) => string | null;
  runs: () => readonly AgentRun[];
  roles: () => readonly AgentProfile[];
  brain: { state(): BrainModelState; apply(p: ResearchProposal): string; noise(key: string, known: boolean): void };
  chats: { create(req: NewChat): Promise<ChatSummary>; get(id: string): ChatSummary | undefined; stop(id: string): Promise<void> };
  /** sends the user's request to the open Orchestrator; false = none is open */
  orchestrator: { open(): boolean; send(text: string): Promise<boolean> };
  /** the dialog, the «Idee dell'app» tab and the Proposte deck read again */
  changed: () => void;
  now?: () => number;
  /** the user's home and name, removed from the issues' text (tests pass their own) */
  privacy?: { home: string; user: string };
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

/** Removes from a public text what would identify the user: the home folder, the user name, e-mails, tokens. */
export function scrub(text: string, privacy: { home: string; user: string }): string {
  let t = text;
  const homes = [privacy.home, privacy.home.replace(/\\/g, '/')].filter(h => h.length > 3);
  for (const h of homes) t = t.split(h).join('~');
  t = t.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s'"`]+/gi, '~').replace(/\/(?:home|Users)\/[^/\s'"`]+/g, '~');
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>');
  t = t.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, '<token>');
  if (privacy.user.length > 2) t = t.replace(new RegExp(`\\b${privacy.user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '<user>');
  return t;
}

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

/** Goes to «Idee dell'app» (not to Proposte): the app's own code, or a bold idea that is an issue. */
export const isAppCard = (p: Pick<ResearchProposal, 'kind' | 'issue' | 'change'>): boolean => isAppKind(p.kind) || (p.kind === 'bold' && !!p.issue && !p.change);

export class ResearchService {
  readonly store: ResearchStore;
  private run: (ResearchRunInfo & { sawWork: boolean; pack: Pack; timer: NodeJS.Timeout | null }) | null = null;
  constructor(private readonly d: ResearchDeps) { this.store = new ResearchStore(d.userData, () => this.now()); }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private privacy() { return this.d.privacy ?? { home: os.homedir(), user: (() => { try { return os.userInfo().username; } catch { return ''; } })() }; }

  // ── the dialog ────────────────────────────────────────────────────────────────────────────────────────────────────
  setup(): MaintenanceSetup {
    const lang = this.d.lang(), engines = this.d.engines();
    const h = engines.find(e => e.harness === 'claude')?.harness ?? engines[0]?.harness ?? 'claude';
    const eng = engines.find(e => e.harness === h);
    const costs = this.store.runs().filter(r => r.state !== 'failed' && r.costUsd > 0).map(r => r.costUsd).sort((a, b) => a - b);
    const last = this.store.runs().at(-1) ?? null;
    return {
      defaultPrompt: defaultPrompt(lang), prompt: this.store.prompt() ?? defaultPrompt(lang),
      frame: researchFrame(lang, { web: true, capUsd: RESEARCH_CAP_USD, brainRoot: this.d.root() ?? '—', issuesUrl: this.d.issuesUrl() }),
      defaults: { harness: h, model: this.d.bestModel(h), effort: eng?.effort ? 'high' : null, web: eng?.web ?? false, capUsd: RESEARCH_CAP_USD },
      engines, estimate: costs.length ? { medianUsd: costs[(costs.length - 1) >> 1]!, n: costs.length } : null,
      running: this.run ? this.info(this.run) : null, last: this.run ? null : last,
    };
  }
  private info(r: ResearchRunInfo): ResearchRunInfo {
    const { chatId, startedAt, endedAt, harness, model, effort, capUsd, costUsd, state, proposals, why } = r;
    return { chatId, startedAt, ...(endedAt ? { endedAt } : {}), harness, model, effort, capUsd, costUsd, state, proposals, ...(why ? { why } : {}) };
  }

  async start(o: ResearchOptions): Promise<ResearchRunInfo> {
    if (this.run) throw new Error('Una manutenzione con ricerca è già in corso.');
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
    const pack = buildPack({ now: this.now(), runs: this.d.runs(), state: this.d.brain.state(), roles: this.d.roles(), past: this.store.all(), appVersion: this.d.appVersion() });
    this.store.setPrompt(method === defaultPrompt(lang).trim() ? undefined : method);
    const frame = researchFrame(lang, { web, capUsd: cap, brainRoot: root, issuesUrl: this.d.issuesUrl() });
    const chat = await this.d.chats.create({ harness: engine.harness, cwd: root, title: RESEARCH_TITLE, research: { web }, prompt: researchMessage(method, frame),
      ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
    const startedAt = this.now();
    this.run = { chatId: chat.id, startedAt, harness: engine.harness, model, effort, capUsd: cap, costUsd: 0, state: 'running', proposals: 0, sawWork: false, pack, timer: null };
    const timer = setTimeout(() => { void this.finish('stopped', 'più di un\'ora senza finire').catch(() => { /* logged */ }); }, RESEARCH_MAX_MS);
    timer.unref?.();
    this.run.timer = timer;
    this.store.saveRun(this.info(this.run));
    log.info('brain', 'maintenance research started', { chat: chat.id, data: { harness: engine.harness, model, effort, web, cap } });
    this.d.changed();
    return this.info(this.run);
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

  async stop(): Promise<MaintenanceSetup> {
    if (this.run) await this.finish('stopped', 'fermata da te');
    return this.setup();
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
    const saved = (was && this.store.replace(was.id, card)) || this.store.add(card);
    r.proposals++;
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
    if (!['skill', 'rule', 'memory', 'role'].includes(target)) throw new Error('change.target: skill, rule, memory or role.');
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
    if (!['skill', 'rule', 'memory'].includes(what)) throw new Error('forget.what: skill, rule or memory.');
    const name = str(o.name, 600, 'forget.name');
    if (what === 'skill' && !this.d.brain.state().skills.some(s => s.name === name && s.home === 'brain')) throw new Error('forget.name: no such skill in the brain (the user\'s own skills are never forgotten).');
    if (what === 'rule' && !/^rules\/[^/]+\.md$/i.test(name)) throw new Error('forget.name: a rules/ file (always-loaded files are edited, not forgotten).');
    const role = typeof o.role === 'string' && o.role ? o.role : undefined;
    if (role !== undefined && !isRoleId(role)) throw new Error('forget.role: a role id.');
    return { what, name, ...(role ? { role } : {}) };
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
    const all = this.store.all(), p = this.privacy();
    let bugs = 0, forget = 0;
    for (const g of logs.groups.filter(x => !x.known)) {
      if (all.some(x => x.logKey === g.key) || bugs >= RESEARCH_CAPS.app) continue;
      const where = `${g.scope} · ${g.msg}`;
      this.store.add({ chatId: null, kind: 'app-bug', title: scrub(where, p).slice(0, 120), adds: '', removes: scrub(`L'avviso «${g.msg}» nei log dell'app (${g.count} volte).`, p),
        why: `Il controllo dei log ha trovato ${g.count} righe ${g.lvl === 'error' ? 'di errore' : 'di avviso'} uguali dall'ultima manutenzione.`, evidence: [scrub(g.sample, p).slice(0, 300)], sources: [], expected: '', risk: '', logKey: g.key,
        issue: { title: scrub(`${g.scope}: ${g.msg}`, p).slice(0, 120), labels: ['bug'], body: scrub([
          `The app logged this ${g.lvl} ${g.count} times since the last maintenance.`, '',
          '**Log group**', '', `- scope: \`${g.scope}\``, `- message: ${g.msg}`, ...(g.cause ? [`- cause: ${g.cause}`] : []), '',
          '**Sample line**', '', '```', g.sample.slice(0, 600), '```', '',
          '**Expected**', '', 'No such warning or error in normal use, or a clear reason why it is expected.', '',
          '**To verify**', '', 'Run the maintenance again after the fix: the group no longer appears in «Log dell\'app».',
          '', '_Written by the app\'s maintenance from its own logs._',
        ].join('\n'), p).slice(0, 8000) } });
      bugs++;
    }
    const recent = (name: string) => all.some(x => x.kind === 'forget' && x.forget?.name === name && x.at >= this.now() - 90 * 86_400_000);
    for (const c of forgetCandidates(this.d.brain.state().skills, this.d.runs(), this.now())) {
      if (forget >= RESEARCH_CAPS.forget || recent(c.name)) continue;
      const since = c.lastUsed ? `dal ${new Date(c.lastUsed).toISOString().slice(0, 10)}` : 'mai, da quando l\'app tiene il conto';
      this.store.add({ chatId: null, kind: 'forget', title: `Dimenticare la skill «${c.name}»`, adds: '', removes: `La skill «${c.name}»${c.description ? `: ${c.description.slice(0, 200)}` : ''}${c.usedBy.length ? ` (dichiarata da ${c.usedBy.join(', ')})` : ''}.`,
        why: `Nessun lavoro l'ha usata ${since}: occupa spazio nella scelta delle skill senza aiutare.`, evidence: [`skill ${c.name}: 0 usi in 60 giorni`], sources: [],
        expected: 'Meno skill tra cui scegliere, nessun lavoro perso: se servisse, «Annulla» la rimette.', risk: 'Una skill usata di rado ma importante: in quel caso rifiuta.',
        forget: { what: 'skill', name: c.name, lastUsed: c.lastUsed ?? null, uses: 0 } });
      forget++;
    }
    if (bugs || forget) this.d.changed();
    return { bugs, forget };
  }

  // ── Proposte (the 'research' source) ─────────────────────────────────────────────────────────────────────────────
  /** Open findings for the brain, newest first. */
  brainCards(): ResearchProposal[] { return this.store.all().filter(p => p.state === 'open' && !isAppCard(p)).reverse(); }
  approve(id: string): string {
    const p = this.store.get(id);
    if (!p || p.state !== 'open' || isAppCard(p)) throw new Error('Proposta non più aperta.');
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
    this.d.changed();
  }

  // ── «Idee dell'app» ──────────────────────────────────────────────────────────────────────────────────────────────
  appIdeas(): AppIdeasState {
    const rank = (p: ResearchProposal) => (p.state === 'open' ? 0 : p.state === 'issue-asked' ? 1 : 2);
    const items = this.store.all().filter(p => isAppCard(p) && p.state !== 'dismissed').sort((a, b) => rank(a) - rank(b) || b.at - a.at);
    return { items, issuesUrl: this.d.issuesUrl(), orchestrator: this.d.orchestrator.open() };
  }

  /** «Apri issue» / «Apri tutte»: the issues, as written, go to the Orchestrator as the user's request. */
  async openIssues(ids: unknown): Promise<{ sent: boolean; why?: string; state: AppIdeasState }> {
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
    const items = list.map(id => this.store.get(id)).filter((p): p is ResearchProposal => !!p && isAppCard(p) && p.state === 'open' && !!p.issue);
    if (!items.length) return { sent: false, why: 'Nessuna idea aperta da mandare.', state: this.appIdeas() };
    if (!this.d.orchestrator.open()) return { sent: false, why: 'Apri prima l\'Orchestrator.', state: this.appIdeas() };
    const repo = repoOf(this.d.issuesUrl());
    const text = [
      `Open ${items.length === 1 ? 'this GitHub issue' : `these ${items.length} GitHub issues`} for me${repo ? ` in ${repo}` : ' in the app\'s repository'}, as written (from Memoria → «Idee dell'app»).`,
      'First look at the open issues: if one already covers it, add a comment there instead of opening a new one. Then tell me the links in one line.',
      ...items.map((p, i) => [
        '', `--- Issue ${i + 1} of ${items.length} (${p.kind === 'app-bug' ? 'bug' : 'idea'}) ---`, `Title: ${p.issue!.title}`,
        ...(p.issue!.labels?.length ? [`Labels: ${p.issue!.labels.join(', ')}`] : []),
        ...(p.issue!.duplicateOf ? [`May already be covered by #${p.issue!.duplicateOf.number}: ${p.issue!.duplicateOf.url}`] : []),
        'Body:', p.issue!.body,
      ].join('\n')),
    ].join('\n');
    const sent = await this.d.orchestrator.send(text);
    if (!sent) return { sent: false, why: 'Apri prima l\'Orchestrator.', state: this.appIdeas() };
    for (const p of items) this.store.update(p.id, { state: 'issue-asked', decidedAt: this.now() });
    log.info('brain', 'app issues handed to the Orchestrator', { data: { n: items.length } });
    this.d.changed();
    return { sent: true, state: this.appIdeas() };
  }

  /** «Scarta»: gone from the tab; a bug from a log group also marks that group known noise (not carded again). */
  dismiss(id: unknown): AppIdeasState {
    const p = typeof id === 'string' ? this.store.get(id) : undefined;
    if (!p || !isAppCard(p) || p.state === 'dismissed') throw new Error('Idea non trovata.');
    this.store.update(p.id, { state: 'dismissed', decidedAt: this.now() });
    if (p.logKey) { try { this.d.brain.noise(p.logKey, true); } catch (e) { log.warn('brain', 'log group not marked known', { cause: errText(e) }); } }
    this.d.changed();
    return this.appIdeas();
  }
}

