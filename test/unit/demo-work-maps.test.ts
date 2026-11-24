// Unit tests of the demo's work maps (src/main/demo-work-maps.ts, ADR 0343): added as the demo does they give more than
// twenty maps in every state, with one a replan waits on; in English no text of theirs stays Italian.
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
import { WORK_MAP_STATES, type WorkMap } from '../../src/shared/work-map';
import { demoWorkMaps } from '../../src/main/demo-work-maps';
import { WORK_MAPS_EN } from '../../src/main/demo-work-maps-text';
import { setDemoLang } from '../../src/main/demo-text';
import { WorkMaps } from '../../src/main/workmap/service';

const E = Date.UTC(2026, 9, 11, 8, 30, 0);
afterEach(() => setDemoLang('it'));

describe('the demo\'s work maps', () => {
  it('are many, in every state', async () => {
    const d = demoWorkMaps(E), saved = new Map<string, WorkMap>(), chats = new Map<string, ChatSummary>();
    let at = E, n = 0;
    const none = async () => {};
    const maps = new WorkMaps({ store: { load: () => [], save: m => { saved.set(m.id, m); }, history: () => [], version: () => null }, emit: () => {}, now: () => at, newId: () => `wm_demo${String(n++).padStart(3, '0')}`,
      chats: { list: () => [...chats.values()], planDecide: none, planStart: none, planStop: none, planResume: none, planReplan: none, planPutAway: () => {} } });
    for (const i of d.ideas) { at = i.at; maps.idea(i); }
    for (const j of d.jobs) {
      at = j.at; chats.set(j.chat.id, j.chat); maps.observe('chat:updated', j.chat);
      if (j.then) await maps.act(maps.ofChat(j.chat.id)!.id, j.then);
    }
    const all = [...maps.list(), ...maps.list({ archived: true })];
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(new Set(all.map(m => m.state))).toEqual(new Set(WORK_MAP_STATES));
    expect(all.filter(m => m.replanned)).toHaveLength(1);
    expect(new Set(all.map(m => m.project)).size).toBe(3);
    expect(new Set(all.map(m => m.updatedAt)).size).toBe(all.length); // one order, whatever the ids are
    expect(all.every(m => m.updatedAt <= E)).toBe(true);
  });
  it('have their English', () => {
    setDemoLang('en');
    const d = demoWorkMaps(E), left = JSON.stringify(d);
    for (const it of Object.keys(WORK_MAPS_EN)) expect(left.includes(JSON.stringify(it)), it).toBe(false);
    const texts = [...d.ideas.flatMap(i => [i.title, i.idea ?? '']), ...d.jobs.flatMap(j => [j.chat.title, j.chat.run!.goal, ...j.chat.plan!.steps.flatMap(s => [s.title, s.detail ?? ''])])].filter(Boolean);
    const english = new Set(Object.values(WORK_MAPS_EN));
    expect(texts.filter(t => !english.has(t))).toEqual([]);
  });
});
