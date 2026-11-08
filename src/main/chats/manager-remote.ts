// ChatManager layer (ADR 0200): Claude Code Remote Control of the Orchestrator (ADR 0222). «Controllo remoto» turns the
// engine's claude.ai bridge on or off (claude.ts setRemoteControl); the wish is saved with the chat, so the next engine
// of the same chat (a restart, a crash) reattaches the same bridge (reattach_session_id) and the phone's link keeps
// working. Used by manager.ts (ChatService.remoteControl, IPC chat:remoteControl); no agent tool: the user's click only.
import type { ChatSummary } from '../../shared/contract';
import { errText, log } from '../log';
import type { HarnessSession } from './session';
import type { Rec } from './manager-types';
import { ManagerSink } from './manager-sink';

/** Remote Control on the Orchestrator: on, off, and the reattach when its engine starts. */
export abstract class ManagerRemote extends ManagerSink {
  /** a turn-on in flight per chat, with the engine it asks: a second click or that engine's start-up reattach waits for
   *  it instead of asking twice; a newer engine asks after it */
  private readonly remoteBusy = new Map<string, { sess: HarnessSession; job: Promise<void> }>();

  /** «Controllo remoto»: on (its engine starts if it is not running) or off. The state, the link included, is in the
   *  returned summary; a refusal is its status 'failed' with the engine's words. */
  async remoteControl(chatId: string, enabled: boolean): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (!r.s.isOrchestrator) throw new Error('Il controllo remoto è solo per l’Orchestrator.');
    if (r.s.harness !== 'claude') throw new Error('Il controllo remoto funziona solo con Claude Code: passa l’Orchestrator a Claude.');
    if (r.s.closedAt) throw new Error('L’Orchestrator è chiuso: riaprilo, poi accendi il controllo remoto.');
    if (!enabled) return this.remoteOff(r);
    const rc = r.s.remoteControl;
    const busy = this.remoteBusy.get(chatId);
    if (busy) { await busy.job; return { ...r.s }; }
    if (rc?.on && r.session?.alive && (rc.status === 'ready' || rc.status === 'connected')) return { ...r.s };
    const hadEngine = !!r.session;
    r.s.remoteControl = { on: true, url: rc?.url ?? null, bridgeSessionId: rc?.bridgeSessionId ?? null, status: 'starting' };
    this.updated(r);
    try { await this.ensureSession(r); } catch (e) {
      if (!r.s.remoteControl?.on) return { ...r.s }; // «Spegni» while the engine was starting
      r.s.remoteControl = { on: false, url: null, bridgeSessionId: null, status: 'failed', error: errText(e) };
      this.persist(); this.updated(r);
      return { ...r.s };
    }
    if (!r.s.remoteControl?.on) return { ...r.s };
    // a new engine is already reattaching (remoteAfterStart); a running one is asked now
    const running = this.remoteBusy.get(chatId);
    if (running) await running.job;
    else if (r.session) await this.remoteOn(r, r.session, hadEngine && rc?.on ? rc.bridgeSessionId : null);
    return { ...r.s };
  }

  /** A new engine of a chat whose Remote Control is on: the same bridge comes back (reattach), once it is ready. */
  protected override remoteAfterStart(r: Rec, sess: HarnessSession): void {
    const rc = r.s.remoteControl;
    if (!rc?.on || !r.s.isOrchestrator || !sess.setRemoteControl) return;
    void this.remoteOn(r, sess, rc.bridgeSessionId);
  }

  /** One ask per engine: the same engine's second ask shares it; an ask still out to an engine that went (a crash while
   *  reattaching) is waited for, then this engine asks, so the new engine always gets its bridge. */
  private remoteOn(r: Rec, sess: HarnessSession, reattach: string | null): Promise<void> {
    const chatId = r.s.id;
    const prior = this.remoteBusy.get(chatId);
    if (prior?.sess === sess) return prior.job;
    const entry = { sess, job: Promise.resolve() };
    entry.job = (async () => {
      let id = reattach;
      if (prior) {
        await prior.job;
        if (r.session !== sess || !r.s.remoteControl?.on) return;
        id = r.s.remoteControl.bridgeSessionId ?? reattach;
      }
      await this.askRemote(r, sess, id);
    })().finally(() => { if (this.remoteBusy.get(chatId) === entry) this.remoteBusy.delete(chatId); });
    this.remoteBusy.set(chatId, entry);
    return entry.job;
  }

  /** Asks one engine for its bridge and writes the answer into the chat; never rejects. */
  private async askRemote(r: Rec, sess: HarnessSession, reattach: string | null): Promise<void> {
    const chatId = r.s.id;
    if (!r.s.remoteControl?.on) return;
    const prev = r.s.remoteControl;
    r.s.remoteControl = { on: true, url: prev.url, bridgeSessionId: reattach, status: 'starting' };
    this.updated(r);
    try {
      await sess.ready;
      if (!r.s.remoteControl?.on) return;
      let reply;
      try { reply = await sess.setRemoteControl!(true, { name: r.s.title, reattach }); } catch (e) {
        if (!reattach || r.session !== sess || !r.s.remoteControl?.on) throw e;
        // the old bridge is gone (expired, closed on claude.ai) or the engine did not answer in time: one more ask without
        // the id (a slow engine may still hand back the same link; a gone bridge gives a new one)
        log.warn('chats', 'remote control reattach failed: asking for a bridge again', { chat: chatId, cause: errText(e), hint: 'compare the link: a new one must be opened again on the phone' });
        reply = await sess.setRemoteControl!(true, { name: r.s.title });
      }
      // turned off while it was asked: the engine's bridge, just made, goes too
      if (!r.s.remoteControl?.on && reply && r.session === sess && sess.alive) {
        await sess.setRemoteControl!(false).catch((e: unknown) => log.warn('chats', 'remote control not turned off after a late reply', { chat: chatId, cause: errText(e), hint: 'the bridge ends with the engine; the user can restart the Orchestrator' }));
        return;
      }
      // turned off, or another engine, while it was asked: that one's state wins
      if (r.session !== sess || !r.s.remoteControl?.on || !reply) return;
      const now = r.s.remoteControl.status;
      r.s.remoteControl = { on: true, url: reply.url, bridgeSessionId: reply.bridgeSessionId ?? reattach, status: now === 'connected' ? 'connected' : 'ready' };
    } catch (e) {
      if ((r.session !== sess && r.session) || !r.s.remoteControl?.on) return;
      log.warn('chats', 'remote control not turned on', { chat: chatId, cause: errText(e), hint: 'the chat shows the engine\'s words; the user tries again or turns it off' });
      r.s.remoteControl = { on: false, url: null, bridgeSessionId: null, status: 'failed', error: errText(e) };
    } finally {
      this.persist();
      this.updated(r);
    }
  }

  /** «Spegni», also while it is starting: the state is off at once (a late reply turns the bridge off, askRemote), and
   *  the engine is told now. */
  private async remoteOff(r: Rec): Promise<ChatSummary> {
    const sess = r.session;
    const was = r.s.remoteControl;
    const starting = this.remoteBusy.has(r.s.id) || was?.status === 'starting';
    r.s.remoteControl = { on: false, url: null, bridgeSessionId: null, status: 'off' };
    this.persist();
    this.updated(r);
    if (sess?.alive && sess.setRemoteControl && was?.on && was.status !== 'paused') {
      try { await sess.setRemoteControl(false); } catch (e) {
        // a bridge still being made may refuse an off: its late reply turns it off (askRemote)
        if (!starting) { r.s.remoteControl = was; this.persist(); this.updated(r); throw e; }
        log.warn('chats', 'remote control off refused while starting', { chat: r.s.id, cause: errText(e), hint: 'the late reply turns the bridge off' });
      }
    }
    log.info('chats', 'remote control off', { chat: r.s.id });
    return { ...r.s };
  }
}
