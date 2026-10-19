// The Judge's sampled reviews (ADR 0083, the app owns the improvement loop): a few times a day the app picks finished
// role runs nobody judged yet (no verdict of the user, of a Judge, or of the parent that read the result), starts a
// Judge chat on each (a root chat linked to the run with reviewOf, on another model when the catalog has one), and
// when that review ends turns its verdict into the run's feedback (run-feedback.ts recordFeedback: it counts as
// reviewed evidence only when the Judge verified it on a model other than the run's). At most
// Settings.delegation.judgeDaily a day (0 = off). It spends tokens, so wiring.ts starts it only in the user's stable
// app outside tests (or with SB_JUDGE_SAMPLE=1). Pure picking (pickSamples, reviewPrompt) is unit-tested in
// test/unit/agents/judge-sample.test.ts.
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AgentRun } from '../../shared/agents';
import type { AgentFeedbackArgs } from '../../shared/agent-lifecycle';
import type { ChatSummary, Harness, NewChat } from '../../shared/contract';
import { ROLE_DEFAULTS, isWorkRole } from '../../shared/roles';
import { readLocal, writeLocal } from './local-store';
import { log, errText } from '../log';

/** a run older than this is not sampled any more */
export const SAMPLE_WINDOW_MS = 7 * 86_400_000;
const OUTPUT_MAX = 6000;
const KEPT = 200;

export interface JudgeSampleDeps {
  file: string;
  runs: () => readonly AgentRun[];
  chat: (id: string) => ChatSummary | undefined;
  create: (req: NewChat) => Promise<ChatSummary>;
  daily: () => number;
  /** the engine the Judge role runs on */
  judgeEngine: () => Harness;
  /** why a chat may not start on that engine now (switched off, agents may not use it); null = it may */
  refusal: (engine: Harness) => string | null;
  feedback: (a: AgentFeedbackArgs, callerId: string) => Promise<unknown>;
  now?: () => number;
}
interface Review { runId: string; chatId: string; at: number; state: 'running' | 'recorded' | 'no-verdict' }
interface State { version: 1; day: string; started: number; reviews: Review[] }

const dayOf = (t: number): string => new Date(t).toISOString().slice(0, 10);
const UNJUDGED = new Set(['self-report', 'unknown']);

/** The runs to review now: finished with a report in the last week, not a Judge's own, not judged by anyone, not
 *  reviewed already; a stable pseudo-random order per day, so the sample is spread over roles and not just the newest. */
export function pickSamples(runs: readonly AgentRun[], reviewed: ReadonlySet<string>, now: number, n: number): AgentRun[] {
  if (n <= 0) return [];
  const day = dayOf(now);
  const hasReview = new Set(runs.flatMap(r => r.reviewOf ? [r.reviewOf] : []));
  return runs.filter(r => r.endedAt !== undefined && r.endReason === 'completed' && now - r.endedAt <= SAMPLE_WINDOW_MS
      && r.source !== 'oneshot' && r.agentId !== 'judge' && isWorkRole(r.agentId) && !!r.report
      && (!r.outcome || UNJUDGED.has(r.outcome.basis)) && !hasReview.has(r.runId) && !reviewed.has(r.runId))
    .map(r => ({ r, k: createHash('sha256').update(`${day}:${r.runId}`).digest('hex') }))
    .sort((a, b) => a.k.localeCompare(b.k)).slice(0, n).map(x => x.r);
}

/** The Judge's self-contained contract: what the run had to do, what it said and gave, how to answer. */
export function reviewPrompt(run: AgentRun, chat: Pick<ChatSummary, 'title' | 'cwd' | 'lastText'>): string {
  const role = isWorkRole(run.agentId) ? ROLE_DEFAULTS[run.agentId].name : run.agentId;
  const output = (chat.lastText ?? '').trim();
  return [
    `Sampled review by the app: an independent verdict on a finished run of ${role} «${chat.title}».`,
    `Goal of that run: ${run.goal}`,
    ...(run.report ? [`Its report: outcome ${run.report.outcome}, verified ${run.report.verified}: ${run.report.summary}`] : []),
    `Its last answer:\n${output ? (output.length > OUTPUT_MAX ? `${output.slice(0, OUTPUT_MAX)}…` : output) : '(none)'}`,
    `Folder: ${chat.cwd}`,
    'Check the answer against the goal with read-only means: read the files and the evidence it names, compare. Change nothing.',
    'End with one run-report block: {"outcome":"done","verified":"yes|partial|no","summary":"…","verdict":"success|partial|fail"}. verified is yes only when you checked the evidence yourself.',
  ].join('\n');
}

export class JudgeSampler {
  private state: State;
  private ticking = false;
  private readonly now: () => number;
  constructor(private readonly d: JudgeSampleDeps) {
    this.now = d.now ?? Date.now;
    this.state = this.read();
  }

  private read(): State {
    let v: unknown;
    try { v = readLocal(this.d.file); } catch (e) { log.warn('agents', 'judge samples unreadable: starting empty', { cause: errText(e), hint: `the file stays as it is: ${path.basename(this.d.file)}` }); }
    const o = v as Partial<State> | undefined;
    const reviews = Array.isArray(o?.reviews) ? o!.reviews.filter((r): r is Review => !!r && typeof r.runId === 'string' && typeof r.chatId === 'string'
      && Number.isFinite(r.at) && ['running', 'recorded', 'no-verdict'].includes(r.state)) : [];
    return { version: 1, day: typeof o?.day === 'string' ? o.day : '', started: Number.isSafeInteger(o?.started) ? o!.started! : 0, reviews };
  }
  private save(): void {
    this.state.reviews = this.state.reviews.slice(-KEPT);
    try { writeLocal(this.d.file, this.state); } catch (e) { log.warn('agents', 'judge samples not saved', { cause: errText(e), hint: 'the next start may sample a run again' }); }
  }

  /** Starts today's remaining reviews (one call at a time). */
  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    try {
      const now = this.now(), day = dayOf(now);
      if (this.state.day !== day) { this.state.day = day; this.state.started = 0; }
      const left = Math.max(0, this.d.daily() - this.state.started);
      if (!left) return 0;
      const engine = this.d.judgeEngine(), refused = this.d.refusal(engine);
      if (refused) { log.info('agents', 'judge sample skipped', { data: { why: refused } }); return 0; }
      let started = 0;
      for (const run of pickSamples(this.d.runs(), new Set(this.state.reviews.map(r => r.runId)), now, left)) {
        const chat = this.d.chat(run.chatId);
        if (!chat) continue;
        try {
          const judge = await this.d.create({ harness: engine, cwd: chat.cwd, title: `Revisione · ${chat.title}`.slice(0, 80), roleId: 'judge', reviewOf: run.runId,
            goal: `Independent verdict on «${chat.title}»`, independentOf: { engine: chat.harness, model: run.model ?? null }, prompt: reviewPrompt(run, chat) });
          this.state.reviews.push({ runId: run.runId, chatId: judge.id, at: now, state: 'running' });
          this.state.started++; started++;
        } catch (e) {
          log.warn('agents', 'judge sample not started', { data: { runId: run.runId }, cause: errText(e), hint: 'tried again at the next tick' });
          break;
        }
      }
      if (started) this.save();
      return started;
    } finally { this.ticking = false; }
  }

  /** A run ended: when it is one of our reviews, its verdict becomes the reviewed run's feedback. */
  async ended(run: AgentRun): Promise<void> {
    if (run.agentId !== 'judge' || !run.reviewOf) return;
    const entry = this.state.reviews.find(r => r.runId === run.reviewOf && r.chatId === run.chatId && r.state === 'running');
    if (!entry) return;
    const verdict = run.report?.verdict;
    if (!verdict || !run.report) { entry.state = 'no-verdict'; this.save(); log.info('agents', 'judge sample without a verdict', { data: { runId: run.reviewOf } }); return; }
    try {
      await this.d.feedback({ runId: run.reviewOf, verdict, notes: `Judge: ${run.report.summary}`, evidence: [{ kind: 'run', ref: run.runId, at: run.endedAt ?? this.now() }] }, 'judge-sample');
      entry.state = 'recorded';
    } catch (e) {
      entry.state = 'no-verdict';
      log.warn('agents', 'judge verdict not recorded', { data: { runId: run.reviewOf }, cause: errText(e), hint: 'the review stays in its chat; the run keeps no verdict' });
    }
    this.save();
  }

  /** The reviews so far (tests, diagnostics). */
  list(): readonly Review[] { return structuredClone(this.state.reviews); }
}
