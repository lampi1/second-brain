// Live feed (src/main/brain/live.ts) on temporary brain folders: baseline, new rows, updates, away diff, chat
// transitions, no parsers. Uses the brain's own parsers (fixture copy) and a fake chats.mjs run by plain Node.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Live, diffChats, parseChatList, stamp, type RawEvent } from '../../../src/main/brain/live';
import { plainNode, tmpBrain } from './helpers';

const lives: Live[] = [];
afterEach(() => { for (const l of lives.splice(0)) l.stop(); });
const make = (root: string, onEvents: (e: RawEvent[]) => void, extra: Partial<ConstructorParameters<typeof Live>[0]> = {}) => {
  const l = new Live({ root, stateFile: path.join(root, '.state', 'live.json'), node: plainNode, onEvents, chatsEveryMs: 60000, debounceMs: 100, ...extra });
  lives.push(l);
  return l;
};

describe('live feed', () => {

  it('an idea state change is an update; a restart shows what changed while away', async () => {
    const root = tmpBrain();
    const a = make(root, () => {});
    await a.start(); a.stop();
    fs.writeFileSync(path.join(root, 'ideas.md'), fs.readFileSync(path.join(root, 'ideas.md'), 'utf8').replace('`aperta`', '`fatta`'));
    const got: RawEvent[] = [];
    const b = make(root, e => got.push(...e));
    await b.start();
    const e = got.find(x => x.kind === 'idea');
    expect(e?.away).toBe(true);
    expect(e?.update).toBe(true);
    expect(e?.title).toMatch(/aperta → fatta/);
  });

  it('quiet changes while away are not replayed', async () => {
    const root = tmpBrain();
    const a = make(root, () => {});
    await a.start(); a.stop();
    fs.writeFileSync(path.join(root, 'now.md'), '# Ora\n\n## Lavoro\n- **Filo nuovo** · repo · prossimo: provare · (2026-10-11)\n');
    const got: RawEvent[] = [];
    const b = make(root, e => got.push(...e));
    await b.start();
    expect(got).toEqual([]);
    b.stop();
  });

  it('ignores .git and worktree copies of the brain', async () => {
    const root = tmpBrain();
    const got: RawEvent[] = [];
    const l = make(root, e => got.push(...e));
    await l.start();
    l.changed('.git/index');
    l.changed('.claude/worktrees/x/ideas.md');
    await new Promise(r => setTimeout(r, 300));
    expect(got).toEqual([]);
  });

  it('without the brain parsers it still starts (chats and mail only)', async () => {
    const root = tmpBrain({ parsers: false });
    const got: RawEvent[] = [];
    await make(root, e => got.push(...e)).start();
    fs.appendFileSync(path.join(root, 'ideas.md'), '\n## 2026-10-11 · [personale] · X · `aperta`\n');
    await new Promise(r => setTimeout(r, 400));
    expect(got).toEqual([]);
  });

  it('chat transitions: running → waiting is urgent, running → done is quiet (center only, 2026-10-13), waiting → waiting is nothing', () => {
    const list = (s: string) => parseChatList(`- Claude · OS · Prova · brain · 11/10, 09:00 · ${s} · id abc123`);
    expect(diffChats(null, list('aspetta te (domanda)'))).toEqual([]);
    const before = new Map(list('in corso').map(c => [c.id, c]));
    const w = diffChats(before, list('aspetta te (domanda)'));
    expect(w[0]!.kind).toBe('chat-waiting');
    expect(stamp(w[0]!).priority).toBe('urgent');
    const d = diffChats(before, list('finito'));
    expect(d[0]!.kind).toBe('chat-done');
    expect(stamp(d[0]!).priority).toBe('quiet');
    expect(diffChats(new Map(list('aspetta te (domanda)').map(c => [c.id, c])), list('aspetta te (domanda)'))).toEqual([]);
  });

  it('stamp gives Italian labels and kind priorities; overrides win; unknown kinds are quiet', () => {
    expect(stamp({ kind: 'idea', title: 't' })).toMatchObject({ label: 'Idea aggiunta', priority: 'normal', detail: '' });
    expect(stamp({ kind: 'budget', title: 't', priority: 'urgent' }).priority).toBe('urgent');
    expect(stamp({ kind: 'mystery', title: 't' })).toMatchObject({ label: 'mystery', priority: 'quiet' });
  });
});
