// The roles' little people (lib/agent-sprites.ts on lib/sprite-rig.ts, ADR 0294): every role has every state, each
// scene is a whole person with something that moves, a track compiles to one @keyframes rule that starts and ends on
// the rest pose, the same movement is written once, the «done» scene stops by itself; and what a strip's person does
// follows the chat (components/StripFace.tsx).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import { CHARACTER_IDS } from '../../src/shared/characters';
import { WORK_ROLE_IDS } from '../../src/shared/roles';
import type { ChatItem } from '../../src/shared/contract';
import { SPRITE_IDS, SPRITE_STATES, spriteScene } from '../../src/renderer/lib/agent-sprites';
import { J, VIEW, jointStyle, keyframesCss, nodeSvg, trackName, walk, type Group } from '../../src/renderer/lib/sprite-rig';
import { AgentSprite, spriteIdOf } from '../../src/renderer/components/AgentSprite';
import { isThinking, spriteStateOf } from '../../src/renderer/components/StripFace';

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
      expect(g.track.t).toBeLessThanOrEqual(6);
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
  it('writes the shared states once for all the roles', () => {
    const css = SPRITE_IDS.map(id => keyframesCss(spriteScene(id, 'idle').nodes));
    expect(new Set(css).size).toBe(1);
  });
  it('builds a scene once', () => {
    expect(spriteScene('artisan', 'work')).toBe(spriteScene('artisan', 'work'));
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
