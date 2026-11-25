// The read-only classifier's reading of a line (issue #485): chains, bash loops over plain values, bash functions
// called on the line, `cd`, output thrown away. Each step is then checked alone (readOnlyCommand); what the reader
// cannot follow stays the user's call. Pins src/main/agents/command-steps.ts and its use in tool-policy.ts.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandSteps, shellOfTool } from '../../../src/main/agents/command-steps';
import { readOnlyCommand, shellWithin } from '../../../src/main/agents/tool-policy';

describe('commandSteps', () => {
  it('writes a loop\'s values and a call\'s arguments into the steps', () => {
    expect(commandSteps('for b in main dev; do git log -1 "$b"; done', 'bash')).toEqual([{ text: 'git log -1 "main"' }, { text: 'git log -1 "dev"' }]);
    expect(commandSteps('Q(){ grep -rn "$1" src | head -5; }; Q foo; Q bar', 'bash')).toEqual([{ text: 'grep -rn "foo" src | head -5' }, { text: 'grep -rn "bar" src | head -5' }]);
    expect(commandSteps('function q { git show "${1}" --stat; }\nq HEAD', 'bash')).toEqual([{ text: 'git show "HEAD" --stat' }]);
    expect(commandSteps('cd src && ls 2>/dev/null; git status 2>&1', 'bash')).toEqual([{ cd: 'src', certain: true }, { text: 'ls' }, { text: 'git status' }]);
    expect(commandSteps('Get-ChildItem 2>$null; Get-Content a.txt', 'powershell')).toEqual([{ text: 'Get-ChildItem' }, { text: 'Get-Content a.txt' }]);
    expect(commandSteps('# look first\nls', 'bash')).toEqual([{ text: 'ls' }]);
  });
  it('gives up on what it cannot follow', () => {
    for (const line of [
      'ls & rm x', 'ls |& cat', 'for b in $(ls); do cat $b; done', 'for b in *; do cat $b; done', 'for b in a; do for c in b; do ls; done; done',
      'for PATH in .; do ls; done', 'for IFS in x; do ls; done', 'for http_proxy in x; do git log; done', 'for b in a; do cd $b; done', 'for b in a; do ls',
      'Q(){ ls; }', 'Q(){ ls "$@"; }; Q a', 'Q(){ ls $1; }; Q "a b"', 'cat(){ rm -rf x; }; ls | cat', 'cat(){ rm -rf x; }; ls|cat', 'Q(){ Q; }; Q',
      'echo `rm x`', 'cat <<EOF\nx\nEOF', 'cat <(rm x)', 'ls "a', 'cd -', 'cd $HOME',
    ]) expect(commandSteps(line, 'bash'), line).toBeNull();
    // `;` is no separator under cmd: a tool that does not say its shell keeps refusing it
    expect(commandSteps('ls; ls', null)).toBeNull();
    expect(commandSteps('ls && ls', null)).toEqual([{ text: 'ls' }, { text: 'ls' }]);
    // loops and functions are bash's alone
    expect(commandSteps('for b in a; do ls $b; done', 'powershell')?.some(s => 'text' in s && s.text.includes('$b'))).toBe(true);
  });
  it('knows each tool\'s shell', () => {
    expect([shellOfTool('Bash'), shellOfTool('PowerShell'), shellOfTool('Shell'), shellOfTool('Command')]).toEqual(['bash', 'powershell', null, null]);
  });
});

describe('readOnlyCommand reads lines, not only single commands (#485)', () => {
  it.each([
    ['bash', 'for b in main dev; do git log --oneline -1 "$b"; done'],
    ['bash', 'for b in main dev; do echo $b; git log --oneline -1 $b; done'],
    ['bash', 'Q(){ grep -rn "$1" src | head -5; }; Q foo; Q bar'],
    ['bash', 'cd src && ls -la && git status'],
    ['bash', 'git log --oneline -3 2>/dev/null || git status'],
    ['powershell', 'Get-ChildItem -Path . -Recurse -Filter *.ts | Select-Object -First 5'],
    ['powershell', 'Get-ChildItem src | Where-Object Length -gt 1000 | Sort-Object Length | Format-Table Name, Length'],
    ['powershell', 'Get-Content package.json | ConvertFrom-Json | Select-Object -ExpandProperty name; git status 2>$null'],
    [null, 'git status && git log -1'],
  ] as const)('%s reads: %s', (shell, line) => {
    expect(readOnlyCommand(line, undefined, shell)).toBe(true);
  });
  it.each([
    ['bash', 'for b in a b; do rm $b; done'], ['bash', 'for b in a; do cat $b > out; done'], ['bash', 'Q(){ cat "$1"; }; Q "a; rm -rf x"'],
    ['bash', 'Q(){ find . $1 $2; }; Q -name -delete'], ['bash', 'for b in -delete; do find . $b; done'], ['bash', 'cd src && rm a'],
    ['bash', 'ls 2>/tmp/err'], ['bash', 'ls 2>/dev/nullx'], ['bash', 'git log; npm install'], ['bash', 'for b in a; do git log $c; done'],
    ['powershell', 'Get-ChildItem | Where-Object { Remove-Item $_ }'], ['powershell', 'Get-Content a | Out-File b'], ['powershell', 'gm x'],
    [null, 'git log; rm x'], [null, 'ls 2>/dev/null'],
    // the independent review's bypasses: a quote in a comment, a function called by a quoted name, `>&2file`, curly
    // quotes, cmd's quoting
    ['bash', "ls\n#'\ntouch pwned\n#'"], ['powershell', 'ls\n#"\nnotepad pwned\n#"'], ['bash', 'cat(){ $1 $2; }; cat ls .; ca""t touch pwned'],
    ['bash', 'cat(){ $1 $2; }; cat ls .; ca\\t touch pwned'], ['bash', "git(){ ls; }; git; g'i't push"], ['bash', 'echo hi >&2pwned'], [null, 'echo hi >&1pwned'],
    ['powershell', 'Get-Content a > nul'], ['powershell', "cat 'a’|notepad ’'"], ['powershell', 'cat "a”|notepad “"'], [null, "findstr 'x|calc'"], [null, 'findstr ^"x|calc"'],
    ['bash', 'cat a\\ #; touch pwned'], ['bash', 'cat a\\\n#; touch pwned'], ['powershell', 'ls #x\rnotepad pwned'], [null, 'findstr %CMDCMDLINE:~-1% "x|calc"'],
  ] as const)('%s does not read only: %s', (shell, line) => {
    expect(readOnlyCommand(line, undefined, shell)).toBe(false);
  });
  it('a declared script is found from where the line moved, and only an absolute one after a move that may fail', () => {
    const brain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-steps-')));
    try {
      fs.mkdirSync(path.join(brain, 'tools'));
      const script = path.join(brain, 'tools', 'read.mjs');
      fs.writeFileSync(script, '');
      const scripts = { cwd: os.tmpdir(), paths: [script] };
      expect(readOnlyCommand(`cd ${brain} && node tools/read.mjs a`, scripts, 'bash')).toBe(true);
      expect(readOnlyCommand(`node ${script} a`, { ...scripts, cwd: '' }, 'bash')).toBe(true);
      expect(readOnlyCommand(`cd ${brain}; node tools/read.mjs`, scripts, 'bash')).toBe(false);
      expect(readOnlyCommand(`cd ${brain}; node ${script}`, scripts, 'bash')).toBe(true);
      expect(readOnlyCommand('cd tools && node read.mjs', { ...scripts, cwd: brain }, 'bash')).toBe(false);   // CDPATH could send it elsewhere
      expect(readOnlyCommand('cd ./tools && node read.mjs', { ...scripts, cwd: brain }, 'bash')).toBe(true);
      // `ls || cd x && node …`: node runs where it was when ls worked
      expect(readOnlyCommand(`ls || cd ${brain} && node tools/read.mjs`, scripts, 'bash')).toBe(false);
      expect(readOnlyCommand(`ls && cd ${brain} && node tools/read.mjs`, scripts, 'bash')).toBe(true);
      expect(readOnlyCommand('# a comment, it\'s fine\nls', undefined, 'bash')).toBe(true);
      expect(shellWithin({ tools: { allow: ['read', 'shell-read'] }, ceiling: null }, 'Bash', { command: 'for b in a b; do git log $b; done' })).toBe(true);
    } finally { fs.rmSync(brain, { recursive: true, force: true }); }
  });
});
