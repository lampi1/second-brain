// The Orchestrator's topics and rollover inside the chat manager (ADR 0369), on an in-process fake ACP engine (no real
// process, no tokens): each of the user's messages carries its topic, its replies and a chat's mail theirs, the user
// moves one with one click, and an idle ACP Orchestrator past its budget or switching topic starts a fresh session whose
// first message carries the role text and the per-topic brief. The rule itself (rolloverDue) is tested apart.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { OrchestratorTopicService, type TopicClassifier } from '../../../src/main/agents/orchestrator-topic-service';
import type { TopicAssignment } from '../../../src/main/agents/orchestrator-topics';
import { HandoffStore } from '../../../src/main/chats/handoff';
import { OrchestratorTopicStore } from '../../../src/main/agents/orchestrator-topic-store';
import { BRIEF_START } from '../../../src/main/agents/orchestrator-brief';
import { ROLLOVER_NOTE, ROLLOVER_POLICY, rolloverDue } from '../../../src/main/chats/orchestrator-rollover';
import type { ChatItem, OrchestratorTopics, PendingRequest } from '../../../src/shared/contract';
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
  it('rolls only a session grown since its first turn, and a fresh session takes its minimum of messages first', () => {
    const ctx = acp.budget + 5_000, base = { kind: 'acp', contextTokens: ctx, topicChanged: false, idle: true };
    // a fresh session already this large (the role, the brief, the engine's tools) does not roll for that alone
    expect(rolloverDue({ ...base, baseTokens: ctx, turns: acp.minTurns })).toBeNull();
    expect(rolloverDue({ ...base, baseTokens: ctx - acp.minGrowth + 1, turns: acp.minTurns })).toBeNull();
    expect(rolloverDue({ ...base, baseTokens: ctx - acp.minGrowth, turns: acp.minTurns })).toBe('budget');
    expect(rolloverDue({ ...base, contextTokens: acp.topicSwitch, topicChanged: true, baseTokens: acp.topicSwitch - acp.minGrowth, turns: acp.minTurns })).toBe('topic');
    // fewer messages than the minimum since the last rollover: never, whatever the size
    expect(rolloverDue({ ...base, contextTokens: 900_000, topicChanged: true, baseTokens: 5_000, turns: acp.minTurns - 1 })).toBeNull();
    // nothing known of the session (a restart, a session the app did not start): its reported size decides
    expect(rolloverDue(base)).toBe('budget');
  });
});

/** The rules' answer, rewritten (a guess the tests need: an answer to a chat's question, an unsure new topic). */
class SteeredTopics extends OrchestratorTopicService {
  steer: ((a: TopicAssignment) => TopicAssignment) | null = null;
  override assign(...args: Parameters<OrchestratorTopicService['assign']>): TopicAssignment {
    const a = super.assign(...args);
    return this.steer ? this.steer(a) : a;
  }
}

interface FixtureOpts { userData?: string; store?: OrchestratorTopicStore; classify?: TopicClassifier; closeGate?: Promise<void>; failStart?: () => boolean; onClose?: (s: SessionSink) => void }

/** An Orchestrator on a fake ACP engine: each message is answered at once and reports `context()` tokens. */
function fixture(fo: FixtureOpts = {}) {
  const userData = fo.userData ?? tmp('roll-ud'), cwd = tmp('roll-cwd'), brain = tmp('roll-brain');
  fs.writeFileSync(path.join(brain, 'now.md'), '- restyle · angoli 3/4/6px\n');
  const sent: string[] = [], starts: SessionOptions[] = [], events: OrchestratorTopics[] = [], replaced: ChatItem[] = [];
  let ctx = 10_000, n = 0;
  const topics = new SteeredTopics({ store: fo.store ?? new OrchestratorTopicStore(null), emit: t => events.push(t), ...(fo.classify ? { classify: fo.classify } : {}) });
  const m = new ChatManager({
    userData, coldEveryMs: 0, runEveryMs: 0, topics, orchestratorEssentials: () => fs.readFileSync(path.join(brain, 'now.md'), 'utf8'),
    emitter: { emit(ch: string, p: unknown) { if (ch === 'chat:item' && (p as { replace?: boolean }).replace) replaced.push((p as { item: ChatItem }).item); } },
    sessionFactory: (_h, o: SessionOptions, s: SessionSink) => {
      starts.push(o);
      let alive = true;
      const id = o.sessionId ?? `ses_${starts.length}`;
      return {
        harness: 'opencode', sessionId: id, pid: null, root: null, get alive() { return alive; }, busy: false,
        start() {
          if (fo.failStart?.()) { alive = false; s.exit({ code: 1, error: 'Avvio non riuscito.' }); return; }
          s.changed({ sessionId: id, state: 'idle' });
        },
        send(text: string) {
          sent.push(text); n++;
          s.changed({ state: 'running' });
          const ask = /CHIEDI-(PERMESSO|DOMANDA)/.exec(text)?.[1];
          if (ask) s.pending({ id: `q${n}`, type: ask === 'PERMESSO' ? 'permission' : 'question', tool: ask === 'PERMESSO' ? 'Bash' : 'AskUserQuestion', title: 'procedo?', detail: '', input: {}, at: Date.now() });
          s.item({ kind: 'assistant', id: `a${n}`, at: Date.now(), text: `risposta ${n}` }, false);
          s.item({ kind: 'result', id: `r${n}`, at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
          s.changed({ state: 'idle', contextTokens: ctx, contextMaxTokens: 1_000_000, contextEstimated: false });
        },
        async close() { if (fo.closeGate) await fo.closeGate; alive = false; s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); fo.onClose?.(s); },
        killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    },
  });
  managers.push(m);
  return { m, cwd, userData, topics, sent, starts, events, replaced, setContext: (v: number) => { ctx = v; } };
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
    // a new subject the rules only guess (not sure, the model may still move it): same session, past the threshold as it is
    await f.m.send(o.id, 'ora un\'altra cosa: scrivi la mail al commercialista per le fatture di ottobre');
    expect(f.starts).toHaveLength(1);
    expect(own(f.m, o.id).at(-1)).toMatchObject({ topic: 'Mail commercialista fatture', topicBy: 'new' });
    // a sure switch (he names the other topic): a fresh session
    await f.m.send(o.id, 'torniamo su Air-mcp-test 401: il login ora funziona?');
    expect(f.starts).toHaveLength(2);
    expect(f.starts[1]!.sessionId).toBeNull(); // session/new, never a load of the old one
    expect(f.starts[1]!.resume).toBe(false);
    const seeded = f.sent.at(-1)!;
    expect(seeded).toContain('[Role supplied by the app: Orchestrator]');
    expect(seeded).toContain(ROLLOVER_NOTE);
    expect(seeded).toContain(BRIEF_START);
    expect(seeded).toContain('restyle · angoli 3/4/6px'); // now.md essentials
    expect(seeded).toContain('- «Mail commercialista fatture»: last: "ora un\'altra cosa: scrivi la mail al commercialista per le fatture di ottobre"'); // the other topic, in one line
    expect(seeded).toContain('Current topic: «Air-mcp-test 401»');
    expect(seeded).toContain('- user: e il token è stato rinnovato?'); // its own exchanges
    expect(seeded.endsWith('il login ora funziona?') || seeded.includes('il login ora funziona?\n')).toBe(true);
    expect(f.m.items(o.id).some(i => i.kind === 'system' && !!i.continued)).toBe(true);
    expect(f.m.list().find(c => c.id === o.id)!.contextTokens).toBe(ROLLOVER_POLICY.acp!.topicSwitch + 1); // reported by the new turn
    // same topic, still under the budget: same session
    await f.m.send(o.id, 'aggiungi anche gli allegati');
    expect(f.starts).toHaveLength(2);
    // grown past the budget since the fresh session's first turn, same topic: fresh again, once it took its minimum
    f.setContext(ROLLOVER_POLICY.acp!.topicSwitch + 1 + ROLLOVER_POLICY.acp!.budget);
    await f.m.send(o.id, 'e mandala domattina');
    expect(f.starts).toHaveLength(2);
    await f.m.send(o.id, 'grazie, e ricordamelo');
    expect(f.starts).toHaveLength(3);
    expect(f.sent.at(-1)).toContain(BRIEF_START);
    expect(f.sent.at(-1)).toContain('Current topic: «');
  });

  it('a short «sì» goes to the chat that asks a question, never to one that waits for a permission', async () => {
    for (const [ask, by] of [['PERMESSO', 'new'], ['DOMANDA', 'question']] as const) {
      const f = fixture();
      const work = await f.m.create({ harness: 'opencode', cwd: f.cwd, title: 'Fix air-mcp-test', prompt: `indaga CHIEDI-${ask}` });
      f.topics.linkChat('o', work.id, 'Air 401');
      const o = await f.m.create({ harness: 'opencode', cwd: f.cwd, orchestrator: true, prompt: 'sì' });
      expect(own(f.m, o.id)[0]).toMatchObject({ topicBy: by });
      if (by === 'question') expect(own(f.m, o.id)[0]!.topic).toBe('Air 401');
    }
  });

  it('never rolls over on the rules\' guess: an answer to another chat\'s question, or an unsure choice', async () => {
    const f = fixture();
    const o = await f.m.create({ harness: 'opencode', cwd: f.cwd, orchestrator: true, prompt: 'controlla perché air-mcp-test risponde 401' });
    f.setContext(ROLLOVER_POLICY.acp!.topicSwitch + 1);
    await f.m.send(o.id, 'e il token è stato rinnovato?');
    f.topics.steer = a => ({ ...a, topic: 'Fatture ottobre', by: 'question', sure: true });
    await f.m.send(o.id, 'sì');
    f.topics.steer = a => ({ ...a, topic: 'Restyle UI', by: 'named', sure: false });
    await f.m.send(o.id, 'e gli angoli?');
    expect(f.starts).toHaveLength(1);
    // a sure switch: rolled
    f.topics.steer = a => ({ ...a, topic: 'Air 401', by: 'named', sure: true });
    await f.m.send(o.id, 'e su Air 401?');
    expect(f.starts).toHaveLength(2);
  });

  it('a fresh session already large does not roll again on every message: its growth counts', async () => {
    const f = fixture();
    f.setContext(ROLLOVER_POLICY.acp!.budget + 10_000); // the engine's own overhead, whatever the history
    const o = await f.m.create({ harness: 'opencode', cwd: f.cwd, orchestrator: true, prompt: 'controlla perché air-mcp-test risponde 401' });
    await f.m.send(o.id, 'e il token è stato rinnovato?');
    expect(f.starts).toHaveLength(2); // a session the app knows nothing of: its size decides
    for (const t of ['e il login?', 'e i log del server?', 'e la cache?', 'e il deploy?', 'e i test?', 'ok, chiudi tu']) await f.m.send(o.id, t);
    expect(f.starts).toHaveLength(2);
    // it grows past the budget over its baseline: rolled again
    f.setContext(2 * ROLLOVER_POLICY.acp!.budget + 10_000);
    await f.m.send(o.id, 'riassumi');
    await f.m.send(o.id, 'grazie');
    expect(f.starts).toHaveLength(3);
  });

  it('rolls on the first message after a restart when the resumed session is over its budget', async () => {
    const a = fixture();
    const o = await a.m.create({ harness: 'opencode', cwd: a.cwd, orchestrator: true, prompt: 'controlla perché air-mcp-test risponde 401' });
    a.setContext(ROLLOVER_POLICY.acp!.budget + 1);
    await a.m.send(o.id, 'e il token è stato rinnovato?');
    expect(a.starts).toHaveLength(1);
    await a.m.shutdown();
    const b = fixture({ userData: a.userData });
    expect(b.m.list().find(c => c.id === o.id)!.contextTokens).toBe(ROLLOVER_POLICY.acp!.budget + 1);
    await b.m.send(o.id, 'e adesso il login funziona?');
    expect(b.starts).toHaveLength(1);
    expect(b.starts[0]!.sessionId).toBeNull(); // a fresh session, never the large one resumed
    expect(b.sent.at(-1)).toContain(ROLLOVER_NOTE);
    expect(b.sent.at(-1)).toContain(BRIEF_START);
  });

  it('a fresh session that does not start puts back the old one and the chat\'s own hand-off note', async () => {
    for (const before of [true, false, 'unreadable'] as const) {
      let fail = false;
      const f = fixture({ failStart: () => fail });
      const o = await f.m.create({ harness: 'opencode', cwd: f.cwd, orchestrator: true, prompt: 'controlla perché air-mcp-test risponde 401' });
      const notes = new HandoffStore(f.userData);
      if (before === true) notes.write(o.id, { title: 'Orchestrator', text: 'la nota di prima', at: 1234, source: 'chat' });
      // a note the app cannot parse (read() says null, as for none): kept byte for byte, never deleted
      if (before === 'unreadable') { fs.mkdirSync(notes.dir, { recursive: true }); fs.writeFileSync(notes.pathOf(o.id), 'scritta a mano\n'); }
      f.setContext(ROLLOVER_POLICY.acp!.budget + 1);
      await f.m.send(o.id, 'e il token è stato rinnovato?');
      fail = true;
      await f.m.send(o.id, 'e il login?').catch(() => null);
      expect(f.starts.length).toBeGreaterThanOrEqual(2); // the fresh session was tried
      expect(f.m.list().find(c => c.id === o.id)!.contextTokens).toBe(ROLLOVER_POLICY.acp!.budget + 1);
      if (before === true) expect(notes.read(o.id)).toMatchObject({ text: 'la nota di prima', at: 1234, source: 'chat' });
      else if (before === 'unreadable') expect(fs.readFileSync(notes.pathOf(o.id), 'utf8')).toBe('scritta a mano\n');
      else expect(fs.existsSync(notes.pathOf(o.id))).toBe(false);
    }
  });

  it('the light model\'s choice made while the engine starts lands on the message, and the guessed topic goes', async () => {
    let open!: () => void;
    const gate = new Promise<void>(r => { open = r; });
    let answer = 'NEW: Restyle';
    const store = new OrchestratorTopicStore(null);
    const f = fixture({ store, closeGate: gate, classify: async () => answer });
    const o = await f.m.create({ harness: 'opencode', cwd: f.cwd, orchestrator: true, prompt: 'controlla perché air-mcp-test risponde 401' });
    const air = own(f.m, o.id)[0]!.topic!;
    f.setContext(ROLLOVER_POLICY.acp!.budget + 1);
    await f.m.send(o.id, 'prepara il piano per la nuova UI squadrata con angoli arrotondati');
    await new Promise(r => setImmediate(r));
    answer = air;
    // past the budget: the old session ends (held here) while the model answers
    const p = f.m.send(o.id, 'scrivi la mail al commercialista per le fatture di ottobre');
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
    expect(own(f.m, o.id)).toHaveLength(2); // not added yet
    open();
    await p;
    const msg = own(f.m, o.id).at(-1)!;
    expect(msg).toMatchObject({ topic: air, topicBy: 'model' });
    expect(store.recall(msg.text, msg.at, msg.id)).toEqual({ topic: air, by: 'model' });
    expect(f.m.items(o.id).filter(i => i.kind === 'assistant').at(-1)).toMatchObject({ topic: air });
    expect(f.sent.at(-1)).toContain(`Current topic: «${air}»`);
    expect(store.has('Mail commercialista fatture')).toBe(false);
  });

  it('moving a reply moves the message it answers and its replies only, never a chat\'s mail in between', async () => {
    const f = fixture();
    const o = await f.m.create({ harness: 'opencode', cwd: f.cwd, orchestrator: true, prompt: 'controlla perché air-mcp-test risponde 401' });
    const air = own(f.m, o.id)[0]!.topic!;
    const work = await f.m.create({ harness: 'opencode', cwd: f.cwd, title: 'Fix air-mcp-test', prompt: 'indaga' }, 'agent');
    await f.m.send(o.id, 'Token scaduto, rinnovato.', undefined, false, 'Fix air-mcp-test', false, { kind: 'chat', chatId: work.id });
    const items = f.m.items(o.id);
    const u1 = items.find(i => i.kind === 'user' && !i.from)!, a1 = items.find(i => i.kind === 'assistant')!;
    const mail = items.find(i => i.kind === 'user' && !!i.from)!, a2 = items.filter(i => i.kind === 'assistant').at(-1)!;
    expect(a2.id).not.toBe(a1.id);
    f.m.setItemTopic(o.id, a1.id, 'Restyle UI');
    const at = (id: string) => f.m.items(o.id).find(i => i.id === id) as { topic?: string };
    expect([at(u1.id).topic, at(a1.id).topic, at(mail.id).topic, at(a2.id).topic]).toEqual(['Restyle UI', 'Restyle UI', air, air]);
    f.m.setItemTopic(o.id, a2.id, 'Fatture');
    expect([at(u1.id).topic, at(a1.id).topic, at(mail.id).topic, at(a2.id).topic]).toEqual(['Restyle UI', 'Restyle UI', 'Fatture', 'Fatture']);
  });

  it('his moves of his own turn and of a mail-led one come back when the transcript is read again', async () => {
    const f = fixture();
    const o = await f.m.create({ harness: 'opencode', cwd: f.cwd, orchestrator: true, prompt: 'controlla perché air-mcp-test risponde 401' });
    const work = await f.m.create({ harness: 'opencode', cwd: f.cwd, title: 'Fix air-mcp-test', prompt: 'indaga' }, 'agent');
    await f.m.send(o.id, 'Token scaduto, rinnovato.', undefined, false, 'Fix air-mcp-test', false, { kind: 'chat', chatId: work.id });
    const replies = f.m.items(o.id).filter(i => i.kind === 'assistant');
    f.m.setItemTopic(o.id, replies[0]!.id, 'Restyle UI');
    f.m.setItemTopic(o.id, replies.at(-1)!.id, 'Fatture');
    // the transcript read back after a restart: the same messages, other ids, no topics (ManagerPersistence.ensureHistory)
    const r = (f.m as unknown as { chats: Map<string, { items: ChatItem[]; turnTopic?: string }> }).chats.get(o.id)!;
    const live = r.items.filter(i => i.kind === 'user' || i.kind === 'assistant');
    r.items = live.map((i, n) => { const { topic: _t, ...rest } = i as ChatItem & { topic?: string; topicBy?: string }; delete (rest as { topicBy?: string }).topicBy; return { ...rest, id: `h-${n}`, at: i.at + 700 } as ChatItem; });
    (f.m as unknown as { tagHistory(r: unknown): void }).tagHistory(r);
    const mailAt = r.items.findIndex(i => i.kind === 'user' && !!i.from);
    expect(mailAt).toBeGreaterThan(0);
    expect(r.items.map(i => (i as { topic?: string }).topic)).toEqual(r.items.map((_, n) => (n < mailAt ? 'Restyle UI' : 'Fatture')));
    expect(r.items[mailAt]).toMatchObject({ topicBy: 'user' });
  });

  it('a question that comes while the old session closes keeps it, and its hand-off note as it was', async () => {
    let ask = false, oid = '';
    // the chat's own record, as the manager holds it: a question lands on it while the old session closes
    const rec = (m: ChatManager) => (m as unknown as { chats: Map<string, { pending: Map<string, PendingRequest> }> }).chats.get(oid)!;
    const hold: { m?: ChatManager } = {};
    const f = fixture({ onClose: () => { if (ask) rec(hold.m!).pending.set('q-late', { id: 'q-late', chatId: oid, type: 'question', tool: 'AskUserQuestion', title: 'procedo?', detail: '', input: {}, at: Date.now() }); } });
    hold.m = f.m;
    const o = await f.m.create({ harness: 'opencode', cwd: f.cwd, orchestrator: true, prompt: 'controlla perché air-mcp-test risponde 401' });
    oid = o.id;
    const notes = new HandoffStore(f.userData);
    notes.write(o.id, { title: 'Orchestrator', text: 'la nota di prima', at: 1234, source: 'chat' });
    const raw = fs.readFileSync(notes.pathOf(o.id), 'utf8');
    f.setContext(ROLLOVER_POLICY.acp!.budget + 1);
    await f.m.send(o.id, 'e il token è stato rinnovato?');
    ask = true;
    await f.m.send(o.id, 'e il login?').catch(() => null);
    expect(rec(f.m).pending.has('q-late')).toBe(true); // the abort path: a question came while it closed
    expect(f.starts.map(s => s.sessionId)).toEqual([null, 'ses_1']); // the old session resumed, never a fresh one
    expect(fs.readFileSync(notes.pathOf(o.id), 'utf8')).toBe(raw);
  });
});
