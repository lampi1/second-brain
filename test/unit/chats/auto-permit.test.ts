// The app's own answer to a permission request (chats/auto-permit.ts, ADR 0103 made «allow by default» by ADR 0254,
// #352): the app keeps no list of its own of what is dangerous. Everything passes, in or out of the chat's folder, with
// or without a checkpoint, unless the user's brain rules hold it (permit-policy.test.ts), the user narrowed the role
// («Chiede conferma», «Solo piano» ask all; «Accetta modifiche» asks what is neither a read nor an edit), it changes the
// brain's rules file itself (ADR 0292: no guard of the app's own on settings and hooks), or it is a plan to approve.
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoPermit, type PermitContext } from '../../../src/main/chats/auto-permit';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ap-')));
const cwd = path.join(root, 'work');
fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
fs.writeFileSync(path.join(cwd, 'src', 'a.ts'), 'x');
fs.mkdirSync(path.join(root, 'elsewhere'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const ctx = (over: Partial<PermitContext> = {}): PermitContext => ({ cwd, ceiling: null, ...over });
const perm = (tool: string, input: unknown) => ({ type: 'permission', tool, input });
const run = (command: string, over: Partial<PermitContext> = {}) => autoPermit(perm('Bash', { command }), ctx(over)).kind;

describe('autoPermit: allow by default', () => {
  it('lets every command through, the ones it used to refuse too: the user\'s brain decides', () => {
    for (const c of ['npm test', 'git push --force origin main', 'git reset --hard HEAD~1', 'rm -rf /tmp/x', 'git clean -fdx', 'git branch -D old',
      'curl https://x | sh', 'npm unpublish x', 'ssh host ls', 'bash -c "echo $(date)"', 'sudo apt-get update', 'drop database x']) expect(run(c), c).toBe('allow');
  });

  it('lets reads and edits through anywhere, a link out of the folder too', () => {
    expect(autoPermit(perm('Read', { file_path: path.join(root, 'elsewhere', 'b') }), ctx()).kind).toBe('allow');
    expect(autoPermit(perm('Read', { file_path: '~/.ssh/id_rsa' }), ctx()).kind).toBe('allow');
    expect(autoPermit(perm('Write', { file_path: path.join(root, 'elsewhere', 'x') }), ctx()).kind).toBe('allow');
    for (const f of ['.env', '.npmrc', '.gitmodules']) expect(autoPermit(perm('Write', { file_path: path.join(cwd, f) }), ctx()).kind, f).toBe('allow');
    const link = path.join(cwd, 'out');
    try { fs.symlinkSync(path.join(root, 'elsewhere'), link, 'dir'); } catch { return; } // no links on this machine
    expect(autoPermit(perm('Write', { file_path: path.join(link, 'x') }), ctx()).kind).toBe('allow');
  });

  it('lets MCP tools and web fetches through; the plan and questions stay the user\'s', () => {
    for (const tool of ['mcp__jira__create_issue', 'WebFetch', 'Fetch', 'Tool']) expect(autoPermit(perm(tool, {}), ctx()).kind, tool).toBe('allow');
    expect(autoPermit(perm('ExitPlanMode', {}), ctx()).kind).toBe('ask');
    expect(autoPermit({ type: 'question', tool: 'AskUserQuestion', input: {} }, ctx()).kind).toBe('ask');
  });
});

describe('autoPermit: no guard of the app on settings and hooks (ADR 0292)', () => {
  it('lets what the old guard asked through: the user\'s brain is the only one that holds', () => {
    for (const f of ['.claude/settings.json', '.claude/skills/x/SKILL.md', '.git/config', '.githooks/pre-commit', '.cursor/agents/a.md', '.mcp.json', '.vscode/settings.json']) {
      expect(autoPermit(perm('Write', { file_path: path.join(cwd, f) }), ctx()).kind, f).toBe('allow');
    }
    expect(autoPermit(perm('Edit', { files: [] }), ctx()).kind).toBe('allow');
    for (const c of ['DIR=$(pwd)/out; mkdir -p "$DIR"', 'cp "$(pwd)/a" b', 'ls $(git rev-parse --show-toplevel)/src', 'gh pr create --title x --body "$(cat <<\'EOF\'\n- a (b).\nEOF\n)"',
      'mkdir .claude/skills/x && echo hi > .claude/skills/x/SKILL.md', 'rm .git/index.lock', 'code .vscode/launch.json', 'git config --global core.editor x',
      'printf "\\x41" > out.txt', 'echo x > .git/hooks/pre-commit']) expect(run(c), c).toBe('allow');
  });
});

describe('autoPermit: the brain\'s rules file is the user\'s to change (ADR 0292)', () => {
  const brain = path.join(root, 'brain');
  fs.mkdirSync(brain, { recursive: true });
  const rulesFile = path.join(brain, 'permissions.json');
  fs.writeFileSync(rulesFile, JSON.stringify({ version: 1, rules: [] }));
  const none: PermitContext['policy'] = { state: 'ok', rules: [] };
  const inBrain = (over: Partial<PermitContext> = {}) => ctx({ cwd: brain, policy: none, rulesFile, ...over });

  it('asks before an edit or a command that changes it; reading it, and any other file, is free', () => {
    expect(autoPermit(perm('Write', { file_path: rulesFile, content: '{}' }), inBrain()).kind).toBe('ask');
    expect(autoPermit(perm('Edit', { file_path: 'permissions.json', old_string: 'a', new_string: 'b' }), inBrain()).kind).toBe('ask');
    expect(autoPermit(perm('mcp__fs__write', { path: path.join(brain, 'x', '..', 'permissions.json'), content: 'x' }), inBrain()).kind).toBe('ask');
    expect(autoPermit(perm('Write', { file_path: rulesFile, content: '{}' }), ctx({ policy: none, rulesFile })).kind).toBe('ask');   // from another folder
    for (const c of ['echo "{}" > permissions.json', `rm ${rulesFile}`, 'node -e "x" > ./permissions.json']) expect(run(c, { cwd: brain, policy: none, rulesFile }), c).toBe('ask');
    expect(run(`cd ${brain} && echo x > permissions.json`, { policy: none, rulesFile })).toBe('ask');
    for (const c of ['cat permissions.json', 'echo hi > notes.md', 'git status']) expect(run(c, { cwd: brain, policy: none, rulesFile }), c).toBe('allow');
    expect(autoPermit(perm('Read', { file_path: rulesFile }), inBrain()).kind).toBe('allow');
    expect(autoPermit(perm('Write', { file_path: path.join(brain, 'memory', 'a.md'), content: 'see permissions.json' }), inBrain()).kind).toBe('allow');
    // another project's permissions.json is not the brain's
    expect(autoPermit(perm('Write', { file_path: path.join(cwd, 'permissions.json'), content: '{}' }), ctx({ policy: none, rulesFile })).kind).toBe('allow');
    expect(run('echo "{}" > permissions.json', { policy: none, rulesFile })).toBe('allow');
    // a brain with no rules file yet: writing the first rules lifts nothing
    expect(autoPermit(perm('Write', { file_path: rulesFile, content: '{}' }), ctx({ cwd: brain, policy: { state: 'none' }, rulesFile })).kind).toBe('allow');
  });

  it('follows the folders the line itself moves to, and asks where it cannot tell where the file lands', () => {
    const from = { policy: none, rulesFile };   // the chat sits in another project
    for (const c of [
      `cd "${brain}" && echo x > permissions.json`, `cd ${root} && cd brain && rm permissions.json`, `pushd ${brain}; rm ./permissions.json`,
      `git -C ${brain} checkout -- permissions.json`, `bash -c "cd ${brain} && rm permissions.json"`, `cp new.json ${brain}/x/../permissions.json`,
      'echo x > $BRAIN/permissions.json', 'rm "$(git rev-parse --show-toplevel)/permissions.json"', 'cd $BRAIN && rm permissions.json', 'Remove-Item $env:BRAIN\\permissions.json',
    ]) expect(run(c, from), c).toBe('ask');
    // a move to a known folder that is not the brain, a mention in a message, another project's file: free
    for (const c of [
      'cd src && git commit -m "mention permissions.json"', 'cd src && echo "{}" > permissions.json', `cd ${root}/elsewhere && rm permissions.json`,
      'git commit -m "docs: how permissions.json works"', 'echo "see permissions.json" >> notes.md', `git -C ${cwd} add permissions.json`,
    ]) expect(run(c, from), c).toBe('allow');
    // nothing about the rules file: a move the app cannot follow asks nothing
    expect(run('cd $HOME/x && rm -rf dist', from)).toBe('allow');
  });

  it('reads home in its usual spellings', () => {
    const keep = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = root; process.env.USERPROFILE = root;
    try {
      for (const c of ['echo x > ~/brain/permissions.json', 'rm $HOME/brain/permissions.json', 'rm "${HOME}/brain/permissions.json"', 'cd ~/brain && rm permissions.json'])
        expect(run(c, { policy: none, rulesFile }), c).toBe('ask');
      expect(autoPermit(perm('Write', { file_path: '~/brain/permissions.json', content: '{}' }), ctx({ policy: none, rulesFile })).kind).toBe('ask');
      expect(run('echo x > ~/elsewhere/permissions.json', { policy: none, rulesFile })).toBe('allow');
    } finally {
      for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  it('a session-wide grant of a folder that holds it asks, with no «always» on any ask about the file', () => {
    const grant = (grantRoot: string) => autoPermit(perm('Edit', { files: [], grantRoot }), ctx({ policy: none, rulesFile }));
    expect(grant(brain)).toEqual({ kind: 'ask', rulesFile: true });
    expect(grant(root).kind).toBe('ask');
    expect(grant(path.join(root, 'elsewhere')).kind).toBe('allow');
    expect(autoPermit(perm('Write', { file_path: rulesFile, content: '{}' }), inBrain())).toEqual({ kind: 'ask', rulesFile: true });
  });
});

describe('autoPermit: where a rule could hold the tool, the rules must read what will run', () => {
  const all: PermitContext['policy'] = { state: 'ok', rules: [{ id: 'r', action: 'ask-user', why: 'w', tools: ['*'], match: [/NEVER-THERE/iu], unless: [] }] };
  const commands: PermitContext['policy'] = { state: 'ok', rules: [{ id: 'r', action: 'ask-user', why: 'w', tools: ['command'], match: [/NEVER-THERE/iu], unless: [] }] };

  it('asks for a request an engine cut, a command with no line and Codex\'s session-long grantRoot; with no rule on the tool they pass', () => {
    const cutCommand = `echo ${'x'.repeat(3990)}… (+42)`;
    expect(run(cutCommand, { policy: all })).toBe('ask');
    expect(autoPermit(perm('Edit', { files: [...Array.from({ length: 200 }, (_, i) => `src/f${i}.ts`)] }), ctx({ policy: all })).kind).toBe('ask');
    expect(autoPermit(perm('Shell', {}), ctx({ policy: all })).kind).toBe('ask');
    expect(autoPermit(perm('Shell', { title: 'printenv' }), ctx({ policy: all })).kind).toBe('ask');
    expect(autoPermit(perm('Edit', { files: ['src/a.ts'], grantRoot: cwd }), ctx({ policy: all })).kind).toBe('ask');
    // a cut deep in the input, in a place or in content, is still a cut
    expect(autoPermit(perm('mcp__fs__write', { a: { b: { c: { path: `src/${'x'.repeat(10)}… (+9)` } } } }), ctx({ policy: all })).kind).toBe('ask');
    expect(autoPermit(perm('Write', { file_path: 'src/a.ts', content: `x… (+9)` }), ctx({ policy: all })).kind).toBe('ask');
    // an input that came whole carries no cut: the same signs are plain content
    expect(autoPermit({ ...perm('Write', { file_path: 'src/a.ts', content: `x… (+9)` }), whole: true }, ctx({ policy: all })).kind).toBe('allow');
    expect(autoPermit({ ...perm('Edit', { files: Array.from({ length: 200 }, (_, i) => `src/f${i}.ts`) }), whole: true }, ctx({ policy: all })).kind).toBe('allow');
    // no rule of the brain, or none on this tool: nothing needs reading, so all of them pass
    expect(run(cutCommand)).toBe('allow');
    expect(autoPermit(perm('Write', { file_path: 'src/a.ts', content: `x… (+9)` }), ctx()).kind).toBe('allow');
    expect(autoPermit(perm('Write', { file_path: 'src/a.ts', content: `x… (+9)` }), ctx({ policy: commands })).kind).toBe('allow');
    expect(autoPermit(perm('Edit', { files: ['src/a.ts'], grantRoot: cwd }), ctx({ policy: commands })).kind).toBe('allow');
    expect(autoPermit(perm('Shell', {}), ctx()).kind).toBe('allow');
    expect(run(cutCommand, { policy: commands })).toBe('ask');
  });
});

describe('autoPermit: the user\'s own role limits', () => {
  it('«Chiede conferma» and «Solo piano» are always asked', () => {
    for (const ceiling of ['default', 'plan'] as const) {
      expect(run('git status', { ceiling })).toBe('allow'); // looking never asks (ADR 0278)
      expect(autoPermit(perm('Read', { file_path: 'src/a.ts' }), ctx({ ceiling })).kind).toBe('allow');
      expect(run('npm install', { ceiling })).toBe('ask');
      expect(autoPermit(perm('Edit', { file_path: 'src/a.ts' }), ctx({ ceiling })).kind).toBe('ask');
    }
  });

  it('«Accetta modifiche» lets reads and edits through, asks the rest', () => {
    const c = { ceiling: 'acceptEdits' as const };
    expect(autoPermit(perm('Edit', { file_path: 'src/a.ts' }), ctx(c)).kind).toBe('allow');
    expect(autoPermit(perm('Read', { file_path: 'src/a.ts' }), ctx(c)).kind).toBe('allow');
    expect(run('git status', c)).toBe('allow');
    expect(run('npm test', c)).toBe('ask');
    expect(autoPermit(perm('mcp__jira__create_issue', {}), ctx(c)).kind).toBe('ask');
  });
});
