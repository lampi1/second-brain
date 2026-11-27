// The Orchestrator's topics and rollover inside the chat manager (ADR 0369), on an in-process fake ACP engine (no real
// process, no tokens): each of the user's messages carries its topic, its replies and a chat's mail theirs, the user
// moves one with one click, and an idle ACP Orchestrator past its budget or switching topic starts a fresh session whose
// first message carries the role text and the per-topic brief. The rule itself (rolloverDue) is tested apart.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { OrchestratorTopicService } from '../../../src/main/agents/orchestrator-topic-service';
import { OrchestratorTopicStore } from '../../../src/main/agents/orchestrator-topic-store';
import { BRIEF_START } from '../../../src/main/agents/orchestrator-brief';
import { ROLLOVER_NOTE, ROLLOVER_POLICY, rolloverDue } from '../../../src/main/chats/orchestrator-rollover';
import type { ChatItem, OrchestratorTopics } from '../../../src/shared/contract';
import { tmp } from './helpers';

const managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); });

describe('rolloverDue', () => {
  const acp = ROLLOVER_POLICY.acp!;
  it('rolls an idle ACP engine past its budget, or on another topic past the smaller threshold', () => {
    const base = { kind: 'acp', contextTokens: acp.budget, topicChanged: false, idle: true };
    expect(rolloverDue(base)).toBe('budget');
    expect(rolloverDue({ ...base, contextTokens: acp.budget - 1 })).toBeNull();
    expect(rolloverDue({ ...base, contextTokens: acp.topicSwitch, topicChanged: true })).toBe('topic');
    expect(rolloverDue({ ...base, contextTokens: acp.topicSwitch - 1, topicChanged: true })).toBeNull();
  });
  it('never while busy, under Remote Control, with an unknown context, or on Claude/Codex (their own compaction)', () => {
    const base = { kind: 'acp', contextTokens: 500_000, topicChanged: true, idle: true };
    expect(rolloverDue({ ...base, idle: false })).toBeNull();
    expect(rolloverDue({ ...base, remote: true })).toBeNull();
    expect(rolloverDue({ ...base, contextTokens: 0 })).toBeNull();
    expect(rolloverDue({ ...base, contextTokens: Number.NaN })).toBeNull();
    for (const kind of ['claude', 'codex', 'api']) expect(rolloverDue({ ...base, kind })).toBeNull();
  });
});

/** An Orchestrator on a fake ACP engine: each message is answered at once and reports `context()` tokens. */
function fixture() {
  const userData = tmp('roll-ud'), cwd = tmp('roll-cwd'), brain = tmp('roll-brain');
  fs.writeFileSync(path.join(brain, 'now.md'), '- restyle · angoli 3/4/6px\n');
  const sent: string[] = [], starts: SessionOptions[] = [], events: OrchestratorTopics[] = [], replaced: ChatItem[] = [];
  let ctx = 10_000, n = 0;
  const topics = new OrchestratorTopicService({ store: new OrchestratorTopicStore(null), emit: t => events.push(t) });
  const m = new ChatManager({
    userData, coldEveryMs: 0, runEveryMs: 0, topics, orchestratorEssentials: () => fs.readFileSync(path.join(brain, 'now.md'), 'utf8'),
    emitter: { emit(ch: string, p: unknown) { if (ch === 'chat:item' && (p as { replace?: boolean }).replace) replaced.push((p as { item: ChatItem }).item); } },
    sessionFactory: (_h, o: SessionOptions, s: SessionSink) => {
      starts.push(o);
      let alive = true;
      const id = o.sessionId ?? `ses_${starts.length}`;
      return {
        harness: 'opencode', sessionId: id, pid: null, root: null, get alive() { return alive; }, busy: false,
        start() { s.changed({ sessionId: id, state: 'idle' }); },
        send(text: string) {
          sent.push(text); n++;
          s.changed({ state: 'running' });
          s.item({ kind: 'assistant', id: `a${n}`, at: Date.now(), text: `risposta ${n}` }, false);
          s.item({ kind: 'result', id: `r${n}`, at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
          s.changed({ state: 'idle', contextTokens: ctx, contextMaxTokens: 1_000_000, contextEstimated: false });
        },
        async close() { alive = false; s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); },
        killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    },
  });
  managers.push(m);
  return { m, cwd, sent, starts, events, replaced, setContext: (v: number) => { ctx = v; } };
}

const own = (m: ChatManager, id: string) => m.items(id).filter((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user' && !i.from);

describe('the Orchestrator\'s topics in the chat manager', () => {
  it('tags each message and its reply, a chat\'s mail with its topic, and moves a turn with one click', async () => {
    const f = fixture();
    const o = await f.m.create({ harness: 'opencode', cwd: f.cwd, orchestrator: true, prompt: 'controlla perché air-mcp-test risponde 401' });
    const first = own(f.m, o.id)[0]!;
    expect(first).toMatchObject({ topicBy: 'new' });
    const air = first.topic!;
    expect(f.m.items(o.id).find(i => i.kind === 'assistant')).toMatchObject({ topic: air });
    // a chat the Orchestrator starts in that turn joins the topic; its mail comes back tagged
    const work = await f.m.create({ harness: 'opencode', cwd: f.cwd, title: 'Fix air-mcp-test', prompt: 'indaga' }, 'agent');
    expect(f.m.topicsOf(o.id).topics.find(t => t.label === air)!.chatIds).toContain(work.id);
    await f.m.send(o.id, 'Token scaduto, rinnovato.', undefined, false, 'Fix air-mcp-test', false, { kind: 'chat', chatId: work.id });
    expect(f.m.items(o.id).filter(i => i.kind === 'user').at(-1)).toMatchObject({ from: 'Fix air-mcp-test', topic: air, topicBy: 'chat' });
    // a new subject opens a new topic; naming the chat brings him back
    await f.m.send(o.id, 'prepara il piano per la nuova UI squadrata con angoli arrotondati');
    const ui = own(f.m, o.id).at(-1)!.topic!;
    expect(ui).not.toBe(air);
    await f.m.send(o.id, 'novità su Fix air-mcp-test?');
    expect(own(f.m, o.id).at(-1)).toMatchObject({ topic: air, topicBy: 'named' });
    // his one-click move: the message and its reply go to the other topic
    const msg = own(f.m, o.id).at(-1)!;
    const after = f.m.setItemTopic(o.id, msg.id, ui);
    expect(after.topics.map(t => t.label)).toContain(ui);
    const items = f.m.items(o.id), at = items.findIndex(i => i.id === msg.id);
    expect(items[at]).toMatchObject({ topic: ui, topicBy: 'user' });
    expect(items.slice(at).find(i => i.kind === 'assistant')).toMatchObject({ topic: ui });
    expect(f.replaced.some(i => i.id === msg.id)).toBe(true);
    expect(f.events.length).toBeGreaterThan(0);
    // never on a work chat
    expect(f.m.topicsOf(work.id).topics).toEqual([]);
    expect(() => f.m.setItemTopic(work.id, 'x', ui)).toThrow();
  });

  it('rolls an idle ACP Orchestrator into a fresh session seeded with the role and the per-topic brief', async () => {
    const f = fixture();
    const o = await f.m.create({ harness: 'opencode', cwd: f.cwd, orchestrator: true, prompt: 'controlla perché air-mcp-test risponde 401' });
    expect(f.sent[0]).toContain('[Role supplied by the app: Orchestrator]');
    expect(f.sent[0]).not.toContain(BRIEF_START); // nothing to carry yet
    // this turn ends past the topic threshold, under the budget
    f.setContext(ROLLOVER_POLICY.acp!.topicSwitch + 1);
    await f.m.send(o.id, 'e il token è stato rinnovato?');
    expect(f.starts).toHaveLength(1);
    expect(f.sent[1]).not.toContain('[Role supplied by the app');
    // another topic: a fresh session
    await f.m.send(o.id, 'ora un\'altra cosa: scrivi la mail al commercialista per le fatture di ottobre');
    expect(f.starts).toHaveLength(2);
    expect(f.starts[1]!.sessionId).toBeNull(); // session/new, never a load of the old one
    expect(f.starts[1]!.resume).toBe(false);
    const seeded = f.sent.at(-1)!;
    expect(seeded).toContain('[Role supplied by the app: Orchestrator]');
    expect(seeded).toContain(ROLLOVER_NOTE);
    expect(seeded).toContain(BRIEF_START);
    expect(seeded).toContain('restyle · angoli 3/4/6px'); // now.md essentials
    expect(seeded).toContain('- «Air-mcp-test 401»: last: "e il token è stato rinnovato?"'); // the other topic, in one line
    expect(seeded).toContain('Current topic: «Mail commercialista fatture»');
    expect(seeded.endsWith('scrivi la mail al commercialista per le fatture di ottobre') || seeded.includes('fatture di ottobre\n')).toBe(true);
    expect(f.m.items(o.id).some(i => i.kind === 'system' && !!i.continued)).toBe(true);
    expect(f.m.list().find(c => c.id === o.id)!.contextTokens).toBe(ROLLOVER_POLICY.acp!.topicSwitch + 1); // reported by the new turn
    // same topic, still under the budget: same session
    await f.m.send(o.id, 'aggiungi anche gli allegati');
    expect(f.starts).toHaveLength(2);
    // past the budget, same topic: fresh again
    f.setContext(ROLLOVER_POLICY.acp!.budget);
    await f.m.send(o.id, 'e mandala domattina');
    await f.m.send(o.id, 'grazie, e ricordamelo');
    expect(f.starts).toHaveLength(3);
    expect(f.sent.at(-1)).toContain(BRIEF_START);
    expect(f.sent.at(-1)).toContain('Current topic: «');
  });
});
