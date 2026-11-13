// A run's receipts (src/main/agents/receipts.ts, ADR 0130): which commands are repo checks and when their exit code is
// theirs, what a tool row and a turn's files add (bounded), the deterministic verdict (pass only on checks after the
// last change, untouched by the run, with files known; fail on a failing check or a "verified" claim with no check;
// unknown otherwise), when it decides a run with no review, and stored receipts read back or dropped.
import { describe, expect, it } from 'vitest';
import type { AgentRun, AgentRunReceipts } from '../../../src/shared/agents';
import type { ChatItem } from '../../../src/shared/contract';
import { criteriaHold, emptyReceipts, isCheck, maskedCheck, noteTool, noteTurnFiles, readReceipts, RECEIPT_COMMANDS, RECEIPT_FILES, receiptDecision, receiptLine, receiptVerdict, rowChanges, shownCommand, turnFilesWithoutGit } from '../../../src/main/agents/receipts';

type Tool = Extract<ChatItem, { kind: 'tool' }>;
let n = 0;
const bash = (command: string, exitCode: number | undefined, at: number, name = 'Bash'): Tool => ({ kind: 'tool', id: `t${++n}`, at, name, summary: '', input: { command }, status: exitCode ? 'error' : 'ok', ...(exitCode !== undefined ? { exitCode } : {}) });
const edit = (file: string, at: number): Tool => ({ kind: 'tool', id: `t${++n}`, at, name: 'Edit', summary: '', input: { file_path: file }, status: 'ok' });
/** a code turn: edited at 100, its files recorded (started at 50, ended at 1000) */
function codeRun(files = ['src/a.ts']): AgentRunReceipts {
  const rc = emptyReceipts();
  noteTool(rc, edit(files[0]!, 100));
  noteTurnFiles(rc, files, 50, 1000);
  return rc;
}

describe('checks and exit codes', () => {
  it('knows a small list of repo checks, after env assignments and a cd', () => {
    for (const c of ['npm test', 'npm run check:branch', 'cd app && CI=1 npm run typecheck', 'npx vitest run test/unit/x.test.ts', 'pnpm exec tsc --noEmit', 'python -m pytest -q', 'pytest', 'go test ./...', 'cargo test', 'dotnet test', './gradlew build test', 'make check', 'npx eslint src'])
      expect(isCheck(c), c).toBe(true);
    for (const c of ['npm ci', 'npm run build', 'git status', 'ls test', 'cat package.json', 'echo npm test'])
      expect(isCheck(c), c).toBe(false);
  });
  it('a pipe, ||, ; or & hides the exit code; a failing && chain is the check\'s only when the check is last', () => {
    expect(maskedCheck('npm test 2>&1 | tail -20', 0)).toBe(true);
    expect(maskedCheck('npm test || true', 0)).toBe(true);
    expect(maskedCheck('npm test; echo done', 0)).toBe(true);
    expect(maskedCheck('npm test &', 0)).toBe(true);
    expect(maskedCheck('npm test 2>&1', 1)).toBe(false);
    expect(maskedCheck('npm run build && npm test', 1)).toBe(false);
    expect(maskedCheck('npm test && git commit -m x', 1)).toBe(true);
    expect(maskedCheck('npm test && git commit -m x', 0)).toBe(false);
  });
  it('keeps a command short, without its leading cd', () => {
    expect(shownCommand('cd "/a b" && npm  test\n')).toBe('npm test');
    expect(shownCommand('x'.repeat(500))).toHaveLength(120);
  });
});

describe('recording', () => {
  it('a command with its exit code (unknown when the engine gave none), an edit, commits and PRs; a running row is not recorded', () => {
    const rc = emptyReceipts();
    expect(noteTool(rc, { ...bash('npm test', 0, 10), status: 'running' })).toBe(false);
    noteTool(rc, bash('npm test', 0, 10));
    noteTool(rc, bash('npm test', undefined, 11, 'Shell'));
    noteTool(rc, bash('git add -A && git commit -m "fix"', 0, 12));
    noteTool(rc, bash('git commit -m "nope"', 1, 13));
    noteTool(rc, bash('gh pr create --fill', 0, 14));
    noteTool(rc, { kind: 'tool', id: 'm', at: 15, name: 'mcp__github__create_pull_request', summary: '', input: {}, status: 'ok' });
    noteTool(rc, edit('test/a.test.ts', 16));
    expect(rc.commands.slice(0, 2)).toEqual([{ cmd: 'npm test', exit: 0, at: 10, check: true }, { cmd: 'npm test', exit: null, at: 11, check: true }]);
    expect(rc).toMatchObject({ commits: 1, prs: 2, lastChangeAt: 16, testsTouched: true, codeTouched: true });
  });
  it('stays bounded: other commands go before a check, files past the cap are only counted', () => {
    const rc = emptyReceipts();
    noteTool(rc, bash('npm test', 0, 1));
    for (let i = 0; i < RECEIPT_COMMANDS + 5; i++) noteTool(rc, bash(`ls ${i}`, 0, 2 + i));
    expect(rc.commands).toHaveLength(RECEIPT_COMMANDS);
    expect(rc.commands[0]).toMatchObject({ cmd: 'npm test' });
    expect(rc.more).toBe(6);
    noteTurnFiles(rc, Array.from({ length: RECEIPT_FILES + 3 }, (_, i) => `docs/f${i}.md`), 0, 50);
    expect(rc.files).toHaveLength(RECEIPT_FILES);
    expect(rc).toMatchObject({ filesMore: 3, filesKnown: true, codeTouched: false });
    noteTurnFiles(rc, null, 60, 70);
    expect(rc.filesGap).toBe(true);
  });
  it('files changed in a turn with no edit tool changed at its end; with one, at the edit', () => {
    const a = emptyReceipts();
    noteTurnFiles(a, ['src/gen.ts'], 100, 900);
    expect(a.lastChangeAt).toBe(900);
    const b = emptyReceipts();
    noteTool(b, edit('src/a.ts', 150));
    noteTurnFiles(b, ['src/a.ts'], 100, 900);
    expect(b.lastChangeAt).toBe(150);
  });
});

describe('receiptVerdict', () => {
  it('pass: every repo check after the last change passed, the run touched no test, files known', () => {
    const rc = codeRun();
    noteTool(rc, bash('npm test', 1, 90));       // before the change: does not count
    noteTool(rc, bash('npm test', 0, 200));
    expect(receiptVerdict({ receipts: rc, report: { verified: 'yes' } })).toEqual({ result: 'pass', reason: 'checks-passed' });
  });
  it('fail: the last run of a check after the change failed; a later green run of it clears it', () => {
    const rc = codeRun();
    noteTool(rc, bash('npm test', 1, 200));
    expect(receiptVerdict({ receipts: rc })).toEqual({ result: 'fail', reason: 'check-failed' });
    noteTool(rc, bash('npm test', 0, 300));
    expect(receiptVerdict({ receipts: rc }).result).toBe('pass');
  });
  it('fail: verified "yes" with no check run at all (claims verified without evidence)', () => {
    expect(receiptVerdict({ receipts: codeRun(), report: { verified: 'yes' } })).toEqual({ result: 'fail', reason: 'claims-unverified' });
    expect(receiptVerdict({ receipts: codeRun(), report: { verified: 'partial' } })).toEqual({ result: 'unknown', reason: 'no-check-after-change' });
  });
  it('unknown: non-code work, files not known, own tests, a check only before the change, an unknown or masked exit, an unmet criterion', () => {
    const docs = emptyReceipts();
    noteTurnFiles(docs, ['docs/plan.md'], 0, 10);
    expect(receiptVerdict({ receipts: docs, report: { verified: 'yes' } })).toEqual({ result: 'unknown', reason: 'not-code' });
    expect(receiptVerdict({ receipts: emptyReceipts() })).toEqual({ result: 'unknown', reason: 'files-unknown' });
    const gap = codeRun(); noteTurnFiles(gap, null, 0, 1); noteTool(gap, bash('npm test', 0, 2000));
    expect(receiptVerdict({ receipts: gap }).reason).toBe('files-unknown');
    const own = codeRun(['src/a.ts', 'test/unit/a.test.ts']); noteTool(own, bash('npm test', 0, 2000));
    expect(receiptVerdict({ receipts: own }).reason).toBe('own-tests');
    const before = codeRun(); noteTool(before, bash('npm test', 0, 90));
    expect(receiptVerdict({ receipts: before }).reason).toBe('no-check-after-change');
    const blind = codeRun(); noteTool(blind, bash('npm test', undefined, 2000));
    expect(receiptVerdict({ receipts: blind }).reason).toBe('no-check-after-change');
    const piped = codeRun(); noteTool(piped, bash('npm test | tail', 0, 2000));
    expect(receiptVerdict({ receipts: piped }).reason).toBe('no-check-after-change');
    const commit = codeRun(); noteTool(commit, bash('npm test', 0, 2000));
    expect(receiptVerdict({ receipts: commit, doneWhen: ['Changes committed on the branch'] }).reason).toBe('criteria-unmet');
    expect(receiptVerdict({ receipts: commit, doneWhen: ['Do not commit', 'Tests pass'] }).result).toBe('pass');
  });
  it('mechanical criteria: a commit, an opened PR; the rest is not checked here', () => {
    expect(criteriaHold(['Commit the fix', 'Open a PR'], { commits: 1, prs: 0 })).toBe(false);
    expect(criteriaHold(['Commit the fix', 'Open a PR'], { commits: 1, prs: 1 })).toBe(true);
    expect(criteriaHold(['The page reads well', 'Senza commit'], { commits: 0, prs: 0 })).toBe(true);
  });
});

describe('receiptDecision', () => {
  const run = (rc: AgentRunReceipts | undefined, outcome: 'done' | 'partial' | 'blocked', verified: 'yes' | 'no' = 'yes'): Pick<AgentRun, 'receipts' | 'report' | 'taskContract'> =>
    ({ ...(rc ? { receipts: rc } : {}), report: { at: 1, outcome, verified, summary: 's' } });
  it('decides only a clear receipt the report agrees with; the rest goes to review', () => {
    const green = codeRun(); noteTool(green, bash('npm test', 0, 2000));
    const red = codeRun(); noteTool(red, bash('npm test', 1, 2000));
    expect(receiptDecision(run(green, 'done'))).toEqual({ verdict: 'success', reason: 'checks-passed' });
    expect(receiptDecision(run(green, 'partial'))).toBeNull();          // the report disagrees
    expect(receiptDecision(run(red, 'blocked', 'no'))).toEqual({ verdict: 'fail', reason: 'check-failed' });
    expect(receiptDecision(run(red, 'done'))).toBeNull();               // says done, the check says no: review
    expect(receiptDecision(run(codeRun(), 'done'))).toBeNull();         // claims verified with no check: review
    expect(receiptDecision(run(undefined, 'done'))).toBeNull();
  });
  it('uses the verdict recorded at the end when there is one', () => {
    const rc = codeRun(); rc.verdict = { result: 'pass', reason: 'checks-passed', at: 5 };
    expect(receiptDecision(run(rc, 'done'))?.verdict).toBe('success');
    expect(receiptLine(rc, { result: 'pass', reason: 'checks-passed' })).toContain('receipts: pass (checks-passed)');
  });
});

describe('readReceipts', () => {
  it('reads stored receipts back and drops ones out of shape', () => {
    const rc = codeRun(); noteTool(rc, bash('npm test', 0, 2000)); rc.verdict = { result: 'pass', reason: 'checks-passed', at: 3000 };
    expect(readReceipts(JSON.parse(JSON.stringify(rc)))).toEqual(rc);
    expect(readReceipts({ ...rc, commands: 'x' })).toBeNull();
    expect(readReceipts({ ...rc, verdict: { result: 'maybe', reason: 'checks-passed', at: 1 } })).toBeNull();
    expect(readReceipts({ ...rc, files: Array(RECEIPT_FILES + 1).fill('a') })).toBeNull();
  });
});

describe('a turn without a git checkpoint (ADR 0186)', () => {
  it('knows its files from its edit rows when no command that may write ran', () => {
    expect(rowChanges(edit('src\\a.ts', 10))).toEqual({ files: ['src/a.ts'], mayWrite: false });
    for (const c of ['git status', 'git diff --stat', 'ls -la', 'cat src/a.ts | head -5', 'npm test', 'cd app && npx tsc --noEmit', 'rg foo src'])
      expect(rowChanges(bash(c, 0, 10)).mayWrite, c).toBe(false);
    for (const c of ['sed -i s/a/b/ x.ts', 'echo x > a.ts', 'node build.mjs', 'git commit -m x', 'cat a | tee b', 'find . -delete'])
      expect(rowChanges(bash(c, 0, 10)).mayWrite, c).toBe(true);
    expect(turnFilesWithoutGit({ files: ['a.ts', 'a.ts'], mayWrite: false })).toEqual(['a.ts']);
    expect(turnFilesWithoutGit({ files: ['a.ts'], mayWrite: true })).toBeNull();
    // the files known this way let the receipts decide: an edit, then a passing check after it
    const rc = emptyReceipts();
    noteTool(rc, edit('src/a.ts', 100));
    noteTool(rc, bash('npm test', 0, 200));
    noteTurnFiles(rc, turnFilesWithoutGit({ files: ['src/a.ts'], mayWrite: false }), 50, 1000);
    expect(rc.filesKnown).toBe(true);
    expect(receiptVerdict({ receipts: rc })).toEqual({ result: 'pass', reason: 'checks-passed' });
  });
});
