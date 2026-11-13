// A role's cartoon character as a round badge (lib/character-art.ts: trusted shapes in code, never user or model
// content), from 16 px in the sidebar tree to 96 px in the role editor: below 24 px the small variant (closer frame,
// no prop), from 24 px the full one. A role the user gave a picture of their own (lib/agent-images.ts, chosen on the
// role's page) shows that picture instead. A chat without a role gets a neutral badge with its initial. Used by the
// Grindhouse strips, the sidebar tree, the child cards, the catalog and the role editor.
import { useId, type ReactElement } from 'react';
import type { AgentAvatar as Avatar } from '@shared/agents';
import { isCharacterId } from '@shared/characters';
import { isRoleId } from '@shared/roles';
import { useAgentImages } from '../lib/agent-images';
import { CHARACTERS, FULL_MIN, characterShapes, frameOf, type Shape } from '../lib/character-art';
import { t } from '../i18n';
import '../styles/agent-avatar.css';

function shape(s: Shape, key: number): ReactElement {
  const line = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  if ('p' in s) return <path key={key} d={s.p} fill={s.f} opacity={s.o} />;
  if ('s' in s) return <path key={key} d={s.s} {...line} stroke={s.c} strokeWidth={s.w} opacity={s.o} />;
  if ('e' in s) return <ellipse key={key} cx={s.e[0]} cy={s.e[1]} rx={s.e[2]} ry={s.e[3]} fill={s.f} opacity={s.o} />;
  if ('r' in s) return <circle key={key} cx={s.r[0]} cy={s.r[1]} r={s.r[2]} {...line} stroke={s.c} strokeWidth={s.w} opacity={s.o} />;
  return <circle key={key} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} fill={s.f} opacity={s.o} />;
}

export function AgentAvatar({ avatar, name, size = 28 }: { avatar: Avatar | undefined; name: string; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const label = t('product.avatar', { name });
  const images = useAgentImages();
  const role = avatar?.kind === 'character' && isRoleId(avatar.value) ? avatar.value : null;
  const picture = role ? images[role] : undefined;
  if (role && picture) {
    return <img className="agent-avatar picture" data-character={role} data-variant="picture" src={picture} width={size} height={size} alt={label} draggable={false} />;
  }
  if (avatar?.kind !== 'character' || !isCharacterId(avatar.value)) {
    return <span className="agent-avatar plain" role="img" aria-label={label} style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.45)) }}>{(name.trim()[0] ?? '?').toUpperCase()}</span>;
  }
  const small = size < FULL_MIN, { cx, cy, r } = frameOf(small), [a, b] = CHARACTERS[avatar.value].bg;
  return <svg className="agent-avatar character" data-character={avatar.value} data-variant={small ? 'small' : 'full'}
    viewBox={`${cx - r} ${cy - r} ${2 * r} ${2 * r}`} width={size} height={size} role="img" aria-label={label}>
    <defs>
      <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
      <clipPath id={`c${id}`}><circle cx={cx} cy={cy} r={r} /></clipPath>
    </defs>
    <g clipPath={`url(#c${id})`}>
      <rect width="64" height="64" fill={`url(#g${id})`} />
      {characterShapes(avatar.value, small).map(shape)}
    </g>
    <circle className="agent-avatar-ring" cx={cx} cy={cy} r={r * 0.976} fill="none" strokeWidth={r * 0.047} />
  </svg>;
}
