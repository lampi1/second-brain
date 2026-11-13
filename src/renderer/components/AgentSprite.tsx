// A role's little person, animated (ADR 0295): the scene of lib/agent-sprites.ts (the portrait's head on a small body,
// its joints, its tool) drawn as one inline SVG, free on the strip. Each joint carries its rest pose and its
// animation inline; the @keyframes of a scene are written once into one <style> of the page the first time the scene
// is drawn (styles/agent-sprite.css has the rest: the rim, the ink, the blink; no image, no timer, no script per
// frame). Used by StripFace.tsx (the Grindhouse strips and the delegated rows), by the front of the role cards
// (AgentCatalogCard.tsx) and by the working line of the Orchestrator's transcript (ChatItems.tsx Typing, in place of
// the spark). Without motion
// (prefers-reduced-motion, a hidden window) it is the rest pose, which every state draws complete. A click on it plays
// a reaction (ADR 0297: a pat, a whack of the stick) and tells its owner, which may record it as a nudge on the run.
import { createContext, useEffect, useInsertionEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactElement } from 'react';
import type { AgentAvatar as Avatar } from '@shared/agents';
import { REACTION_S, isSpriteId, reactionScene, spriteScene, type SpriteId, type SpriteReaction, type SpriteState } from '../lib/agent-sprites';
import { VIEW, jointStyle, keyframeRules, type Node } from '../lib/sprite-rig';
import '../styles/agent-sprite.css';

/** The little person a transcript's working line shows instead of the spark (ChatItems.tsx Typing); null = the spark. */
export const SpriteCtx = createContext<SpriteId | null>(null);
/** The little person of a chat's role; a chat without a role is the plain one at a laptop. */
export const spriteIdOf = (avatar: Avatar | undefined): SpriteId => (avatar?.kind === 'character' && isSpriteId(avatar.value) ? avatar.value : 'plain');

const scenes = new Set<string>(), rules = new Set<string>();
/** The scene's @keyframes, each rule once (the roles share most of them) in the page's one <style> for the sprites. */
function writeKeyframes(key: string, nodes: readonly Node[]): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('agent-sprite-keyframes');
  // the element went away (a reloaded page keeps this module): everything is written again
  if (!el) { el = document.createElement('style'); el.id = 'agent-sprite-keyframes'; document.head.append(el); scenes.clear(); rules.clear(); }
  if (scenes.has(key)) return;
  scenes.add(key);
  let css = '';
  for (const [name, rule] of keyframeRules(nodes)) if (!rules.has(name)) { rules.add(name); css += rule + '\n'; }
  if (css) el.append(css);
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

/** `height` in px; the picture is 5 : 4. `still`: the scene's last picture without its movement (a «done» already seen).
 *  A click on the person plays a reaction once over its state (ADR 0297): the left one a pat on the head, the right
 *  one a whack of the stick; `onTouch` hears which (+1 the pat, -1 the whack), `tip` is its tooltip. The click stays on
 *  the person: it never opens the strip or the card under it. */
export function AgentSprite({ id, state, height = 32, label, still, onTouch, tip }: { id: SpriteId; state: SpriteState; height?: number; label?: string; still?: boolean; onTouch?: (sign: 1 | -1) => void; tip?: string }) {
  // `n` counts the clicks: each one starts its reaction from the top
  const [react, setReact] = useState<{ kind: SpriteReaction; n: number } | null>(null);
  useEffect(() => {
    if (!react) return;
    const back = setTimeout(() => setReact(null), REACTION_S[react.kind] * 1000);
    return () => clearTimeout(back);
  }, [react]);
  const scene = react ? reactionScene(id, react.kind) : spriteScene(id, state);
  const key = react ? `${id}:${react.kind}` : `${id}:${state}`;
  useInsertionEffect(() => writeKeyframes(key, scene.nodes), [key, scene]);
  const body = useMemo(() => scene.nodes.map(draw), [scene]);
  const touch = (sign: 1 | -1) => (e: MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setReact(r => ({ kind: sign > 0 ? 'pat' : 'whack', n: (r?.n ?? 0) + 1 }));
    onTouch?.(sign);
  };
  return <span className={`agent-sprite${still && !react ? ' is-still' : ''}`} data-sprite={id} data-sprite-state={state} data-react={react?.kind} title={tip}
    onClick={touch(1)} onContextMenu={touch(-1)} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
    {/* the key restarts the movements when the state changes, and at every click */}
    <svg key={react ? `${key}:${react.n}` : key} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} width={height * VIEW.w / VIEW.h} height={height} aria-hidden="true">{body}</svg>
  </span>;
}
