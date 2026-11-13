// The agent's view of a screenshot (browser/preview.ts, browser/tools.ts shotMapping): the long side is scaled to
// ~1000 px by a round factor and the text tells how image px map back to click coordinates (fewer tokens per image).
import { describe, expect, it } from 'vitest';
import { fmtFactor, previewScale } from '../../src/main/browser/preview';
import { shotMapping } from '../../src/main/browser/tools';

describe('previewScale', () => {
  it('keeps small images as they are', () => {
    expect(previewScale(800, 600)).toEqual({ factor: 1, width: 800, height: 600 });
    expect(previewScale(1100, 400)).toEqual({ factor: 1, width: 1100, height: 400 });
  });
  it('picks the smallest round factor that brings the long side within ~1000 px', () => {
    expect(previewScale(1920, 1080)).toEqual({ factor: 2, width: 960, height: 540 });
    expect(previewScale(1600, 1000)).toEqual({ factor: 1.5, width: 1067, height: 667 });
    expect(previewScale(1280, 800)).toEqual({ factor: 1.25, width: 1024, height: 640 });
    expect(previewScale(1920, 16000)).toEqual({ factor: 16, width: 120, height: 1000 });
  });
  it('beyond the round factors scales to exactly 1000 px', () => {
    expect(previewScale(4000, 30000)).toEqual({ factor: 30, width: 133, height: 1000 });
  });
  it('never returns an empty size', () => {
    expect(previewScale(0, 0)).toEqual({ factor: 1, width: 1, height: 1 });
  });
  it('formats factors short', () => {
    expect(fmtFactor(2)).toBe('2');
    expect(fmtFactor(1 / 3)).toBe('0.333');
  });
});

describe('shotMapping', () => {
  const img = { width: 960, height: 540, factor: 2, mimeType: 'image/jpeg' };
  it('viewport: click coordinate = image px × factor', () => {
    expect(shotMapping({ scale: 1, origin: { x: 0, y: 0 } }, img)).toBe('Image 960x540 JPEG: click coordinate = image px × 2');
  });
  it('a zoomed region adds its origin and divides by the zoom', () => {
    expect(shotMapping({ scale: 2, origin: { x: 100, y: 50 } }, { ...img, width: 400, height: 200, factor: 1 }))
      .toBe('Image 400x200 JPEG: click coordinate = (100 + image x × 0.5, 50 + image y × 0.5)');
  });
  it('a capture in device px (display at 150%) still maps to CSS px', () => {
    // CDP returned 2880x1620 for a 1920x1080 viewport: scale 1.5, the preview divides it by 3
    expect(shotMapping({ scale: 1.5, origin: { x: 0, y: 0 } }, { ...img, factor: 3 })).toBe('Image 960x540 JPEG: click coordinate = image px × 2');
  });
  it('full page: page coordinates, not click coordinates', () => {
    expect(shotMapping({ scale: 1, origin: { x: 0, y: 0 }, page: true }, { ...img, factor: 4 })).toContain('page point = image px × 4');
  });
});
