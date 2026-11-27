// The Orchestrator's topics on disk and at run time (ADR 0369): topics, the topic of each message found again after a
// restart by its text and time, chats joining a topic, an unreadable file never overwritten; the service's rules,
// the lightest model only when unsure (its move never undoes the user's own), and the user's move.
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrchestratorTopicStore, TOPIC_OPEN_MS, textKey } from '../../../src/main/agents/orchestrator-topic-store';
import { OrchestratorTopicService } from '../../../src/main/agents/orchestrator-topic-service';
import { tmp } from '../chats/helpers';
import path from 'node:path';

afterEach(() => { vi.restoreAllMocks(); });
const NOW = 1_800_000_000_000;

describe('the topic store', () => {
  it('keeps topics, marks and chat links across a restart', () => {
    const file = path.join(tmp('topics'), 'orchestrator-topics.json');
    let now = NOW;
    const a = new OrchestratorTopicStore(file, () => now);
    expect(a.touch('  [Air 401] ', NOW, 'controlla   air')).toBe('Air 401');
    expect(a.touch('air 401', NOW + 10)).toBe('Air 401'); // the same topic, its own spelling
    a.mark('controlla air-mcp-test\n\n[app · hint]', NOW, 'Air 401', 'new');
    a.linkChat('c-1', 'Air 401');
    a.flush();
    const b = new OrchestratorTopicStore(file, () => now);
    expect(b.list()).toEqual([{ label: 'Air 401', createdAt: NOW, lastAt: NOW + 10, chatIds: ['c-1'], open: true, gist: 'controlla air' }]);
    // a transcript's item: other id, a slightly different time, the same first words
    expect(b.recall('controlla air-mcp-test\n\n[app · hint]', NOW + 900)).toEqual({ topic: 'Air 401', by: 'new' });
    expect(b.recall('altro', NOW)).toBeNull();
    expect(b.chatTopic('c-1')).toBe('Air 401');
    now = NOW + TOPIC_OPEN_MS + 11;
    expect(b.list()[0]!.open).toBe(false);
    expect(b.openLabels()).toEqual([]);
  });

  it('moves a chat from one topic to another, and a mark of the same message is replaced', () => {
    const s = new OrchestratorTopicStore(null, () => NOW);
    s.linkChat('c-1', 'A'.repeat(2));
    s.linkChat('c-1', 'Bb');
    expect(s.list().find(t => t.label === 'AA')!.chatIds).toEqual([]);
    expect(s.list().find(t => t.label === 'Bb')!.chatIds).toEqual(['c-1']);
    s.mark('ciao', NOW, 'AA', 'new');
    s.mark('ciao', NOW + 1000, 'Bb', 'user');
    expect(s.recall('ciao', NOW)).toEqual({ topic: 'Bb', by: 'user' });
    expect(textKey('a  b\n c')).toBe(textKey('a b c'));
    expect(() => s.touch('[ ]')).toThrow();
  });

  it('never overwrites a file it could not read', () => {
    const file = path.join(tmp('topics-bad'), 'orchestrator-topics.json');
    fs.writeFileSync(file, '{not json');
    const s = new OrchestratorTopicStore(file, () => NOW);
    s.touch('Nuovo', NOW);
    s.flush();
    expect(fs.readFileSync(file, 'utf8')).toBe('{not json');
    expect(s.list().map(t => t.label)).toEqual(['Nuovo']);
  });
});

describe('the topic service', () => {
  const world = { items: [], chats: [{ id: 'c-air', title: 'Fix air-mcp-test' }], questions: [] };

  it('the rules choose at once; the lightest model moves an unsure message later, never after the user moved it', async () => {
    const store = new OrchestratorTopicStore(null, () => NOW), emitted: number[] = [];
    let answer = 'Air 401';
    const classify = vi.fn(async () => answer);
    const svc = new OrchestratorTopicService({ store, classify, emit: t => emitted.push(t.topics.length), now: () => NOW });
    svc.linkChat('o', 'c-air', 'Air 401');
    svc.assign('o', 'prepara il piano della nuova UI', NOW, world); // a second topic
    // sure (named): the model is not asked
    const named = svc.assign('o', 'novità su Fix air-mcp-test?', NOW + 1, world, () => { throw new Error('not asked'); });
    expect(named).toMatchObject({ topic: 'Air 401', by: 'named', sure: true });
    expect(classify).not.toHaveBeenCalled();
    // unsure: goes as a new topic now, then moves to the model's pick
    const moved: string[] = [];
    const a = svc.assign('o', 'controlla anche il token del login', NOW + 2, world, t => moved.push(t));
    expect(a).toMatchObject({ by: 'new', sure: false });
    await new Promise(r => setImmediate(r));
    expect(moved).toEqual(['Air 401']);
    expect(store.recall('controlla anche il token del login', NOW + 2)).toEqual({ topic: 'Air 401', by: 'model' });
    // the user's move wins over a later model answer
    const late: string[] = [];
    let release!: () => void;
    classify.mockImplementationOnce(() => new Promise(r => { release = () => r('Air 401'); }));
    svc.assign('o', 'e la fattura di ottobre', NOW + 3, world, t => late.push(t));
    expect(svc.move('o', 'e la fattura di ottobre', NOW + 3, 'Fatture')).toBe('Fatture');
    release();
    await new Promise(r => setImmediate(r));
    expect(late).toEqual([]);
    expect(store.recall('e la fattura di ottobre', NOW + 3)).toEqual({ topic: 'Fatture', by: 'user' });
    // a model that answers something else, or fails, leaves the rules' choice
    answer = 'boh';
    const none: string[] = [];
    svc.assign('o', 'ancora una cosa diversa da tutto', NOW + 4, world, t => none.push(t));
    classify.mockRejectedValueOnce(new Error('offline'));
    svc.assign('o', 'e poi un\'altra ancora diversa', NOW + 5, world, t => none.push(t));
    await new Promise(r => setImmediate(r));
    expect(none).toEqual([]);
    expect(emitted.length).toBeGreaterThan(3);
  });

  it('tags a chat\'s mail and results with that chat\'s topic, replies with the turn\'s, his old messages by their mark', () => {
    const store = new OrchestratorTopicStore(null, () => NOW);
    const svc = new OrchestratorTopicService({ store });
    svc.linkChat('o', 'c-air', 'Air 401');
    svc.assign('o', 'organizza la settimana', NOW, world);
    const chat = () => 'Air 401';
    expect(svc.itemTopic({ kind: 'user', id: 'm', at: NOW, text: 'fatto', from: 'Fix air-mcp-test' }, 'X', chat)).toEqual({ topic: 'Air 401', by: 'chat' });
    expect(svc.itemTopic({ kind: 'assistant', id: 'a', at: NOW, text: 'ok' }, 'Turno', () => undefined)).toEqual({ topic: 'Turno' });
    expect(svc.itemTopic({ kind: 'user', id: 'h-1', at: NOW + 500, text: 'organizza la settimana' }, undefined, () => undefined)).toMatchObject({ topic: 'Organizza settimana' });
    expect(svc.itemTopic({ kind: 'user', id: 'h-2', at: NOW, text: 'ciao', topic: 'Già' }, undefined, chat)).toBeNull();
    expect(svc.itemTopic({ kind: 'tool', id: 't', at: NOW, name: 'Bash', summary: '', input: {}, status: 'ok' }, 'Turno', chat)).toBeNull();
  });
});
