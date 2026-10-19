// Main-only automatic local memory for the first run: a fresh, empty brain in userData (rules/new-brain.ts
// writeFreshBrain: the owner's profile and brain.json only, ADR 0072). It never copies the template into the folder,
// never runs the installer and never modifies harness config: rules, tools, agents and skills stay the app's.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CreatedBrain } from '../../shared/brain-create';
import { writeFreshBrain } from '../../main/rules/new-brain';
export interface DefaultBrainHost {
  userData: string; templateRoot: string; current: () => string | null; revision: () => number;
  connect: (root: string) => Promise<void>; now?: () => Date;
  usable?: () => boolean;
  /** the owner's projects folder (setting projectsRoot): the new memory's REPOS; absent = an empty projects/ inside it */
  projects?: () => string | null;
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
    if (!['it', 'en'].includes(language) || !['none', 'claude', 'codex', 'cursor'].includes(harness)) return Promise.reject(new Error('AI_SETUP_FIELDS'));
    if (!this.pending) this.pending = this.create(language, harness).finally(() => { this.pending = null; });
    return this.pending;
  }
  private async create(language: 'it' | 'en', harness: string): Promise<CreatedBrain> {
    const h = this.host, previous = h.current(), revision = h.revision();
    await directory(h.userData); await directory(h.templateRoot);
    // An exclusively reserved fresh directory needs no replace/rename operation on any OS.
    const root = await fs.mkdtemp(path.join(h.userData, 'memory-'));
    const projects = h.projects?.() ?? null;
    try {
      writeFreshBrain(root, {
        OWNER: language === 'it' ? 'Tu' : 'You', ROLE: language === 'it' ? 'Da conoscere insieme' : 'To discover together', LANG: language === 'it' ? 'italiano' : 'English',
        TODAY: (h.now?.() ?? new Date()).toISOString().slice(0, 10), REPOS: forward(projects ?? path.join(root, 'projects')),
        HARNESSES: harness === 'none' ? (language === 'it' ? 'Da collegare' : 'Not connected yet') : ({ claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' } as Record<string, string>)[harness]!,
      });
    } catch { throw new Error('AI_SETUP_TEMPLATE_INCOMPLETE'); } // the empty reservation is kept: never delete user data
    // without a projects folder of the owner's, the default one for their repositories (REPOS): empty, nothing in it
    if (!projects) await fs.mkdir(path.join(root, 'projects'), { mode: 0o700 });
    // Concurrent explicit folder selection always wins. Keep the prepared data; never delete user content.
    if (h.revision() !== revision || h.current() !== previous) return { root, connected: false };
    await h.connect(root);
    return { root, connected: true };
  }
}
