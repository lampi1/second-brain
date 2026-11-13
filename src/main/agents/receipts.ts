// A run's receipts (ADR 0130): what the agent did while its run was open, recorded at zero token cost from what the
// engines already report, and the deterministic verdict on them at the run's end. Recorded: the shell commands with
// their exit code (ChatItem tool exitCode: Claude's Bash/PowerShell results, Codex's commandExecution.exitCode, an ACP
// rawOutput that carries one; else null = unknown), which of them run a repo check (tests, typecheck, lint), the files
// the run's turns changed (the per-turn git checkpoints, chats/checkpoints.ts turnFiles), when a file last changed (an
// edit tool, else the end of a turn whose files changed through a command; a turn with no checkpoint knows them from its
// edit rows when it ran no command that may write, turnFilesWithoutGit), and the commits and PRs it made. Bounded:
// RECEIPT_COMMANDS commands and RECEIPT_FILES paths per run, cut texts (agent-runs.json has a byte budget, runs.ts).
// receiptVerdict decides pass / fail / unknown without a model; receiptDecision says whether that is clear enough to
// skip the Sentinel's review (judge-sample.ts): only a verdict the agent's own report agrees with. Pure: ChatManager
// feeds it, judge-sample.ts reads it; pinned by test/unit/agents/receipts.test.ts.
import type { AgentRun, AgentRunCommand, AgentRunReceipts, AgentRunReport, ReceiptReason, ReceiptResult } from '../../shared/agents';
import type { ChatItem } from '../../shared/contract';
import { COMMAND_TOOLS } from './tool-policy';

export const RECEIPT_COMMANDS = 12;
export const RECEIPT_FILES = 15;
const CMD_MAX = 120;
const PATH_MAX = 160;
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});

/** Tools that change files when they succeed (Claude's, Codex's fileChange row, ACP's edit/delete/move). */
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Delete', 'Move']);
/** A repo's own checks, at the start of a command segment (after env assignments). A small list on purpose: an unknown
 *  runner only means no `pass`, never a wrong one. `npm ci` installs: not a check. */
const CHECKS: readonly RegExp[] = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|t|check|lint|typecheck|type-check|verify|e2e|(test|check|lint|typecheck):[\w:.-]+)(\s|$)/,
  /^((npx|bunx)\s+(--?\S+\s+)*|(pnpm|yarn)\s+(exec|dlx)\s+)?(vitest|jest|mocha|ava|tsc|eslint|playwright\s+test|cypress\s+run)(\s|$)/,
  /^(python3?\s+-m\s+|uv\s+run\s+|poetry\s+run\s+)?(pytest|unittest|mypy|ruff\s+check|flake8|tox|nox)(\s|$)/,
  /^go\s+(test|vet)(\s|$)/, /^cargo\s+(test|check|clippy|nextest)(\s|$)/, /^dotnet\s+test(\s|$)/,
  /^(mvn|\.\/mvnw|mvnw)\s+(\S+\s+)*(test|verify)(\s|$)/, /^(gradle|\.\/gradlew|gradlew)\s+(\S+\s+)*(test|check)(\s|$)/,
  /^make\s+(test|check)(\s|$)/, /^(bundle\s+exec\s+)?rspec(\s|$)/, /^(\.\/)?(vendor\/bin\/)?phpunit(\s|$)/,
];
const GIT_COMMIT = /(^|[\s;&|])git\s+(-\S+\s+(\S+\s+)?)*commit(\s|$)/;
const GH_PR = /(^|[\s;&|])gh\s+pr\s+create(\s|$)/;
/** A test, or the config that defines the checks: a run that touched one may have written the check it then passed. */
const TEST_PATH = /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(go|py)$|Tests?\.cs$|(^|\/)(package\.json|(vitest|jest|playwright)\.config\.[cm]?[jt]s|pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml|tsconfig[\w.-]*\.json|\.eslintrc[\w.]*|eslint\.config\.[cm]?[jt]s|Makefile|Cargo\.toml|go\.mod|[\w.-]+\.csproj)$|(^|\/)\.github\/workflows\//;
/** Not code: docs, plain text, images (a run that only changed these is no code work). */
const NON_CODE = /\.(md|mdx|markdown|txt|rst|adoc|png|jpe?g|gif|webp|svg|pdf|csv)$/i;

export const emptyReceipts = (): AgentRunReceipts => ({ commands: [], more: 0, files: [], filesMore: 0, filesKnown: false, filesGap: false, testsTouched: false, codeTouched: false, lastChangeAt: null, commits: 0, prs: 0 });

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** env assignments and a leading `cd dir &&` say nothing about the command */
const segmentsOf = (cmd: string): string[] => cmd.split(/&&|\|\||[;|\n]|(?<![>&])&(?![&>])/).map(s => s.trim().replace(/^(\w+=\S*\s+)+/, '')).filter(Boolean);
/** Whether a command runs one of the repo's checks. */
export const isCheck = (cmd: string): boolean => segmentsOf(cmd).some(seg => CHECKS.some(re => re.test(seg)));
/** The command as kept: one line, a leading `cd …` step dropped, cut. */
export function shownCommand(cmd: string): string {
  const line = oneLine(cmd).replace(/^(cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*)+/, '');
  return line.length > CMD_MAX ? `${line.slice(0, CMD_MAX - 1)}…` : line;
}
/** Its exit code is not the check's: a pipe, `||`, `;`, a newline or a background `&`; or it failed in an `&&` chain
 *  whose last step is no check (the failing step may be another). */
export function maskedCheck(cmd: string, exit: number | null): boolean {
  if (/(?<!\|)\|(?!\|)|\|\||;|\n|(?<![>&])&(?![&>])/.test(cmd.trim())) return true;
  if (exit === null || exit === 0) return false;
  const last = segmentsOf(cmd).at(-1) ?? '';
  return !CHECKS.some(re => re.test(last));
}

function pushCommand(rc: AgentRunReceipts, c: AgentRunCommand): void {
  if (rc.commands.length >= RECEIPT_COMMANDS) {
    const i = rc.commands.findIndex(x => !x.check);
    rc.commands.splice(i >= 0 ? i : 0, 1);
    rc.more++;
  }
  rc.commands.push(c);
}
function touch(rc: AgentRunReceipts, file: string): void {
  const f = file.replace(/\\/g, '/');
  if (!f) return;
  if (TEST_PATH.test(f)) rc.testsTouched = true;
  if (!NON_CODE.test(f)) rc.codeTouched = true;
}

/** Commands that only read: a turn that ran only these (and checks) changed files only through its edit tools. A
 *  redirection (`>`) or an unknown command may write: not read-only. */
const READ_ONLY = /^(cd|ls|dir|cat|type|head|tail|wc|pwd|echo|grep|rg|find|which|where|tree|stat|file|du|df|env|printenv|date|whoami|node\s+(-v|--version)|npm\s+(ls|view|-v)|git\s+(status|diff|log|show|blame|branch|rev-parse|ls-files|remote|config\s+--get|grep)|gh\s+(pr|issue|run)\s+(view|list|diff|checks)|Get-(Content|ChildItem|Item|Location)|Select-String|Test-Path)(\s|$)/;
const readOnly = (cmd: string): boolean => !/(?<![<>&=\d])>(?!&)|\btee\b|-delete\b|-exec\b/.test(cmd) && segmentsOf(cmd).every(seg => READ_ONLY.test(seg) || CHECKS.some(re => re.test(seg)));
const editFiles = (item: ToolItem, input: Obj): string[] => [...(item.diff ?? []).map(d => d.path), ...[input.file_path, input.notebook_path, input.path].filter((p): p is string => typeof p === 'string'),
  ...(Array.isArray(input.files) ? input.files.filter((p): p is string => typeof p === 'string') : [])];

/** What a finished tool row says about the files of its turn (ADR 0186): the paths an edit tool changed, and whether it
 *  was a command that may have written files the edit rows do not show (anything but a read-only command or a check). */
export function rowChanges(item: ToolItem): { files: string[]; mayWrite: boolean } {
  if (item.status === 'running') return { files: [], mayWrite: false };
  const input = obj(item.input);
  if (COMMAND_TOOLS.includes(item.name)) return { files: [], mayWrite: typeof input.command !== 'string' || !readOnly(input.command.trim()) };
  if (EDIT_TOOLS.has(item.name) && item.status === 'ok') return { files: editFiles(item, input).map(f => f.replace(/\\/g, '/')), mayWrite: false };
  return { files: [], mayWrite: false };
}

/** A finished tool row of the run (sink.item): a command with its exit code, a file edit, a PR. True = something was
 *  recorded. The caller passes each row once (a row is replaced while it runs). */
export function noteTool(rc: AgentRunReceipts, item: ToolItem): boolean {
  if (item.status === 'running') return false;
  const input = obj(item.input);
  if (COMMAND_TOOLS.includes(item.name) && typeof input.command === 'string' && input.command.trim()) {
    const raw = input.command, exit = Number.isSafeInteger(item.exitCode) ? item.exitCode! : null, check = isCheck(raw);
    pushCommand(rc, { cmd: shownCommand(raw), exit, at: item.at, ...(check ? { check: true as const } : {}), ...(check && maskedCheck(raw, exit) ? { masked: true as const } : {}) });
    if (exit === 0 && GIT_COMMIT.test(raw)) rc.commits++;
    if (exit === 0 && GH_PR.test(raw)) rc.prs++;
    return true;
  }
  if (EDIT_TOOLS.has(item.name) && item.status === 'ok') {
    rc.lastChangeAt = Math.max(rc.lastChangeAt ?? 0, item.at);
    for (const f of editFiles(item, input)) touch(rc, f);
    return true;
  }
  if (/^mcp__.+__create_pull_request$/.test(item.name) && item.status === 'ok') { rc.prs++; return true; }
  return false;
}

/** A turn without a git checkpoint (not git, checkpoints off, a queued turn) still knows its files when nothing but its
 *  edit tools could have changed any (ADR 0186: about 70% of runs had filesKnown false, so the receipts never decided
 *  them): the edit rows' paths; null = a command that may write ran, the files are unknown. */
export const turnFilesWithoutGit = (turn: { files: readonly string[]; mayWrite: boolean }): string[] | null => turn.mayWrite ? null : [...new Set(turn.files)];

/** A turn of the run ended: the files it changed (null = not recorded: not git, checkpoints off, git failed, a queued
 *  turn under an earlier checkpoint). turnStart = its checkpoint's time; a turn whose files changed with no edit tool
 *  in it changed them through a command: their time is the turn's end (a check earlier in it is not after them). */
export function noteTurnFiles(rc: AgentRunReceipts, files: readonly string[] | null, turnStart: number, turnEnd: number): void {
  if (files === null) { rc.filesGap = true; return; }
  rc.filesKnown = true;
  if (!files.length) return;
  for (const f of files) {
    touch(rc, f);
    if (rc.files.includes(f)) continue;
    if (rc.files.length < RECEIPT_FILES) rc.files.push(f.length > PATH_MAX ? `…${f.slice(-(PATH_MAX - 1))}` : f); else rc.filesMore++;
  }
  if (rc.lastChangeAt === null || rc.lastChangeAt < turnStart) rc.lastChangeAt = Math.max(rc.lastChangeAt ?? 0, turnEnd);
}

const NEGATED = /\b(no|not|never|without|don'?t|do not|senza|non|nessun[ao]?|mai)\b/i;
/** The done-when criteria the receipts can check hold: "commit…" needs a commit, "open/create a PR" a PR. A passing
 *  check is checked by the verdict itself; any other criterion (or a negated one) is not mechanical and left out. */
export function criteriaHold(doneWhen: readonly string[], rc: Pick<AgentRunReceipts, 'commits' | 'prs'>): boolean {
  for (const d of doneWhen) {
    if (NEGATED.test(d)) continue;
    if (/\bcommit(s|ted|tato|tati)?\b/i.test(d) && rc.commits === 0) return false;
    if (/\b(pr|pull request)\b/i.test(d) && /\b(open(ed)?|creat(e|ed)|apri|aperta|crea(ta)?)\b/i.test(d) && rc.prs === 0) return false;
  }
  return true;
}

export interface ReceiptVerdict { result: ReceiptResult; reason: ReceiptReason }
/** The deterministic verdict on a run's receipts (ADR 0130):
 *  - no code changed: unknown (not-code, or files-unknown when a turn's files were not recorded);
 *  - the last run of a repo check after the last change failed: fail (check-failed);
 *  - the report says verified "yes" but no check ran at all: fail (claims-unverified: the judge sends it to review);
 *  - files not fully known, a test or check config the run touched itself (own-tests), no check after the last change
 *    or one whose exit code is unknown or masked, a mechanical done-when criterion not met: unknown;
 *  - else every check after the last change passed: pass. */
export function receiptVerdict(x: { receipts: AgentRunReceipts; report?: Pick<AgentRunReport, 'verified'>; doneWhen?: readonly string[] }): ReceiptVerdict {
  const rc = x.receipts;
  if (!rc.codeTouched) return { result: 'unknown', reason: rc.filesKnown && !rc.filesGap ? 'not-code' : 'files-unknown' };
  const checks = rc.commands.filter(c => c.check), since = rc.lastChangeAt ?? 0;
  const latest = new Map<string, number | null>();
  for (const c of checks) if (c.at >= since) latest.set(c.cmd, c.masked ? null : c.exit);
  const exits = [...latest.values()];
  if (exits.some(e => e !== null && e !== 0)) return { result: 'fail', reason: 'check-failed' };
  // the list drops other commands before a check: no check in it = none ran
  if (x.report?.verified === 'yes' && !checks.length) return { result: 'fail', reason: 'claims-unverified' };
  if (!rc.filesKnown || rc.filesGap) return { result: 'unknown', reason: 'files-unknown' };
  if (rc.testsTouched) return { result: 'unknown', reason: 'own-tests' };
  if (!exits.length || exits.some(e => e === null)) return { result: 'unknown', reason: 'no-check-after-change' };
  if (!criteriaHold(x.doneWhen ?? [], rc)) return { result: 'unknown', reason: 'criteria-unmet' };
  return { result: 'pass', reason: 'checks-passed' };
}

/** The run's receipt verdict: the one recorded at its end, else computed now (a run whose last turn never settled). */
export const runReceiptVerdict = (run: Pick<AgentRun, 'receipts' | 'report' | 'taskContract'>): ReceiptVerdict | null =>
  !run.receipts ? null : run.receipts.verdict ? { result: run.receipts.verdict.result, reason: run.receipts.verdict.reason }
    : receiptVerdict({ receipts: run.receipts, ...(run.report ? { report: run.report } : {}), doneWhen: run.taskContract?.doneWhen ?? [] });

/** Whether the receipts decide the run with no review (judge-sample.ts): a pass the report agrees with (done), or a
 *  failed check the report agrees with (partial or blocked). Unknown, or a receipt the report contradicts, goes to the
 *  Sentinel. */
export function receiptDecision(run: Pick<AgentRun, 'receipts' | 'report' | 'taskContract'>): { verdict: 'success' | 'fail'; reason: ReceiptReason } | null {
  const v = runReceiptVerdict(run), said = run.report?.outcome;
  if (!v || !said) return null;
  if (v.result === 'pass' && said === 'done') return { verdict: 'success', reason: v.reason };
  if (v.result === 'fail' && v.reason === 'check-failed' && said !== 'done') return { verdict: 'fail', reason: v.reason };
  return null;
}

/** One line for the reviewer (judge-sample.ts reviewPrompt) and the outcome's note: what the receipts saw. */
export function receiptLine(rc: AgentRunReceipts, v: ReceiptVerdict | null): string {
  const checks = rc.commands.filter(c => c.check).map(c => `${c.cmd} → ${c.masked ? 'masked' : c.exit ?? 'exit unknown'}`);
  return [`receipts: ${v ? `${v.result} (${v.reason})` : 'none'}`, `checks: ${checks.length ? checks.join('; ') : 'none'}`,
    `files changed: ${rc.filesKnown ? rc.files.length + rc.filesMore : 'unknown'}${rc.filesGap ? ' (some turns not recorded)' : ''}`, `commits: ${rc.commits}`, `PRs: ${rc.prs}`].join(' · ');
}

const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const RESULTS: readonly ReceiptResult[] = ['pass', 'fail', 'unknown'];
const REASONS: readonly ReceiptReason[] = ['checks-passed', 'check-failed', 'claims-unverified', 'not-code', 'files-unknown', 'own-tests', 'no-check-after-change', 'criteria-unmet'];
/** Stored receipts, or null when out of shape (runs.ts drops them: a run is never refused for its receipts). */
export function readReceipts(v: unknown): AgentRunReceipts | null {
  const r = obj(v);
  if (!Array.isArray(r.commands) || r.commands.length > RECEIPT_COMMANDS || !count(r.more) || !Array.isArray(r.files) || r.files.length > RECEIPT_FILES || !count(r.filesMore)
    || !count(r.commits) || !count(r.prs) || !(r.lastChangeAt === null || count(r.lastChangeAt))) return null;
  for (const k of ['filesKnown', 'filesGap', 'testsTouched', 'codeTouched'] as const) if (typeof r[k] !== 'boolean') return null;
  const commands: AgentRunCommand[] = [];
  for (const raw of r.commands) {
    const c = obj(raw);
    if (typeof c.cmd !== 'string' || c.cmd.length > CMD_MAX || !(c.exit === null || Number.isSafeInteger(c.exit)) || !count(c.at)) return null;
    commands.push({ cmd: c.cmd, exit: c.exit as number | null, at: c.at, ...(c.check === true ? { check: true as const } : {}), ...(c.masked === true ? { masked: true as const } : {}) });
  }
  if (!r.files.every(f => typeof f === 'string' && f.length <= PATH_MAX)) return null;
  const verdict = r.verdict === undefined ? undefined : obj(r.verdict);
  if (verdict && (!RESULTS.includes(verdict.result as ReceiptResult) || !REASONS.includes(verdict.reason as ReceiptReason) || !count(verdict.at))) return null;
  return { commands, more: r.more, files: [...r.files as string[]], filesMore: r.filesMore, filesKnown: r.filesKnown as boolean, filesGap: r.filesGap as boolean,
    testsTouched: r.testsTouched as boolean, codeTouched: r.codeTouched as boolean, lastChangeAt: r.lastChangeAt as number | null, commits: r.commits, prs: r.prs,
    ...(verdict ? { verdict: { result: verdict.result as ReceiptResult, reason: verdict.reason as ReceiptReason, at: verdict.at as number } } : {}) };
}
