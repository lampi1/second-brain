// cursor-db: where the Cursor editor keeps its chat database (state.vscdb) on this computer. Cursor stores it in the
// OS's own application-data folder: Windows %APPDATA%, macOS ~/Library/Application Support, Linux $XDG_CONFIG_HOME
// (default ~/.config). One rule in one place, so the tools that read that database (chats, inbox, feedback-stats, the
// Cursor hooks) find it on every OS; BRAIN_CURSOR_DB overrides it (tests, a portable install). Read-only: nothing here
// opens the file.
import os from 'node:os';
import path from 'node:path';

/** The absolute path of Cursor's state.vscdb for this user. */
export function cursorDb(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.BRAIN_CURSOR_DB) return env.BRAIN_CURSOR_DB;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const data = platform === 'win32' ? env.APPDATA || p.join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? p.join(home, 'Library', 'Application Support')
      : env.XDG_CONFIG_HOME || p.join(home, '.config');
  return p.join(data, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}
