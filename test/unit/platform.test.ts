// Per-OS folders and engine package (src/main/platform.ts, ADR 0054): the shared folder never lands inside the stable
// userData, the XDG variables are honoured on Linux, and the engine package matches the npm names Anthropic ships.
import { describe, expect, it } from 'vitest';
import { claudeEnginePackage, etimeSeconds, gitBashPath, launcherName, linuxDesktopEntry, macCommandFile, ownProcessGroup, restartWaiter, sharedDir, userShell, userShellName } from '../../src/main/platform';

describe('sharedDir', () => {
  it('Windows: %LOCALAPPDATA%/second-brain, with the profile fallback when the variable is missing', () => {
    expect(sharedDir({ LOCALAPPDATA: 'D:\\L' }, 'win32', 'C:\\Users\\u')).toBe('D:\\L\\second-brain');
    expect(sharedDir({}, 'win32', 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\second-brain');
  });

  it('macOS: Application Support, beside the stable userData (second-brain), never inside it', () => {
    expect(sharedDir({}, 'darwin', '/Users/u')).toBe('/Users/u/Library/Application Support/second-brain-shared');
  });

  it('Linux: $XDG_DATA_HOME, else ~/.local/share (an empty variable counts as unset)', () => {
    expect(sharedDir({ XDG_DATA_HOME: '/data' }, 'linux', '/home/u')).toBe('/data/second-brain');
    expect(sharedDir({ XDG_DATA_HOME: '' }, 'linux', '/home/u')).toBe('/home/u/.local/share/second-brain');
  });
});

describe('claudeEnginePackage', () => {
  it('names the official package per OS and CPU, claude.exe only on Windows', () => {
    expect(claudeEnginePackage('win32', 'x64')).toEqual({ pkg: '@anthropic-ai/claude-agent-sdk-win32-x64', bin: 'claude.exe' });
    expect(claudeEnginePackage('darwin', 'arm64')).toEqual({ pkg: '@anthropic-ai/claude-agent-sdk-darwin-arm64', bin: 'claude' });
    expect(claudeEnginePackage('linux', 'x64')).toEqual({ pkg: '@anthropic-ai/claude-agent-sdk-linux-x64', bin: 'claude' });
  });

  it('none where Anthropic ships none', () => {
    expect(claudeEnginePackage('freebsd', 'x64')).toBeNull();
    expect(claudeEnginePackage('linux', 'ia32')).toBeNull();
  });

  it('every package it can name is an optional dependency of the app, at one version', async () => {
    const pkg = (await import('../../package.json', { with: { type: 'json' } })).default as { optionalDependencies?: Record<string, string>; dependencies?: Record<string, string> };
    const names = (['win32', 'darwin', 'linux'] as const).flatMap(os => (['x64', 'arm64'] as const).map(cpu => claudeEnginePackage(os, cpu)?.pkg));
    for (const n of names) expect(pkg.optionalDependencies?.[n ?? '']).toBeTruthy();
    expect(new Set(names.map(n => pkg.optionalDependencies?.[n ?? ''])).size).toBe(1);
    expect(Object.keys(pkg.dependencies ?? {}).some(n => n.startsWith('@anthropic-ai/claude-agent-sdk-'))).toBe(false);
  });
});

describe('process helpers (ADR 0054 stage 3)', () => {
  it('own process group and launcher only differ off Windows', () => {
    expect([ownProcessGroup('win32'), ownProcessGroup('darwin'), ownProcessGroup('linux')]).toEqual([false, true, true]);
    expect([launcherName('win32'), launcherName('darwin'), launcherName('linux')]).toEqual(['launch.cmd', 'launch.sh', 'launch.sh']);
  });
  it('the restart waiter: PowerShell on Windows as before, a /bin/sh loop elsewhere with the launcher as an argument', () => {
    const w = restartWaiter(42, "C:\\Users\\o'k\\launch.cmd", 'win32');
    expect(w.command).toBe('powershell.exe');
    expect(w.args.at(-1)).toBe("Wait-Process -Id 42 -Timeout 60 -ErrorAction SilentlyContinue; & cmd.exe /d /c 'C:\\Users\\o''k\\launch.cmd'");
    const p = restartWaiter(42, "/home/o'k $x/launch.sh", 'linux');
    expect(p.command).toBe('/bin/sh');
    expect(p.args[0]).toBe('-c');
    expect(p.args[1]).toContain('kill -0 42');
    expect(p.args[1]).not.toContain('launch.sh');
    expect(p.args[2]).toBe("/home/o'k $x/launch.sh");
  });
  it('user commands: PowerShell from stdin on Windows; the login shell with -c elsewhere, /bin/sh when SHELL is unset or relative', () => {
    expect(userShell('ls', {}, 'win32')).toMatchObject({ command: 'powershell.exe', stdin: true });
    expect(userShell('ls -la', { SHELL: '/bin/zsh' }, 'darwin')).toEqual({ command: '/bin/zsh', args: ['-l', '-c', 'ls -la'], stdin: false });
    expect(userShell('ls', {}, 'linux').command).toBe('/bin/sh');
    expect(userShell('ls', { SHELL: 'zsh' }, 'linux').command).toBe('/bin/sh');
  });
  it('names that shell to an agent: PowerShell 5.1 on Windows, the login shell elsewhere, never PowerShell off Windows', () => {
    expect(userShellName({ SHELL: '/bin/zsh' }, 'win32')).toEqual({ name: 'PowerShell 5.1', fence: 'powershell' });
    expect(userShellName({ SHELL: '/bin/zsh' }, 'darwin')).toEqual({ name: 'zsh', fence: 'bash' });
    expect(userShellName({ SHELL: '/usr/bin/fish' }, 'linux')).toEqual({ name: 'fish', fence: 'bash' });
    expect(userShellName({}, 'linux')).toEqual({ name: 'sh', fence: 'bash' });
    expect(userShellName({ SHELL: 'zsh' }, 'linux').name).toBe('sh'); // as userShell: a relative SHELL is not trusted
  });
  it('ps etime in every form both Linux and macOS print', () => {
    expect(etimeSeconds('00:07')).toBe(7);
    expect(etimeSeconds('  12:34')).toBe(754);
    expect(etimeSeconds('01:02:03')).toBe(3723);
    expect(etimeSeconds('2-01:02:03')).toBe(176523);
    expect(etimeSeconds('abc')).toBeNaN();
  });
});

describe('desktop launchers of macOS and Linux (ADR 0054 stage 4)', () => {
  it('the .desktop entry quotes the launcher per the freedesktop spec', () => {
    const e = linuxDesktopEntry('/home/u/a "b" $c 100%/launch.sh', '/opt/sb/icon.png');
    expect(e).toContain(String.raw`Exec=/bin/sh "/home/u/a \"b\" \$c 100%%/launch.sh"`);
    expect(e).toContain('Icon=/opt/sb/icon.png');
    expect(e.startsWith('[Desktop Entry]\nType=Application\n')).toBe(true);
  });
  it('the .command file runs launch.sh as one shell word', () => {
    expect(macCommandFile("/Users/o'k/launch.sh")).toContain(String.raw`exec /bin/sh '/Users/o'\''k/launch.sh'`);
  });
});

describe('gitBashPath (run_code Bash, the hooks guard)', () => {
  const only = (...paths: string[]) => (p: string): boolean => paths.map(x => x.toLowerCase()).includes(p.toLowerCase());
  it('Windows: the per-user Git for Windows install under %LOCALAPPDATA%/Programs/Git', () => {
    const bash = 'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\bin\\bash.exe';
    expect(gitBashPath({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', only(bash))).toBe(bash);
  });
  it('Windows: the Git on PATH (cmd or mingw64/bin), its root/bin/bash.exe; never a bash.exe without git.exe beside it', () => {
    const bash = 'D:\\Tools\\Git\\bin\\bash.exe';
    expect(gitBashPath({ Path: 'C:\\Windows\\System32;"D:\\Tools\\Git\\cmd"' }, 'win32', only('D:\\Tools\\Git\\cmd\\git.exe', bash))).toBe(bash);
    expect(gitBashPath({ PATH: 'D:\\Tools\\Git\\mingw64\\bin' }, 'win32', only('D:\\Tools\\Git\\mingw64\\bin\\git.exe', bash))).toBe(bash);
    expect(gitBashPath({ PATH: 'C:\\Windows\\System32' }, 'win32', only('C:\\Windows\\System32\\bash.exe'))).toBeNull();
  });
  it('Windows PATH: two levels up only from mingw64/bin; a relative PATH entry is never used', () => {
    // a git.exe in some other folder: its grandparent's bin/bash.exe is not Git Bash
    expect(gitBashPath({ PATH: 'D:\\Tools\\Other\\sub' }, 'win32', only('D:\\Tools\\Other\\sub\\git.exe', 'D:\\Tools\\bin\\bash.exe'))).toBeNull();
    // relative to the current folder: whatever is there, never trusted
    expect(gitBashPath({ PATH: 'tools\\git\\cmd' }, 'win32', only('tools\\git\\cmd\\git.exe', 'tools\\git\\bin\\bash.exe'))).toBeNull();
    expect(gitBashPath({ PATH: 'D:tools\\cmd' }, 'win32', only('D:tools\\cmd\\git.exe', 'D:tools\\bin\\bash.exe'))).toBeNull();
  });
  it('Windows: CLAUDE_CODE_GIT_BASH_PATH first, then Program Files; elsewhere /bin/sh', () => {
    const pf = 'C:\\Program Files\\Git\\bin\\bash.exe';
    expect(gitBashPath({ CLAUDE_CODE_GIT_BASH_PATH: 'E:\\b.exe', LOCALAPPDATA: 'C:\\L' }, 'win32', only('E:\\b.exe', pf))).toBe('E:\\b.exe');
    expect(gitBashPath({ LOCALAPPDATA: 'C:\\L' }, 'win32', only(pf, 'C:\\L\\Programs\\Git\\bin\\bash.exe'))).toBe(pf);
    expect(gitBashPath({}, 'linux', () => false)).toBe('/bin/sh');
  });
});
