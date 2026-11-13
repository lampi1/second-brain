// Saved Orchestrator preferences remain readable across layout changes and reject malformed values.
import { describe, expect, it } from 'vitest';
import { DEFAULT_V } from '../../src/renderer/lib/orchestrator-dock';
import { loadPrefs } from '../../src/renderer/store/ui';

describe('saved Orchestrator preferences', () => {
  it('remembers legacy choices; a first start opens the coordinator column', () => {
    const first = loadPrefs(null, 5000);
    expect(first).toMatchObject({ orchestratorOpen: true, orchestratorSize: null, orchestratorSeenAt: 5000 });
    expect(loadPrefs(JSON.stringify({orchestratorOpen:false}),5000)).toMatchObject({orchestratorOpen:false});
    const saved = loadPrefs(JSON.stringify({ orchestratorOpen: true, orchestratorSize: { w: 500, h: 420 }, orchestratorSizeV: DEFAULT_V, orchestratorSeenAt: 1234 }), 5000);
    expect(saved).toMatchObject({ orchestratorOpen: true, orchestratorSize: { w: 500, h: 420 }, orchestratorSeenAt: 1234 });
  });

  it('a size saved under the old default (narrow and tall) goes back to the new default once', () => {
    const old = loadPrefs(JSON.stringify({ orchestratorOpen: true, orchestratorSize: { w: 440, h: 650 } }), 0);
    expect(old).toMatchObject({ orchestratorOpen: true, orchestratorSize: null, orchestratorSizeV: DEFAULT_V });
    // saved again with the version: kept from now on
    expect(loadPrefs(JSON.stringify({ ...old, orchestratorSize: { w: 600, h: 380 } }), 0).orchestratorSize).toEqual({ w: 600, h: 380 });
  });

  it('drops what is broken or from before the widget (the floating panel place)', () => {
    const p = loadPrefs(JSON.stringify({ orchestratorOpen: 'yes', orchestratorSize: { w: 'x', h: 3 }, orchestratorSeenAt: 'ieri', orchestratorRect: { x: 1, y: 2, w: 3, h: 4 } }), 77);
    expect(p).toMatchObject({ orchestratorOpen: false, orchestratorSize: null, orchestratorSeenAt: 77 });
    expect('orchestratorRect' in p).toBe(false);
    expect(loadPrefs(JSON.stringify({ orchestratorSize: { w: -5, h: 300 } }), 0).orchestratorSize).toBeNull();
  });
});
