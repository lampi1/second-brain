// Persistent agent identity: whitelisted professional symbols or validated raster data, never remote URLs or SVG.
import type { AgentAvatar as Avatar, AgentSymbol } from '@shared/agents';
import {t}from'../i18n';
import { IconBook, IconChart, IconCheck, IconClock, IconCompass, IconFile, IconFocus, IconGlobe, IconSearch, IconSend, IconSettings, IconShield, IconSparkle, IconTarget, IconTerminal, IconTicket } from './Icons';

// Every catalog symbol needs an entry: the Record type makes a new symbol without an icon a type error.
const symbols: Record<AgentSymbol, typeof IconTicket> = { briefcase: IconTicket, search: IconSearch, pen: IconBook, chart: IconChart, compass: IconCompass, code: IconSparkle, spark: IconSparkle,
  bug: IconTarget, eye: IconFocus, globe: IconGlobe, server: IconTerminal, mail: IconSend, calendar: IconClock, book: IconFile, shield: IconShield, wrench: IconSettings, check: IconCheck };

export function AgentAvatar({ avatar, name, size = 28 }: { avatar: Avatar | undefined; name: string; size?: number }) {
  if (avatar?.kind === 'image' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar.dataUrl) && avatar.dataUrl.length <= 360_000) {
    return <img className="agent-avatar" src={avatar.dataUrl} alt={t('product.avatar',{name})} width={size} height={size} draggable={false} />;
  }
  const icon = avatar?.kind === 'symbol' ? avatar.value : 'briefcase';
  const Symbol = symbols[icon] ?? IconTicket;
  return <span className="agent-avatar symbol" data-tone={avatar?.kind === 'symbol' ? avatar.tone : undefined} role="img" aria-label={t('product.avatar',{name})} style={{ width: size, height: size }}><Symbol size={Math.round(size * 0.65)} /></span>;
}
