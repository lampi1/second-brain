// Claude's own deny and ask rules for run_code's internal calls (src/main/code-mode/claude-rules.ts, ADR 0331): a
// settings file's deny refuses a command or a path, the stable app's guard rails (ClaudeSession's --settings) do too,
// ask rules reach the user, an unreadable file fails closed, and a search leaves out what a Read deny covers. Temp
// folders only: no engine, no real settings.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeRuleFiles, claudeVerdict, commandParts, readableBy, readClaudeRuleSet, type ClaudeRuleSet } from '../../../src/main/code-mode/claude-rules';
import { ClaudeSession, stableGuards } from '../../../src/main/chats/claude';
import { recSink } from '../chats/helpers';

const dirs: string[] = [];
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cr-'))); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

type Ok = Extract<ClaudeRuleSet, { ok: true }>;
const ok = (s: ClaudeRuleSet): Ok => { if (!s.ok) throw new Error(s.error); return s; };
const settings = (dir: string, permissions: object): string => { const f = path.join(dir, 'settings.json'); fs.writeFileSync(f, JSON.stringify({ permissions })); return f; };

describe('Claude rules for run_code', () => {
  it('a settings deny refuses the command, also inside a chain, and leaves others alone', () => {
    const cwd = tmp(), home = tmp();
    const set = ok(readClaudeRuleSet({ files: [settings(home, { deny: ['Bash(az webapp deploy:*)', 'Bash(sqlcmd *)'] })], inline: null, cwd }, home));
    expect(claudeVerdict(set, 'Bash', { command: 'az webapp deploy --name x' }, cwd, home)).toMatchObject({ kind: 'deny', rule: 'Bash(az webapp deploy:*)' });
    expect(claudeVerdict(set, 'Bash', { command: 'ls && FOO=1 sqlcmd -S prod -Q "x"' }, cwd, home)).toMatchObject({ kind: 'deny', rule: 'Bash(sqlcmd *)' });
    expect(claudeVerdict(set, 'Bash', { command: 'echo $(sqlcmd -Q x)' }, cwd, home)?.kind).toBe('deny');
    expect(claudeVerdict(set, 'Bash', { command: 'az account list' }, cwd, home)).toBeNull();
    // a Bash rule holds for the PowerShell wrapper too: the same command through another shell
    expect(claudeVerdict(set, 'PowerShell', { command: 'az webapp deploy --name x' }, cwd, home)).toMatchObject({ kind: 'deny', rule: 'Bash(az webapp deploy:*)' });
    expect(commandParts('a | b; c && d')).toEqual(['a | b; c && d', 'a', 'b', 'c', 'd']);
  });

  it('the stable app\'s guard rails (its --settings) refuse a kill and an edit of the shared folder', () => {
    const cwd = tmp(), shared = tmp();
    const set = ok(readClaudeRuleSet({ files: [], inline: stableGuards(shared), cwd }));
    expect(claudeVerdict(set, 'Bash', { command: 'taskkill /F /PID 41936' }, cwd)?.kind).toBe('deny');
    expect(claudeVerdict(set, 'Write', { file_path: path.join(shared, 'x', 'a.json') }, cwd)?.kind).toBe('deny');
    expect(claudeVerdict(set, 'Write', { file_path: path.join(cwd, 'a.json') }, cwd)).toBeNull();
  });

  it('a stable Claude session hands its guard rails to run_code, with the folder and env it runs with', () => {
    const cwd = tmp();
    const s = new ClaudeSession({ chatId: 'c', cwd, stable: true, env: { SB_X: '1' } }, recSink());
    const ctx = s.toolContext();
    expect(ctx.cwd).toBe(cwd);
    expect(ctx.env.SB_X).toBe('1');
    expect(JSON.stringify(ctx.inline)).toMatch(/taskkill/);
    expect(ctx.files).toContain(path.join(cwd, '.claude', 'settings.json'));
    // a --worktree chat: no folder until its engine names it
    expect(new ClaudeSession({ chatId: 'c', cwd, worktree: 'w' } as never, recSink()).toolContext().cwd).toBeNull();
  });

  it('ask rules send the call to the user; deny wins over ask', () => {
    const cwd = tmp(), home = tmp();
    const set = ok(readClaudeRuleSet({ files: [settings(home, { ask: ['Bash(git push:*)', 'mcp__outlook'], deny: ['Bash(git push --force:*)'] })], inline: null, cwd }, home));
    expect(claudeVerdict(set, 'Bash', { command: 'git push origin main' }, cwd, home)?.kind).toBe('ask');
    expect(claudeVerdict(set, 'Bash', { command: 'git push --force origin main' }, cwd, home)?.kind).toBe('deny');
    expect(claudeVerdict(set, 'mcp__outlook__send_email', {}, cwd, home)?.kind).toBe('ask');
  });

  it('an unreadable or broken settings file fails closed; a missing one is skipped', () => {
    const cwd = tmp(), home = tmp();
    const bad = path.join(home, 'settings.json');
    fs.writeFileSync(bad, '{ not json');
    expect(readClaudeRuleSet({ files: [bad], inline: null, cwd }, home).ok).toBe(false);
    expect(readClaudeRuleSet({ files: [path.join(home, 'missing.json')], inline: null, cwd }, home).ok).toBe(true);
    const asDir = path.join(home, 'dir.json'); fs.mkdirSync(asDir);
    expect(readClaudeRuleSet({ files: [asDir], inline: null, cwd }, home).ok).toBe(false);
  });

  it('unchanged sources give the cached set; a changed or broken file is read again (still fail closed)', () => {
    const cwd = tmp(), home = tmp();
    const f = settings(home, { deny: ['Bash(sqlcmd *)'] });
    fs.utimesSync(f, 1_000, 1_000);
    const src = { files: [f], inline: null, cwd };
    const first = ok(readClaudeRuleSet(src, home));
    expect(readClaudeRuleSet(src, home)).toBe(first);
    // other inline settings are other sources
    expect(readClaudeRuleSet({ ...src, inline: { permissions: { deny: ['Bash(az *)'] } } }, home)).not.toBe(first);
    fs.writeFileSync(f, JSON.stringify({ permissions: { deny: ['Bash(sqlcmd *)', 'Bash(az rest*--method post*)'] } }));
    fs.utimesSync(f, 2_000, 2_000);
    const next = ok(readClaudeRuleSet(src, home));
    expect(claudeVerdict(next, 'Bash', { command: 'cd x && az rest --uri y --method post' }, cwd, home)?.kind).toBe('deny');
    fs.writeFileSync(f, '{ broken');
    fs.utimesSync(f, 3_000, 3_000);
    expect(readClaudeRuleSet(src, home).ok).toBe(false);
    expect(readClaudeRuleSet(src, home).ok).toBe(false);
  });

  it('compiled rules match the same with many rules and repeated calls', () => {
    const cwd = tmp(), home = tmp();
    const filler = Array.from({ length: 2000 }, (_, i) => `Bash(tool${i} --x:*)`);
    const set = ok(readClaudeRuleSet({ files: [settings(home, { deny: [...filler, 'PowerShell(Invoke-Sqlcmd*)', 'Bash(*write-all*)'] })], inline: null, cwd }, home));
    for (let i = 0; i < 3; i++) {
      expect(claudeVerdict(set, 'Bash', { command: 'powershell -c "invoke-sqlcmd -Q x"' }, cwd, home)?.kind).toBe('deny');
      expect(claudeVerdict(set, 'Bash', { command: 'cd /c/x && bash run.sh write-all' }, cwd, home)?.kind).toBe('deny');
      expect(claudeVerdict(set, 'Bash', { command: 'git status' }, cwd, home)).toBeNull();
    }
  });

  it('path rules: Read deny keeps files out of a search; ~ and project-relative bases', () => {
    const cwd = tmp(), home = tmp();
    const set = ok(readClaudeRuleSet({ files: [settings(home, { deny: ['Read(~/.secrets/**)', 'Read(**/.env*)', 'Edit(/docs/**)'] })], inline: null, cwd }, home));
    const readable = readableBy(set, cwd, home);
    expect(readable(path.join(home, '.secrets', 'k.txt'))).toBe(false);
    expect(readable(path.join(cwd, 'sub', '.env.local'))).toBe(false);
    expect(readable(path.join(cwd, 'src', 'a.ts'))).toBe(true);
    // "/docs/**" is relative to the settings file's own base (here the home folder holding it)
    expect(claudeVerdict(set, 'Edit', { file_path: path.join(home, 'docs', 'x.md') }, cwd, home)?.kind).toBe('deny');
    expect(claudeVerdict(set, 'Grep', { path: path.join(home, '.secrets') }, cwd, home)?.kind).toBe('deny');
  });

  it('reads the user, project and local settings of the chat\'s folder', () => {
    const cwd = tmp(), home = tmp();
    const files = claudeRuleFiles(cwd, {}, home);
    expect(files).toEqual(expect.arrayContaining([path.join(home, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')]));
    expect(claudeRuleFiles(cwd, { CLAUDE_CONFIG_DIR: path.join(home, 'cfg') }, home)).toContain(path.join(home, 'cfg', 'settings.json'));
  });
});
