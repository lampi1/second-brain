// IPC handlers, Brain: the Brain pages (brainmodel, queries, classifiers), memory and learning review, Proposte, the
// maintenance, the morning block, comparisons, skills. Registered by src/main/index.ts with every other group (Handlers
// in ipc.ts keeps the set complete); each channel's shape is in src/shared/contract/*.ts.
import type { HandlerContext, HandlersOf } from './context';

export function brainHandlers({ s, emitter, research, requireReviewRoot, search, proposals }: HandlerContext): HandlersOf<'brain' | 'brainmodel' | 'queries' | 'classifiers' | 'memory' | 'learning' | 'proposals' | 'maintenance' | 'morning' | 'compare' | 'learn' | 'skills'> {
  return {
    'brain:share': () => s.agentPacks.share(),
    // the Brain pages (ADR 0077): read, the maintenance button, an undo, a skill toggle; Classificatori read-only
    'brainmodel:state': () => s.brainModel.stateAsync(),
    'memory:reviewList': a => s.memoryReview?.list(undefined, a?.asOf) ?? [],
    'memory:retract': async a => { requireReviewRoot(a.expectedRoot); if (!s.memoryReview) throw new Error('Memory review unavailable.'); try { return await s.memoryReview.retract(a.id, a.reason); } finally { await search.invalidateBrain(); } },
    'memory:delete': async a => { requireReviewRoot(a.expectedRoot); if (!s.memoryReview) throw new Error('Memory review unavailable.'); try { return await s.memoryReview.delete(a.id); } finally { await search.invalidateBrain(); } },
    'learning:state': () => s.learningReview?.state() ?? { datasets: [], replays: [], candidates: [], replayAvailable: false },
    'learning:evidence': a => { requireReviewRoot(a.expectedRoot); if (!s.learningReview) throw new Error('Learning evidence unavailable.'); return s.learningReview.evidence(a.runId); },
    'learning:import': a => { requireReviewRoot(a.expectedRoot); if (!s.learningReview) throw new Error('Learning review unavailable.'); return s.learningReview.import(a.dataset); },
    'learning:replay': a => { requireReviewRoot(a.expectedRoot); if (!s.learningReview) throw new Error('Replay unavailable.'); return s.learningReview.replay(a.datasetId, a.split, a.candidateName); },
    'learning:saveCandidate': a => { requireReviewRoot(a.expectedRoot); if (!s.learningReview) throw new Error('Candidate review unavailable.'); return s.learningReview.saveCandidate(a.name, a.text, a.expectedDigest); },
    'learning:promote': a => { requireReviewRoot(a.expectedRoot); if (!s.learningReview) throw new Error('Candidate promotion unavailable.'); const result = s.learningReview.promote(a.name, a.expectedDigest, a.replayId, a.exampleRunId); emitter.emit('brainmodel:changed', undefined); return result; },
    'learning:compare': a => { if (!s.learningReview) throw new Error('Replay comparison unavailable.'); return s.learningReview.compare(a.beforeId, a.afterId); },
    // Memoria → Proposte (ADR 0123): one list of what waits for the user; each decision runs its source's own handler
    'proposals:list': () => proposals().list(),
    'proposals:count': () => proposals().count(),
    'proposals:decide': a => proposals().decide(a),
    'proposals:shown': a => proposals().shown(a?.id),
    'proposals:undoAuto': a => proposals().undoAuto(a),
    'brainmodel:maintain': a => s.brainModel.maintain(a?.job),
    // the one-click maintenance (ADR 0132, 0153): the free cleanup, then the invisible research; its cards in Proposte
    'maintenance:run': () => research().runAll(),
    'maintenance:status': () => research().status(),
    'maintenance:stop': () => research().stop(),
    'brainmodel:rollback': a => s.brainModel.rollback(String(a?.id ?? '')),
    // the brain's saved queries (ADR 0124); a delete is a ChangeLog entry, undone with brainmodel:rollback
    'queries:list': () => s.queries?.list() ?? { root: null, dir: 'queries', queries: [] },
    'queries:get': a => { if (!s.queries) throw new Error('Queries unavailable.'); return s.queries.get(String(a?.id ?? '')); },
    'queries:delete': a => { if (!s.queries) throw new Error('Queries unavailable.'); const r = s.queries.delete(String(a?.id ?? '')); emitter.emit('brainmodel:changed', undefined); emitter.emit('queries:changed', undefined); return r; },
    'brainmodel:noise': a => { if (typeof a?.key !== 'string' || !a.key || a.key.length > 1000 || typeof a?.known !== 'boolean') throw new Error('Invalid log group'); return s.brainModel.noise(a.key, a.known); },
    'brainmodel:link': a => { if (typeof a?.skill !== 'string' || typeof a?.agentId !== 'string' || typeof a?.on !== 'boolean') throw new Error('Invalid skill link'); return s.brainModel.link(a.skill, a.agentId, a.on); },
    'brainmodel:remove': a => { if (!['skill', 'rule', 'script'].includes(a?.kind as string) || typeof a?.target !== 'string' || !a.target || a.target.length > 500) throw new Error('Invalid item to remove'); return s.brainModel.remove(a.kind, a.target); },
    'classifiers:state': () => s.brainModel.classifiers(),
    // the morning block (ADR 0102): the renderer's presence, Ctrl+J's fallback, the user's Esc / Ok
    'morning:brief': a => s.morning ? s.morning.handle(a) : { history: false, show: false, brief: null },
    'brain:api': a => s.brain.api(a?.path),
    'compare:list': () => s.brain.compareList(),
    'learn:act': a => s.brain.learnAct(a),
    'skills:list': () => s.skills.list(),
    'skills:read': a => s.skills.read(String(a?.id ?? '')),
    'skills:save': a => s.skills.save(a),
    'skills:delete': a => s.skills.remove(String(a?.id ?? '')),
  };
}
