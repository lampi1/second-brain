// Persistent agent identity: trusted legacy/designed glyphs or validated raster data; never user-supplied SVG.
import type { AgentAvatar as Avatar, AgentSymbol } from '@shared/agents';
import type { CSSProperties } from 'react';
import { isRoleGlyph, type RoleGlyph } from '@shared/agent-glyphs';
import { GLYPH_TONES, GLYPH_INK } from '../lib/agent-glyph-tones';
import { AgentGlyph } from './AgentGlyphs';
import '../styles/agent-glyphs.css';
import {t}from'../i18n';
import { IconBook, IconChart, IconCheck, IconClock, IconCompass, IconFile, IconFocus, IconGlobe, IconSearch, IconSend, IconSettings, IconShield, IconSparkle, IconTarget, IconTerminal, IconTicket } from './Icons';

// Every catalog symbol needs an entry: the Record type makes a new symbol without an icon a type error.
const symbols: Record<Exclude<AgentSymbol, RoleGlyph>, typeof IconTicket> = { briefcase: IconTicket, search: IconSearch, pen: IconBook, chart: IconChart, compass: IconCompass, code: IconSparkle, spark: IconSparkle,
  bug: IconTarget, eye: IconFocus, globe: IconGlobe, server: IconTerminal, mail: IconSend, calendar: IconClock, book: IconFile, shield: IconShield, wrench: IconSettings, check: IconCheck };

export function AgentAvatar({ avatar, name, size = 28 }: { avatar: Avatar | undefined; name: string; size?: number }) {
  if (avatar?.kind === 'image' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar.dataUrl) && avatar.dataUrl.length <= 360_000) {
    return <img className="agent-avatar" src={avatar.dataUrl} alt={t('product.avatar',{name})} width={size} height={size} style={{ borderRadius: '50%', objectFit: 'cover' }} draggable={false} />;
  }
  const icon = avatar?.kind === 'symbol' ? avatar.value : 'briefcase';
  if (isRoleGlyph(icon)) {
    const tone = avatar?.kind === 'symbol' ? avatar.tone ?? 'blue' : 'blue';
    const colors = GLYPH_TONES[tone] ?? GLYPH_TONES.blue;
    const style = { width: size, height: size, '--glyph-dark-a': colors.dark[0], '--glyph-dark-b': colors.dark[1], '--glyph-light-a': colors.light[0], '--glyph-light-b': colors.light[1], '--glyph-dark-ink': GLYPH_INK.dark, '--glyph-light-ink': GLYPH_INK.light } as CSSProperties;
    return <span className="agent-avatar role-glyph" data-tone={tone} data-shadow={size >= 28} role="img" aria-label={t('product.avatar',{name})} style={style}><AgentGlyph symbol={icon} size={size} /></span>;
  }
  const Symbol = Object.hasOwn(symbols, icon) ? symbols[icon] : IconTicket;
  return <span className="agent-avatar symbol" data-tone={avatar?.kind === 'symbol' ? avatar.tone : undefined} role="img" aria-label={t('product.avatar',{name})} style={{ width: size, height: size }}><Symbol size={Math.round(size * 0.65)} /></span>;
}
