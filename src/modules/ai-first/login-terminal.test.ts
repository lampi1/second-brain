// Platform-simulated terminal argv tests only: never opens a terminal or executes an engine.
import { expect, it } from 'vitest';
import path from 'node:path';
import { posixLoginSpec } from './login-terminal';
it('passes macOS paths and official login args as AppleScript argv, never as script source', () => {
  const executable = path.posix.join('/', 'Users', "Example O'Name", 'bin', 'claude');
  const spec = posixLoginSpec('darwin', executable, ['auth', 'login']);
  expect(spec.file).toBe(path.posix.join('/', 'usr', 'bin', 'osascript'));
  expect(spec.args[1]).not.toContain(executable); expect(spec.args[1]).toContain('quoted form');
  expect(spec.args.slice(2)).toEqual([executable, 'auth', 'login']);
});
it('passes Linux engine arguments directly to an installed terminal, with no shell string', () => {
  const terminal = path.posix.join('/', 'usr', 'bin', 'gnome-terminal');
  const executable = path.posix.join('/', 'home', 'example', '.local', 'bin', 'kimi');
  expect(posixLoginSpec('linux', executable, ['login', '--region', 'global'], file => file === terminal)).toEqual({ file: terminal, args: ['--', executable, 'login', '--region', 'global'] });
});
it('fails explicitly when no terminal exists or command data contains control characters', () => {
  expect(() => posixLoginSpec('linux', '/example/claude', ['login'], () => false)).toThrow('TERMINAL_UNAVAILABLE');
  expect(() => posixLoginSpec('darwin', '/example/claude', ['login\nunsafe'])).toThrow('LOGIN_COMMAND');
});
