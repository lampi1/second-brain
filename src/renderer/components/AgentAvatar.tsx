// Persistent agent identity: whitelisted professional symbols or validated raster data, never remote URLs or SVG.
import type { AgentAvatar as Avatar } from '@shared/agents';
import {t}from'../i18n';
import { IconBook, IconChart, IconCompass, IconSearch, IconSparkle, IconTicket } from './Icons';

export function AgentAvatar({ avatar, name, size = 28 }: { avatar: Avatar | undefined; name: string; size?: number }) {
  if (avatar?.kind === 'image' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar.dataUrl) && avatar.dataUrl.length <= 360_000) {
    return <img className="agent-avatar" src={avatar.dataUrl} alt={t('product.avatar',{name})} width={size} height={size} draggable={false} />;
  }
  const icon = avatar?.kind === 'symbol' ? avatar.value : 'briefcase';
  const symbols = { briefcase: IconTicket, search: IconSearch, pen: IconBook, chart: IconChart, compass: IconCompass, code: IconSparkle, spark: IconSparkle };
  const Symbol = symbols[icon] ?? IconTicket;
  return <span className="agent-avatar symbol" role="img" aria-label={t('product.avatar',{name})} style={{ width: size, height: size }}><Symbol size={Math.round(size * 0.65)} /></span>;
}
