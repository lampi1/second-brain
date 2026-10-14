// The image an agent sees of a screenshot: scaled down so its long side is about 1000 px, as JPEG. Why: every image
// stays in the agent's context for the rest of the chat, and a 1920x1080 PNG costs about twice the tokens of a
// 960x540 one (the user, 2026-10-14: chats must spend fewer tokens). The scale is a round factor (1, 1.25, 1.5, 2 …)
// so "click coordinate = image px × factor" is easy to apply. Evidence files (save_to) stay full-size PNGs.
// Used by browser/tools.ts (screenshot) and appctl/tools.ts (app_screenshot); previewScale is pure and unit-tested.
import type { NativeImage } from 'electron';

/** long side the agent's image aims at; a factor is accepted while the long side stays within LONG_MAX */
export const LONG_TARGET = 1000;
const LONG_MAX = 1100;
const FACTORS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20];
const JPEG_QUALITY = 80;

/** The smallest round factor that brings the long side within LONG_MAX (beyond the list: exactly LONG_TARGET). */
export function previewScale(width: number, height: number): { factor: number; width: number; height: number } {
  const long = Math.max(width, height, 1);
  const factor = FACTORS.find(f => long / f <= LONG_MAX) ?? long / LONG_TARGET;
  return { factor, width: Math.max(1, Math.round(width / factor)), height: Math.max(1, Math.round(height / factor)) };
}

export interface Preview { data: string; mimeType: 'image/jpeg'; width: number; height: number; factor: number }

/** img scaled by previewScale, as base64 JPEG; factor = source px per preview px */
export function previewOf(img: NativeImage): Preview {
  const s = img.getSize();
  const p = previewScale(s.width, s.height);
  const out = p.factor === 1 ? img : img.resize({ width: p.width, height: p.height, quality: 'better' });
  const size = out.getSize();
  return { data: out.toJPEG(JPEG_QUALITY).toString('base64'), mimeType: 'image/jpeg', width: size.width, height: size.height, factor: p.factor };
}

/** "2", "1.5", "0.5": a factor as short text */
export function fmtFactor(f: number): string { return String(Math.round(f * 1000) / 1000); }
