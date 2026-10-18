// Main-only automatic local memory: copies trusted bundled data, never executes the installer or modifies harness config.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { CreatedBrain } from '../../shared/brain-create';
export interface DefaultBrainHost {
  userData: string; templateRoot: string; current: () => string | null; revision: () => number;
  connect: (root: string) => Promise<void>; now?: () => Date;
  usable?: () => boolean;
}
const forward = (value: string) => value.split(path.sep).join('/');
async function directory(file: string): Promise<void> {
  const stat = await fs.lstat(file);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(await fs.realpath(file)) !== path.resolve(file)) throw new Error('AI_SETUP_LOCAL_DIRECTORY');
}
export class DefaultBrain {
  private pending: Promise<CreatedBrain> | null = null;
  constructor(private readonly host: DefaultBrainHost) {}
  ensure(language: 'it' | 'en', harness: string): Promise<CreatedBrain> {
    const current = this.host.current();
    if (current) return Promise.resolve({ root: current, connected: this.host.usable?.() ?? true });
    if (!['it', 'en'].includes(language) || !['none', 'claude', 'codex', 'kimi', 'cursor'].includes(harness)) return Promise.reject(new Error('AI_SETUP_FIELDS'));
    if (!this.pending) this.pending = this.create(language, harness).finally(() => { this.pending = null; });
    return this.pending;
  }
  private async create(language: 'it' | 'en', harness: string): Promise<CreatedBrain> {
    const h = this.host, previous = h.current(), revision = h.revision();
    await directory(h.userData); await directory(h.templateRoot);
    // An exclusively reserved fresh directory needs no replace/rename operation on any OS.
    const root = await fs.mkdtemp(path.join(h.userData, 'memory-'));
    const fwd = forward(root), home = forward(os.homedir()), projects = path.join(root, 'projects');
    const values: Record<string, string> = {
      OWNER: language === 'it' ? 'Tu' : 'You', ROLE: language === 'it' ? 'Da conoscere insieme' : 'To discover together', LANG: language === 'it' ? 'italiano' : 'English',
      BRAIN_NAME: 'memory', TODAY: (h.now?.() ?? new Date()).toISOString().slice(0, 10), BRAIN: fwd, BRAIN_WIN: root, BRAIN_JS: root.replace(/\\/g, '\\\\'), BRAIN_RE: fwd.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'),
      REPOS: forward(projects), REPOS_WIN: projects, REPOS_JS: projects.replace(/\\/g, '\\\\'), HOME: home, HOME_WIN: os.homedir(), HOME_JS: os.homedir().replace(/\\/g, '\\\\'),
      DEVOPS_ORG: 'your-org', DEVOPS_PROJECT: 'your-project', OS: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux', SHELL: process.platform === 'win32' ? 'PowerShell' : 'bash',
      HARNESSES: harness === 'none' ? (language === 'it' ? 'Da collegare' : 'Not connected yet') : ({ claude: 'Claude Code', codex: 'Codex', kimi: 'Kimi', cursor: 'Cursor' } as Record<string, string>)[harness]!,
    };
    const render = (text: string, js = false) => text.replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error('AI_SETUP_TEMPLATE_PLACEHOLDER');
      return js ? value.replace(key === 'BRAIN_RE' ? /['"`]/g : /['"`$]/g, '\\$&') : value;
    });
    let count = 0, bytes = 0;
    const copy = async (from: string, to: string, depth = 0) => {
      if (depth > 12) throw new Error('AI_SETUP_TEMPLATE_LIMIT');
      await directory(from);
      for (const entry of await fs.readdir(from, { withFileTypes: true })) {
        // A project hook/MCP config becomes executable as soon as an engine starts in this directory.
        // Copy memory data only; even bundled integration directories require a separate user choice.
        if (depth === 0 && (['install.mjs', 'README.md', 'me.template.md', '.mcp.json', '.claude.json'].includes(entry.name) || (entry.isDirectory() && entry.name.startsWith('.')))) continue;
        // Cursor's template hooks target the omitted .claude integration scripts. They are opt-in too.
        if (path.relative(h.templateRoot, path.join(from, entry.name)).split(path.sep).join('/') === 'harness/cursor/hooks.json') continue;
        if (++count > 2000 || entry.isSymbolicLink()) throw new Error('AI_SETUP_TEMPLATE_LIMIT');
        const source = path.join(from, entry.name), name = render(entry.name);
        if (name !== path.basename(name) || name === '.' || name === '..') throw new Error('AI_SETUP_TEMPLATE_PATH');
        const target = path.join(to, name);
        if (entry.isDirectory()) { await fs.mkdir(target, { mode: 0o700 }); await copy(source, target, depth + 1); }
        else if (entry.isFile()) {
          const stat = await fs.lstat(source); bytes += stat.size;
          if (stat.isSymbolicLink() || stat.nlink !== 1 || bytes > 16 * 1024 * 1024) throw new Error('AI_SETUP_TEMPLATE_LIMIT');
          const body = await fs.readFile(source);
          await fs.writeFile(target, body.subarray(0, 8000).includes(0) ? body : render(body.toString('utf8'), /\.(m?js|cjs)$/.test(name)), { flag: 'wx', mode: 0o600 });
        } else throw new Error('AI_SETUP_TEMPLATE_TYPE');
      }
    };
    await copy(h.templateRoot, root);
    const me = path.join(h.templateRoot, 'me.template.md');
    const meStat = await fs.lstat(me);
    if (!meStat.isFile() || meStat.isSymbolicLink() || meStat.size > 128 * 1024) throw new Error('AI_SETUP_TEMPLATE_TYPE');
    await fs.writeFile(path.join(root, 'me.md'), render(await fs.readFile(me, 'utf8')), { flag: 'wx', mode: 0o600 });
    for (const parts of [['journal', 'brief'], ['playbooks'], ['reviews'], ['projects']]) await fs.mkdir(path.join(root, ...parts), { recursive: true, mode: 0o700 });
    for (const parts of [['AGENTS.md'], ['me.md'], ['ops', 'tools', 'brain-site.mjs']]) if (!(await fs.lstat(path.join(root, ...parts))).isFile()) throw new Error('AI_SETUP_TEMPLATE_INCOMPLETE');
    // Concurrent explicit folder selection always wins. Keep the prepared data; never delete user content.
    if (h.revision() !== revision || h.current() !== previous) return { root, connected: false };
    await h.connect(root);
    return { root, connected: true };
  }
}
