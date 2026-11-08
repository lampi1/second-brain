// The Telegram phone bridge (design: brain tmp/phone-telegram-plan.md): createPhoneBridge(deps) implements the shared
// PhoneController (Impostazioni → Telefono, app_guide) plus start/stop/notifyUrgent for main's lifecycle. Only the stable
// instance polls (dev without a testApiBase stays 'dev-disabled' and never calls Telegram). At start: addRedaction(token)
// before any call, deleteWebhook, then long polling with the saved offset (saved before an update is handled: an update
// is never run twice). Every update passes the guard (guard.ts); pairing, commands, text, voice, button presses and the
// backlog of messages older than the start are handled here; replies, questions and notices leave only through
// outbound.ts (the one filter). Phone text goes to the Orchestrator through PhonePort.sendFromPhone and never approves
// anything; only button presses checked by buttons.ts answer simple questions and plans. Notifications follow policy.ts
// (questions, the Orchestrator's replies, failed chats from PhonePort.onChatFailed, urgent notices from main).
// Used by main (wiring.ts, by the integrator); tests: test/unit/phone/bridge.test.ts against a fake Telegram server.
import type { PhoneController, PhoneDecidable, PhoneSettingsPatch, PhoneStatus, PhoneBridgeState, PhoneOutcome } from '../../shared/contract/phone';
import { createBacklog, isBacklog, START_NOTICE, STOP_NOTICE, type BacklogPayload } from './backlog';
import { createButtons, refKey } from './buttons';
import { backoff, createTelegramClient, resolveApiBase, TelegramError, type TelegramClient } from './client';
import { parseCommand, runCommand, HELP_TEXT } from './commands';
import { condense } from './condense';
import { createGuard } from './guard';
import { createOutbound } from './outbound';
import { createPairing } from './pairing';
import { decide, type PolicyEvent } from './policy';
import { loadState, pushAction, saveState, validQuiet, type PhoneState } from './state';
import { BOT_TOKEN_SHAPE, DEFAULT_TIMING, type PhoneBridgeDeps, type TgMessage, type TgUpdate, type UrgentKind } from './types';
import { clearVoiceTemp, handleVoice } from './voice';

export const ERR_CONFLICT = 'Un\'altra istanza sta leggendo questo bot (altra istanza in polling): chiudila o rigenera il token.';
export const ERR_TOKEN = 'Token non valido: incollane uno nuovo da BotFather.';
export const ERR_NETWORK = 'Telegram non raggiungibile (rete, proxy o firewall): riprovo da solo.';
export const PAIRED_TEXT = '✅ Collegato al PC. Solo questo account può usarmi.\nComandi: /stato /pausa /riprendi /stop';
const URGENT_ICON: Record<UrgentKind, string> = { production: '🚨 PRODUZIONE', urgente: '🚨 URGENTE', budget: '💸 BUDGET 100%' };

export interface PhoneBridge extends PhoneController {
  start(): Promise<void>;
  /** app quitting: "🔴 App chiusa" (silent) then the polling stops */
  stop(): Promise<void>;
  notifyUrgent(kind: UrgentKind, text: string): Promise<void>;
  /** re-checks waiting questions and the night-mode return (runs on a timer; exposed for tests) */
  tick(): Promise<void>;
}

export function createPhoneBridge(deps: PhoneBridgeDeps): PhoneBridge {
  const timing = { ...DEFAULT_TIMING, ...deps.timing };
  const log = deps.log;
  const devDisabled = !deps.isStable && deps.testApiBase === undefined;
  const s: PhoneState = loadState(deps.statePath);
  const guard = createGuard(deps.now);
  const pairing = createPairing(deps.now);
  let client: TelegramClient | null = null;
  let runState: PhoneBridgeState = devDisabled ? 'dev-disabled' : 'off';
  let error: string | null = null;
  let abort: AbortController | null = null;
  let loop: Promise<void> | null = null;
  // one start at a time; halt() bumps the generation so a start still awaiting Telegram gives up (no double polling,
  // no start notice after «App chiusa»)
  let starting: Promise<void> | null = null;
  let gen = 0;
  /** starts begun: a halt that finishes after a newer start leaves the state to it */
  let starts = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubs: (() => void)[] = [];
  let startedAt = 0;
  let lastPhoneMessageAt: number | null = null;
  let focus: string | null = null;
  let wasNight = false;
  let voiceChain: Promise<unknown> = Promise.resolve();
  let outcomeChain: Promise<void> = Promise.resolve();
  let droppedSaved = guard.dropped;
  /** decidables seen and not yet sent: first-seen time, for the "waiting > 2 min" rule */
  const waiting = new Map<string, { item: PhoneDecidable; since: number }>();
  const listeners = new Set<(st: PhoneStatus) => void>();

  const out = createOutbound(() => client, () => s.paired?.chatId ?? null, log);
  const buttons = createButtons({ now: deps.now, port: deps.phonePort, out, log });
  const backlog = createBacklog({ out, now: deps.now });

  const persist = () => {
    s.counters.dropped += guard.dropped - droppedSaved;
    droppedSaved = guard.dropped;
    try { saveState(deps.statePath, s); } catch (e) {
      log.error('phone', 'phone state not saved', { cause: e instanceof Error ? e.message : String(e), hint: 'check that userData is writable; the bridge keeps running with the state in memory' });
    }
  };
  const status = (): PhoneStatus => ({
    hasToken: !!deps.getToken(),
    // after /stop the PC switch shows off: one click turns it back on (update enabled: true clears stoppedFromPhone)
    enabled: s.enabled && !s.stoppedFromPhone,
    paired: s.paired !== null,
    pairing: pairing.shown(),
    state: runState,
    error,
    dropped: s.counters.dropped + guard.dropped - droppedSaved,
    quietHours: s.quietHours ? { ...s.quietHours } : null,
    recent: s.recent.map(a => ({ ...a })),
  });
  const changed = () => { const st = status(); for (const cb of listeners) try { cb(st); } catch { /* a listener never breaks the bridge */ } };
  const setRun = (st: PhoneBridgeState, err: string | null = null) => {
    if (st === runState && err === error) return;
    runState = st; error = err; changed();
  };
  const act = (kind: Parameters<typeof pushAction>[1]['kind'], label: string) => { pushAction(s, { at: deps.now(), kind, label }); persist(); changed(); };
  const ctx = () => {
    const p = deps.presence();
    return { now: deps.now(), hour: new Date(deps.now()).getHours(), lastPhoneMessageAt, atPc: p.atPc, nightMode: p.nightMode, focusChatId: focus, quietHours: s.quietHours, paused: s.paused };
  };

  // ── outgoing: Orchestrator replies, decidables, urgent ────────────────────────────────────────────────────────
  async function onOutcome(ev: PhoneOutcome): Promise<void> {
    if (!s.paired || runState !== 'running' && runState !== 'paused' || s.paused) return;
    const records = s.outcomes ??= [];
    const old = records.find(x => x.runId === ev.runId && x.chatId === s.paired!.chatId);
    if (old && (old.revision >= ev.revision || old.messageId === null)) return;
    const text = condense(ev.text);
    if (!text) return;
    if (old) {
      await out.edit(old.messageId!, text);
      old.revision = ev.revision; persist();
      return;
    }
    const record = { runId: ev.runId, revision: ev.revision, chatId: s.paired.chatId, messageId: null as number | null };
    records.push(record);
    if (records.length > 500) records.shift();
    // An unknown network result must not become a duplicate completion after a restart.
    persist();
    record.messageId = await out.send(text, { silent: true });
    persist();
  }
  async function offerIfAllowed(item: PhoneDecidable, since: number): Promise<void> {
    if (!s.paired || runState !== 'running' && runState !== 'paused') return;
    const key = refKey(item);
    if (buttons.isOffered(item)) { waiting.delete(key); return; }
    const d = decide({ kind: 'decidable', chatId: item.chatId, orchestrator: item.orchestrator, waitingMs: deps.now() - since }, ctx());
    if (!d.send) return;
    waiting.delete(key);
    await buttons.offer(item, { silent: d.silent });
  }

  async function onTurnEnd(ev: { reply: string; fromPhone: boolean; failed: boolean }): Promise<void> {
    if (!s.paired || runState !== 'running' && runState !== 'paused') return;
    const e: PolicyEvent = ev.failed && !ev.fromPhone ? { kind: 'failed', chatId: 'orchestrator', orchestrator: true } : { kind: 'reply', fromPhone: ev.fromPhone };
    const d = decide(e, ctx());
    if (!d.send) return;
    const text = ev.failed ? '⚠️ L\'Orchestrator non ha finito il turno: guarda sul PC.' : condense(ev.reply);
    if (text) await out.send(text, { silent: d.silent });
  }

  async function onChatFailed(ev: { chatId: string; role: string; neutralLabel: string }): Promise<void> {
    if (!s.paired || runState !== 'running' && runState !== 'paused') return;
    const d = decide({ kind: 'failed', chatId: ev.chatId, orchestrator: false }, ctx());
    if (d.send) await out.send(`⚠️ ${ev.role} · ${ev.neutralLabel} si è fermata con un errore: guarda sul PC.`, { silent: d.silent });
  }

  // ── incoming ──────────────────────────────────────────────────────────────────────────────────────────────────
  async function sendText(text: string, label: string): Promise<void> {
    lastPhoneMessageAt = deps.now();
    act('text', label);
    const r = await deps.phonePort.sendFromPhone(text, { voice: false });
    if (r.queued) await out.send('In coda all\'Orchestrator.', { silent: true });
  }

  function runVoice(v: NonNullable<TgMessage['voice']>): void {
    lastPhoneMessageAt = deps.now();
    act('voice', 'vocale');
    const c = client;
    if (!c) return;
    voiceChain = voiceChain.then(() => handleVoice(v, {
      client: c, out, port: deps.phonePort, decodeVoice: deps.decodeVoice, transcribe: deps.transcribe, tempDir: deps.tempDir, log,
    })).catch(e => log.warn('phone', 'voice pipeline failed', { data: { error: e instanceof Error ? e.name : 'error' } }));
  }

  async function runPayload(p: BacklogPayload): Promise<void> {
    if (p.kind === 'text') await sendText(p.text, 'messaggio arretrato');
    else runVoice(p.voice);
  }

  async function onMessage(m: TgMessage): Promise<void> {
    const cmd = typeof m.text === 'string' ? parseCommand(m.text) : null;
    if (isBacklog(m, startedAt)) {
      // /stop is the safe direction: it applies late too; other commands from the backlog are not run
      if (cmd?.name === 'stop') { await out.send(runCommand('stop', commandCtx)); return; }
      if (cmd) return;
      act('backlog', 'messaggio arretrato');
      await backlog.ask(m);
      return;
    }
    if (cmd) {
      act('command', `/${cmd.name}`);
      await out.send(runCommand(cmd.name, commandCtx), { silent: cmd.name === 'pausa' });
      return;
    }
    if (m.voice ?? m.audio) { runVoice((m.voice ?? m.audio)!); return; }
    if (typeof m.text === 'string' && m.text.trim()) { await sendText(m.text, 'messaggio'); return; }
    await out.send(`Qui leggo solo testo e vocali. ${HELP_TEXT}`);
  }

  const commandCtx = {
    summary: () => deps.phonePort.waitingSummary(),
    paused: () => s.paused,
    setPaused: (p: boolean) => { s.paused = p; persist(); setRun(p ? 'paused' : 'running'); },
    // the polling loop halts right after this update (its reply goes out first)
    stopFromPhone: () => { s.stoppedFromPhone = true; persist(); },
  };

  async function handleUpdate(u: TgUpdate): Promise<void> {
    const v = guard.check(u, s.paired?.userId ?? null);
    switch (v.kind) {
      case 'drop':
        if (s.recent[s.recent.length - 1]?.kind !== 'dropped') act('dropped', 'aggiornamento scartato');
        else changed();
        return;
      case 'pair': {
        const r = pairing.attempt(v.code, v.userId);
        if (r !== 'ok') {
          // no reply to the sender; the PC shows it: the dropped counter and one line in the recent actions per series
          s.counters.dropped++;
          const label = r === 'blocked' ? 'associazione: troppi tentativi da un account' : r === 'none' ? 'associazione senza codice attivo' : 'associazione: codice errato';
          if (s.recent[s.recent.length - 1]?.label !== label) act('dropped', label);
          else { persist(); changed(); }
          return;
        }
        s.paired = { userId: v.userId, chatId: v.chatId };
        persist();
        log.info('phone', 'phone paired');
        act('command', 'associazione');
        await out.send(PAIRED_TEXT);
        return;
      }
      case 'rate-limited':
        if (v.notify) await out.send('⏳ Troppi messaggi: per qualche minuto ignoro i nuovi.');
        return;
      case 'message': return onMessage(v.message);
      case 'callback': {
        const paired = s.paired!.userId;
        if (v.callback.data?.startsWith('b:')) {
          const r = await backlog.press(v.callback, paired);
          if (r.outcome === 'run' && r.payload) await runPayload(r.payload);
          return;
        }
        const r = await buttons.press(v.callback, paired);
        if (r === 'ok') act('answer', 'risposta con pulsante');
        return;
      }
    }
  }

  async function poll(signal: AbortSignal): Promise<void> {
    let fails = 0;
    let conflicts = 0;
    const wait = (ms: number) => new Promise<void>(r => { const t = setTimeout(r, ms); signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
    while (!signal.aborted && client) {
      let updates: TgUpdate[];
      try {
        updates = await client.getUpdates(s.offset, signal);
        fails = 0;
        conflicts = 0;
        if (runState === 'error') setRun(s.paused ? 'paused' : 'running');
      } catch (e) {
        if (signal.aborted) return;
        const code = e instanceof TelegramError ? e.code : 'network';
        if (code === 401 || code === 404) {
          log.error('phone', 'telegram token rejected', { cause: `getUpdates ${code}`, hint: 'paste a new bot token in Impostazioni → Telefono (BotFather /token)' });
          setRun('error', ERR_TOKEN);
          void halt('error');
          return;
        }
        if (code === 409) {
          // the other reader stays until someone closes it: back off like a network failure, log once per series
          if (++conflicts === 1) log.error('phone', 'telegram polling conflict', { cause: 'getUpdates 409: another getUpdates or a webhook uses this token', hint: 'close the other instance (dev or another PC) or regenerate the token' });
          fails++;
          setRun('error', ERR_CONFLICT);
        } else if (code === 429 && e instanceof TelegramError && e.retryAfterS) {
          await wait(Math.min(timing.maxRetryAfterMs, e.retryAfterS * 1000));
          continue;
        } else if (++fails >= 3) setRun('error', ERR_NETWORK);
        await wait(backoff(fails, timing.backoffMs, timing.backoffMaxMs));
        continue;
      }
      for (const u of updates) {
        if (signal.aborted) return;
        if (!Number.isSafeInteger(u?.update_id) || u.update_id < s.offset) continue;
        s.offset = u.update_id + 1;
        persist(); // before handling: a crash never runs an update twice
        try { await handleUpdate(u); } catch (e) {
          log.warn('phone', 'update not handled', { data: { error: e instanceof Error ? e.name : 'error' } });
        }
        if (s.stoppedFromPhone) { log.info('phone', 'phone bridge stopped from the phone'); void halt('stopped-from-phone'); return; }
      }
    }
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────────────────────────────────────────
  function idleState(): PhoneBridgeState {
    if (devDisabled) return 'dev-disabled';
    if (s.stoppedFromPhone) return 'stopped-from-phone';
    return 'off';
  }

  async function halt(next: PhoneBridgeState, notice = false): Promise<void> {
    const my = ++gen, startsAtHalt = starts;
    const wasLive = runState === 'running' || runState === 'paused';
    if (notice && wasLive && s.paired) {
      await Promise.race([out.send(STOP_NOTICE, { silent: true }), new Promise(r => { const t = setTimeout(r, 3000); t.unref?.(); })]);
    }
    abort?.abort();
    abort = null;
    if (timer) clearInterval(timer);
    timer = null;
    for (const u of unsubs) try { u(); } catch { /* already gone */ }
    unsubs = [];
    const l = loop;
    loop = null;
    client = null;
    buttons.clear();
    backlog.clear();
    waiting.clear();
    await l?.catch(() => undefined);
    // a start (or another halt) since this one began owns the state now: never write 'off' over a new running loop
    if (my !== gen || starts !== startsAtHalt) return;
    setRun(next, next === 'error' ? error : null);
  }

  function start(): Promise<void> {
    if (loop) return Promise.resolve();
    if (starting) return starting;
    starts++;
    const p = startOnce(gen).finally(() => { if (starting === p) starting = null; });
    starting = p;
    return p;
  }

  async function startOnce(my: number): Promise<void> {
    if (devDisabled) { setRun('dev-disabled'); return; }
    const token = deps.getToken();
    if (!token || !s.enabled || s.stoppedFromPhone) { setRun(idleState()); return; }
    let base: string;
    try { base = resolveApiBase(deps.testApiBase); } catch (e) {
      log.error('phone', 'phone bridge api base refused', { cause: e instanceof Error ? e.message : String(e), hint: 'testApiBase must be http://127.0.0.1:<port>' });
      setRun('error', 'Indirizzo di test rifiutato.');
      return;
    }
    deps.addRedaction(token); // before the first call: the token is in every URL
    clearVoiceTemp(deps.tempDir, log);
    setRun('starting');
    const c = createTelegramClient({ fetch: deps.fetch, token, base, log, timing });
    try {
      await c.deleteWebhook();
    } catch (e) {
      const code = e instanceof TelegramError ? e.code : 'network';
      const msg = code === 401 || code === 404 ? ERR_TOKEN : ERR_NETWORK;
      log.error('phone', 'phone bridge did not start', { cause: `deleteWebhook ${String(code)}`, hint: code === 401 || code === 404 ? 'paste a new bot token in Impostazioni → Telefono' : 'check that api.telegram.org is reachable (proxy, firewall)' });
      if (my === gen) setRun('error', msg);
      return;
    }
    if (my !== gen) return; // halted while Telegram answered
    client = c;
    startedAt = deps.now();
    wasNight = deps.presence().nightMode;
    abort = new AbortController();
    const port = deps.phonePort;
    unsubs.push(port.onOrchestratorTurnEnd(ev => { void onTurnEnd(ev).catch(() => undefined); }));
    if (port.onOutcome) unsubs.push(port.onOutcome(ev => { outcomeChain = outcomeChain.then(() => onOutcome(ev)).catch(e => log.warn('phone', 'outcome delivery failed', { cause: String(e), hint: 'the canonical outcome remains in the Orchestrator' })); }));
    unsubs.push(port.onChatFailed(ev => { void onChatFailed(ev).catch(() => undefined); }));
    unsubs.push(port.onDecidable(ev => {
      const key = refKey(ev.item);
      if (ev.type === 'resolved') { waiting.delete(key); void buttons.resolved(ev.item, ev.by).catch(() => undefined); return; }
      const since = waiting.get(key)?.since ?? deps.now();
      waiting.set(key, { item: ev.item, since });
      void offerIfAllowed(ev.item, since).catch(() => undefined);
    }));
    for (const item of port.listDecidable()) waiting.set(refKey(item), { item, since: deps.now() });
    timer = setInterval(() => { void tick(); }, timing.tickMs);
    timer.unref?.();
    setRun(s.paused ? 'paused' : 'running');
    log.info('phone', 'phone bridge started');
    if (s.paired) await out.send(START_NOTICE, { silent: true });
    if (my !== gen || !abort) return; // halted during the notice: halt() already undid the subscriptions
    loop = poll(abort.signal);
  }

  async function tick(): Promise<void> {
    if (runState !== 'running' && runState !== 'paused') return;
    const night = deps.presence().nightMode;
    if (wasNight && !night && s.paired && !s.paused && !deps.presence().atPc) {
      const w = deps.phonePort.waitingSummary();
      await out.send(`🌅 Fine modalità notte · ${w.waiting === 1 ? '1 chat ti aspetta' : `${w.waiting} chat ti aspettano`}.`, { silent: true });
    }
    wasNight = night;
    const open = new Set(deps.phonePort.listDecidable().map(refKey));
    for (const [key, w] of [...waiting]) {
      if (!open.has(key)) { waiting.delete(key); continue; }
      await offerIfAllowed(w.item, w.since);
    }
  }

  async function restart(): Promise<void> {
    await halt(idleState());
    await start();
  }

  return {
    status,
    start,
    stop: () => halt(idleState(), true),
    tick,
    async notifyUrgent(kind, text) {
      if (!s.paired || runState !== 'running' && runState !== 'paused') return;
      const d = decide({ kind: 'urgent' }, ctx());
      if (d.send) await out.send(`${URGENT_ICON[kind]}\n${condense(text, 400)}`, { silent: d.silent });
    },
    async setToken(token) {
      const t = String(token ?? '').trim();
      if (!BOT_TOKEN_SHAPE.test(t)) throw new Error('Token non valido: copia quello che ti dà BotFather (numeri:lettere).');
      deps.addRedaction(t);
      await deps.saveToken(t);
      s.enabled = true;
      s.stoppedFromPhone = false;
      persist();
      error = null;
      await restart();
      return status();
    },
    async clearToken() {
      await halt(idleState());
      await deps.deleteToken();
      pairing.cancel();
      changed();
      return status();
    },
    startPairing() {
      // a dev build never polls: a code it showed could never be used
      if (devDisabled || s.paired || !deps.getToken()) return status();
      pairing.start();
      if (!loop && s.enabled && !s.stoppedFromPhone) void start();
      changed();
      return status();
    },
    unpair() {
      s.paired = null;
      pairing.cancel();
      buttons.clear();
      backlog.clear();
      waiting.clear();
      persist();
      log.info('phone', 'phone unpaired');
      changed();
      return status();
    },
    update(patch: PhoneSettingsPatch) {
      if (patch.quietHours !== undefined && (patch.quietHours === null || validQuiet(patch.quietHours))) {
        s.quietHours = patch.quietHours ? { from: patch.quietHours.from, to: patch.quietHours.to } : null;
      }
      if (patch.enabled === true && (!s.enabled || s.stoppedFromPhone)) {
        s.enabled = true; s.stoppedFromPhone = false;
        persist();
        void start();
      } else if (patch.enabled === false && s.enabled) {
        s.enabled = false;
        persist();
        void halt(idleState());
      } else persist();
      changed();
      return status();
    },
    onChanged(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    setFocus(chatId) { focus = typeof chatId === 'string' && chatId ? chatId : null; },
  };
}
