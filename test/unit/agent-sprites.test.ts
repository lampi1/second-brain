// The roles' little people (lib/agent-sprites.ts on lib/sprite-rig.ts, ADR 0294): every role has every state, each
// animation moves, each frame is a whole 20 × 16 picture with a body in it, the «done» one plays once; the SVG path of a
// frame covers exactly its pixels; and what a strip's person does follows the chat (components/StripFace.tsx).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import { CHARACTER_IDS } from '../../src/shared/characters';
import type { ChatItem } from '../../src/shared/contract';
import { SPRITE_IDS, SPRITE_STATES, spriteAnim } from '../../src/renderer/lib/agent-sprites';
import { SPRITE_H, SPRITE_W, framePaths, type Frame } from '../../src/renderer/lib/sprite-rig';
import { AgentSprite, spriteIdOf } from '../../src/renderer/components/AgentSprite';
import { isThinking, spriteStateOf } from '../../src/renderer/components/StripFace';

const key = (f: Frame) => f.map(r => r.join(',')).join('\n');
const filled = (f: Frame) => f.reduce((n, r) => n + r.filter(Boolean).length, 0);

describe('the little people', () => {
  it('has one for every character, and a plain one', () => {
    expect([...SPRITE_IDS].sort()).toEqual([...CHARACTER_IDS, 'plain'].sort());
  });
  it('gives every role every state, as whole frames that move', () => {
    for (const id of SPRITE_IDS) for (const state of SPRITE_STATES) {
      const a = spriteAnim(id, state);
      expect(a.frames.length, `${id} ${state}`).toBeGreaterThanOrEqual(2);
      expect(a.ms).toBeGreaterThan(0);
      for (const f of a.frames) {
        expect(f.length).toBe(SPRITE_H);
        for (const row of f) expect(row.length).toBe(SPRITE_W);
        // a head and a body at least: the first frame is what a still window shows
        expect(filled(f), `${id} ${state}`).toBeGreaterThan(60);
      }
      expect(new Set(a.frames.map(key)).size, `${id} ${state} moves`).toBeGreaterThan(1);
      expect(!!a.once).toBe(state === 'done');
    }
  });
  it('makes each role work in its own way', () => {
    const first = SPRITE_IDS.map(id => key(spriteAnim(id, 'work').frames[0]!));
    expect(new Set(first).size).toBe(SPRITE_IDS.length);
  });
  it('builds an animation once', () => {
    expect(spriteAnim('artisan', 'work')).toBe(spriteAnim('artisan', 'work'));
  });
});

describe('a frame as SVG paths', () => {
  it('covers each pixel once, one path per colour', () => {
    const f = spriteAnim('sentinel', 'work').frames[0]!;
    const paths = framePaths(f, SPRITE_W);
    expect(new Set(paths.map(p => p.fill)).size).toBe(paths.length);
    let area = 0;
    for (const p of paths) for (const m of p.d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(SPRITE_W); // shifted along the strip
      area += Number(m[3]);
    }
    expect(area).toBe(filled(f));
  });
});

describe('the sprite on the page', () => {
  it('draws the frames side by side and steps through them', () => {
    const html = renderToStaticMarkup(createElement(AgentSprite, { id: 'artisan', state: 'work', label: 'Artisan' }));
    const n = spriteAnim('artisan', 'work').frames.length;
    expect(html).toContain('data-sprite="artisan"');
    expect(html).toContain('data-sprite-state="work"');
    expect(html).toContain('aria-label="Artisan"');
    expect(html).toContain(`steps(${n}, jump-none)`);
    expect(html).toContain(`--sprite-end:${-(n - 1) * SPRITE_W}px`);
    expect(html).toContain('animation-iteration-count:infinite');
  });
  it('plays the end once', () => {
    expect(renderToStaticMarkup(createElement(AgentSprite, { id: 'scout', state: 'done' }))).toContain('animation-iteration-count:1');
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
