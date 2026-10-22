// The first-run setup wizard's flow, kept pure so it is unit-tested (test/unit/setup-wizard.test.ts) without a DOM:
// the six steps in order (language, AI, tools, about you, folders, ready: issues #164, #165, ADR 0119), which step may
// be left or reached, how a saved run resumes, the language names written into me.md, the recommended AI and the AI
// sign-in states. Why: the owner wants ONE modal from start to finish (2026-10-18):
// "Collega" opens the engine's official sign-in in its own window and the wizard waits on the same step, checking by
// itself every few seconds (and with a "Verifica"); nothing here closes the modal, only an explicit exit does. Used by components/FirstInterview.tsx
// and components/SetupEngines.tsx.
import type { SetupDraft, SetupState } from '@shared/agents';
import type { CliStatus, Lang } from '@shared/contract';

export const SETUP_STEPS = ['language', 'ai', 'tools', 'you', 'folders', 'done'] as const;
export type SetupStepId = typeof SETUP_STEPS[number];
export const SETUP_ENGINES = ['claude', 'codex', 'cursor'] as const;
export type SetupEngineId = typeof SETUP_ENGINES[number];
export const LAST_STEP = SETUP_STEPS.length - 1;
/** the profile answers' problems (lib/agent-setup.ts answerProblems) */
export type AnswerProblems = Partial<Record<'name' | 'role' | 'language' | 'areas', string>>;

/** a saved or malformed step number, as a valid index */
export function clampStep(step: number): number { return Math.max(0, Math.min(LAST_STEP, Number.isInteger(step) ? step : 0)); }
export const stepId = (step: number): SetupStepId => SETUP_STEPS[clampStep(step)]!;

/** the answer problems that keep this step from being left forward (the summary waits for all of them) */
export function stepProblems(step: number, problems: AnswerProblems): string[] {
  const id = stepId(step);
  const keys: (keyof AnswerProblems)[] = id === 'you' ? ['name', 'role'] : id === 'done' ? ['name', 'role'] : [];
  return keys.flatMap(k => problems[k] ? [problems[k]!] : []);
}
export const canAdvance = (step: number, problems: AnswerProblems): boolean => stepProblems(step, problems).length === 0;

/** a click on the step indicator: back is always allowed, forward only past steps that may be left */
export function canJump(from: number, to: number, problems: AnswerProblems): boolean {
  const a = clampStep(from), b = clampStep(to);
  if (b <= a) return true;
  for (let s = a; s < b; s++) if (!canAdvance(s, problems)) return false;
  return true;
}

/** how the wizard ends: only these three, each an explicit button (or Esc = later); every one saves the answers */
export type SetupExit = 'later' | 'skip' | 'finish';
export const exitStatus = (exit: SetupExit): 'draft' | 'skipped' | 'completed' => exit === 'finish' ? 'completed' : exit === 'skip' ? 'skipped' : 'draft';

/** the draft the wizard opens on: a run in progress resumes at its step with its answers; a finished or skipped run
 *  starts over from the first step (its old answers are never written again), with the engines turned on preselected */
export function openingDraft(initial: SetupState, enabledEngines: Partial<Record<string, boolean>> | undefined): SetupDraft {
  const resume = initial.status === 'new' || initial.status === 'draft';
  return {
    ...initial.preferences,
    engines: initial.preferences.engines ?? (resume ? [] : SETUP_ENGINES.filter(id => enabledEngines?.[id])),
    step: resume ? clampStep(initial.preferences.step) : 0,
    profile: resume ? initial.preferences.profile : undefined,
  };
}

/** the chat language as me.md writes it ("Language: italiano in chat"), from the language picked in the first step */
export const LANG_PROFILE: Record<Lang, string> = { it: 'italiano', en: 'English', de: 'Deutsch' };
/** each language in its own words, for the first step's buttons (never translated) */
export const LANG_NATIVE: Record<Lang, { name: string; region: string }> = { it: { name: 'Italiano', region: 'Italia' }, en: { name: 'English', region: 'International' }, de: { name: 'Deutsch', region: 'Österreich' } };

/** turns one engine on or off in the draft's preferences (never a trust or login grant) */
export function withEngine(engines: readonly string[] | undefined, id: string, on: boolean): string[] {
  const now = (engines ?? []).filter(e => e !== id);
  return on ? SETUP_ENGINES.filter(e => e === id || now.includes(e)) : now;
}

// ---------------------------------------------------------------- AI sign-in, in place

export type LinkPhase = 'checking' | 'missing' | 'signedOut' | 'unknown' | 'opening' | 'waiting' | 'verifying' | 'connected' | 'error';
export interface EngineLink { phase: LinkPhase; account?: string | null; note?: 'notYet' | 'unverifiable' | null; error?: string | null; /** when a check found it signed in (ms) */ checkedAt?: number }
/** a sign-in in its own window is checked again by itself every ENGINE_POLL_MS, ENGINE_POLL_TRIES times (3 minutes) */
export const ENGINE_POLL_MS = 4000, ENGINE_POLL_TRIES = 45;
/** what the wizard asks of main for one engine: all typed IPC (cli:status, engines:trust, cli:login) */
export interface EngineLinkPort {
  status(engine: SetupEngineId): Promise<CliStatus>;
  trust(engine: SetupEngineId): Promise<void>;
  login(engine: SetupEngineId): Promise<void>;
}

/** the card state from a status check (null = the check itself failed: not the same as absent) */
export function linkFromStatus(status: CliStatus | null): EngineLink {
  if (!status) return { phase: 'unknown' };
  if (!status.found) return { phase: 'missing' };
  if (status.loggedIn === true) return { phase: 'connected', account: status.account ?? null, checkedAt: Date.now() };
  return { phase: status.loggedIn === false ? 'signedOut' : 'unknown' };
}

/** IPC errors arrive wrapped ("Error invoking remote method 'cli:login': Error: …"): keep the app's own sentence */
export function plainError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').trim();
}

/** "Collega": the click chooses this built-in engine (trust) and opens its official sign-in in a separate window.
 *  The wizard then WAITS on the same step: no navigation, no close, the answers stay. */
export async function openSignIn(port: EngineLinkPort, engine: SetupEngineId): Promise<EngineLink> {
  try {
    await port.trust(engine);
    await port.login(engine);
    return { phase: 'waiting', note: null };
  } catch (error) { return { phase: 'error', error: plainError(error) }; }
}

/** "Verifica": a token-free status check. Signed in → connected; still signed out → keep waiting with a hint; a check
 *  that cannot tell → unknown (the owner may continue); a failed check keeps waiting with the reason. */
export async function verifySignIn(port: EngineLinkPort, engine: SetupEngineId): Promise<EngineLink> {
  try {
    const status = await port.status(engine);
    if (!status.found) return { phase: 'missing' };
    if (status.loggedIn === true) return { phase: 'connected', account: status.account ?? null, checkedAt: Date.now() };
    if (status.loggedIn === false) return { phase: 'waiting', note: 'notYet' };
    return { phase: 'unknown', note: 'unverifiable' };
  } catch (error) { return { phase: 'waiting', error: plainError(error) }; }
}

/** the one AI the step recommends: the first one that is signed in, else the first installed, else Claude Code (in the
 *  order Claude Code, Codex, Cursor); the others sit under «More» */
export function recommendedEngine(links: Partial<Record<SetupEngineId, EngineLink>>): SetupEngineId {
  const rank = (l: EngineLink | undefined) => !l ? 3 : l.phase === 'connected' ? 0 : l.phase === 'missing' ? 2 : 1;
  return [...SETUP_ENGINES].sort((a, b) => rank(links[a]) - rank(links[b]))[0]!;
}

/** an engine a sign-in may be opened for (installed, or a check that could not tell) */
export const canSignIn = (link: EngineLink): boolean => ['signedOut', 'unknown', 'error'].includes(link.phase);
