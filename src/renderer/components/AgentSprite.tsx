// A role's little person, animated (ADR 0294): the scene of lib/agent-sprites.ts (the portrait's head on a small body,
// its joints, its tool) drawn as one inline SVG, free on the strip. Each joint carries its rest pose and its
// animation inline; the @keyframes of a scene are written once into one <style> of the page the first time the scene
// is drawn (styles/agent-sprite.css has the rest: the rim, the ink, the blink; no image, no timer, no script per
// frame). Used by StripFace.tsx (the Grindhouse strips and the delegated rows) and by the working line of the
// Orchestrator's and Flash's transcript (ChatItems.tsx Typing, in place of the spark). Without motion
// (prefers-reduced-motion, a hidden window) it is the rest pose, which every state draws complete.
import { createContext, useInsertionEffect, useMemo, type CSSProperties, type ReactElement } from 'react';
import type { AgentAvatar as Avatar } from '@shared/agents';
import { isCharacterId } from '@shared/characters';
import { spriteScene, type SpriteId, type SpriteState } from '../lib/agent-sprites';
import { VIEW, jointStyle, keyframesCss, type Node } from '../lib/sprite-rig';
import '../styles/agent-sprite.css';

/** The little person a transcript's working line shows instead of the spark (ChatItems.tsx Typing); null = the spark. */
export const SpriteCtx = createContext<SpriteId | null>(null);
/** The little person of a chat's role; a chat without a role is the plain one at a laptop. */
export const spriteIdOf = (avatar: Avatar | undefined): SpriteId => (avatar?.kind === 'character' && isCharacterId(avatar.value) ? avatar.value : 'plain');

const written = new Set<string>();
/** The scene's @keyframes, added once to the page's one <style> for the sprites. */
function writeKeyframes(key: string, nodes: readonly Node[]): void {
  if (written.has(key) || typeof document === 'undefined') return;
  written.add(key);
  let el = document.getElementById('agent-sprite-keyframes');
  if (!el) { el = document.createElement('style'); el.id = 'agent-sprite-keyframes'; document.head.append(el); }
  el.append(keyframesCss(nodes) + '\n');
}

function draw(n: Node, key: number): ReactElement {
  if ('g' in n) return <g key={key} className={[n.j ? 'sp-j' : '', n.cls ?? ''].filter(Boolean).join(' ') || undefined} style={jointStyle(n) as CSSProperties}>{n.g.map(draw)}</g>;
  const line = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  if ('p' in n) return <path key={key} d={n.p} fill={n.f} opacity={n.o} />;
  if ('s' in n) return <path key={key} d={n.s} {...line} stroke={n.c} strokeWidth={n.w} opacity={n.o} />;
  if ('e' in n) return <ellipse key={key} cx={n.e[0]} cy={n.e[1]} rx={n.e[2]} ry={n.e[3]} fill={n.f} opacity={n.o} />;
  if ('r' in n) return <circle key={key} cx={n.r[0]} cy={n.r[1]} r={n.r[2]} {...line} stroke={n.c} strokeWidth={n.w} opacity={n.o} />;
  return <circle key={key} cx={n.c[0]} cy={n.c[1]} r={n.c[2]} fill={n.f} opacity={n.o} />;
}

/** `height` in px; the picture is 5 : 4. */
export function AgentSprite({ id, state, height = 32, label }: { id: SpriteId; state: SpriteState; height?: number; label?: string }) {
  const scene = spriteScene(id, state);
  useInsertionEffect(() => writeKeyframes(`${id}:${state}`, scene.nodes), [id, state, scene]);
  const body = useMemo(() => scene.nodes.map(draw), [scene]);
  return <span className="agent-sprite" data-sprite={id} data-sprite-state={state} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
    {/* the key restarts the movements when the state changes */}
    <svg key={`${id}:${state}`} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} width={height * VIEW.w / VIEW.h} height={height} aria-hidden="true">{body}</svg>
  </span>;
}
