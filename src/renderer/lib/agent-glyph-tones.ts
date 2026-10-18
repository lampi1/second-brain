// Measured badge colors used by the renderer and approval sheets; contrast tests cover both gradient stops.
import type { AgentTone } from '../../shared/agents';
export interface GlyphTone { dark: [string, string]; light: [string, string] }
export const GLYPH_TONES: Record<AgentTone, GlyphTone> = {
  blue: { dark: ['#a8caff', '#83b5f4'], light: ['#245087', '#32649c'] },
  violet: { dark: ['#d2baff', '#b89aee'], light: ['#61408b', '#73539d'] },
  amber: { dark: ['#f6d18a', '#e9b65d'], light: ['#785019', '#896125'] },
  teal: { dark: ['#91dbca', '#68c5b2'], light: ['#235f57', '#2e7268'] },
  red: { dark: ['#ffb5b4', '#ed9494'], light: ['#893d43', '#9c4b51'] },
  slate: { dark: ['#c6ceda', '#a8b6c8'], light: ['#485565', '#5a6878'] },
  cyan: { dark: ['#91dbea', '#67c3d8'], light: ['#245d70', '#316f82'] },
  pink: { dark: ['#f0b8dc', '#dd98c6'], light: ['#803f6d', '#934e80'] },
  indigo: { dark: ['#c3c3ff', '#a7acef'], light: ['#4c4d8c', '#5e60a0'] },
  green: { dark: ['#b6dda2', '#91c57c'], light: ['#426431', '#50773e'] },
};
export const GLYPH_INK = { dark: '#15202b', light: '#ffffff' } as const;
