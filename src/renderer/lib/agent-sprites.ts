// The little people of the roles, frame by frame (ADR 0294): each role is a small person in its character's clothes
// (lib/character-art.ts is the portrait, this is the same person at work) and does its own job while its chat works:
// the Orchestrator conducts, the Strategist moves a chess knight, the Scout walks with a magnifying glass, the Artisan
// hammers on an anvil, the Sentinel scans with binoculars beside its shield, the Herald blows its horn, Flash runs; a
// chat without a role types on a laptop. The other states are shared: thinking (a hand on the chin, a thought growing),
// waiting for the user (a wave, a hop, an amber "!"), done (a cheer, then still under a green tick), error (a squat, a
// drop of sweat, a red "!"), idle (asleep). Built on lib/sprite-rig.ts; drawn by components/AgentSprite.tsx.
import type { CharacterId } from '../../shared/characters';
import { ACCENT, AMBER, Canvas, GOLD, GREEN, OX, RED, SKY, bubble, glint, note, person, type Frame, type Look, type Pose } from './sprite-rig';

export type SpriteId = CharacterId | 'plain';
export type SpriteState = 'work' | 'think' | 'wait' | 'done' | 'err' | 'idle';
/** The frames of one animation, the time each one stays, and whether it plays once and rests on its last frame. */
export interface SpriteAnim { frames: Frame[]; ms: number; once?: boolean }

const hair = (c: string, sides = true) => (cv: Canvas, x: number, y: number): void => {
  cv.rect(x + 1, y - 1, 6, 1, c).rect(x, y, 8, 1, c);
  if (sides) cv.dots(c, [x, y + 1], [x + 7, y + 1]);
};

const LOOKS: Record<SpriteId, Look> = {
  orchestrator: {
    skin: '#efc19c', top: '#34314a',
    head: (cv, x, y) => { hair('#e6e9f2')(cv, x, y); cv.dots('#c3c8d6', [x + 7, y - 1], [x + 8, y], [x + 2, y], [x + 5, y - 1]); },
    wear: (cv, x, y) => { cv.rect(x + 2, y, 2, 3, '#f7f7fb').rect(x + 2, y, 2, 1, RED); },
  },
  strategist: {
    skin: '#a8693f', top: '#3558d6', glasses: true,
    head: hair('#1d1a22', false),
    wear: (cv, x, y) => { cv.rect(x + 2, y, 2, 1, '#f7f7fb').rect(x + 2, y + 1, 2, 2, GOLD); },
  },
  scout: {
    skin: '#f2c8a4', top: '#4f9d4f',
    head: (cv, x, y) => { cv.rect(x + 1, y - 2, 6, 2, '#d8b47a').rect(x + 1, y - 1, 6, 1, '#7a4b2a').rect(x - 1, y, 10, 1, '#b8904f'); },
    wear: (cv, x, y) => { cv.rect(x + 2, y, 2, 1, RED).rect(x, y + 3, 6, 1, '#7a4b2a'); },
  },
  artisan: {
    skin: '#8a5636', top: '#3f6fc0',
    head: (cv, x, y) => { cv.rect(x + 1, y - 1, 6, 1, RED).rect(x, y, 8, 1, RED).dots('#ffffff', [x + 2, y - 1], [x + 5, y], [x + 1, y]).dots(RED, [x + 8, y], [x + 8, y + 1]); },
    wear: (cv, x, y) => { cv.rect(x + 1, y + 1, 4, 3, '#9a6a35').rect(x + 2, y, 2, 1, '#9a6a35'); },
  },
  sentinel: {
    skin: '#d39a6c', top: '#1f9e90',
    head: (cv, x, y) => {
      cv.rect(x + 1, y - 1, 6, 1, '#d5dae3').rect(x, y, 8, 2, '#c1c7d2').rect(x, y + 2, 8, 1, '#8c94a3').rect(x, y + 3, 1, 2, '#c1c7d2').rect(x + 7, y + 3, 1, 2, '#c1c7d2');
      cv.rect(x + 3, y - 2, 3, 1, RED);
    },
    wear: (cv, x, y) => { cv.rect(x + 1, y, 4, 2, '#d5dae3').rect(x, y + 3, 6, 1, '#12756b'); },
  },
  herald: {
    skin: '#f7d6ba', top: '#d93b30',
    head: (cv, x, y) => {
      cv.dots('#d9772b', [x, y + 1], [x + 7, y + 1]).rect(x + 1, y - 1, 6, 1, '#27306b').rect(x - 1, y, 10, 1, '#27306b').dots(GOLD, [x - 1, y], [x + 8, y], [x + 3, y - 1]);
      cv.dots('#fff6c9', [x + 6, y - 2], [x + 7, y - 2]);
    },
    wear: (cv, x, y) => { cv.rect(x + 2, y, 2, 1, '#ffffff').dots(GOLD, [x + 2, y + 2], [x + 3, y + 2]); },
  },
  flash: {
    skin: '#f2c8a4', top: '#d93b30',
    head: (cv, x, y) => { cv.rect(x + 1, y - 1, 6, 1, '#e5383b').rect(x, y, 8, 1, '#e5383b').dots('#e5383b', [x + 8, y]).dots('#ffffff', [x - 1, y - 1], [x, y - 1], [x - 1, y]); },
    wear: (cv, x, y) => { cv.dots('#ffd23f', [x + 3, y], [x + 2, y + 1], [x + 3, y + 1], [x + 2, y + 2]); },
  },
  plain: { skin: '#f2c8a4', top: '#6b7285', head: hair('#5a3d2b') },
};

const frame = (draw: (cv: Canvas) => void): Frame => { const cv = new Canvas(); draw(cv); return cv.frame(); };
const TINT: Record<SpriteState, string> = { work: '#8f9cff70', think: '#8f9cff70', wait: '#f0b44c90', done: '#3fbf7f80', err: '#e5484d90', idle: '#8d94a460' };

// ---------------------------------------------------------------- each role at work
type Work = (look: Look, ground: string) => SpriteAnim;

const artisan: Work = (look, ground) => {
  const anvil = (cv: Canvas) => cv.rect(14, 12, 6, 1, '#b4bcc9').rect(15, 13, 4, 1, '#7c8494').rect(14, 14, 6, 1, '#7c8494');
  const head = '#dfe4ea', handle = '#b07a3c';
  const raised = frame(cv => { anvil(cv); const h = person(cv, look, { armR: 'high', ground }); cv.rect(h.r[0], h.r[1] - 2, 1, 2, handle).rect(h.r[0] - 1, h.r[1] - 4, 3, 2, head); });
  const mid = frame(cv => { anvil(cv); const h = person(cv, look, { armR: 'up', ground }); cv.dots(handle, [h.r[0] + 1, h.r[1] - 1]).rect(h.r[0] + 2, h.r[1] - 3, 3, 2, head); });
  const hit = frame(cv => { anvil(cv); person(cv, look, { armR: 'fwd', bob: true, eyes: 'happy', ground }); cv.rect(15, 10, 3, 2, head).dots(handle, [14, 11]).dots('#ffd166', [19, 9], [18, 8], [13, 8]); });
  const after = frame(cv => { anvil(cv); person(cv, look, { armR: 'fwd', ground }); cv.rect(15, 9, 3, 2, head).dots('#ffd166', [19, 7], [12, 6], [19, 10]); });
  return { frames: [raised, raised, mid, hit, after], ms: 130 };
};

const sentinel: Work = (look, ground) => {
  const at = (dx: number, legs: Pose['legs'], shine: boolean) => frame(cv => {
    cv.rect(15, 9, 4, 4, GOLD).rect(16, 13, 2, 1, GOLD).rect(16, 10, 2, 2, '#b07d12');
    person(cv, look, { dx, legs, eyes: 'none', armL: 'chin', armR: 'chin', ground });
    const x = OX + dx;
    cv.rect(x, 4, 3, 3, '#2a2f3a').rect(x + 5, 4, 3, 3, '#2a2f3a').rect(x + 3, 5, 2, 1, '#2a2f3a').dots(SKY, [x + 1, 5], [x + 6, 5]).dots(look.skin, [x, 7], [x + 7, 7]);
    if (shine) cv.dots('#ffffff', [x + (dx < 0 ? 1 : 6), 5], [x + (dx < 0 ? 0 : 7), 4]);
  });
  return { frames: [at(-1, 'b', true), at(-1, 'b', false), at(0, 'stand', false), at(1, 'a', true), at(1, 'a', false), at(0, 'stand', false)], ms: 280 };
};

const scout: Work = (look, ground) => {
  const at = (legs: Pose['legs'], up: number, found: boolean) => frame(cv => {
    const h = person(cv, look, { armR: 'fwd', legs, eyes: 'right', ground });
    const y = 4 - up;
    cv.rect(15, y, 3, 5, '#ffffff').rect(14, y + 1, 5, 3, '#ffffff').rect(15, y + 1, 3, 3, '#9be3ff').rect(h.r[0], y + 5, 1, h.r[1] - y - 5, '#7a4b2a');
    cv.dots('#ffffff', [found ? 17 : 15, y + 1]);
    if (found) glint(cv, 18, 1);
  });
  return { frames: [at('a', 0, false), at('stand', 1, false), at('b', 0, true), at('stand', 1, false)], ms: 190 };
};

const strategist: Work = (look, ground) => {
  const table = (cv: Canvas) => cv.rect(13, 12, 7, 1, '#9a6a35').dots('#6b4423', [14, 13], [14, 14], [18, 13], [18, 14]).rect(19, 10, 1, 2, '#1d1a22');
  const knight = (cv: Canvas, x: number, y: number) => cv.rect(x, y, 1, 2, '#f4f5fa').dots('#f4f5fa', [x + 1, y], [x, y - 1]);
  const think = (eyes: Pose['eyes']) => frame(cv => { table(cv); knight(cv, 15, 10); person(cv, look, { armR: 'chin', eyes, ground }); cv.dots(ACCENT, [14, 6]); });
  const reach = frame(cv => { table(cv); knight(cv, 15, 10); person(cv, look, { armR: 'fwd', eyes: 'right', ground }); });
  const lift = frame(cv => { table(cv); knight(cv, 16, 7); person(cv, look, { armR: 'out', eyes: 'right', ground }); });
  const place = frame(cv => { table(cv); knight(cv, 17, 10); person(cv, look, { armR: 'fwd', eyes: 'happy', ground }); });
  return { frames: [think('up'), think('blink'), think('up'), reach, lift, place, place], ms: 240 };
};

const herald: Work = (look, ground) => {
  const at = (blow: boolean, n1: [number, number] | null, n2: [number, number] | null) => frame(cv => {
    person(cv, look, { armR: 'up', eyes: blow ? 'happy' : 'open', bob: !blow, ground });
    const y = blow ? 7 : 8;
    cv.rect(13, y, 2, 1, GOLD).rect(15, y - 1, 1, 3, GOLD).rect(16, y - 2, 1, 5, blow ? GOLD : '#c9972b');
    if (blow) cv.rect(17, y - 3, 1, 7, '#c9972b');
    if (n1) note(cv, n1[0], n1[1], ACCENT);
    if (n2) note(cv, n2[0], n2[1], GOLD);
  });
  return { frames: [at(false, null, null), at(true, [17, 3], null), at(true, [17, 2], [1, 6]), at(false, null, [1, 4])], ms: 200 };
};

const orchestrator: Work = (look, ground) => {
  const baton = '#ffe9a8';
  const at = (armR: Pose['armR'], armL: Pose['armL'], bob: boolean, line: [number, number][], n: [number, number] | null) => frame(cv => {
    const h = person(cv, look, { armR, armL, bob, eyes: 'happy', ground });
    cv.dots(baton, ...line.map(([ax, ay]) => [h.r[0] + ax, h.r[1] + ay] as [number, number]));
    if (n) note(cv, n[0], n[1], ACCENT);
  });
  return { frames: [
    at('high', 'down', false, [[1, -1], [2, -2], [3, -3]], [0, 8]),
    at('up', 'out', false, [[1, 0], [2, 0], [3, 0], [4, 0]], [0, 6]),
    at('fwd', 'up', true, [[1, 1], [2, 2], [3, 3]], [0, 4]),
    at('up', 'out', false, [[1, -1], [2, -1], [3, -2], [4, -2]], null),
  ], ms: 180 };
};

const flash: Work = (look, ground) => {
  const at = (legs: Pose['legs'], dy: number, swing: boolean) => frame(cv => {
    person(cv, look, { legs, dy, armR: swing ? 'fwd' : 'back', armL: swing ? 'back' : 'fwd', eyes: 'right', ground });
    cv.rect(swing ? 0 : 1, 6, 3, 1, '#ffd23f').rect(swing ? 1 : 0, 10, 3, 1, '#ffd23f').rect(swing ? 0 : 2, 13, 2, 1, '#ffd23f90');
  });
  return { frames: [at('a', 0, true), at('stand', -1, true), at('b', 0, false), at('stand', -1, false)], ms: 100 };
};

const plain: Work = (look, ground) => {
  const at = (armR: Pose['armR'], glow: [number, number][]) => frame(cv => {
    cv.rect(14, 6, 5, 5, '#3a4256').rect(13, 11, 7, 1, '#9aa3b5').dots('#9aa3b5', [16, 12], [15, 13], [16, 13], [17, 13]).dots(SKY, ...glow);
    person(cv, look, { armR, armL: 'down', ground });
  });
  return { frames: [at('fwd', [[15, 7], [16, 7], [15, 9]]), at('out', [[15, 7], [16, 7], [17, 7], [15, 9]]), at('fwd', [[15, 7], [16, 7], [17, 7], [15, 9], [16, 9]]), at('out', [[15, 7], [16, 7], [17, 7], [15, 9], [16, 9], [17, 9]])], ms: 150 };
};

const WORK: Record<SpriteId, Work> = { orchestrator, strategist, scout, artisan, sentinel, herald, flash, plain };

// ---------------------------------------------------------------- the states every role shares
function shared(look: Look, state: Exclude<SpriteState, 'work'>): SpriteAnim {
  const ground = TINT[state];
  switch (state) {
    case 'think': {
      const at = (dots: number, eyes: Pose['eyes']) => frame(cv => {
        person(cv, look, { armR: 'chin', eyes, ground });
        if (dots > 0) cv.dots(ACCENT, [14, 7]);
        if (dots > 1) cv.rect(15, 4, 2, 2, ACCENT);
        if (dots > 2) cv.rect(16, 0, 3, 3, ACCENT).dots(ACCENT, [15, 1], [19, 1], [17, 3]);
      });
      return { frames: [at(0, 'up'), at(1, 'up'), at(2, 'up'), at(3, 'up'), at(3, 'blink')], ms: 320 };
    }
    case 'wait': {
      const at = (pose: Pose, up: boolean) => frame(cv => { person(cv, look, { ...pose, ground }); bubble(cv, AMBER, '!', up); });
      return { frames: [at({ armL: 'high' }, false), at({ armL: 'up', dy: -1, mouth: true }, true), at({ armL: 'high' }, false), at({ armL: 'up' }, false), at({ eyes: 'blink' }, false), at({}, false)], ms: 230 };
    }
    case 'done': {
      const at = (pose: Pose) => frame(cv => { person(cv, look, { eyes: 'happy', ...pose, ground }); bubble(cv, GREEN, 'ok'); });
      const cheer = at({ armL: 'high', armR: 'up', dy: -1 }), land = at({ armL: 'high', armR: 'up' }), rest = at({});
      return { frames: [land, cheer, land, cheer, land, rest], ms: 200, once: true };
    }
    case 'err': {
      const at = (drop: number) => frame(cv => { person(cv, look, { bob: true, eyes: 'sad', ground }); bubble(cv, RED, '!'); cv.dots(SKY, [3, 3 + drop], [3, 4 + drop]); });
      return { frames: [at(0), at(2), at(4)], ms: 420 };
    }
    case 'idle': {
      const z = (cv: Canvas, x: number, y: number) => cv.rect(x, y, 4, 1, ACCENT).dots(ACCENT, [x + 2, y + 1], [x + 1, y + 2]).rect(x, y + 3, 4, 1, ACCENT);
      const at = (bob: boolean, zs: [number, number][]) => frame(cv => { person(cv, look, { bob, eyes: 'blink', ground }); for (const [x, y] of zs) z(cv, x, y); });
      return { frames: [at(false, [[14, 5]]), at(true, [[14, 4]]), at(true, [[15, 0], [14, 6]]), at(false, [[15, 0]])], ms: 650 };
    }
  }
}

const cache = new Map<string, SpriteAnim>();
/** The animation of a role in a state (built once). */
export function spriteAnim(id: SpriteId, state: SpriteState): SpriteAnim {
  const key = `${id}:${state}`;
  let anim = cache.get(key);
  if (!anim) { const look = LOOKS[id]; anim = state === 'work' ? WORK[id](look, TINT.work) : shared(look, state); cache.set(key, anim); }
  return anim;
}
export const SPRITE_IDS = Object.keys(LOOKS) as SpriteId[];
export const SPRITE_STATES: readonly SpriteState[] = ['work', 'think', 'wait', 'done', 'err', 'idle'];
