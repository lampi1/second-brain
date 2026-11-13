// Doctor's selected instance and safe status formatting. Reads configuration/release metadata only, never credentials.
// Exported separately so stable/dev/override selection and unknown login states can be tested without running a CLI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function json(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? { value, state: 'loaded' } : { value: {}, state: 'invalid' };
  } catch (e) { return { value: {}, state: e.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
}

export function doctorContext({ root, dev = false, env = process.env, platform = process.platform, home = os.homedir() }) {
  const appData = platform === 'win32' ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME || path.join(home, '.config');
  const mode = dev ? 'dev' : 'stable';
  const userData = env.SB_USER_DATA ?? path.join(appData, dev ? 'second-brain-dev' : 'second-brain');
  const configPath = path.join(userData, 'config.json');
  const config = json(configPath);
  const brain = env.SB_BRAIN ? path.normalize(env.SB_BRAIN) : typeof config.value.brainRoot === 'string' && path.isAbsolute(config.value.brainRoot) ? config.value.brainRoot : null;
  const brainSource = env.SB_BRAIN ? 'SB_BRAIN' : brain ? 'config.json' : 'unset';
  // The listener starts before ConfigService. Match mcp/server.ts mcpPortFromEnv after index.ts sets dev's default;
  // the saved setting is diagnostic context, not the listener's source.
  const portEnv = env.SB_MCP_PORT || (dev ? '4329' : undefined);
  const validPort = portEnv !== undefined && Number.isInteger(Number(portEnv)) && Number(portEnv) >= 0 && Number(portEnv) < 65536;
  const savedPort = Number.isInteger(config.value.mcpPort) && config.value.mcpPort >= 0 && config.value.mcpPort <= 65535 ? config.value.mcpPort : null;
  const port = validPort ? Number(portEnv) : 4319;
  const portSource = validPort ? (env.SB_MCP_PORT ? 'SB_MCP_PORT' : 'dev default') : portEnv ? 'default (invalid SB_MCP_PORT)' : 'default';
  const shared = platform === 'win32' ? path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'second-brain')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'second-brain-shared') : path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'second-brain');
  const releasesRoot = env.SB_RELEASES_ROOT ?? shared;
  const state = dev ? {} : json(path.join(releasesRoot, 'current.json')).value;
  // Metadata is not a path override: accept a release basename only, never an arbitrary path from current.json.
  const bad = Array.isArray(state.bad) ? state.bad : [];
  const release = [state.current, state.previous].find(id => typeof id === 'string' && id && id !== '.' && id !== '..' && !/[\\/]/.test(id) && !path.isAbsolute(id) && !bad.includes(id)) ?? null;
  const appRoot = release ? path.join(releasesRoot, 'releases', release) : root;
  const metadata = release ? json(path.join(appRoot, 'release.json')).value : {};
  let releaseEngine = dev ? null : env.SB_ENGINE_CLAUDE ?? null;
  if (!dev && typeof metadata.claudeEngine === 'string' && metadata.claudeEngine) {
    const value = metadata.claudeEngine;
    if (path.isAbsolute(value)) releaseEngine = value; // legacy installed release metadata
    else {
      const absolute = path.resolve(releasesRoot, value), relative = path.relative(path.resolve(releasesRoot), absolute);
      releaseEngine = relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? absolute : null;
    }
  }
  const electronParts = platform === 'win32' ? ['electron.exe'] : platform === 'darwin' ? ['Electron.app', 'Contents', 'MacOS', 'Electron'] : ['electron'];
  const electron = release && typeof metadata.electron === 'string'
    ? path.join(releasesRoot, 'electron', metadata.electron, ...electronParts)
    : path.join(root, 'node_modules', 'electron', 'dist', ...electronParts);
  return { mode, userData, userDataSource: env.SB_USER_DATA !== undefined ? 'SB_USER_DATA' : mode, configPath, configState: config.state,
    brain, brainSource, port, portSource, savedPort, appRoot, release, releaseEngine, electron };
}

export function claudeLogin(stdout) {
  let status;
  try { status = JSON.parse(stdout); } catch { /* unknown output is not evidence of a missing login */ }
  const loggedIn = typeof status?.loggedIn === 'boolean' ? status.loggedIn : null;
  return loggedIn === null
    ? { ok: true, level: 'info', detail: 'not verified (auth status unreadable or unsupported)', hint: 'the user can check the selected Claude CLI with auth status' }
    : { ok: loggedIn, level: loggedIn ? 'ok' : 'warn', detail: loggedIn ? 'logged in' : 'not logged in (reported by the selected CLI)',
      hint: loggedIn ? '' : 'the user signs in with the selected Claude CLI: auth login' };
}

/** Version metadata only. A native desktop install need not have npm metadata; that means unknown, never missing. */
export function packageVersion(cli, packageName) {
  const parent = path.dirname(cli);
  for (const base of [parent, path.join(parent, '..', 'lib')]) {
    const version = json(path.join(base, 'node_modules', ...packageName.split('/'), 'package.json')).value.version;
    if (typeof version === 'string') return version;
  }
  return null;
}
