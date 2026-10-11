// Unit tests of the demo data source (src/main/demo.ts), frozen (instant, deterministic) and live (fake timers):
// the seed is rich and stable, answering resolves and continues the chat, stop/send/create behave like the service.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventMap } from '@shared/contract';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DemoBrain, DemoChats, FROZEN_EPOCH, seed, type DemoAction } from '../../src/main/demo';
import { ConfigStore } from '../../src/main/brain/config';

type Ev = { ch: keyof EventMap; p: unknown };

function make(freeze = true) {
  const events: Ev[] = [];
  const acts: { tabId: string; a: DemoAction }[] = [];
  const now = freeze ? () => FROZEN_EPOCH : () => Date.now();
  const s = seed(now());
  const chats = new DemoChats((ch, p) => { events.push({ ch, p }); }, { freeze, now }, s);
  chats.browser = { act: (tabId, a) => acts.push({ tabId, a }), closeOwned: () => {} };
  const cfg = new ConfigStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-demo-')), {});
  const brain = new DemoBrain((ch, p) => { events.push({ ch, p }); }, chats, s, cfg);
  return { chats, brain, events, acts };
}
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

afterEach(() => { vi.useRealTimers(); });

describe('demo seed', () => {
  it('is a rich, deterministic state', () => {
    const a = seed(FROZEN_EPOCH);
    expect(seed(FROZEN_EPOCH)).toEqual(a);
    expect(a.chats.filter(c => c.isRegia)).toHaveLength(1);
    expect(new Set(a.chats.map(c => c.state))).toEqual(new Set(['waiting', 'running', 'idle']));
    expect(a.pending.map(p => p.type).sort()).toEqual(['permission', 'question', 'question']);
    expect(a.tabs.every(t => t.ownerChatId && a.chats.some(c => c.id === t.ownerChatId))).toBe(true);
    expect(a.items.fix!.some(i => i.kind === 'tool' && i.status === 'running')).toBe(true);
    expect(a.items.sms!.some(i => i.kind === 'assistant' && i.streaming)).toBe(true);
  });
});

describe('demo chats (frozen)', () => {
  it('answering the QA question resolves it and the chat carries on to idle, driving its browser', async () => {
    const { chats, events, acts } = make();
    await chats.answer('qa', 'qa-q1', { kind: 'question', answers: { 'Il test case 7 fallisce anche su master: cosa faccio?': 'Apro un bug e taggo la QA (consigliato)' } });
    await flush();
    expect(chats.pending().some(p => p.id === 'qa-q1')).toBe(false);
    expect(events.some(e => e.ch === 'pending:resolved')).toBe(true);
    expect(chats.list().find(c => c.id === 'qa')?.state).toBe('idle');
    expect(chats.items('qa').some(i => i.kind === 'tool' && i.name === 'mcp__tracker__create_bug' && i.status === 'ok')).toBe(true);
    expect(acts.some(x => x.tabId === 'tab-qa')).toBe(true);
  });

  it('denying a permission with a message continues with that message', async () => {
    const { chats } = make();
    await chats.answer('feedback', 'feedback-p1', { kind: 'permission', allow: false, message: 'prima la build' });
    await flush();
    const last = chats.items('feedback').filter(i => i.kind === 'assistant').pop();
    expect(last && 'text' in last ? last.text : '').toContain('prima la build');
  });

  it('stop ends a running chat: tools marked error, a notice, idle; stopAll counts the running ones', async () => {
    const { chats } = make();
    expect(await chats.stopAll()).toBe(2);
    const fix = chats.items('fix');
    expect(fix.some(i => i.kind === 'tool' && i.status === 'running')).toBe(false);
    expect(fix[fix.length - 1]).toMatchObject({ kind: 'system', level: 'warn' });
    expect(chats.list().filter(c => c.state === 'running')).toHaveLength(0);
  });

  it('send to an idle chat adds the user message and a reply; create starts a new chat', async () => {
    const { chats } = make();
    await chats.send('mappa', 'Aggiungi la legenda');
    await flush();
    const items = chats.items('mappa');
    expect(items.some(i => i.kind === 'user' && i.text === 'Aggiungi la legenda')).toBe(true);
    expect(chats.list().find(c => c.id === 'mappa')?.state).toBe('idle');
    const c = await chats.create({ harness: 'claude', cwd: 'C:\\lavoro\\brain', prompt: 'Ciao' });
    await flush();
    expect(chats.list().some(x => x.id === c.id)).toBe(true);
    expect(chats.items(c.id).some(i => i.kind === 'user')).toBe(true);
  });

  it('the Regia answers with the current picture', async () => {
    const { chats } = make();
    await chats.send('regia', 'Che si fa adesso?');
    await flush();
    const last = chats.items('regia').filter(i => i.kind === 'assistant').pop();
    expect(last && 'text' in last ? last.text : '').toMatch(/Ti aspettano \d/);
  });

  it('set changes model/effort/title and close removes the chat', async () => {
    const { chats, events } = make();
    const c = await chats.set('fix', { model: 'claude-sonnet-4-5', effort: 'low', title: 'Fix totale' });
    expect(c).toMatchObject({ model: 'claude-sonnet-4-5', effort: 'low', title: 'Fix totale' });
    await chats.close('mappa');
    expect(chats.list().some(x => x.id === 'mappa')).toBe(false);
    expect(events.some(e => e.ch === 'chat:removed')).toBe(true);
  });

  it('brain: feed, mute and usage that follows the chats\' cost', () => {
    const { brain } = make();
    expect(brain.feed().length).toBeGreaterThan(5);
    brain.mute('idea', true);
    expect(brain.feed().some(e => e.kind === 'idea')).toBe(false);
    expect(brain.usage().todayUsd).toBeCloseTo(38.2);
  });
});

describe('demo chats (live)', () => {
  it('the fix finishes its tests, then asks a permission; allowing it commits and ends idle', async () => {
    vi.useFakeTimers();
    const { chats } = make(false);
    chats.start();
    await vi.advanceTimersByTimeAsync(20_000);
    const perm = chats.pending().find(p => p.chatId === 'fix');
    expect(perm?.type).toBe('permission');
    expect(chats.items('fix').find(i => i.id === 'fix-t4')).toMatchObject({ status: 'ok' });
    await chats.answer('fix', perm!.id, { kind: 'permission', allow: true });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(chats.list().find(c => c.id === 'fix')?.state).toBe('idle');
    expect(chats.items('fix').some(i => i.kind === 'result')).toBe(true);
    await chats.shutdown();
  });

  it('streams assistant text in steps (streaming flag until the end)', async () => {
    vi.useFakeTimers();
    const { chats, events } = make(false);
    chats.start();
    await vi.advanceTimersByTimeAsync(3000);
    const sms = events.filter(e => e.ch === 'chat:item' && (e.p as { chatId: string }).chatId === 'sms');
    expect(sms.length).toBeGreaterThan(2);
    await chats.shutdown();
  });
});
