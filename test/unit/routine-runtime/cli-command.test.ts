// The copyable `routine` command (packages/routine-runtime/src/cli-command.ts): PowerShell 5.1 and POSIX quoting, the
// flags of run / resume / watch. The app's Routine section shows exactly these strings.
import { describe, expect, it } from 'vitest';
import { cliCommand, quoteArg } from '../../../packages/routine-runtime/src/index';

describe('cliCommand', () => {
  it('run with inputs, from-step and engine', () => {
    expect(cliCommand('run', { pkg: 'C:\\pkgs\\air.zip', inputs: { workItem: '123' }, fromStep: 'fix', engine: 'claude' }, 'win32'))
      .toBe('routine run C:\\pkgs\\air.zip --input workItem=123 --from-step fix --engine claude');
  });
  it('quotes spaces and single quotes for PowerShell 5.1 and POSIX', () => {
    expect(cliCommand('run', { pkg: "C:\\My Pkgs\\it's.zip", inputs: { topic: 'login bug' } }, 'win32')).toBe("routine run 'C:\\My Pkgs\\it''s.zip' --input 'topic=login bug'");
    expect(cliCommand('run', { pkg: "/home/u/it's pkg" }, 'linux')).toBe("routine run '/home/u/it'\\''s pkg'");
    expect(quoteArg('', 'linux')).toBe("''");
  });
  it('resume takes the run folder, watch the package', () => {
    expect(cliCommand('resume', { runDir: '/runs/demo/r1' }, 'linux')).toBe('routine resume /runs/demo/r1');
    expect(cliCommand('watch', { pkg: '/p', engine: 'claude', runsDir: '/r' }, 'linux')).toBe('routine watch /p --engine claude --runs-dir /r');
    expect(() => cliCommand('resume', {}, 'linux')).toThrow();
  });
  it('a quoted bin path runs through & in PowerShell', () => {
    expect(cliCommand('resume', { runDir: 'C:\\r' }, 'win32', ['C:\\Program Files\\node.exe', 'C:\\x\\routine.mjs'])).toBe("& 'C:\\Program Files\\node.exe' C:\\x\\routine.mjs resume C:\\r");
  });
});
