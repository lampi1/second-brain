// Main-only official CLI login on macOS/Linux. Arguments stay data; no credentials, downloads or PowerShell.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
export function posixLoginSpec(platform: 'darwin' | 'linux', executable: string, args: string[], exists = fs.existsSync): { file: string; args: string[] } {
  if (!path.posix.isAbsolute(executable) || [executable, ...args].some(value => /[\x00\r\n]/.test(value))) throw new Error('AI_SETUP_LOGIN_COMMAND');
  const bin = (...parts: string[]) => path.posix.join(path.posix.sep, 'usr', 'bin', ...parts);
  if (platform === 'darwin') {
    // Terminal scripting and quoted form: Apple Mac Automation Scripting Guide, Calling Command-Line Tools.
    const script = 'on run argv\nset commandLine to "exec"\nrepeat with part in argv\nset commandLine to commandLine & " " & quoted form of (contents of part)\nend repeat\ntell application "Terminal"\nactivate\ndo script commandLine\nend tell\nend run';
    return { file: bin('osascript'), args: ['-e', script, executable, ...args] };
  }
  for (const [name, flag] of [['x-terminal-emulator', '-e'], ['gnome-terminal', '--'], ['konsole', '-e'], ['xterm', '-e']]) {
    const terminal = bin(name!);
    if (exists(terminal)) return { file: terminal, args: [flag!, executable, ...args] };
  }
  throw new Error('AI_SETUP_TERMINAL_UNAVAILABLE');
}
export function launchPosixLogin(platform: 'darwin' | 'linux', executable: string, args: string[]): Promise<void> {
  const spec = posixLoginSpec(platform, executable, args);
  return new Promise((resolve, reject) => {
    const child = spawn(spec.file, spec.args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('AI_SETUP_LOGIN_TIMEOUT')); }, 10000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('AI_SETUP_LOGIN_HANDOFF')); });
    if (platform === 'darwin') child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('AI_SETUP_LOGIN_HANDOFF'));
    });
    else child.once('spawn', () => { clearTimeout(timer); child.unref(); resolve(); });
  });
}
