// Input change gates used by the live feed and usage monitor: real filesystem events, missing/replaced roots,
// errors and shutdown. These tests keep every watched source in an isolated temporary directory.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FileRevision, chatInputs, costInputs } from '../../../src/main/brain/input-revision';
import { tmpDir } from './helpers';

const gates: FileRevision[] = [];
const roots: string[] = [];
const temporary = () => { const root = tmpDir(); roots.push(root); return root; };
const gate = (sources: ConstructorParameters<typeof FileRevision>[0]) => { const value = new FileRevision(sources); gates.push(value); return value; };
afterEach(() => { vi.restoreAllMocks(); gates.splice(0).forEach(g => g.stop()); roots.splice(0).forEach(r => fs.rmSync(r, { recursive: true, force: true })); });

describe('script input revisions', () => {

  it('falls back on watch errors and recovers without trusting the old token', async () => {
    const root = temporary(), g = gate([{ directory: root }]);
    const watch = vi.spyOn(fs, 'watch');
    const before = await g.revision();
    watch.mock.results[0]!.value.emit('error', new Error('watch lost'));
    watch.mockImplementationOnce(() => { throw new Error('unsupported'); });
    expect(await g.revision()).toBeNull();
    expect(await g.revision()).not.toBe(before);
    expect(await g.revision()).not.toBeNull();
  });

  it('never reopens a watcher when stopped during an asynchronous root check', async () => {
    const root = temporary(), g = gate([{ directory: root }]);
    const stat = fs.statSync(root);
    let finish!: (s: fs.Stats) => void;
    vi.spyOn(fs.promises, 'stat').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as ReturnType<typeof fs.promises.stat>);
    const watch = vi.spyOn(fs, 'watch');
    const pending = g.revision(); g.stop(); finish(stat);
    expect(await pending).toBeNull(); expect(watch).not.toHaveBeenCalled();
    expect(await g.revision()).toBeNull();
  });

  it('matches shipped paths, child-cwd-relative overrides and price table fallback', () => {
    const root = temporary(), home = path.join(root, 'home'), script = path.join(root, 'copy', 'ops', 'tools', 'cost.mjs');
    const env = { BRAIN_CLAUDE_PROJECTS: 'chat-projects', BRAIN_CURSOR_PROJECTS: 'cursor-projects', BRAIN_CURSOR_DB: 'db/custom.sqlite', COMPARE_DOWNLOADS: 'exports' };
    const chats = chatInputs(root, env, home), cost = costInputs(root, script, env, home);
    expect(chats.map(x => x.directory)).toEqual(['chat-projects', 'cursor-projects', 'db'].map(p => path.join(root, p)));
    expect(chats[2]!.accepts!('custom.sqlite-wal')).toBe(true);
    expect(chats[2]!.accepts!('custom.sqlite-shm')).toBe(false); // SQLite reader bookkeeping must not wake itself
    expect(cost.map(x => x.directory)).toEqual([path.join(home, '.claude', 'projects'), path.join(root, 'exports'), path.join(root, 'harness'), path.join(root, 'copy', 'harness')]);
  });
});
