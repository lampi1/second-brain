// The Guida's main side (ADR 0196): «Chiedi alla Guida» (IPC guide:ask) and the cards «da verificare» (IPC guide:stale).
// ask: the question with the matching cards and the app_guide index (shared/guide-ask.ts) goes to one light model with
// no tools through agents/oneshot.ts (Flash's engine at its lightest tier: no role text, no files, no permission
// prompt; the run is kept like the other one-shot jobs', job 'guide'); the answer comes back with its checked citations and its cost.
// stale: the anchored code of the cards hashed in the repo the app runs from (main/guide/anchors.ts), at most once a
// minute, against the repo's own src/shared/guide-anchors.json (the bundled copy only when that one cannot be read);
// a packaged build has no repo and answers checked: false. A runOnce that throws answers a clean reason. Built by wiring.ts; handlers in index.ts.
import type { OneShotRequest, OneShotResult } from '../agents/oneshot';
import { FLASH_ID } from '../../shared/roles';
import { GUIDE_SYSTEM, QUESTION_MAX, citations, guidePrompt, type GuideAnswer, type GuideAskRequest, type GuideStaleState } from '../../shared/guide-ask';
import { errText, log } from '../log';
import { CONCEPTS } from '../../shared/concept-guide';
import { anchorsIn, staleInRepo } from './anchors';

export interface GuideServiceDeps {
  /** agents/oneshot.ts runOnce (tests: a fake engine) */
  runOnce(req: OneShotRequest): Promise<OneShotResult>;
  /** app_guide's index in the user's language (appctl/guide.ts guideIndex), '' when the window does not answer */
  index(lang: GuideAskRequest['lang']): Promise<string>;
  /** the repo a dev build runs from; null in a packaged build */
  repoRoot: string | null;
  now?: () => number;
}

const STALE_TTL = 60_000;

export class GuideService {
  private staleAt = 0;
  private staleCache: GuideStaleState | null = null;
  constructor(private readonly d: GuideServiceDeps) {}

  async ask(req: GuideAskRequest): Promise<GuideAnswer> {
    const lang = req?.lang === 'en' || req?.lang === 'de' ? req.lang : 'it';
    const question = typeof req?.question === 'string' ? req.question.trim() : '';
    const empty: GuideAnswer = { ok: false, text: '', cards: [], files: [], costUsd: null, costBasis: 'unknown', model: null };
    if (question.length < 2 || question.length > QUESTION_MAX) return { ...empty, reason: 'invalid' };
    let index = '';
    try { index = await this.d.index(lang); } catch { /* the cards alone still answer */ }
    const { prompt, given } = guidePrompt(question, lang, index);
    let r: OneShotResult;
    try { r = await this.d.runOnce({ agentId: FLASH_ID, purpose: 'guide', light: true, system: GUIDE_SYSTEM(lang), prompt, maxOutputTokens: 900, timeoutMs: 60_000 }); }
    catch (e) {
      // the engine threw instead of answering: a clean reason for the card, the cause in the log
      log.warn('guide', 'guide question not answered', { cause: errText(e), hint: 'try again; npm run logs -- --scope guide' });
      return { ...empty, reason: 'La Guida non ha potuto rispondere adesso: riprova tra poco.' };
    }
    if (!r.ok) {
      log.warn('guide', 'guide question not answered', { cause: r.reason ?? 'unknown', hint: r.noEngine ? 'turn on an engine for agents in Impostazioni → Motori' : 'try again; npm run logs -- --scope guide' });
      return { ...empty, model: r.model, costUsd: r.costUsd, costBasis: r.costBasis, ...(r.reason ? { reason: r.reason } : {}), ...(r.noEngine ? { noEngine: true } : {}) };
    }
    const cites = citations(r.text, given);
    log.info('guide', 'guide question answered', { data: { cards: given.map(c => c.id), costUsd: r.costUsd, model: r.model } });
    return { ok: true, text: r.text.trim(), ...cites, costUsd: r.costUsd, costBasis: r.costBasis, model: r.model };
  }

  stale(): GuideStaleState {
    if (!this.d.repoRoot) return { checked: false, cards: [] };
    const now = (this.d.now ?? Date.now)();
    if (this.staleCache && now - this.staleAt < STALE_TTL) return this.staleCache;
    try {
      // the repo's own stored hashes: a clone updated but not rebuilt compares like the code on disk
      const cards = staleInRepo(this.d.repoRoot, CONCEPTS, anchorsIn(this.d.repoRoot)).map(c => ({ id: c.id, points: c.points, refs: c.anchors.map(a => a.ref) }));
      this.staleCache = { checked: true, cards };
    } catch (e) {
      log.warn('guide', 'guide anchors not checked', { cause: errText(e), hint: 'run node scripts/guide-anchors.mjs --check in the repo' });
      this.staleCache = { checked: false, cards: [] };
    }
    this.staleAt = now;
    return this.staleCache;
  }
}
