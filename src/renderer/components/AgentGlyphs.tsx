// Trusted role glyph renderer for avatars and approval previews; unknown IDs degrade to the designed spark.
import { isRoleGlyph } from '@shared/agent-glyphs';
import { GLYPH_ART, GLYPH_METRICS, glyphSize } from '../lib/agent-glyph-art';

export function AgentGlyph({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const id = isRoleGlyph(symbol) ? symbol : 'role-spark';
  const art = GLYPH_ART[id], tuned = glyphSize(size), metrics = GLYPH_METRICS[tuned];
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" data-glyph={id} data-glyph-size={tuned}>
    <path d={art.accent} fill="currentColor" opacity=".3" />
    <path d={tuned === 16 && art.small ? art.small : art.outline} stroke="currentColor" strokeWidth={metrics.stroke} strokeLinecap="round" strokeLinejoin="round" />
    {metrics.detail && art.detail && <path d={art.detail} stroke="currentColor" strokeWidth={metrics.stroke} strokeLinecap="round" strokeLinejoin="round" />}
  </svg>;
}
