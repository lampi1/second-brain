// The roles' little people (lib/agent-sprites.ts on lib/sprite-rig.ts, ADR 0295): every role has every state, each
// scene is a whole person with something that moves, a track compiles to one @keyframes rule that starts and ends on
// the rest pose, the same movement is written once, the «done» scene stops by itself; and what a strip's person does
// follows the chat (components/StripFace.tsx), down to the kind of work at hand (ADR 0305).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import { CHARACTER_IDS } from '../../src/shared/characters';
import { WORK_ROLE_IDS } from '../../src/shared/roles';
import type { ChatItem } from '../../src/shared/contract';
import { REACTION_S, SPRITE_ACTIVITIES, SPRITE_IDS, SPRITE_REACTIONS, SPRITE_STATES, isSpriteActivity, reactionScene, spriteScene } from '../../src/renderer/lib/agent-sprites';
import { J, VIEW, jointStyle, keyframeRules, keyframesCss, nodeSvg, trackName, walk, type Group } from '../../src/renderer/lib/sprite-rig';
import { AgentSprite, spriteIdOf } from '../../src/renderer/components/AgentSprite';
import { ACTIVITY_MS, isThinking, settleLeft, spriteStateOf } from '../../src/renderer/components/StripFace';

const groups = (id: (typeof SPRITE_IDS)[number], state: (typeof SPRITE_STATES)[number]) => walk(spriteScene(id, state).nodes).filter((n): n is Group => 'g' in n);

describe('the little people', () => {
  it('has one for the Orchestrator, every work role, and a plain one', () => {
    expect(SPRITE_IDS).toEqual(expect.arrayContaining(['orchestrator', ...WORK_ROLE_IDS, 'plain']));
    expect(SPRITE_IDS.every(id => id === 'plain' || (CHARACTER_IDS as readonly string[]).includes(id))).toBe(true);
  });
  it('gives every role every state: a whole person, with joints that move', () => {
    for (const id of SPRITE_IDS) for (const state of SPRITE_STATES) {
      const all = walk(spriteScene(id, state).nodes);
      // two legs, a torso, a head with its face and hair, two arms of two parts each
      expect(all.filter(n => !('g' in n)).length, `${id} ${state}`).toBeGreaterThan(24);
      expect(groups(id, state).filter(g => g.track).length, `${id} ${state} moves`).toBeGreaterThanOrEqual(3);
    }
  });
  it('keeps every key inside its loop, in a time a person can watch', () => {
    for (const id of SPRITE_IDS) for (const state of SPRITE_STATES) for (const g of groups(id, state)) {
      if (!g.track) continue;
      expect(g.track.t, `${id} ${state}`).toBeGreaterThan(0.1);
      // a vice at rest plays once in a longer still loop (ADR 0311)
      expect(g.track.t, `${id} ${state}`).toBeLessThanOrEqual(state === 'idle' && id !== 'plain' ? 18 : 7);
      for (const key of g.track.keys) { expect(key.at, `${id} ${state}`).toBeGreaterThanOrEqual(0); expect(key.at, `${id} ${state}`).toBeLessThanOrEqual(100); }
    }
  });
  it('makes each role work in its own way', () => {
    const work = SPRITE_IDS.map(id => spriteScene(id, 'work').nodes.map(nodeSvg).join(''));
    expect(new Set(work).size).toBe(SPRITE_IDS.length);
  });
  it('lets the end stop by itself (the blink aside), and nothing else', () => {
    for (const id of SPRITE_IDS) for (const state of SPRITE_STATES) {
      const tracks = groups(id, state).flatMap(g => (g.track ? [g.track] : []));
      expect(tracks.every(t => t.n === 1), `${id} ${state}`).toBe(state === 'done');
      if (state !== 'done') expect(tracks.every(t => t.n === undefined), `${id} ${state}`).toBe(true);
    }
  });
  it('keeps the sparks and the notes hidden when their loop starts and ends', () => {
    for (const id of ['artisan', 'orchestrator', 'herald'] as const) {
      const rules = keyframeRules(spriteScene(id, 'work').nodes);
      const puffs = groups(id, 'work').filter(g => g.j && g.track?.keys.some(k => k.o === 0 && k.e === 'hold'));
      expect(puffs.length, id).toBeGreaterThan(1);
      for (const g of puffs) {
        const rule = rules.get(trackName(g.j!, g.track!))!;
        expect(rule, id).toMatch(/\{0%\{[^}]*opacity:0[;}]/);
        expect(rule, id).toMatch(/100%\{[^}]*opacity:0[;}]/);
      }
    }
  });
  it('never writes two blocks for the same moment of a rule', () => {
    for (const id of SPRITE_IDS) for (const state of SPRITE_STATES) for (const rule of keyframeRules(spriteScene(id, state).nodes).values()) {
      const at = [...rule.matchAll(/([\d.]+)%\{/g)].map(m => m[1]);
      expect(new Set(at).size, `${id} ${state} ${at.join(" ")}`).toBe(at.length);
    }
  });
  it('at rest lets each role indulge its own vice, then hold still for most of the loop; the plain chat dozes', () => {
    const idle = SPRITE_IDS.map(id => spriteScene(id, 'idle').nodes.map(nodeSvg).join(''));
    expect(new Set(idle).size).toBe(SPRITE_IDS.length);
    for (const id of SPRITE_IDS) {
      if (id === 'plain') continue;
      for (const g of groups(id, 'idle')) if (g.track) expect(Math.max(...g.track.keys.filter(k => k.at < 100).map(k => k.at)), id).toBeLessThanOrEqual(40.01);
    }
  });
  it('reacts to a click the same way in every role: a pat and a whack, each played once and as long as it says', () => {
    for (const id of SPRITE_IDS) for (const kind of SPRITE_REACTIONS) {
      const tracks = walk(reactionScene(id, kind).nodes).flatMap(n => ('g' in n && n.track ? [n.track] : []));
      expect(tracks.length, `${id} ${kind}`).toBeGreaterThan(6);
      expect(tracks.every(t => t.n === 1 && t.t === REACTION_S[kind]), `${id} ${kind}`).toBe(true);
    }
    expect(reactionScene('scout', 'pat')).toBe(reactionScene('scout', 'pat'));
    expect(reactionScene('scout', 'pat').nodes.map(nodeSvg).join('')).not.toBe(reactionScene('scout', 'whack').nodes.map(nodeSvg).join(''));
  });
  it('builds a scene once', () => {
    expect(spriteScene('artisan', 'work')).toBe(spriteScene('artisan', 'work'));
  });
  it('draws the kind of work at hand for every role (ADR 0305): a whole person that moves, each kind its own scene', () => {
    expect([...SPRITE_ACTIVITIES].sort()).toEqual(['delegate', 'read', 'run', 'search', 'test', 'web']);
    for (const id of SPRITE_IDS) {
      const drawn = new Set([spriteScene(id, 'work').nodes.map(nodeSvg).join('')]);
      for (const act of SPRITE_ACTIVITIES) {
        const scene = spriteScene(id, 'work', act), all = walk(scene.nodes), moving = all.filter((n): n is Group => 'g' in n && !!n.track);
        expect(all.filter(n => !('g' in n)).length, `${id} ${act}`).toBeGreaterThan(24);
        expect(moving.length, `${id} ${act} moves`).toBeGreaterThanOrEqual(3);
        for (const g of moving) {
          // a loop a person can watch, never a counted one: it goes on as long as the work does
          expect(g.track!.n, `${id} ${act}`).toBeUndefined();
          expect(g.track!.t, `${id} ${act}`).toBeGreaterThan(0.1);
          expect(g.track!.t, `${id} ${act}`).toBeLessThanOrEqual(6);
          for (const key of g.track!.keys) { expect(key.at, `${id} ${act}`).toBeGreaterThanOrEqual(0); expect(key.at, `${id} ${act}`).toBeLessThanOrEqual(100); }
        }
        for (const rule of keyframeRules(scene.nodes).values()) {
          const at = [...rule.matchAll(/([\d.]+)%\{/g)].map(m => m[1]);
          expect(new Set(at).size, `${id} ${act} ${at.join(' ')}`).toBe(at.length);
        }
        drawn.add(scene.nodes.map(nodeSvg).join(''));
        expect(spriteScene(id, 'work', act), `${id} ${act} built once`).toBe(scene);
      }
      // the role's own way of working and the six kinds: seven different drawings; the smith hammers for a command
      // and the tests too (his own work), so he has five
      expect(drawn.size, id).toBe(id === 'artisan' ? SPRITE_ACTIVITIES.length - 1 : SPRITE_ACTIVITIES.length + 1);
    }
  });
  it('lets the smith hammer for a command and the tests, and plays the shared scenes for the rest', () => {
    expect(spriteScene('artisan', 'work', 'run')).toBe(spriteScene('artisan', 'work'));
    expect(spriteScene('artisan', 'work', 'test')).toBe(spriteScene('artisan', 'work'));
    expect(spriteScene('artisan', 'work', 'read')).not.toBe(spriteScene('artisan', 'work'));
  });
  it('shows no screen, key or pointer in the shared scenes of a command, a page and the tests', () => {
    // the old props were drawn in these colours: the terminal's steel, its dark glass, the pointer's ink
    for (const act of ['run', 'web', 'test'] as const) {
      const svg = spriteScene('scout', 'work', act).nodes.map(nodeSvg).join('');
      expect(svg, act).not.toContain('#59627a');
      expect(svg, act).not.toContain('#1f2430');
    }
  });
  it('draws a kind of work only while the person works', () => {
    for (const state of SPRITE_STATES) if (state !== 'work') expect(spriteScene('scout', state, 'read'), state).toBe(spriteScene('scout', state));
    expect(spriteScene('scout', 'work', null)).toBe(spriteScene('scout', 'work'));
    expect(isSpriteActivity('read')).toBe(true);
    // an edit and work the app cannot name stay the role's own scene
    for (const v of ['edit', 'work', 'pat', '', null, undefined, 'toString']) expect(isSpriteActivity(v), String(v)).toBe(false);
  });
});

describe('a joint', () => {
  it('rests at its place, angle and scale', () => {
    const j = J(3, 4, 20, []);
    expect(jointStyle(j)).toEqual({ transform: 'translate(3px,4px) rotate(20deg) scale(1,1)' });
    expect(nodeSvg(J(1, 2, 0, [{ c: [0, 0, 1], f: '#ffffff' }]))).toBe('<g class="sp-j" style="transform:translate(1px,2px) rotate(0deg) scale(1,1)"><circle cx="0" cy="0" r="1" fill="#ffffff"/></g>');
  });
  it('compiles its track to keyframes that start and end on the rest pose, each key with its own easing', () => {
    const j = J(0, 5, -10, [], { t: 0.9, keys: [{ at: 40, a: -90, dy: -2, sy: 1.1, e: 'in' }, { at: 50, e: 'out' }] });
    const name = trackName(j.j!, j.track!);
    expect(name).toMatch(/^spk-[0-9a-z]+$/);
    expect(jointStyle(j).animation).toBe(`${name} 0.9s linear 0s infinite both`);
    const css = keyframesCss([j]);
    expect(css).toBe(`@keyframes ${name}{`
      + '0%{transform:translate(0px,5px) rotate(-10deg) scale(1,1);animation-timing-function:cubic-bezier(.45,0,.55,1)}'
      + '40%{transform:translate(0px,3px) rotate(-90deg) scale(1,1.1);animation-timing-function:cubic-bezier(.6,0,1,.5)}'
      + '50%{transform:translate(0px,5px) rotate(-10deg) scale(1,1);animation-timing-function:cubic-bezier(0,.5,.4,1)}'
      + '100%{transform:translate(0px,5px) rotate(-10deg) scale(1,1);animation-timing-function:cubic-bezier(.45,0,.55,1)}}');
  });
  it('fades only where a key or the rest pose asks for it, and plays a counted track that many times', () => {
    const j = J(0, 0, 0, [], { t: 2, n: 1, d: -0.5, keys: [{ at: 0, o: 0 }, { at: 50, o: 1 }] }, 1, 0);
    expect(jointStyle(j).opacity).toBe('0');
    expect(jointStyle(j).animation).toMatch(/ 2s linear -0\.5s 1 both$/);
    expect(keyframesCss([j])).toContain('opacity:1');
    expect(keyframesCss([J(0, 0, 0, [], { t: 1, keys: [{ at: 50, a: 5 }] })])).not.toContain('opacity');
  });
  it('writes the same movement once', () => {
    const a = J(1, 1, 0, [], { t: 1, keys: [{ at: 50, a: 9 }] }), b = J(1, 1, 0, [], { t: 1, keys: [{ at: 50, a: 9 }] });
    expect(keyframesCss([a, b]).match(/@keyframes/g)).toHaveLength(1);
  });
});

describe('the sprite on the page', () => {
  it('draws the scene free on the page at the asked height', () => {
    const html = renderToStaticMarkup(createElement(AgentSprite, { id: 'artisan', state: 'work', height: 48, label: 'Artisan' }));
    expect(html).toContain('data-sprite="artisan"');
    expect(html).toContain('data-sprite-state="work"');
    expect(html).toContain('aria-label="Artisan"');
    expect(html).toContain(`viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}"`);
    expect(html).toContain('width="60" height="48"');
    expect(html).not.toContain('background');
    expect(html).toMatch(/class="sp-j" style="transform:[^"]*;animation:spk-/);
  });
  it('says on the page which kind of work it draws, and only at work', () => {
    const at = (state: 'work' | 'idle') => renderToStaticMarkup(createElement(AgentSprite, { id: 'scout', state, activity: 'search', height: 48 }));
    expect(at('work')).toContain('data-sprite-activity="search"');
    expect(at('idle')).not.toContain('data-sprite-activity');
    expect(at('work')).not.toBe(renderToStaticMarkup(createElement(AgentSprite, { id: 'scout', state: 'work', height: 48 })));
  });
  it('picks the person of the role, the plain one without a role', () => {
    expect(spriteIdOf({ kind: 'character', value: 'herald' })).toBe('herald');
    expect(spriteIdOf({ kind: 'emoji', value: '🦊' } as never)).toBe('plain');
    expect(spriteIdOf(undefined)).toBe('plain');
  });
});

describe('what the person of a strip does', () => {
  const o = { waitsUser: false, error: false, busy: false, thinking: false, done: false };
  it('follows the chat: the error, then the user, the work, the end, the rest', () => {
    expect(spriteStateOf({ ...o, error: true, waitsUser: true, busy: true })).toBe('err');
    expect(spriteStateOf({ ...o, waitsUser: true, busy: true })).toBe('wait');
    expect(spriteStateOf({ ...o, busy: true })).toBe('work');
    expect(spriteStateOf({ ...o, busy: true, thinking: true })).toBe('think');
    expect(spriteStateOf({ ...o, done: true })).toBe('done');
    expect(spriteStateOf({ ...o, pending: true })).toBe('think');
    expect(spriteStateOf(o)).toBe('idle');
  });
  it('changes the scene of work no more often than a scene can be watched: the first change at once, the next when its time is up', () => {
    expect(settleLeft(0, ACTIVITY_MS, 1_000_000)).toBe(0);
    expect(settleLeft(1_000_000, ACTIVITY_MS, 1_000_000)).toBe(ACTIVITY_MS);
    expect(settleLeft(1_000_000, ACTIVITY_MS, 1_000_000 + ACTIVITY_MS - 1)).toBe(1);
    expect(settleLeft(1_000_000, ACTIVITY_MS, 1_000_000 + ACTIVITY_MS)).toBe(0);
    expect(settleLeft(1_000_000, ACTIVITY_MS, 9_000_000)).toBe(0);
    expect(ACTIVITY_MS).toBeGreaterThanOrEqual(2000);
  });
  it('thinks on a thought or before the first step, keeps working between two steps', () => {
    const item = (p: Record<string, unknown>) => ({ id: 'i', at: 0, ...p }) as unknown as ChatItem;
    expect(isThinking(undefined)).toBe(true);
    expect(isThinking([])).toBe(true);
    expect(isThinking([item({ kind: 'user', text: 'go' })])).toBe(true);
    expect(isThinking([item({ kind: 'thinking', text: 'hm' })])).toBe(true);
    expect(isThinking([item({ kind: 'tool', name: 'Read', status: 'ok' })])).toBe(false);
    expect(isThinking([item({ kind: 'assistant', text: 'done that' })])).toBe(false);
  });
});
