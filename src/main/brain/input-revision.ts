// Read-only change tokens for the shipped chat/cost scripts. Live and UsageMonitor keep their existing cadence,
// but launch a child only after an input changes. No timers, content reads or routine-folder watches here.
// Missing roots are watched through their nearest existing parent; unsupported watches fall back to polling.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface InputSource { directory: string; recursive?: boolean; accepts?: (name: string) => boolean }
export interface InputRevision { revision(): Promise<string | null>; stop(): void }
interface Watched { source: InputSource; key?: string; watcher?: fs.FSWatcher }

/** Only for app-owned product tools; custom legacy scripts may read arbitrary inputs and keep polling. */
export function chatInputs(root: string, env: NodeJS.ProcessEnv, home = os.homedir()): InputSource[] {
  const database = path.resolve(root, env.BRAIN_CURSOR_DB || path.join(env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb'));
  const name = path.basename(database);
  return [
    { directory: path.resolve(root, env.BRAIN_CLAUDE_PROJECTS || path.join(home, '.claude', 'projects')), recursive: true },
    { directory: path.resolve(root, env.BRAIN_CURSOR_PROJECTS || path.join(home, '.cursor', 'projects')), recursive: true },
    // Reading SQLite may change -shm read marks itself. Data changes always touch the database/WAL/journal.
    { directory: path.dirname(database), accepts: file => [name, `${name}-wal`, `${name}-journal`].includes(file) },
  ];
}

export function costInputs(root: string, script: string, env: NodeJS.ProcessEnv, home = os.homedir()): InputSource[] {
  return [
    // cost.mjs deliberately uses the default Claude directory, not BRAIN_CLAUDE_PROJECTS.
    { directory: path.join(home, '.claude', 'projects'), recursive: true },
    { directory: path.resolve(root, env.COMPARE_DOWNLOADS || path.join(home, 'Downloads')), accepts: file => /^team-usage-events-.*\.csv$/i.test(file) },
    { directory: path.join(root, 'harness'), accepts: file => file === 'models.json' },
    { directory: path.resolve(path.dirname(script), '../../harness'), accepts: file => file === 'models.json' },
  ];
}

export class FileRevision implements InputRevision {
  private entries: Watched[];
  private version = 0;
  private stopped = false;

  constructor(sources: InputSource[]) {
    this.entries = sources.map(source => ({ source: { ...source, directory: path.resolve(source.directory) } }));
  }

  async revision(): Promise<string | null> {
    if (this.stopped) return null;
    let healthy = true;
    for (const entry of this.entries) {
      try { if (!await this.arm(entry)) healthy = false; }
      catch { this.close(entry); healthy = false; }
    }
    return !this.stopped && healthy ? String(this.version) : null;
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.entries) this.close(entry);
  }

  private close(entry: Watched): void {
    const watcher = entry.watcher;
    entry.watcher = undefined; entry.key = undefined;
    watcher?.close();
  }

  private async arm(entry: Watched): Promise<boolean> {
    const { source } = entry;
    let directory = source.directory;
    let stat: fs.Stats;
    for (;;) {
      try { stat = await fs.promises.stat(directory); break; }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        const parent = path.dirname(directory);
        if (parent === directory) throw e;
        directory = parent;
      }
    }
    if (this.stopped) return false;
    if (!stat.isDirectory()) throw new Error('Input root is not a directory');
    const missing = directory !== source.directory;
    const recursive = !missing && !!source.recursive;
    const key = `${directory}:${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${recursive}`;
    if (entry.watcher && entry.key === key) return true;
    this.close(entry);
    const firstMissing = missing ? path.relative(directory, source.directory).split(path.sep)[0] : null;
    const watcher = fs.watch(directory, { recursive, persistent: false }, (_event, name) => {
      const file = name?.toString().replace(/\\/g, '/');
      if (!file || (missing ? file.split('/')[0] === firstMissing : !source.accepts || source.accepts(file))) this.version++;
    });
    entry.watcher = watcher; entry.key = key;
    this.version++; // first scan, root replacement or recovery must not reuse an older child's result
    const failed = () => {
      if (entry.watcher !== watcher) return;
      this.close(entry); this.version++;
    };
    watcher.on('error', failed);
    watcher.on('close', failed);
    return true;
  }
}
