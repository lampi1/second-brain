// The first-run setup's flow, kept pure so it is unit-tested (test/unit/setup-wizard.test.ts) without a DOM: three
// moments in one modal (ADR 0279, the 1.0 onboarding): welcome (language and name on one screen), your AI (the programs
// found on this computer, one click) and the first real request to the Orchestrator, inside the same window. Tools,
// folders, role and goals are not asked: the Orchestrator proposes them the first time they are needed. Here: which
// moment may be left, how a saved run resumes, the language names written into me.md, which AI is proposed and the AI
// sign-in states. Why: the owner wants ONE modal from start to finish (2026-10-18): "Accedi" opens the engine's
// official sign-in in its own window and the setup waits in place, checking by itself every few seconds; nothing here
// closes the modal, only an explicit exit does. Used by components/FirstInterview.tsx and components/SetupEngines.tsx.
import type { SetupDraft, SetupState } from '@shared/agents';
import type { ChatSummary, CliStatus, Lang } from '@shared/contract';
import { WORK_ROLE_IDS, isWorkRole } from '@shared/roles';
import type { WorkRoleId } from '@shared/roles';
import { isBusy } from '../store/state';

export const SETUP_STEPS = ['welcome', 'ai', 'first'] as const;
export type SetupStepId = typeof SETUP_STEPS[number];
/** the engines the setup looks for on this computer, in the order it proposes them */
export const SETUP_ENGINES = ['claude', 'codex', 'cursor', 'opencode'] as const;
export type SetupEngineId = typeof SETUP_ENGINES[number];
/** each engine's name as its maker writes it (never translated; shown before the engine registry answers too) */
export const ENGINE_NAMES: Record<SetupEngineId, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', opencode: 'OpenCode' };
export const LAST_STEP = SETUP_STEPS.length - 1;
/** the last moment a saved run resumes on: the first request is entered only by preparing the workspace */
export const LAST_RESUMABLE = SETUP_STEPS.indexOf('ai');
/** the profile answers' problems (lib/agent-setup.ts answerProblems) */
export type AnswerProblems = Partial<Record<'name' | 'role' | 'language' | 'areas', string>>;

/** a saved or malformed step number, as a valid index */
export function clampStep(step: number): number { return Math.max(0, Math.min(LAST_STEP, Number.isInteger(step) ? step : 0)); }
export const stepId = (step: number): SetupStepId => SETUP_STEPS[clampStep(step)]!;

/** the answer problems that keep this moment from being left forward: only the name, asked in the first one */
export function stepProblems(step: number, problems: AnswerProblems): string[] {
  return stepId(step) === 'welcome' && problems.name ? [problems.name] : [];
}
export const canAdvance = (step: number, problems: AnswerProblems): boolean => stepProblems(step, problems).length === 0;

/** how the setup ends: only these three, each an explicit button (or Esc = later); every one saves the answers */
export type SetupExit = 'later' | 'skip' | 'finish';
export const exitStatus = (exit: SetupExit): 'draft' | 'skipped' | 'completed' => exit === 'finish' ? 'completed' : exit === 'skip' ? 'skipped' : 'draft';

/** the draft the setup opens on: a run in progress resumes at its moment with its answers (never past «your AI»: a
 *  draft saved by the six-step wizard lands there too); a finished or skipped run starts over from the first moment
 *  (its old answers are never written again), with the engines turned on preselected */
export function openingDraft(initial: SetupState, enabledEngines: Partial<Record<string, boolean>> | undefined): SetupDraft {
  const resume = initial.status === 'new' || initial.status === 'draft';
  return {
    ...initial.preferences,
    engines: initial.preferences.engines ?? (resume ? [] : SETUP_ENGINES.filter(id => enabledEngines?.[id])),
    step: resume ? Math.min(LAST_RESUMABLE, clampStep(initial.preferences.step)) : 0,
    profile: resume ? initial.preferences.profile : undefined,
  };
}

/** the chat language as me.md writes it ("Language: italiano in chat"), from the language picked in the first moment */
export const LANG_PROFILE: Record<Lang, string> = { it: 'italiano', en: 'English', de: 'Deutsch' };
/** each language in its own words, for the first moment's buttons (never translated) */
export const LANG_NATIVE: Record<Lang, { name: string; region: string }> = { it: { name: 'Italiano', region: 'Italia' }, en: { name: 'English', region: 'International' }, de: { name: 'Deutsch', region: 'Österreich' } };

/** the engines in use, the first one being the Orchestrator's and the roles' (issue #96): `id` joins them (last) or
 *  leaves them; never a trust or login grant */
export function withEngine(engines: readonly string[] | undefined, id: string, on: boolean): string[] {
  const now = (engines ?? []).filter(e => e !== id);
  return on ? [...now, id] : now;
}
/** the engine the Orchestrator starts on: `id` moves to the front, the others keep their order */
export const withPrimary = (engines: readonly string[] | undefined, id: string): string[] => [id, ...(engines ?? []).filter(e => e !== id)];

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

/** the one AI the setup proposes: the first one that is signed in, else the first installed, else Claude Code (in the
 *  order of SETUP_ENGINES) */
export function recommendedEngine(links: Partial<Record<SetupEngineId, EngineLink>>): SetupEngineId {
  const rank = (l: EngineLink | undefined) => !l ? 3 : l.phase === 'connected' ? 0 : l.phase === 'missing' ? 2 : 1;
  return [...SETUP_ENGINES].sort((a, b) => rank(links[a]) - rank(links[b]))[0]!;
}

/** an engine a sign-in may be opened for (installed, or a check that could not tell) */
export const canSignIn = (link: EngineLink): boolean => ['signedOut', 'unknown', 'error'].includes(link.phase);
/** an engine the first request may start on: signed in, or installed with a sign-in the check cannot tell */
export const usable = (link: EngineLink | undefined): boolean => link?.phase === 'connected' || link?.phase === 'unknown';
/** the engines put in use by themselves once every one has been checked: those already signed in, the proposed one
 *  first. Nothing when the owner already chose (a resumed run) or none is signed in. */
export function autoEngines(links: Partial<Record<SetupEngineId, EngineLink>>, chosen: readonly string[]): string[] | null {
  if (chosen.length) return null;
  const ready = SETUP_ENGINES.filter(e => links[e]?.phase === 'connected');
  return ready.length ? withPrimary(ready, recommendedEngine(links)) : null;
}

// ---------------------------------------------------------------- the team on the stage (third moment)

export type RoleState = 'idle' | 'working' | 'done';
/** what each work role is doing now, from the chats the Orchestrator delegated (the delegation's role, else the chat's
 *  catalog agent): working while one of its open chats runs, done once one ended a turn or reported */
export function teamStates(chats: readonly ChatSummary[]): Record<WorkRoleId, RoleState> {
  const out = Object.fromEntries(WORK_ROLE_IDS.map(r => [r, 'idle'])) as Record<WorkRoleId, RoleState>;
  for (const c of chats) {
    const role = c.delegation?.role ?? c.agent?.id;
    if (!isWorkRole(role) || c.isOrchestrator) continue;
    if (!c.closedAt && isBusy(c)) out[role] = 'working';
    else if (out[role] === 'idle' && (c.delegation?.result || c.lastResult)) out[role] = 'done';
  }
  return out;
}
