// Live feed (src/main/brain/live.ts) on temporary brain folders: baseline, new rows, updates, away diff, chat
// transitions, no parsers. Uses the brain's own parsers (fixture copy) and a fake chats.mjs run by plain Node.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Live, diffChats, parseChatList, stamp, type RawEvent } from '../../../src/main/brain/live';
import { plainNode, tmpBrain, until } from './helpers';

const lives: Live[] = [];
afterEach(() => { for (const l of lives.splice(0)) l.stop(); });
const make = (root: string, onEvents: (e: RawEvent[]) => void, extra: Partial<ConstructorParameters<typeof Live>[0]> = {}) => {
  const l = new Live({ root, stateFile: path.join(root, '.state', 'live.json'), node: plainNode, onEvents, chatsEveryMs: 60000, debounceMs: 100, ...extra });
  lives.push(l);
  return l;
};

describe('live feed', () => {
  it('baseline emits nothing, then a new AI idea and an error become events', async () => {
    const root = tmpBrain();
    const got: RawEvent[] = [];
    await make(root, e => got.push(...e)).start();
    await new Promise(r => setTimeout(r, 300));
    expect(got).toEqual([]);
    fs.appendFileSync(path.join(root, 'ideas.md'), '\n## 2026-10-11 · [personale] · Notifiche live · `aperta`\n- **Idea:** feed\n- **Fonte:** IA, chat X\n');
    fs.appendFileSync(path.join(root, 'ai-errors.md'), '- 2026-10-11 09:30 · Pers · app · codice · bug · detto: funziona · vero: non partiva · visto da: test\n');
    expect(await until(() => got.some(e => e.kind === 'idea') && got.some(e => e.kind === 'error'))).toBe(true);
    const idea = got.find(e => e.kind === 'idea')!;
    expect(idea.title).toBe('Notifiche live');
    expect(idea.who).toBe("dell'IA");
    expect(idea.file).toBe('ideas.md');
    const err = got.find(e => e.kind === 'error')!;
    expect(err.title).toBe('funziona');
    expect(err.detail).toBe('Vero: non partiva');
  });

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

  it('quiet changes while away are not replayed; playbooks and mail are quiet events', async () => {
    const root = tmpBrain();
    const a = make(root, () => {});
    await a.start(); a.stop();
    fs.writeFileSync(path.join(root, 'now.md'), '# Ora\n\n## Lavoro\n- **Filo nuovo** · repo · prossimo: provare · (2026-10-11)\n');
    const got: RawEvent[] = [];
    const b = make(root, e => got.push(...e));
    await b.start();
    expect(got).toEqual([]);
    fs.mkdirSync(path.join(root, 'playbooks'));
    fs.writeFileSync(path.join(root, 'playbooks', 'qa-webapp.md'), '# QA\n');
    expect(await until(() => got.some(e => e.kind === 'playbook'))).toBe(true);
    expect(got.find(e => e.kind === 'playbook')!.title).toBe('qa-webapp');
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

  it('polls chats.mjs: the first list is a baseline, then in corso → aspetta te is a chat-waiting event', async () => {
    const root = tmpBrain();
    const got: RawEvent[] = [];
    const l = make(root, e => got.push(...e), { chatsEveryMs: 250 });
    await l.start();
    expect(await until(() => l.chatPolls >= 1, 15000)).toBe(true); // the baseline list has been read
    expect(got).toEqual([]);
    fs.writeFileSync(path.join(root, 'chats.txt'), '- Claude · OS · Prova · brain · 11/10, 09:05 · aspetta te (domanda) · id abc123\n');
    expect(await until(() => got.some(e => e.kind === 'chat-waiting'), 8000)).toBe(true);
    expect(got.find(e => e.kind === 'chat-waiting')).toMatchObject({ title: 'OS · Prova', detail: 'domanda', chatId: 'abc123', who: 'Claude' });
  });

  it('a parser that throws once (file read mid-save) keeps the snapshot: old rows never come back as new', async () => {
    const root = tmpBrain({ parsers: false });
    // a brain whose ideas() parser throws on a half-written file
    fs.mkdirSync(path.join(root, 'ops', 'tools', 'brain-site'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ops', 'tools', 'brain-site', 'parse.mjs'),
      "export function ideas(t) { if (t.includes('BOOM')) throw new Error('half'); return [...t.matchAll(/^## (\\S+) · \\[\\w+\\] · (.+?) · `([^`]+)`/gm)].map(m => ({ data: m[1], titolo: m[2], stato: m[3], chi: 'utente' })); }\n");
    const stateFile = path.join(root, '.state', 'live.json');
    const got: RawEvent[] = [];
    await make(root, e => got.push(...e), { stateFile }).start();
    const good = fs.readFileSync(path.join(root, 'ideas.md'), 'utf8');
    fs.writeFileSync(path.join(root, 'ideas.md'), `${good}\nBOOM`);
    await new Promise(r => setTimeout(r, 400));
    fs.writeFileSync(path.join(root, 'ideas.md'), `${good}\n## 2026-10-11 · [personale] · Nuova · \`aperta\`\n`);
    expect(await until(() => got.length > 0)).toBe(true);
    await new Promise(r => setTimeout(r, 300));
    expect(got.map(e => e.title)).toEqual(['Nuova']);
    // a failure at start keeps the saved keys too: no "while away" flood after it
    lives.splice(0).forEach(l => l.stop());
    fs.writeFileSync(path.join(root, 'ideas.md'), `${good}\nBOOM`);
    const got2: RawEvent[] = [];
    await make(root, e => got2.push(...e), { stateFile }).start();
    lives.splice(0).forEach(l => l.stop());
    fs.writeFileSync(path.join(root, 'ideas.md'), `${good}\n## 2026-10-11 · [personale] · Nuova · \`aperta\`\n`);
    await make(root, e => got2.push(...e), { stateFile }).start();
    expect(got2).toEqual([]);
  });

  it('without the brain parsers it still starts (chats, playbooks and mail only)', async () => {
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
