// A role's little person, animated (ADR 0294): the frames of lib/agent-sprites.ts side by side in one inline SVG, one
// path per colour, moved one frame at a time by a stepped CSS animation (transform only; no image, no timer, no
// script per frame). It stands on a small dark stage so its colours read the same in the light and the dark theme.
// Used by StripFace.tsx (the Grindhouse strips and the delegated rows) and by the working line of a transcript
// (ChatItems.tsx Typing, in place of the spark). Without motion (prefers-reduced-motion, a hidden window) it is the
// first frame, which every state draws complete.
import { createContext, useMemo, type CSSProperties } from 'react';
import type { AgentAvatar as Avatar } from '@shared/agents';
import { isCharacterId } from '@shared/characters';
import { spriteAnim, type SpriteId, type SpriteState } from '../lib/agent-sprites';
import { framePaths, SPRITE_H, SPRITE_W } from '../lib/sprite-rig';
import '../styles/agent-sprite.css';

/** The little person a transcript's working line shows instead of the spark (ChatItems.tsx Typing); null = the spark. */
export const SpriteCtx = createContext<SpriteId | null>(null);
/** The little person of a chat's role; a chat without a role is the plain one at a laptop. */
export const spriteIdOf = (avatar: Avatar | undefined): SpriteId => (avatar?.kind === 'character' && isCharacterId(avatar.value) ? avatar.value : 'plain');

export function AgentSprite({ id, state, scale = 2, label }: { id: SpriteId; state: SpriteState; scale?: number; label?: string }) {
  const anim = spriteAnim(id, state);
  const paths = useMemo(() => {
    const by = new Map<string, string>();
    anim.frames.forEach((f, i) => { for (const p of framePaths(f, i * SPRITE_W)) by.set(p.fill, (by.get(p.fill) ?? '') + p.d); });
    return [...by];
  }, [anim]);
  const n = anim.frames.length;
  const move = { '--sprite-end': `${-(n - 1) * SPRITE_W}px`, animationDuration: `${n * anim.ms}ms`, animationTimingFunction: `steps(${n}, jump-none)`, animationIterationCount: anim.once ? 1 : 'infinite' } as CSSProperties;
  return <span className="agent-sprite" data-sprite={id} data-sprite-state={state} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
    <svg viewBox={`0 0 ${SPRITE_W} ${SPRITE_H}`} width={SPRITE_W * scale} height={SPRITE_H * scale} shapeRendering="crispEdges" aria-hidden="true">
      {/* the key restarts the animation when the state changes */}
      <g key={`${id}:${state}`} className="agent-sprite-frames" style={move}>
        {paths.map(([fill, d]) => <path key={fill} d={d} fill={fill} />)}
      </g>
    </svg>
  </span>;
}
