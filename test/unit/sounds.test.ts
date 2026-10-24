// The notification sounds (src/renderer/lib/sounds.ts) and notify's ring rule (lib/notice.ts uses it): every look
// has its own sound, recipes stay short and quiet, a burst rings once with its most important kind, the alerts that
// arrive by themselves ring with their kind's sound, a budget only at 100 %, and notify respects the switch, the mute
// and do-not-disturb (ADR 0151).
import { describe, expect, it } from 'vitest';
import { EVENT_SOUND, RECIPES, SOUND_OF, loudest, notifyRings, type SoundKind } from '../../src/renderer/lib/sounds';
import { toChime } from '../../src/renderer/lib/chime';

describe('notification sounds', () => {
  it('every look has a sound, and the sounds differ', () => {
    const kinds = Object.values(SOUND_OF);
    expect(new Set(kinds).size).toBe(6);
    const shapes = kinds.map(k => JSON.stringify(RECIPES[k]));
    expect(new Set(shapes).size).toBe(6);
  });
  it('each sound is short and quiet', () => {
    for (const k of Object.keys(RECIPES) as SoundKind[]) {
      const end = Math.max(...RECIPES[k].map(n => n.at + n.dur));
      expect(end).toBeLessThan(1.2);
      for (const n of RECIPES[k]) expect(n.vol).toBeLessThanOrEqual(0.13);
    }
  });
  it('a burst rings its most important kind', () => {
    expect(loudest(['info', 'error', 'success'])).toBe('error');
    expect(loudest(['success', 'attention'])).toBe('attention');
    expect(loudest([])).toBeNull();
  });
  it('alerts ring with their kind; a question rings from the request, not from chat-waiting; a budget only at 100 %', () => {
    expect(EVENT_SOUND['chat-failed']).toBe('error');
    expect(EVENT_SOUND['task-alert']).toBe('warn');
    expect(EVENT_SOUND['chat-waiting']).toBeUndefined();
    const on = { soundOn: true, muted: {}, dnd: false };
    const evs = [{ id: 'a', kind: 'chat-failed' }, { id: 'b', kind: 'budget', priority: 'normal' }, { id: 'c', kind: 'budget', priority: 'urgent' }, { id: 'd', kind: 'chat-done' }];
    expect(toChime(evs, new Set(), on)).toEqual(['a', 'c']);
  });
  it('notify rings unless asked not to, the sound is off, the kind is muted or do-not-disturb is on', () => {
    const on = { soundOn: true, muted: {}, dnd: false };
    expect(notifyRings({}, on)).toBe(true);
    expect(notifyRings({ sound: false }, on)).toBe(false);
    expect(notifyRings({}, { ...on, soundOn: false })).toBe(false);
    expect(notifyRings({}, { ...on, dnd: true })).toBe(false);
    expect(notifyRings({ muteKind: 'maintenance' }, { ...on, muted: { maintenance: true } })).toBe(false);
  });
});
