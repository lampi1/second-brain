// A role's cartoon character as a round badge (lib/character-art.ts: trusted shapes in code, never user or model
// content), from 16 px in the sidebar tree to 96 px in the role editor; a chat without a role gets a neutral badge
// with its initial. Used by the Grindhouse strips, the sidebar tree, the child cards, the catalog and the role editor.
import { useId, type ReactElement } from 'react';
import type { AgentAvatar as Avatar } from '@shared/agents';
import { isCharacterId } from '@shared/characters';
import { CHARACTERS, FACE, HEAD, PROP_MIN, type Shape } from '../lib/character-art';
import { t } from '../i18n';
import '../styles/agent-avatar.css';

function shape(s: Shape, key: number): ReactElement {
  if ('p' in s) return <path key={key} d={s.p} fill={s.f} />;
  if ('s' in s) return <path key={key} d={s.s} fill="none" stroke={s.c} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" />;
  if ('e' in s) return <ellipse key={key} cx={s.e[0]} cy={s.e[1]} rx={s.e[2]} ry={s.e[3]} fill={s.f} />;
  return <circle key={key} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} fill={s.f} />;
}

export function AgentAvatar({ avatar, name, size = 28 }: { avatar: Avatar | undefined; name: string; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const label = t('product.avatar', { name });
  if (avatar?.kind !== 'character' || !isCharacterId(avatar.value)) {
    return <span className="agent-avatar plain" role="img" aria-label={label} style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.45)) }}>{(name.trim()[0] ?? '?').toUpperCase()}</span>;
  }
  const c = CHARACTERS[avatar.value], small = size < PROP_MIN;
  return <svg className="agent-avatar character" data-character={avatar.value} viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={label}>
    <defs>
      <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={c.bg[0]} /><stop offset="1" stopColor={c.bg[1]} /></linearGradient>
      <clipPath id={`c${id}`}><circle cx="32" cy="32" r="32" /></clipPath>
    </defs>
    <g clipPath={`url(#c${id})`}>
      <rect width="64" height="64" fill={`url(#g${id})`} />
      {c.body.map(shape)}
      <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill={c.skin} />
      {(small ? FACE.filter(s => !('e' in s)) : FACE).map(shape)}
      {c.face?.map(shape)}
      {c.head.map(shape)}
      {!small && c.prop.map(shape)}
    </g>
    <circle className="agent-avatar-ring" cx="32" cy="32" r="31.25" fill="none" strokeWidth="1.5" />
  </svg>;
}
