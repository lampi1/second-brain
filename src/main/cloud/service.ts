// Cloud agents in the app (ADR 0080, issue #79): one service over the three vendors' providers (cursor.ts, codex.ts,
// claude.ts) that the cloud:* IPC channels (index.ts), app_create_chat where:'cloud' and app_chats (appctl/tools.ts)
// call. It checks before a start that the engine is on, signed in or keyed (readiness, cached), that the folder is a
// GitHub checkout on a pushed branch (repo.ts: the app never pushes) and, for Cursor, that the budget's Cursor daily
// limit is not reached (its cloud spend is real API spend: counted here and in engines/spend.ts). It polls the
// vendors' lists only while the window is visible, at most every 30 s while something runs, backing off to 10 min when
// nothing does (owner default, ADR 0080 §7), and streams the messages of the one strip the user expanded (Cursor).
// Every failure fails closed: an Error the user reads, logged with cause + hint. Used by wiring.ts (demo: demo.ts).
import path from 'node:path';
import { CLOUD_ACTIVE, CLOUD_CAPS, CLOUD_ENGINES, isCloudEngine, type CloudAgent, type CloudApplyResult, type CloudEngine, type CloudReady, type CloudStartRequest, type CloudState } from '../../shared/cloud';
import { errText, log } from '../log';
import { monthOf } from '../engines/spend';
import { ClaudeCloud } from './claude';
import { CodexCloud } from './codex';
import { CursorCloud } from './cursor';
import type { Exec, Http } from './exec';
import type { CloudProvider } from './provider';
import { fetchIntoWorktree, freshWorktree, repoInfo } from './repo';
import { CloudStore } from './store';

export const POLL_MIN_MS = 30_000;
export const POLL_MAX_MS = 10 * 60_000;
const READY_TTL_MS = 5 * 60_000;
const MAX_MESSAGES = 60;

export interface CloudDeps {
  /** null = nothing saved (tests) */
  file: string | null;
  emit(state: CloudState): void;
  exec: Exec;
  http: Http;
  /** the user's Cursor Cloud Agents key (engines/service.ts), read right before each request */
  cursorKey(): string | null;
  /** the engine is on in Settings (engineOn) */
  engineOn(engine: CloudEngine): boolean;
  /** the budget's Cursor daily limit (null = none or off) and today's local Cursor spend */
  budget(): { limitUsd: number | null; localTodayUsd: number };
  /** real API spend (Cursor), into engines/spend.ts */
  addSpend(usd: number): void;
  /** the app window is on screen (not minimized, not hidden) */
  visible(): boolean;
  now?(): number;
  /** tests: providers replaying fixtures */
  providers?: Partial<Record<CloudEngine, CloudProvider>>;
}

/** The local day of a moment ("2026-10-19"). */
const dayOf = (ms: number): string => { const d = new Date(ms); return `${monthOf(ms)}-${String(d.getDate()).padStart(2, '0')}`; };
const active = (a: CloudAgent) => CLOUD_ACTIVE.includes(a.status);

export class CloudService {
  readonly store: CloudStore;
  private readonly providers: Record<CloudEngine, CloudProvider>;
  private readonly ready = new Map<CloudEngine, { at: number; r: CloudReady }>();
  private messages = new Map<string, CloudAgent['messages']>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval = POLL_MIN_MS;
  private lastRefresh = 0;
  private refreshing: Promise<void> | null = null;
  private watched: { id: string; ctl: AbortController } | null = null;
  private stopped = false;
  private polling = false;

  constructor(private readonly d: CloudDeps) {
    this.store = new CloudStore(d.file);
    this.providers = {
      cursor: d.providers?.cursor ?? new CursorCloud({ http: d.http, key: d.cursorKey }),
      codex: d.providers?.codex ?? new CodexCloud(d.exec),
      claude: d.providers?.claude ?? new ClaudeCloud(d.exec),
    };
  }

  private now(): number { return this.d.now?.() ?? Date.now(); }

  state(): CloudState {
    const hidden = new Set(this.store.data.dismissed);
    const day = dayOf(this.now());
    return {
      agents: this.store.data.agents.filter(a => !hidden.has(`${a.engine}:${a.id}`)).sort((a, b) => b.updatedAt - a.updatedAt)
        .map(a => { const m = this.messages.get(`${a.engine}:${a.id}`); return m?.length ? { ...a, messages: m } : a; }),
      caps: CLOUD_CAPS,
      todayUsd: this.store.data.spend.day === day ? Math.round(this.store.data.spend.usd * 100) / 100 : 0,
      polling: this.polling,
    };
  }

  private changed(): void { this.store.save(); this.d.emit(this.state()); }

  private find(id: string): CloudAgent {
    const a = this.store.data.agents.find(x => x.id === id);
    if (!a) throw new Error('agente cloud non trovato');
    return a;
  }

  private put(a: CloudAgent): CloudAgent {
    const list = this.store.data.agents;
    const i = list.findIndex(x => x.id === a.id && x.engine === a.engine);
    if (i < 0) { list.unshift(a); return a; }
    const old = list[i]!;
    // what the app knows beyond the vendor's list (its own start: folder, title, who) survives a refresh
    const merged: CloudAgent = { ...old, ...a, by: old.by, ...(old.cwd ? { cwd: old.cwd } : {}), title: old.by !== 'vendor' && old.title ? old.title : a.title,
      repo: a.repo || old.repo, ...(a.branch ?? old.branch ? { branch: a.branch ?? old.branch } : {}) };
    if (!a.error) delete merged.error;
    list[i] = merged;
    return merged;
  }

  private fail(what: string, e: unknown, hint: string, agent?: CloudAgent): never {
    log.warn('cloud', what, { data: { engine: agent?.engine, id: agent?.id }, cause: errText(e), hint });
    throw e instanceof Error ? e : new Error(String(e));
  }

  // ── readiness ──
  private async engineReady(engine: CloudEngine): Promise<CloudReady> {
    if (!this.d.engineOn(engine)) return { ok: false, why: 'motore spento in Impostazioni → Motori' };
    const hit = this.ready.get(engine);
    if (engine !== 'cursor' && hit && this.now() - hit.at < READY_TTL_MS) return hit.r;
    let r: CloudReady;
    try { r = await this.providers[engine].readiness(); } catch (e) { r = { ok: false, why: errText(e) }; }
    this.ready.set(engine, { at: this.now(), r });
    return r;
  }

  /** Per engine: can a cloud agent start from this folder now. */
  async readiness(cwd: string): Promise<Record<CloudEngine, CloudReady>> {
    const repo = await repoInfo(this.d.exec, cwd);
    const out = {} as Record<CloudEngine, CloudReady>;
    await Promise.all(CLOUD_ENGINES.map(async e => {
      const r = await this.engineReady(e);
      out[e] = !r.ok ? r : 'why' in repo ? { ok: false, why: repo.why } : r;
    }));
    return out;
  }

  // ── actions ──
  async start(req: CloudStartRequest, by: 'user' | 'agent'): Promise<CloudAgent> {
    if (!isCloudEngine(req?.engine)) throw new Error('motore cloud: cursor | codex | claude');
    const prompt = typeof req.prompt === 'string' ? req.prompt.trim() : '';
    if (!prompt || prompt.length > 8000) throw new Error('scrivi il compito (al massimo 8000 caratteri)');
    const engine = req.engine;
    const ready = await this.engineReady(engine);
    if (!ready.ok) throw new Error(`${engine}: ${ready.why ?? 'non pronto'}`);
    const repo = await repoInfo(this.d.exec, typeof req.cwd === 'string' ? req.cwd.trim() : '');
    if ('why' in repo) throw new Error(repo.why);
    if (engine === 'cursor') {
      const b = this.d.budget();
      if (b.limitUsd !== null && this.state().todayUsd + b.localTodayUsd >= b.limitUsd) throw new Error(`limite di spesa giornaliero Cursor raggiunto (${b.limitUsd} $): gli agenti cloud di Cursor si pagano a prezzo API`);
    }
    const title = (typeof req.title === 'string' && req.title.trim() ? req.title.trim() : prompt.split('\n')[0]!).slice(0, 80);
    const env = engine === 'codex' ? (typeof req.env === 'string' && req.env.trim() ? req.env.trim() : this.store.data.envs[repo.repo]) : undefined;
    let a: CloudAgent;
    try {
      a = await this.providers[engine].start({ prompt, title, repo, ...(typeof req.model === 'string' && req.model ? { model: req.model } : {}), ...(env ? { env } : {}) });
    } catch (e) {
      return this.fail('cloud agent not started', e, engine === 'cursor' ? 'check the Cursor key, plan and spending limit, and that the repo is connected to Cursor' : engine === 'codex' ? 'check `codex login status` (ChatGPT) and the environment id' : 'check `claude auth status` (claude.ai), the Claude GitHub App and the org policy for remote sessions');
    }
    if (env) this.store.data.envs[repo.repo] = env;
    a = this.put({ ...a, by, cwd: repo.root, repo: a.repo || repo.repo, updatedAt: this.now() });
    log.info('cloud', 'cloud agent started', { data: { engine, id: a.id, repo: a.repo, by } });
    this.interval = POLL_MIN_MS;
    this.changed();
    this.schedule(POLL_MIN_MS);
    return a;
  }

  async followUp(id: string, text: string): Promise<CloudAgent> {
    const a = this.find(id), p = this.providers[a.engine];
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t || t.length > 8000) throw new Error('messaggio vuoto o troppo lungo');
    if (!CLOUD_CAPS[a.engine].followUp || !p.followUp) throw new Error('questo motore non accetta messaggi dall’app: apri la sua pagina');
    let patch: Partial<CloudAgent>;
    try { patch = await p.followUp(a, t); } catch (e) { return this.fail('cloud follow-up failed', e, 'open the agent on the vendor page', a); }
    const next = this.put({ ...a, ...patch, updatedAt: this.now() });
    this.changed();
    if (this.watched?.id === id) this.watch(id);
    this.interval = POLL_MIN_MS;
    this.schedule(POLL_MIN_MS);
    return next;
  }

  async stop(id: string): Promise<CloudAgent> {
    const a = this.find(id), p = this.providers[a.engine];
    if (!CLOUD_CAPS[a.engine].stop || !p.stop) throw new Error('questo motore non si ferma dall’app: apri la sua pagina');
    let patch: Partial<CloudAgent>;
    try { patch = await p.stop(a); } catch (e) { return this.fail('cloud stop failed', e, 'stop it on the vendor page', a); }
    const next = this.put({ ...a, ...patch, updatedAt: this.now() });
    this.changed();
    return next;
  }

  /** "Porta in locale": a new worktree beside the repo with the agent's branch (git fetch) or its diff (codex apply). */
  async apply(id: string): Promise<CloudApplyResult> {
    const a = this.find(id);
    if (!a.cwd) throw new Error('non so in quale cartella portarlo: avvialo dall’app, o prendi il branch con git fetch');
    const repo = await repoInfo(this.d.exec, a.cwd);
    const root = 'why' in repo ? a.cwd : repo.root;
    try {
      if (a.engine === 'codex') {
        const w = await freshWorktree(this.d.exec, root, `${a.title}-${a.id.slice(-6)}`);
        await this.providers.codex.applyIn!(a, w.worktree);
        log.info('cloud', 'codex task applied in a new worktree', { data: { id: a.id, worktree: w.worktree } });
        return w;
      }
      if (!a.branch) throw new Error('il branch dell’agente non è ancora noto: aprilo sulla pagina del fornitore');
      const w = await fetchIntoWorktree(this.d.exec, root, a.branch);
      log.info('cloud', 'cloud branch fetched into a new worktree', { data: { id: a.id, worktree: w.worktree } });
      return w;
    } catch (e) { return this.fail('cloud result not brought home', e, 'look at the git output; the checkout itself was not touched', a); }
  }

  dismiss(id: string): CloudState {
    const a = this.find(id);
    if (active(a) && a.engine !== 'claude') throw new Error('è ancora al lavoro: fermalo prima');
    this.store.data.dismissed = [...this.store.data.dismissed.filter(x => x !== `${a.engine}:${a.id}`), `${a.engine}:${a.id}`];
    this.store.data.agents = this.store.data.agents.filter(x => x !== a);
    this.changed();
    return this.state();
  }

  /** The strip the user expanded: its run's messages stream (Cursor) until it collapses or the run ends. */
  watch(id: string | null): void {
    this.watched?.ctl.abort();
    this.watched = null;
    if (!id) return;
    const a = this.store.data.agents.find(x => x.id === id);
    const p = a && this.providers[a.engine];
    if (!a || !p?.stream || !CLOUD_CAPS[a.engine].stream || !a.runId || !this.d.visible()) return;
    const ctl = new AbortController();
    this.watched = { id, ctl };
    const key = `${a.engine}:${a.id}`;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const flush = () => { pending = null; this.d.emit(this.state()); };
    void p.stream(a, m => {
      const list = [...(this.messages.get(key) ?? []).filter(x => x.id !== m.id), { id: m.id, kind: m.kind, text: m.text, at: m.at }].slice(-MAX_MESSAGES);
      this.messages.set(key, list);
      const status = (m as { status?: CloudAgent['status'] }).status;
      if (status && status !== 'unknown' && status !== a.status) { this.put({ ...a, status, updatedAt: this.now() }); this.store.save(); }
      pending ??= setTimeout(flush, 250);
    }, ctl.signal).catch(e => {
      if (!ctl.signal.aborted) log.warn('cloud', 'cloud stream ended with an error', { data: { id }, cause: errText(e), hint: 'the strip falls back to the polled status' });
    });
  }

  // ── polling ──
  /** cloud:list; refresh = ask the vendors now (never more often than every 30 s). */
  async list(refresh = false): Promise<CloudState> {
    if (refresh) await this.refresh();
    return this.state();
  }

  /** Engines whose list is polled: Cursor with a key, Codex once the app knows one of its tasks. */
  private pollable(): CloudEngine[] {
    return CLOUD_ENGINES.filter(e => CLOUD_CAPS[e].list && this.d.engineOn(e) && (e === 'cursor' ? !!this.d.cursorKey() : this.store.data.agents.some(a => a.engine === e)));
  }

  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (this.now() - this.lastRefresh < POLL_MIN_MS) return Promise.resolve();
    this.lastRefresh = this.now();
    this.refreshing = this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const engines = this.pollable();
    if (!engines.length) return;
    this.polling = true;
    for (const e of engines) {
      try {
        const seen = await this.providers[e].list!();
        const hidden = new Set(this.store.data.dismissed);
        for (const a of seen) if (!hidden.has(`${a.engine}:${a.id}`)) this.put(a);
      } catch (err) {
        log.warn('cloud', 'cloud list failed', { data: { engine: e }, cause: errText(err), hint: e === 'cursor' ? 'check the Cursor key in Impostazioni → Motori' : 'check `codex login status`' });
      }
    }
    await this.readSpend();
    this.polling = false;
    this.changed();
  }

  /** Cursor's spend per agent that ran since the last read; the increase is real API spend (budget + engines/spend.ts). */
  private async readSpend(): Promise<void> {
    const p = this.providers.cursor;
    if (!p.usage || !this.d.cursorKey()) return;
    const last = this.store.data.lastCost;
    for (const a of this.store.data.agents.filter(x => x.engine === 'cursor' && (active(x) || last[x.id] === undefined)).slice(0, 10)) {
      let usd: number | null = null;
      try { usd = await p.usage(a); } catch (e) { log.warn('cloud', 'cursor usage not read', { data: { id: a.id }, cause: errText(e), hint: 'the spend shows on the next poll' }); }
      if (usd === null) continue;
      const delta = Math.max(0, usd - (last[a.id] ?? 0));
      last[a.id] = usd;
      this.put({ ...a, costUsd: Math.round(usd * 100) / 100 });
      if (delta > 0) {
        const day = dayOf(this.now());
        if (this.store.data.spend.day !== day) this.store.data.spend = { day, usd: 0 };
        this.store.data.spend.usd = Math.round((this.store.data.spend.usd + delta) * 1e6) / 1e6;
        this.d.addSpend(delta);
      }
    }
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  /** One poll: nothing while the window is hidden; every 30 s while an agent runs, doubling to 10 min when none does. */
  async tick(): Promise<void> {
    if (this.stopped) return;
    if (!this.d.visible()) { this.schedule(POLL_MIN_MS); return; }
    const running = this.store.data.agents.some(a => active(a) && CLOUD_CAPS[a.engine].list);
    this.interval = running ? POLL_MIN_MS : Math.min(this.interval * 2, POLL_MAX_MS);
    if (this.pollable().length) await this.refresh();
    this.schedule(this.interval);
  }

  /** The current poll interval (tests, app_state). */
  get pollMs(): number { return this.interval; }

  startPolling(): void { this.stopped = false; this.schedule(5_000); }

  shutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.watched?.ctl.abort();
  }
}

/** The service as wiring.ts builds it for the real app. */
export function cloudFile(userData: string): string { return path.join(userData, 'cloud-agents.json'); }
